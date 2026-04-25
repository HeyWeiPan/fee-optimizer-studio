import type { Route } from "./+types/token.$mint.simulate";
import { Link } from "react-router";
import { useMemo, useState } from "react";
import { loader as tokenApiLoader } from "./api.token.$mint";
import type { TokenView } from "./api.token.$mint";
import { palette } from "../styles/tokens";
import {
  Badge,
  Card,
  PageShell,
  Stat,
  fmtSolNum,
  shortAddr,
} from "../components/ui";

/**
 * F3 — Split simulator.
 *
 * Reuses the F2 loader (full TokenView). All editing is client-side; nothing
 * is persisted. The "apply" CTA will wire to the on-chain admin update once
 * wallet signing is live; until then this surface is a pure preview.
 *
 * Projection model (closed-form, mass-conserving):
 *   projected_i = gross30d * newBps_i / sum(newBps where > 0)
 *   delta_i     = projected_i - actual30d_i
 *   sum(delta)  = 0   ← invariant guarded by sum==10000 client check
 */

export function meta({ params }: Route.MetaArgs) {
  return [
    {
      title: `Simulate · ${params.mint?.slice(0, 8) ?? "Token"} · Fee Optimizer Studio`,
    },
  ];
}

export const loader = tokenApiLoader;

const LAMPORTS_PER_SOL = 1_000_000_000;

function lamportsStrToSol(s: string): number {
  // BigInt-safe lamports → SOL conversion.
  const big = BigInt(s);
  const whole = big / BigInt(LAMPORTS_PER_SOL);
  const frac = big % BigInt(LAMPORTS_PER_SOL);
  return Number(whole) + Number(frac) / LAMPORTS_PER_SOL;
}

export default function SimulatePage({ loaderData }: Route.ComponentProps) {
  const data = loaderData as TokenView;
  const { mint, feeConfig, thirty } = data;

  const initialNew = useMemo(
    () =>
      Object.fromEntries(
        feeConfig.claimers.map((c) => [c.wallet, c.basisPoints] as const),
      ),
    [feeConfig.claimers],
  );

  const [newBps, setNewBps] = useState<Record<string, number>>(initialNew);

  const newTotalBps = useMemo(
    () => Object.values(newBps).reduce((s, v) => s + v, 0),
    [newBps],
  );
  const newActiveTotalBps = useMemo(
    () => Object.values(newBps).reduce((s, v) => (v > 0 ? s + v : s), 0),
    [newBps],
  );

  const isValid = newTotalBps === 10000;
  const isDirty = useMemo(
    () =>
      feeConfig.claimers.some((c) => newBps[c.wallet] !== c.basisPoints),
    [newBps, feeConfig.claimers],
  );

  const gross30dSol = lamportsStrToSol(thirty.gross30dTotalLamports);

  const rows = feeConfig.claimers.map((c) => {
    const actualLamports = thirty.actual30dByWalletLamports[c.wallet] ?? "0";
    const actualSol = lamportsStrToSol(actualLamports);
    const newB = newBps[c.wallet] ?? 0;
    const projectedSol =
      newB > 0 && newActiveTotalBps > 0
        ? (gross30dSol * newB) / newActiveTotalBps
        : 0;
    const deltaSol = projectedSol - actualSol;
    return {
      claimer: c,
      actualSol,
      projectedSol,
      deltaSol,
      newBps: newB,
    };
  });

  const sumDelta = rows.reduce((s, r) => s + r.deltaSol, 0);

  const updateBps = (wallet: string, value: number) => {
    setNewBps((prev) => ({ ...prev, [wallet]: Math.max(0, Math.min(10000, Math.floor(value || 0))) }));
  };

  const reset = () => setNewBps(initialNew);

  return (
    <PageShell>
      <div className="space-y-8">
        <nav className="flex items-center gap-3 text-xs uppercase tracking-widest text-ink-subtle">
          <Link to="/" className="hover:text-ink">
            ← all tokens
          </Link>
          <span>·</span>
          <Link to={`/token/${mint}`} className="hover:text-ink">
            inspector
          </Link>
        </nav>

        <header className="space-y-2">
          <h1 className="font-display text-4xl">Split simulator</h1>
          <p className="text-ink-muted text-sm leading-relaxed max-w-2xl">
            Edit each claimer's basis points and see how the same 30-day claim
            flow would have been distributed under the new split. The simulator
            is read-only — nothing is written on-chain until you click{" "}
            <em>Apply</em>.
          </p>
          <p className="text-ink-subtle text-xs leading-relaxed max-w-2xl">
            Projected based on the last 30 days of <em>claimed</em> fees.
            Unclaimed accrued fees are not included — a claimer who never
            pulled their share will appear as <em>actual = 0</em>, even if
            their old BPS entitled them to a slice of gross flow.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <Stat
              label="30-day gross"
              value={`${fmtSolNum(gross30dSol)} SOL`}
              hint="all claimers, last 30 days"
              tone="accent"
            />
          </Card>
          <Card>
            <Stat
              label="New BPS sum"
              value={newTotalBps.toLocaleString()}
              hint={
                isValid
                  ? "balanced ✓"
                  : `${newTotalBps > 10000 ? "+" : ""}${newTotalBps - 10000} from 10000`
              }
              tone={isValid ? "success" : "danger"}
            />
          </Card>
          <Card>
            <Stat
              label="Net redistribution"
              value={
                Math.abs(sumDelta) < 0.000001
                  ? "0 SOL"
                  : `${sumDelta > 0 ? "+" : ""}${fmtSolNum(sumDelta)} SOL`
              }
              hint="should be 0 if BPS sums to 10000"
              tone={Math.abs(sumDelta) < 0.001 ? "success" : "warning"}
            />
          </Card>
        </div>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg">Editable split</h3>
            <div className="flex gap-2">
              <button
                onClick={reset}
                disabled={!isDirty}
                className="h-9 px-4 rounded-md text-xs font-medium uppercase tracking-wide disabled:opacity-40"
                style={{
                  background: "transparent",
                  color: palette.inkMuted,
                  border: `1px solid ${palette.borderStrong}`,
                }}
              >
                Reset
              </button>
              <button
                disabled={!isValid || !isDirty}
                title={
                  !isValid
                    ? "BPS must sum to 10000"
                    : !isDirty
                    ? "No changes to apply"
                    : "Build update-config tx (coming soon)"
                }
                className="h-9 px-4 rounded-md text-xs font-medium uppercase tracking-wide disabled:opacity-40"
                style={{
                  background: palette.accent,
                  color: palette.accentInk,
                }}
              >
                Apply split
              </button>
            </div>
          </div>

          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-xs uppercase tracking-wider text-ink-subtle"
                  style={{ borderBottom: `1px solid ${palette.border}` }}
                >
                  <th className="text-left px-2 py-2">Claimer</th>
                  <th className="text-right px-2 py-2">Current</th>
                  <th className="text-right px-2 py-2">New</th>
                  <th className="text-right px-2 py-2">Actual 30d</th>
                  <th className="text-right px-2 py-2">Projected 30d</th>
                  <th className="text-right px-2 py-2">Delta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <SimRow
                    key={r.claimer.wallet}
                    row={r}
                    colorIndex={i}
                    onChangeBps={(v) => updateBps(r.claimer.wallet, v)}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr
                  style={{ borderTop: `2px solid ${palette.border}` }}
                  className="font-medium"
                >
                  <td className="px-2 py-3 text-xs uppercase tracking-wider text-ink-subtle">
                    Total
                  </td>
                  <td className="px-2 py-3 text-right tabular text-ink-muted">
                    {feeConfig.totalBps.toLocaleString()}
                  </td>
                  <td className="px-2 py-3 text-right tabular">
                    <span
                      style={{
                        color: isValid ? palette.success : palette.danger,
                      }}
                    >
                      {newTotalBps.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-right tabular text-ink-muted">
                    {fmtSolNum(gross30dSol)} SOL
                  </td>
                  <td className="px-2 py-3 text-right tabular text-ink-muted">
                    {fmtSolNum(gross30dSol)} SOL
                  </td>
                  <td className="px-2 py-3 text-right tabular text-ink-subtle">
                    {Math.abs(sumDelta) < 0.000001
                      ? "0"
                      : fmtSolNum(Math.abs(sumDelta), 6)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <p className="text-xs text-ink-subtle">
          <em>Apply split</em> will wire the on-chain admin update once wallet
          signing is live. Until then this is a pure preview.
        </p>
      </div>
    </PageShell>
  );
}

function SimRow({
  row,
  colorIndex,
  onChangeBps,
}: {
  row: {
    claimer: TokenView["feeConfig"]["claimers"][number];
    actualSol: number;
    projectedSol: number;
    deltaSol: number;
    newBps: number;
  };
  colorIndex: number;
  onChangeBps: (v: number) => void;
}) {
  const { claimer: c } = row;
  const isPromotion = c.basisPoints === 0 && row.newBps > 0;
  const isDemotion = c.basisPoints > 0 && row.newBps === 0;
  const color = palette.chart[colorIndex % palette.chart.length];

  return (
    <tr
      className="border-t"
      style={{ borderColor: palette.border }}
    >
      <td className="px-2 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: color }}
          />
          <div className="flex flex-col">
            <span className="font-medium">
              {c.display.username ||
                (c.display.twitter ? `@${c.display.twitter}` : shortAddr(c.wallet))}
            </span>
            <span className="text-xs text-ink-subtle tabular">
              {shortAddr(c.wallet)}
            </span>
          </div>
        </div>
        <div className="flex gap-1 mt-1">
          {c.isAdmin && <Badge tone="accent">admin</Badge>}
          {isPromotion && <Badge tone="success">promoting</Badge>}
          {isDemotion && <Badge tone="warning">removing</Badge>}
          {c.basisPoints === 0 && row.newBps === 0 && (
            <Badge tone="muted">display only · raise to give a share</Badge>
          )}
        </div>
      </td>
      <td className="px-2 py-3 text-right tabular text-ink-muted text-xs whitespace-nowrap">
        {c.basisPoints === 0 ? (
          <span className="text-ink-subtle">0</span>
        ) : (
          <>
            {c.basisPoints.toLocaleString()}{" "}
            <span className="text-ink-subtle">BPS</span>
          </>
        )}
      </td>
      <td className="px-2 py-3 text-right">
        <input
          type="number"
          min={0}
          max={10000}
          step={50}
          value={row.newBps}
          onChange={(e) => onChangeBps(Number(e.target.value))}
          className="w-24 h-9 px-2 rounded text-right tabular text-sm"
          style={{
            background: palette.bg,
            border: `1px solid ${
              row.newBps !== c.basisPoints
                ? palette.accent
                : palette.borderStrong
            }`,
            color: palette.ink,
            outline: "none",
          }}
        />
        <div className="text-xs text-ink-subtle mt-0.5 tabular">
          {(row.newBps / 100).toFixed(2)}%
        </div>
      </td>
      <td className="px-2 py-3 text-right tabular text-sm">
        {row.actualSol > 0 ? (
          `${fmtSolNum(row.actualSol)} SOL`
        ) : (
          <span className="text-ink-subtle">—</span>
        )}
      </td>
      <td className="px-2 py-3 text-right tabular text-sm">
        {row.projectedSol > 0 ? (
          `${fmtSolNum(row.projectedSol)} SOL`
        ) : (
          <span className="text-ink-subtle">—</span>
        )}
      </td>
      <td className="px-2 py-3 text-right tabular text-sm">
        <DeltaCell sol={row.deltaSol} />
      </td>
    </tr>
  );
}

function DeltaCell({ sol }: { sol: number }) {
  if (Math.abs(sol) < 0.000001) {
    return <span className="text-ink-subtle">0</span>;
  }
  const positive = sol > 0;
  return (
    <span
      style={{ color: positive ? palette.success : palette.danger }}
    >
      {positive ? "+" : ""}
      {fmtSolNum(sol)} SOL
    </span>
  );
}
