"use client";

import { AccessModal } from "@/components/AccessModal";
import { Landing } from "@/components/Landing";
import { useAgent } from "@/components/useAgent";
import { Workspace } from "@/components/Workspace";

export default function Home() {
  const agent = useAgent();
  const inRun = agent.phase !== "idle";
  const lamp = agent.phase === "running" ? "on" : agent.phase === "error" ? "err" : "";

  return (
    <div className="app-chrome">
      <header className="topbar">
        <button className="wordmark" onClick={() => agent.phase !== "running" && agent.reset()}>
          INTEL<span>/</span>01
        </button>
        <div className="topbar-meta">
          <span className={`lamp ${lamp}`} />
          <span className="meta-text">
            {agent.phase === "running" ? "Agent working" : agent.phase === "done" ? "Report filed" : "Autonomous research agent"}
            {agent.provider && <span className="dim"> · {agent.provider.label}</span>}
          </span>
        </div>
      </header>

      <main>
        {inRun ? (
          <Workspace agent={agent} />
        ) : (
          <Landing
            onRun={agent.run}
            locked={agent.accessRequired}
            provider={agent.provider}
            searchBackend={agent.searchBackend}
            history={agent.history}
            onOpen={agent.openSaved}
            onRemove={agent.removeSaved}
          />
        )}
      </main>

      <footer className="footer">
        <span>Intel/01 — competitor research, done by an agent.</span>
        <span>Built with Claude</span>
      </footer>

      {agent.needsCode && <AccessModal onSubmit={agent.submitCode} onClose={() => agent.setNeedsCode(false)} />}
    </div>
  );
}
