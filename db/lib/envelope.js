// Standard result envelope and evidence ledger shared by every db tool.
//
// Every tool returns { ok, data, evidence[], coverage, warnings[] }.
// Evidence items are the only thing the AI may cite; ids are `ev1`, `ev2`, ...
// and are unique within one analysis.

export class Ledger {
  constructor(start = 0) {
    this.start = start;
    this.items = [];
  }

  /** A per-tool view: items added through it are returned in that tool's envelope. */
  scope() {
    const mine = [];
    return {
      items: mine,
      add: (item) => {
        const full = { id: `ev${this.start + this.items.length + 1}`, ...item };
        this.items.push(full);
        mine.push(full);
        return full.id;
      },
    };
  }
}

/** confidence from sample size n: none / low / medium / high */
export function confidenceFromN(n, { low = 8, high = 30 } = {}) {
  if (!n) return "none";
  if (n < low) return "low";
  if (n < high) return "medium";
  return "high";
}

export function envelope({ data, scope, coverage = {}, warnings = [] }) {
  return {
    ok: true,
    data,
    evidence: scope ? scope.items : [],
    coverage: { confidence: "none", ...coverage },
    warnings,
  };
}

export function noData(scope, warning, coverage = {}) {
  return envelope({ data: null, scope, coverage: { confidence: "none", ...coverage }, warnings: [warning] });
}
