import type { Route } from "./+types/token.$mint";
import { Link } from "react-router";
import { loader as tokenApiLoader } from "./api.token.$mint";
import type { TokenView } from "./api.token.$mint";
import { palette } from "../styles/tokens";
import {
  Badge,
  Card,
  PageShell,
  Stat,
  fmtSolNum,
  formatTimestamp,
  shortAddr,
} from "../components/ui";
import { FeePieChart } from "../components/FeePieChart";
import { PeersSection } from "../components/PeersSection";
import type { PeersData } from "../lib/peers";

/**
 * F2 — Per-token inspector page.
 *
 * Reuses the F2 API loader directly so the page-rendered view and the JSON
 * `/api/token/:mint` endpoint share one data path. No client-side fetching;
 * the loader does the Bags fan-out server-side.
 */

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: `${params.mint?.slice(0, 8) ?? "Token"} · Fee Optimizer Studio` },
  ];
}

export const loader = tokenApiLoader;

export default function TokenPage({ loaderData }: Route.ComponentProps) {
  const data = loaderData as TokenView & { peers?: PeersData };
  const { feeConfig, totals, claimEvents, pool, mint, peers } = data;

  const lastEvent = claimEvents[0];
  const claimerLabels = feeConfig.claimers.map((c) => ({
    wallet: c.wallet,
    label: c.display.username || c.display.twitter || shortAddr(c.wallet),
    basisPoints: c.basisPoints,
  }));

  return (
    <PageShell>
      <div className="space-y-8">
        <nav>
          <Link
            to="/"
            className="text-xs text-ink-subtle hover:text-ink uppercase tracking-widest"
          >
            ← all tokens
          </Link>
        </nav>

        <header className="flex items-end justify-between flex-wrap gap-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl">
              {shortAddr(mint)}
              <span
                className="ml-3 text-base text-ink-subtle tabular align-middle"
                style={{ fontFamily: "var(--font-sans)", fontWeight: 400 }}
              >
                {mint}
              </span>
            </h1>
            <div className="flex gap-2">
              {feeConfig.integrityWarning ? (
                <Badge tone="warning">⚠ {feeConfig.integrityWarning}</Badge>
              ) : (
                <Badge tone="success">BPS sums to 10000</Badge>
              )}
              <Badge tone="muted">
                {feeConfig.claimers.filter((c) => c.basisPoints > 0).length}{" "}
                fee-active claimers
              </Badge>
              {feeConfig.claimers.some((c) => c.basisPoints === 0) && (
                <Badge tone="muted">
                  +{feeConfig.claimers.filter((c) => c.basisPoints === 0).length}{" "}
                  display-only
                </Badge>
              )}
            </div>
          </div>
          <Link
            to={`/token/${mint}/simulate`}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-md text-sm font-medium tracking-wide"
            style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}
          >
            Simulate split →
          </Link>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <Stat
              label="Lifetime fees"
              value={`${fmtSolNum(totals.lifetimeFeesSol)} SOL`}
              hint={`${totals.lifetimeFeesLamports} lamports`}
              tone="accent"
            />
          </Card>
          <Card>
            <Stat
              label="Claim events"
              value={totals.claimEventsCount}
              hint={
                lastEvent
                  ? `last ${formatTimestamp(lastEvent.timestamp)}`
                  : "none yet"
              }
            />
          </Card>
          <Card>
            <Stat
              label="Pool"
              value={
                pool.dammV2PoolKey
                  ? "DAMM v2"
                  : pool.dbcPoolKey
                  ? "DBC (pre-grad)"
                  : "—"
              }
              hint={
                pool.dammV2PoolKey
                  ? shortAddr(pool.dammV2PoolKey)
                  : pool.dbcPoolKey
                  ? shortAddr(pool.dbcPoolKey)
                  : undefined
              }
              tone={pool.dammV2PoolKey ? "success" : "default"}
            />
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <Card className="lg:col-span-2">
            <h3 className="font-display text-lg mb-4">Fee split</h3>
            <FeePieChart claimers={claimerLabels} />
          </Card>

          <Card className="lg:col-span-3">
            <h3 className="font-display text-lg mb-4">Claimers</h3>
            <ClaimersTable claimers={feeConfig.claimers} />
          </Card>
        </div>

        <Card>
          <header className="flex items-baseline justify-between mb-4">
            <h3 className="font-display text-lg">Claim events</h3>
            <span className="text-xs text-ink-subtle tabular">
              {totals.claimEventsCount} total · most recent first
            </span>
          </header>
          {claimEvents.length === 0 ? (
            <div className="text-center py-10 text-ink-subtle text-sm">
              No claim events recorded yet.
            </div>
          ) : (
            <ClaimEventsTable
              events={claimEvents}
              walletColor={Object.fromEntries(
                claimerLabels
                  .filter((c) => c.basisPoints > 0)
                  .map((c, i) => [
                    c.wallet,
                    palette.chart[i % palette.chart.length],
                  ]),
              )}
            />
          )}
        </Card>

        {peers ? <PeersSection peers={peers} /> : null}

        <Card>
          <h3 className="font-display text-lg mb-4">Pool keys</h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm tabular">
            <PoolKey label="DBC pool" value={pool.dbcPoolKey} />
            <PoolKey label="DBC config" value={pool.dbcConfigKey} />
            <PoolKey label="DAMM v2 pool" value={pool.dammV2PoolKey} />
            <PoolKey label="Bags config" value={pool.bagsConfigType} />
          </dl>
        </Card>
      </div>
    </PageShell>
  );
}

function ClaimersTable({ claimers }: { claimers: TokenView["feeConfig"]["claimers"] }) {
  const sorted = [...claimers].sort((a, b) => b.basisPoints - a.basisPoints);
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-ink-subtle">
            <th className="text-left px-2 py-2">Claimer</th>
            <th className="text-right px-2 py-2">Split</th>
            <th className="text-right px-2 py-2">Cumulative</th>
            <th className="text-left px-2 py-2">Role</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const color =
              c.basisPoints > 0
                ? palette.chart[
                    sorted
                      .filter((x) => x.basisPoints > 0)
                      .findIndex((x) => x.wallet === c.wallet) %
                      palette.chart.length
                  ]
                : palette.inkSubtle;
            return (
              <tr
                key={c.wallet}
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
                </td>
                <td className="px-2 py-3 text-right tabular">
                  {c.basisPoints === 0 ? (
                    <span className="text-ink-subtle">—</span>
                  ) : (
                    <>
                      <span style={{ color: palette.ink }}>
                        {c.pctOfSplit.toFixed(2)}%
                      </span>
                      <span className="text-ink-subtle text-xs ml-2">
                        {c.basisPoints} BPS
                      </span>
                    </>
                  )}
                </td>
                <td className="px-2 py-3 text-right tabular">
                  {c.totalClaimedSol > 0
                    ? `${fmtSolNum(c.totalClaimedSol)} SOL`
                    : "—"}
                </td>
                <td className="px-2 py-3">
                  <div className="flex gap-1">
                    {c.isAdmin && <Badge tone="accent">admin</Badge>}
                    {c.isCreator && <Badge tone="muted">creator</Badge>}
                    {c.basisPoints === 0 && <Badge tone="muted">display only</Badge>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClaimEventsTable({
  events,
  walletColor,
}: {
  events: TokenView["claimEvents"];
  walletColor: Record<string, string>;
}) {
  return (
    <div className="overflow-x-auto -mx-2 max-h-96 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0" style={{ background: palette.surface }}>
          <tr className="text-xs uppercase tracking-wider text-ink-subtle">
            <th className="text-left px-2 py-2">Time</th>
            <th className="text-left px-2 py-2">Claimer</th>
            <th className="text-right px-2 py-2">Amount</th>
            <th className="text-left px-2 py-2">Signature</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr
              key={e.signature}
              className="border-t"
              style={{ borderColor: palette.border }}
            >
              <td className="px-2 py-2 text-ink-muted tabular text-xs whitespace-nowrap">
                {formatTimestamp(e.timestamp)}
              </td>
              <td className="px-2 py-2">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: walletColor[e.wallet] || palette.inkSubtle,
                    }}
                  />
                  <span className="tabular text-xs">
                    {shortAddr(e.wallet)}
                  </span>
                </span>
              </td>
              <td className="px-2 py-2 text-right tabular">
                {fmtSolNum(Number(BigInt(e.amount)) / 1e9, 6)}
              </td>
              <td className="px-2 py-2 text-xs tabular">
                <a
                  href={`https://solscan.io/tx/${e.signature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                  style={{ color: palette.accent }}
                >
                  {shortAddr(e.signature)} ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PoolKey({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <dt className="text-ink-subtle text-xs uppercase tracking-wider">
        {label}
      </dt>
      <dd className="text-right">
        {value ? (
          <span style={{ color: palette.ink }}>{value}</span>
        ) : (
          <span className="text-ink-subtle">—</span>
        )}
      </dd>
    </div>
  );
}
