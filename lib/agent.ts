import Anthropic from "@anthropic-ai/sdk";
import { AnthropicFoundry } from "@anthropic-ai/foundry-sdk";
import type { AgentEvent, ProviderInfo, RunRequest } from "./events";
import { azureDeployment, azureOpenAIKit } from "./providers/azure-openai";
import { makeClaudeProvider } from "./providers/claude";
import { geminiKit, geminiModel } from "./providers/gemini";
import { makeGenericProvider } from "./providers/generic";
import type { Provider } from "./providers/types";
import { runTeam } from "./team";
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

function buildProvider(info: ProviderInfo): Provider {
  switch (info.id) {
    case "anthropic":
      return makeClaudeProvider({ client: new Anthropic(), info, platform: "anthropic", price: CLAUDE_PRICE });
    case "foundry":
      return makeClaudeProvider({ client: new AnthropicFoundry(), info, platform: "foundry", price: CLAUDE_PRICE });
    case "gemini":
      return makeGenericProvider(info, webToolsLabel(info), geminiKit());
    case "azure-openai":
      return makeGenericProvider(info, webToolsLabel(info), azureOpenAIKit());
  }
}

export async function runAgent(req: RunRequest, emit: (e: AgentEvent) => void, signal: AbortSignal) {
  const info = activeProvider();
  if (!info) {
    throw new Error(
      "No AI provider is configured. Add GEMINI_API_KEY (free at aistudio.google.com), ANTHROPIC_API_KEY, Azure OpenAI or Claude on Azure settings to .env.local.",
    );
  }
  const provider = buildProvider(info);
  emit({ type: "meta", provider: info, search: provider.webLabel });
  await runTeam(provider, req, emit, signal);
}
