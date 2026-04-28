import { Card, Badge } from "./ui";
import { palette } from "../styles/tokens";
import {
  formatClusterKey,
  INSUFFICIENT_COPY,
  type PeersData,
  type PeerRow,
} from "../lib/peers";

/**
 * F4 — Comparable launches (empirical baseline).
 *
 * Renders three view states:
 *   1. cluster-found  → header + (n=N) + per-rank IQR + diff bar
 *   2. insufficient   → fail-loud message, NO numbers, NO fallback
 *   3. loading        → header + skeleton bars
 *
 * Copy and visual treatment are locked. Do NOT add prescriptive wording
 * ("you should" / "we recommend"). Do NOT soften the insufficient message —
 * its presence is itself a reliability signal.
 */
export function PeersSection({ peers }: { peers: PeersData }) {
  if (peers.kind === "loading") {
    return (
      <Card>
        <header className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="font-display text-lg">Comparable launches</h3>
            <p className="text-xs text-ink-subtle mt-1">
              Tokens with similar profile have settled at the splits below.
            </p>
          </div>
          <Badge tone="muted">{formatClusterKey(peers.cluster)}</Badge>
        </header>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-6 rounded animate-pulse"
              style={{
                background: palette.bg,
                border: `1px solid ${palette.border}`,
              }}
            />
          ))}
        </div>
        <p className="text-xs text-ink-subtle mt-4 italic">
          Loading peer baseline…
        </p>
      </Card>
    );
  }

  if (peers.kind === "insufficient") {
    return (
      <Card>
        <header className="flex items-baseline justify-between mb-2">
          <h3 className="font-display text-lg">Comparable launches</h3>
          <Badge tone="muted">n={peers.n}</Badge>
        </header>
        <p className="text-sm text-ink-muted mb-1">
          Cluster: {formatClusterKey(peers.cluster)}
        </p>
        <p
          className="text-sm mt-3 italic"
          style={{ color: palette.warning }}
        >
          {INSUFFICIENT_COPY}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <header className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="font-display text-lg">Comparable launches</h3>
          <p className="text-xs text-ink-subtle mt-1">
            {peers.n} tokens with similar profile · {formatClusterKey(peers.cluster)}
          </p>
        </div>
        <Badge tone="accent">n={peers.n}</Badge>
      </header>

      <PeersTable rows={peers.rows} />

      <p className="text-xs text-ink-subtle mt-4 tabular">
        Median: central tendency · IQR: middle 50% of peers
      </p>
    </Card>
  );
}

function PeersTable({ rows }: { rows: PeerRow[] }) {
  // Domain max for shared scale across rows (so bars are visually comparable).
  const domainMax = rows.reduce(
    (m, r) => Math.max(m, r.currentBps, r.p75Bps, r.medianBps),
    0,
  );
  // Round up to nearest 500 BPS for a cleaner visual ceiling.
  const ceiling = Math.max(500, Math.ceil(domainMax / 500) * 500);

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-ink-subtle">
            <th className="text-left px-2 py-2">Rank</th>
            <th className="text-right px-2 py-2">Your BPS</th>
            <th className="text-right px-2 py-2">Cluster median</th>
            <th className="text-left px-2 py-2 w-1/2">IQR (p25–p75) · current</th>
            <th className="text-right px-2 py-2">Δ vs median</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const delta = r.currentBps - r.medianBps;
            return (
              <tr
                key={r.rank}
                className="border-t"
                style={{ borderColor: palette.border }}
              >
                <td className="px-2 py-3 tabular text-xs text-ink-muted">
                  #{r.rank + 1}
                </td>
                <td className="px-2 py-3 text-right tabular">
                  {r.currentBps.toLocaleString()} BPS
                  <span className="text-ink-subtle text-xs ml-2">
                    ({(r.currentBps / 100).toFixed(1)}%)
                  </span>
                </td>
                <td className="px-2 py-3 text-right tabular text-ink-muted">
                  {r.medianBps.toLocaleString()}
                </td>
                <td className="px-2 py-3">
                  <IqrBar
                    p25={r.p25Bps}
                    median={r.medianBps}
                    p75={r.p75Bps}
                    current={r.currentBps}
                    ceiling={ceiling}
                  />
                </td>
                <td className="px-2 py-3 text-right tabular text-xs text-ink-muted">
                  {delta === 0
                    ? "—"
                    : `${delta > 0 ? "+" : ""}${delta.toLocaleString()}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Horizontal IQR bar with median dot + current marker.
 *   ├──[p25 ████████ p75]──┤   ◆ = median   ▮ = current
 *
 * The current marker is a single neutral color regardless of in/out IQR.
 * Two-toning the marker by in/out implies a verdict ("you should be in the
 * green band"); median + IQR shading carry the color because they are data
 * points, the current position stays neutral so the user reads position
 * rather than judgment.
 */
function IqrBar({
  p25,
  median,
  p75,
  current,
  ceiling,
}: {
  p25: number;
  median: number;
  p75: number;
  current: number;
  ceiling: number;
}) {
  const pct = (v: number) => `${Math.min(100, (v / ceiling) * 100)}%`;
  const iqrLeft = pct(p25);
  const iqrWidth = `${Math.max(0, ((p75 - p25) / ceiling) * 100)}%`;
  return (
    <div
      className="relative h-6"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 4,
      }}
    >
      {/* IQR shaded range — semantic success (data, not verdict) */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: iqrLeft,
          width: iqrWidth,
          background: palette.successSoft,
          borderLeft: `1px solid ${palette.success}`,
          borderRight: `1px solid ${palette.success}`,
        }}
        aria-label={`p25 ${p25} to p75 ${p75}`}
      />
      {/* Median dot — semantic success */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
        style={{
          left: pct(median),
          background: palette.success,
        }}
        aria-label={`median ${median}`}
      />
      {/* Current marker — neutral ink, regardless of in/out IQR */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: pct(current),
          width: 2,
          marginLeft: -1,
          background: palette.ink,
        }}
        aria-label={`current ${current}`}
      />
    </div>
  );
}
