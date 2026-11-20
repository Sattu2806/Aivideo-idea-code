import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { withRetry } from "../web";
import type { AdapterFactory, ChatAdapter, ToolCall } from "./generic";

// Google Gemini (works with the free API key from aistudio.google.com).

export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

export const geminiAdapter: AdapterFactory = ({ system, firstMessage, tools, onWait }): ChatAdapter => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = geminiModel();
  const contents: Content[] = [{ role: "user", parts: [{ text: firstMessage }] }];
  const functionDeclarations = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters }));
  let callSeq = 0;

  return {
    async next(signal) {
      const res = await withRetry(
        () =>
          ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: system,
              tools: [{ functionDeclarations }],
              thinkingConfig: { includeThoughts: true },
              maxOutputTokens: 32000,
              abortSignal: signal,
            },
          }),
        signal,
        onWait,
      );

      const candidate = res.candidates?.[0];
      const parts: Part[] = candidate?.content?.parts ?? [];
      // Append the model turn exactly as returned (keeps thought signatures intact).
      contents.push({ role: "model", parts });

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

    async json(sys, user, signal) {
      const res = await withRetry(
        () =>
          ai.models.generateContent({
            model,
            contents: user,
            config: {
              systemInstruction: sys,
              responseMimeType: "application/json",
              responseJsonSchema: {
                type: "object",
                properties: { approved: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
                required: ["approved", "issues"],
              },
              abortSignal: signal,
            },
          }),
        signal,
        onWait,
      );
      return res.text;
    },

    // Free tier. On a paid key the cost depends on the model; we don't guess.
    cost: () => (process.env.GEMINI_PAID === "true" ? null : 0),
  };
};
