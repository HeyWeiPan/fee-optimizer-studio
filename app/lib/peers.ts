/**
 * F4 — Peer comparison data contract.
 *
 * The shape is *path-agnostic*:
 *   - GREEN path: cluster ETL populates this from a Postgres cache hit.
 *   - RED path: inline scan computes this directly from the launch feed.
 *
 * The UI component (`PeersSection`) does not know which path produced the data.
 *
 * Framing rules:
 *   - Empirical baseline only. Never "you should" / "we recommend".
 *   - Always show `(n=N)` sample count.
 *   - Show IQR (p25/p75), not just median — variance must be visible.
 *   - Cold start (n<5) → fail-loud. NO global-median fallback.
 *   - Median computed by *rank-sorted position* within same claimer count
 *     (different claimer counts have different BPS dimensionality; can't
 *     median across).
 */

export type ClaimerCountBucket = "1" | "2-3" | "4-6" | "7+";
export type AccrualBucket = "<0.1" | "0.1-1" | "1-10" | "10+";

export type ClusterKey = {
  claimerCount: ClaimerCountBucket;
  accrual: AccrualBucket;
};

/** Per-rank-position peer row (rank 0 = largest BPS slot). */
export type PeerRow = {
  /** 0-indexed rank within the same claimer count (0 = largest slot). */
  rank: number;
  /** This token's BPS at this rank position (sorted desc, fee-active only). */
  currentBps: number;
  /** Cluster median BPS at this rank position. */
  medianBps: number;
  /** Cluster 25th percentile BPS at this rank position. */
  p25Bps: number;
  /** Cluster 75th percentile BPS at this rank position. */
  p75Bps: number;
};

/** Threshold: clusters with fewer peers surface a fail-loud insufficient-data
 *  message instead of falling back to a noisy or global median. */
export const COLD_START_FLOOR = 5;

export type PeersData =
  | {
      kind: "cluster";
      /** Number of peer tokens in the matching cluster (>= COLD_START_FLOOR). */
      n: number;
      cluster: ClusterKey;
      rows: PeerRow[];
    }
  | {
      kind: "insufficient";
      /** Actual peer count found (< COLD_START_FLOOR). */
      n: number;
      cluster: ClusterKey;
    }
  | {
      kind: "loading";
      /** Cluster the loader has identified for the current token (so the
       *  skeleton can show the bucket badge before peer stats arrive). */
      cluster: ClusterKey;
    };

/**
 * Insufficient-data copy. The presence of an explicit "we don't have enough
 * peers" surface is itself a reliability signal — a tool that knows when it
 * has no data communicates more trustworthiness than one that always emits
 * a number. Do not soften this message.
 */
export const INSUFFICIENT_COPY =
  "Insufficient comparable data — your token is in a niche with too few peers to baseline against.";

export function formatClusterKey(c: ClusterKey): string {
  const claimers =
    c.claimerCount === "1"
      ? "1 fee-active claimer"
      : `${c.claimerCount} fee-active claimers`;
  return `${claimers} · ${c.accrual} SOL lifetime`;
}

/** BPS bucket for a given fee-active claimer count. */
export function bucketClaimerCount(n: number): ClaimerCountBucket {
  if (n <= 1) return "1";
  if (n <= 3) return "2-3";
  if (n <= 6) return "4-6";
  return "7+";
}

/** Log-bucket for lifetime accrual in SOL. */
export function bucketAccrual(sol: number): AccrualBucket {
  if (sol < 0.1) return "<0.1";
  if (sol < 1) return "0.1-1";
  if (sol < 10) return "1-10";
  return "10+";
}
