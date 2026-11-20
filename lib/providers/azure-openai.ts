import { AzureOpenAI } from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { withRetry } from "../web";
import type { AdapterFactory, ChatAdapter, ToolCall } from "./generic";

// Azure OpenAI (GPT deployments) through the Chat Completions API.

export const azureDeployment = () => process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4.1";

export const azureOpenAIAdapter: AdapterFactory = ({ system, firstMessage, tools, onWait }): ChatAdapter => {
  const deployment = azureDeployment();
  const client = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview",
    deployment,
  });
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: firstMessage },
  ];
  const fnTools: ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  return {
    async next(signal) {
      const res = await withRetry(
        () => client.chat.completions.create({ model: deployment, messages, tools: fnTools, max_completion_tokens: 32000 }, { signal }),
        signal,
        onWait,
      );
      const choice = res.choices[0];
      const msg = choice.message;
      messages.push(msg);

      const calls: ToolCall[] = [];
      for (const tc of msg.tool_calls ?? []) {
        if (tc.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = { __invalid_json: tc.function.arguments };
        }
        calls.push({ id: tc.id, name: tc.function.name, args });
      }

      return {
        calls,
        text: msg.content ?? "",
        thinking: "",
        usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 },
        truncated: choice.finish_reason === "length",
      };
    },

    addToolResults(results) {
      for (const { call, content } of results) messages.push({ role: "tool", tool_call_id: call.id, content });
    },

    addUserText(text) {
      messages.push({ role: "user", content: text });
    },

    async json(sys, user, signal) {
      const res = await withRetry(
        () =>
          client.chat.completions.create(
            {
              model: deployment,
              messages: [
                { role: "system", content: sys },
                { role: "user", content: user },
              ],
              response_format: { type: "json_object" },
              max_completion_tokens: 4000,
            },
            { signal },
          ),
        signal,
        onWait,
      );
      return res.choices[0]?.message.content ?? undefined;
    },

    cost: () => null, // depends on your deployment's pricing
  };
};
