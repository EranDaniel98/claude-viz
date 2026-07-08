interface RedactionRule {
  name: string;
  pattern: RegExp;
}

const RULES: RedactionRule[] = [
  { name: "aws-key",   pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "gh-token",  pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: "sk-key",    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "slack",     pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "bearer",    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g },
  { name: "pem",       pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g },
];

export interface RedactResult {
  value: string;
  count: number;
}

export function redactString(input: string): RedactResult {
  let count = 0;
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, () => {
      count++;
      return `[REDACTED:${rule.name}]`;
    });
  }
  return { value: out, count };
}

/** Deep-redact any JSON value. Returns [newValue, totalCount]. */
export function redactValue(v: unknown): { value: unknown; count: number } {
  if (typeof v === "string") {
    const r = redactString(v);
    return { value: r.value, count: r.count };
  }
  if (Array.isArray(v)) {
    let total = 0;
    const out = v.map((item) => {
      const r = redactValue(item);
      total += r.count;
      return r.value;
    });
    return { value: out, count: total };
  }
  if (v && typeof v === "object") {
    let total = 0;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const r = redactValue(val);
      total += r.count;
      out[k] = r.value;
    }
    return { value: out, count: total };
  }
  return { value: v, count: 0 };
}
