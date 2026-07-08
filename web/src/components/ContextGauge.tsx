import type { SessionSnapshot } from "../types.js";

interface Props { snapshot?: SessionSnapshot }

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function ContextGauge({ snapshot }: Props) {
  const ctx = snapshot?.context;
  if (!ctx) return null;

  const pct = ctx.limit > 0 ? Math.min(100, (ctx.tokens / ctx.limit) * 100) : 0;
  const level = pct >= 90 ? "red" : pct >= 75 ? "amber" : "ok";

  return (
    <div className={`ctx-gauge ${level}`} role="meter"
         aria-label="context window occupancy"
         aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className="ctx-label">
        Context <b>{Math.round(pct)}%</b> · {fmtTokens(ctx.tokens)} / {fmtTokens(ctx.limit)} tokens
      </span>
      {ctx.burn && (
        <span className="ctx-burn" title={`median ${fmtTokens(ctx.burn.median)} · current ${fmtTokens(ctx.burn.currentNew)}`}>
          🔥 burning {ctx.burn.ratio.toFixed(1)}× median
        </span>
      )}
      <span className="ctx-bar" aria-hidden="true">
        <span className="ctx-fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
