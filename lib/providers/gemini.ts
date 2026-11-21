import { GoogleGenAI, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import { withRetry } from "../web";
import type { AdapterKit, ChatAdapter, ToolCall } from "./generic";

// Google Gemini (works with the free API key from aistudio.google.com).

export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.5-flash";
const isPaid = () => process.env.GEMINI_PAID === "true";
/** Lighter models to switch to when the main one is overloaded or hangs (free tiers often are). */
const fallbackModels = () =>
  (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
const CALL_TIMEOUT_MS = 90_000;
// Models found overloaded recently are skipped by later runs too (this server process).
const overloadedUntil = new Map<string, number>();
const OVERLOAD_MEMORY_MS = 10 * 60_000;

/**
 * Prepares history written by one model for another: thought text is dropped and
 * thought signatures (which only the model that wrote them can validate) are
 * replaced by the placeholder Gemini accepts for history from elsewhere.
 */
function forOtherModel(contents: Content[]): Content[] {
  return contents.map((c) => ({
    ...c,
    parts: (c.parts ?? [])
      .filter((p) => !p.thought)
      .map(({ thoughtSignature, ...p }) => (p.functionCall && thoughtSignature ? { ...p, thoughtSignature: "skip_thought_signature_validator" } : p)),
  }));
}

export function geminiKit(): AdapterKit {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const primary = geminiModel();
  const models = [primary, ...fallbackModels().filter((m) => m !== primary)];
  // Shared by every agent in the run: once a model is found overloaded, later calls start further down the list.
  let preferred = Math.max(0, models.findIndex((m) => (overloadedUntil.get(m) ?? 0) < Date.now()));
  let callSeq = 0;

  /** Calls the model, retrying, and moving to a fallback model when it's overloaded or hangs. */
  async function generate(
    call: (model: string, signal: AbortSignal) => Promise<GenerateContentResponse>,
    signal: AbortSignal,
    onWait: (s: number) => void,
    onSwitch: (model: string) => void,
  ): Promise<{ res: GenerateContentResponse; model: string }> {
    for (let i = preferred; i < models.length; i++) {
      const last = i === models.length - 1;
      try {
        const res = await withRetry(() => call(models[i], AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])), signal, onWait, last ? 5 : 2);
        return { res, model: models[i] };
      } catch (err) {
        if (signal.aborted || last) throw err;
        const status = (err as { status?: number }).status;
        const name = (err as { name?: string }).name;
        const overloaded = status === 503 || status === 500 || status === 429 || name === "AbortError" || name === "TimeoutError";
        if (!overloaded) throw err;
        overloadedUntil.set(models[i], Date.now() + OVERLOAD_MEMORY_MS);
        preferred = Math.max(preferred, i + 1);
        onSwitch(models[i + 1]);
      }
    }
    throw new Error("No Gemini model available.");
  }

  return {
    // Free keys allow only a few requests a minute, so researchers take turns.
    concurrency: isPaid() ? 4 : 2,

    chat({ system, firstMessage, tools, onWait, onNotice }): ChatAdapter {
      const contents: Content[] = [{ role: "user", parts: [{ text: firstMessage }] }];
      let historyModel: string | null = null; // the model that wrote the model turns so far
      const onSwitch = (m: string) => onNotice(`The main Gemini model is overloaded — switching to ${m}…`);
      const functionDeclarations = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters }));
      return {
        async next(signal) {
          const { res, model } = await generate(
            (model, sig) =>
              ai.models.generateContent({
                model,
                contents: historyModel && historyModel !== model ? forOtherModel(contents) : contents,
                config: {
                  systemInstruction: system,
                  tools: [{ functionDeclarations }],
                  thinkingConfig: { includeThoughts: true },
                  maxOutputTokens: 32000,
                  abortSignal: sig,
                },
              }),
            signal,
            onWait,
            onSwitch,
          );
          if (historyModel && historyModel !== model) contents.splice(0, contents.length, ...forOtherModel(contents));
          historyModel = model;
          const candidate = res.candidates?.[0];
          const parts: Part[] = candidate?.content?.parts ?? [];
          contents.push({ role: "model", parts }); // as returned: keeps thought signatures intact

          const calls: ToolCall[] = parts
            .filter((p) => p.functionCall?.name)
            .map((p) => ({
              id: p.functionCall!.id ?? `gm_${++callSeq}`,
              name: p.functionCall!.name!,
              args: (p.functionCall!.args ?? {}) as Record<string, unknown>,
            }));
          return {
            calls,
            text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(""),
            thinking: parts.filter((p) => p.text && p.thought).map((p) => p.text).join("\n"),
            usage: {
              input: res.usageMetadata?.promptTokenCount ?? 0,
              output: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0),
            },
            truncated: candidate?.finishReason === "MAX_TOKENS",
          };
        },
        addToolResults(results) {
          contents.push({
            role: "user",
            parts: results.map(({ call, content, isError }) => ({
              functionResponse: {
                ...(call.id.startsWith("gm_") ? {} : { id: call.id }),
                name: call.name,
                response: isError ? { error: content } : { output: content },
              },
            })),
          });
        },
        addUserText(text) {
          contents.push({ role: "user", parts: [{ text }] });
        },
      };
    },

    async json(system, user, schema, signal, onWait, onNotice) {
      const { res } = await generate(
        (model, sig) =>
          ai.models.generateContent({
            model,
            contents: user,
            config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema, abortSignal: sig },
          }),
        signal,
        onWait,
        (m) => onNotice(`The main Gemini model is overloaded — switching to ${m}…`),
      );
      return res.text;
    },

    // Free tier. On a paid key the cost depends on the model; we don't guess.
    cost: () => (isPaid() ? null : 0),
  };
}
