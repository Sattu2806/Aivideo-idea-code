"use client";

import { AccessModal } from "@/components/AccessModal";
import { Arrow, Logo } from "@/components/Icons";
import { Landing } from "@/components/Landing";
import { useAgent } from "@/components/useAgent";
import { Workspace } from "@/components/Workspace";

export default function Home() {
  const agent = useAgent();
  const inRun = agent.phase !== "idle";

  return (
    <div className="app-chrome">
      <div className="noise" aria-hidden />
      <nav className="nav">
        <div className="nav-inner">
          <a className="brand" href="#top" onClick={() => inRun && agent.phase !== "running" && agent.reset()}>
            <Logo /> <span>Competitor Intel</span>
          </a>
          {!inRun && (
            <div className="nav-links">
              <a href="#how">How it works</a>
              <a href="#features">Features</a>
            </div>
          )}
          {!inRun ? (
            <a className="nav-cta" href="#top">
              Get started <Arrow width={14} height={14} />
            </a>
          ) : (
            <span className="nav-badge">{agent.phase === "running" ? "Agent running" : "Session"}</span>
          )}
        </div>
      </nav>

      <main>{inRun ? <Workspace agent={agent} /> : <Landing onRun={agent.run} locked={agent.accessRequired} />}</main>

      <footer className="footer">
        <div className="brand small"><Logo width={20} height={20} /> Competitor Intel</div>
        <span>Autonomous research agent built with Claude and Next.js</span>
      </footer>

      {agent.needsCode && <AccessModal onSubmit={agent.submitCode} onClose={() => agent.setNeedsCode(false)} />}
    </div>
  );
}
