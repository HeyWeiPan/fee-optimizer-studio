/**
 * F4 — Peers snapshot resolver.
 *
 * Reads the static snapshot built by `scripts/build-peers-snapshot.ts` and
 * produces `PeersData` for a given (current mint, claimer count, accrual,
 * BPS vector). The match is exact on cluster bucket; sub-floor samples
 * fail loud per the F4 design.
 *
 * Why a static snapshot rather than a live cluster scan on every request:
 *   - Cluster ETL is the long-term path. The snapshot is its drop-in
 *     replacement at the same data contract — the UI stays unchanged.
 *   - Per-request scanning would burn Bags rate budget on every page hit.
 *   - The snapshot is rebuilt on demand (`pnpm tsx scripts/build-peers-snapshot.ts`)
 *     so the data path is verifiable without infra.
 */

import snapshot from "../data/peers-snapshot.json";
import {
  bucketAccrual,
  bucketClaimerCount,
  COLD_START_FLOOR,
  type ClusterKey,
  type PeerRow,
  type PeersData,
} from "./peers";

type SnapshotSample = {
  mint: string;
  symbol: string;
  status: string;
  claimerCount: number;
  accrualSol: number;
  bpsVector: number[];
};

type SnapshotFile = {
  generatedAt: string;
  source: string;
  sampleCount: number;
  samples: SnapshotSample[];
};

const data = snapshot as SnapshotFile;

/**
 * Per-rank percentile across cluster peers. Each rank has its own array of
 * BPS values pulled from the same rank position in each peer's sorted-desc
 * vector — so the cross-token comparison is rank-aligned.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return Math.round(sorted[lo] * (1 - frac) + sorted[hi] * frac);
}

export function resolvePeers(input: {
  currentMint: string;
  currentClaimerCount: number; // fee-active count
  currentAccrualSol: number;
  currentBpsVector: number[]; // sorted desc, fee-active only
}): PeersData {
  const cluster: ClusterKey = {
    claimerCount: bucketClaimerCount(input.currentClaimerCount),
    accrual: bucketAccrual(input.currentAccrualSol),
  };

  // Match peers: exact cluster bucket, exclude self.
  const peers = data.samples.filter(
    (s) =>
      s.mint !== input.currentMint &&
      bucketClaimerCount(s.claimerCount) === cluster.claimerCount &&
      bucketAccrual(s.accrualSol) === cluster.accrual,
  );

  if (peers.length < COLD_START_FLOOR) {
    return { kind: "insufficient", n: peers.length, cluster };
  }

  // For per-rank stats we need same-length vectors. Inside a single
  // claimerCount bucket ("2-3", "4-6", "7+") tokens may still differ by
  // exact count — restrict to peers whose vector length matches the
  // current token's so rank semantics are preserved.
  const sameLen = peers.filter(
    (s) => s.bpsVector.length === input.currentBpsVector.length,
  );
  if (sameLen.length < COLD_START_FLOOR) {
    return { kind: "insufficient", n: sameLen.length, cluster };
  }

  const ranks = input.currentBpsVector.length;
  const rows: PeerRow[] = [];
  for (let r = 0; r < ranks; r++) {
    const vals = sameLen
      .map((s) => s.bpsVector[r])
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    rows.push({
      rank: r,
      currentBps: input.currentBpsVector[r],
      medianBps: percentile(vals, 0.5),
      p25Bps: percentile(vals, 0.25),
      p75Bps: percentile(vals, 0.75),
    });
  }

  return { kind: "cluster", n: sameLen.length, cluster, rows };
}

export const peersSnapshotMeta = {
  generatedAt: data.generatedAt,
  sampleCount: data.sampleCount,
  source: data.source,
};
