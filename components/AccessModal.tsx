"use client";

import { useState } from "react";

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
        <div className="kicker">Restricted</div>
        <h2>Enter the access code.</h2>
        <p>This demo is private. Use the code you were given.</p>
        <label className="field">
          <span className="field-label">Code</span>
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-invalid={wrong} />
        </label>
        {wrong && <div className="err mono small">Wrong code. Try again.</div>}
        <div className="modal-actions">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <button type="submit" className="run small" disabled={!code.trim() || busy}>
            <span>{busy ? "Checking" : "Unlock"}</span><span className="run-arrow">→</span>
          </button>
        </div>
      </form>
    </div>
  );
}
