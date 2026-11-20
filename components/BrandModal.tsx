"use client";

import { useState } from "react";
import { DEFAULT_BRAND, readLogo, type Brand } from "./useBrand";

const SWATCHES = ["#ff4f00", "#1f7a4d", "#2b59c3", "#7c3aed", "#c2185b", "#141413"];

export function BrandModal({ brand, onSave, onClose }: { brand: Brand; onSave: (b: Brand) => void; onClose: () => void }) {
  const [b, setB] = useState<Brand>(brand);
  const [err, setErr] = useState("");
  const set = (patch: Partial<Brand>) => setB((x) => ({ ...x, ...patch }));

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      set({ logo: await readLogo(f) });
      setErr("");
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal brand-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(b);
          onClose();
        }}
      >
        <div className="kicker">White label</div>
        <h2>Brand your reports.</h2>
        <p>Applied to every PDF you export. Saved in this browser.</p>

        {/* live preview of the PDF header */}
        <div className="brand-preview" style={{ ["--brand" as string]: b.accent }}>
          <div className="bp-row">
            <span className="bp-brand">
              {b.logo ? <img src={b.logo} alt="" /> : null}
              <strong>{b.name || "Your company"}</strong>
            </span>
            <span>Competitive analysis</span>
          </div>
          <div className="bp-title">Linear vs. the market</div>
          {b.preparedFor && <div className="bp-for">Prepared for {b.preparedFor}</div>}
          <div className="bp-rule" />
        </div>

        <label className="field small">
          <span className="field-label">Name</span>
          <input value={b.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your agency or company" maxLength={60} />
        </label>
        <label className="field small">
          <span className="field-label">For</span>
          <input value={b.preparedFor} onChange={(e) => set({ preparedFor: e.target.value })} placeholder="Client name (optional)" maxLength={80} />
        </label>
        <label className="field small">
          <span className="field-label">Footer</span>
          <input value={b.contact} onChange={(e) => set({ contact: e.target.value })} placeholder="hello@agency.com · agency.com" maxLength={120} />
        </label>

        <div className="brand-row">
          <span className="field-label">Colour</span>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button key={c} type="button" className={b.accent === c ? "on" : ""} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={`Accent ${c}`} />
            ))}
            <input type="color" value={b.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Custom accent colour" />
          </div>
        </div>
        <div className="brand-row">
          <span className="field-label">Logo</span>
          <label className="link">
            {b.logo ? "Replace logo" : "Upload logo"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={upload} hidden />
          </label>
          {b.logo && <button type="button" className="link" onClick={() => set({ logo: null })}>Remove</button>}
        </div>
        {err && <div className="err mono small">{err}</div>}

        <div className="modal-actions">
          <button type="button" className="link" onClick={() => setB(DEFAULT_BRAND)}>Reset</button>
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <button type="submit" className="run small"><span>Save</span><span className="run-arrow">→</span></button>
        </div>
      </form>
    </div>
  );
}
