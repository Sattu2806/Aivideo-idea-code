import type { Change, Competitor } from "../events";

// Compares two sets of competitor profiles. Deterministic, so the change list
// doesn't depend on the model noticing differences.

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();

/** Prices mentioned in a pricing string, e.g. "$8.60/user, $17 Premium" → ["8.60", "17"]. */
export function pricesIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

export function compareCompetitors(before: Competitor[], after: Competitor[]): Change[] {
  const changes: Change[] = [];
  const key = (c: Competitor) => norm(c.name);
  const prev = new Map(before.map((c) => [key(c), c]));
  const next = new Map(after.map((c) => [key(c), c]));

  for (const [k, c] of next) {
    const old = prev.get(k);
    if (!old) {
      changes.push({ kind: "new", company: c.name, after: c.pricing });
      continue;
    }
    // A pricing change means the numbers changed, not just the wording.
    const a = pricesIn(old.pricing).join(",");
    const b = pricesIn(c.pricing).join(",");
    if (a !== b && (a || b)) changes.push({ kind: "pricing", company: c.name, before: old.pricing, after: c.pricing });
    if (old.threat_level !== c.threat_level) changes.push({ kind: "threat", company: c.name, before: old.threat_level, after: c.threat_level });
  }
  for (const [k, c] of prev) if (!next.has(k)) changes.push({ kind: "removed", company: c.name, before: c.pricing });
  return changes;
}

export function describeChange(c: Change): string {
  switch (c.kind) {
    case "new":
      return `New competitor: ${c.company}`;
    case "removed":
      return `No longer in the report: ${c.company}`;
    case "pricing":
      return `${c.company} pricing changed: ${c.before} → ${c.after}`;
    case "threat":
      return `${c.company} threat level: ${c.before} → ${c.after}`;
  }
}
