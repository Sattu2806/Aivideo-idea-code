import Anthropic from "@anthropic-ai/sdk";
import { AnthropicFoundry } from "@anthropic-ai/foundry-sdk";
import type { AgentEvent, ProviderInfo, RunRequest } from "./events";
import { azureDeployment, azureOpenAIAdapter } from "./providers/azure-openai";
import { runClaude } from "./providers/claude";
import { geminiAdapter, geminiModel } from "./providers/gemini";
import { runGeneric } from "./providers/generic";
import { searchBackend } from "./web";

// ---------------------------------------------------------------------------
// Provider selection. Set AI_PROVIDER, or leave it empty and the first
// configured key wins: Claude API → Claude on Azure → Gemini → Azure OpenAI.
// ---------------------------------------------------------------------------

type ProviderId = ProviderInfo["id"];

const CLAUDE_PRICE = { input: 4, output: 20, cacheRead: 0.2 }; // Claude Opus 5.5 list price, USD / 1M tokens

function configured(): Record<ProviderId, boolean> {
  const env = process.env;
  return {
    anthropic: !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    foundry: !!(env.ANTHROPIC_FOUNDRY_API_KEY && (env.ANTHROPIC_FOUNDRY_RESOURCE || env.ANTHROPIC_FOUNDRY_BASE_URL)),
    gemini: !!env.GEMINI_API_KEY,
    "azure-openai": !!(env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_ENDPOINT),
  };
}

export function activeProvider(): ProviderInfo | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase() as ProviderId | undefined;
  const ok = configured();
  const id: ProviderId | undefined =
    forced && forced in ok ? forced : (["anthropic", "foundry", "gemini", "azure-openai"] as ProviderId[]).find((p) => ok[p]);
  if (!id) return null;

  switch (id) {
    case "anthropic":
      return { id, label: "Claude", model: process.env.CLAUDE_MODEL || "claude-opus-5-5", free: false };
    case "foundry":
      return { id, label: "Claude on Azure", model: process.env.FOUNDRY_MODEL || "claude-opus-5-5", free: false };
    case "gemini":
      return { id, label: "Gemini", model: geminiModel(), free: process.env.GEMINI_PAID !== "true" };
    case "azure-openai":
      return { id, label: "Azure OpenAI", model: azureDeployment(), free: false };
  }
}

export function webToolsLabel(p: ProviderInfo) {
  return p.id === "anthropic" || p.id === "foundry" ? "built-in" : searchBackend();
}

export async function runAgent(req: RunRequest, emit: (e: AgentEvent) => void, signal: AbortSignal) {
  const provider = activeProvider();
  if (!provider) {
    throw new Error(
      "No AI provider is configured. Add GEMINI_API_KEY (free at aistudio.google.com), ANTHROPIC_API_KEY, Azure OpenAI or Claude on Azure settings to .env.local.",
    );
  }
  emit({ type: "meta", provider, search: webToolsLabel(provider) });

  switch (provider.id) {
    case "anthropic":
      return runClaude({ client: new Anthropic(), model: provider.model, platform: "anthropic", price: CLAUDE_PRICE }, req, emit, signal);
    case "foundry":
      return runClaude({ client: new AnthropicFoundry(), model: provider.model, platform: "foundry", price: CLAUDE_PRICE }, req, emit, signal);
    case "gemini":
      return runGeneric(geminiAdapter, req, emit, signal);
    case "azure-openai":
      return runGeneric(azureOpenAIAdapter, req, emit, signal);
  }
}
