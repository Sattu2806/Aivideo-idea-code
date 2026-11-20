"use client";

import { useState } from "react";
import { Lock } from "./Icons";

export function AccessModal({ onSubmit, onClose }: { onSubmit: (code: string) => Promise<boolean>; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setWrong(false);
    const ok = await onSubmit(code.trim());
    setBusy(false);
    if (!ok) setWrong(true);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className={`modal ${wrong ? "shake" : ""}`} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-icon"><Lock width={22} height={22} /></div>
        <h2>Enter access code</h2>
        <p>This demo is private. Enter the code you were given to run the agent.</p>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          autoFocus
          aria-invalid={wrong}
        />
        {wrong && <div className="modal-error">That code isn&apos;t right. Try again.</div>}
        <div className="modal-actions">
          <button type="button" className="tool-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary sm" disabled={!code.trim() || busy}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
