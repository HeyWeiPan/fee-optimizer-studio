#!/usr/bin/env tsx
/**
 * F4 scope decision: scan launch feed and bucket tokens by fee-active claimer
 * count (royaltyBps > 0) to decide whether the cluster ETL has enough peer
 * data to be worth building.
 *
 * Decision rule:
 *   - if multi-claimer (≥ 2 fee-active) tokens ≥ 10 → cluster ETL is viable
 *   - else                                          → fall back to single-token
 *                                                     informational overlay
 *
 * Pre-flight: abort if rate.remaining < 600. Concurrency capped at 4 to keep
 * usage moderate against the shared 1k/h Bags API budget.
 *
 * Usage:
 *   pnpm tsx scripts/scout-multi-claimer.ts [--limit N] [--status MIGRATED,PRE_GRAD]
 */

import { bags } from "../app/lib/bags-client.server";
import type { FeedItem } from "../app/lib/bags-client.server";

const ARG = (name: string) => {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const LIMIT = ARG("limit") ? Number(ARG("limit")) : undefined;
const STATUSES = (ARG("status") ?? "MIGRATED,PRE_GRAD").split(",") as FeedItem["status"][];
const CONCURRENCY = 4;

type Sample = {
  mint: string;
  symbol: string;
  status: string;
  feeActiveCount: number;
  totalClaimerCount: number;
  bpsVector: number[]; // sorted desc, only fee-active
};

async function pmap<T, U>(
  items: T[],
  fn: (item: T, idx: number) => Promise<U>,
  concurrency: number,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  // pre-flight rate check
  // (we have to make at least one call to populate rate state; launchFeed is fine)
  console.error("[scout] fetching launch feed...");
  const feed = await bags.launchFeed();
  const rl = bags.rateLimit();
  console.error(
    `[scout] feed=${feed.length}, rate.remaining=${rl.remaining}, resetAt=${new Date(rl.resetAt * 1000).toISOString()}`,
  );

  if (rl.remaining < 600) {
    console.error(
      `[scout] ABORT: remaining=${rl.remaining} < 600 floor. Defer 30 min and retry.`,
    );
    process.exit(2);
  }

  let candidates = feed.filter((f) => STATUSES.includes(f.status));
  if (LIMIT) candidates = candidates.slice(0, LIMIT);
  console.error(
    `[scout] candidates after status filter (${STATUSES.join("|")}): ${candidates.length}${LIMIT ? ` (limit=${LIMIT})` : ""}`,
  );

  // Budget guard: each token = 1 creatorInfo call. Don't drain past 600 floor.
  const budget = Math.max(0, rl.remaining - 600);
  if (candidates.length > budget) {
    console.error(
      `[scout] trimming candidates ${candidates.length} → ${budget} to preserve 600-floor`,
    );
    candidates = candidates.slice(0, budget);
  }

  console.error(`[scout] fetching creatorInfo for ${candidates.length} mints @ concurrency=${CONCURRENCY}...`);

  const samples: Sample[] = [];
  const errors: { mint: string; err: string }[] = [];

  await pmap(
    candidates,
    async (t) => {
      try {
        const info = await bags.creatorInfo(t.tokenMint);
        const feeActive = info.filter((c) => c.royaltyBps > 0);
        samples.push({
          mint: t.tokenMint,
          symbol: t.symbol,
          status: t.status,
          feeActiveCount: feeActive.length,
          totalClaimerCount: info.length,
          bpsVector: feeActive.map((c) => c.royaltyBps).sort((a, b) => b - a),
        });
      } catch (e) {
        errors.push({ mint: t.tokenMint, err: e instanceof Error ? e.message : String(e) });
      }
    },
    CONCURRENCY,
  );

  const finalRl = bags.rateLimit();
  console.error(`[scout] done. remaining=${finalRl.remaining}. errors=${errors.length}`);

  // bucket by fee-active count
  const buckets = new Map<string, Sample[]>();
  const bucketOf = (n: number): string =>
    n === 0 ? "0" : n === 1 ? "1" : n <= 3 ? "2-3" : n <= 6 ? "4-6" : "7+";

  for (const s of samples) {
    const k = bucketOf(s.feeActiveCount);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(s);
  }

  console.log("\n═══ Fee-active claimer distribution ═══");
  console.log(`Total sampled: ${samples.length}\n`);
  console.log("bucket    count   pct     example mints");
  console.log("──────    ─────   ─────   ─────────────");
  const order = ["0", "1", "2-3", "4-6", "7+"];
  for (const k of order) {
    const arr = buckets.get(k) ?? [];
    const pct = samples.length > 0 ? ((arr.length / samples.length) * 100).toFixed(1) : "0.0";
    const examples = arr.slice(0, 3).map((s) => `${s.symbol}(${s.feeActiveCount})`).join(", ");
    console.log(`${k.padEnd(8)}  ${String(arr.length).padEnd(5)}  ${pct.padStart(4)}%   ${examples}`);
  }

  const multiClaimer = samples.filter((s) => s.feeActiveCount >= 2);
  console.log(`\nMulti-claimer (≥2 fee-active): ${multiClaimer.length}`);
  console.log(`F4 ETL viability: ${multiClaimer.length >= 10 ? "GREEN — proceed with cluster ETL" : "RED — fall back to single-token overlay"}`);

  if (multiClaimer.length > 0) {
    console.log("\n═══ Multi-claimer candidates (best for F4 demo) ═══");
    const ranked = [...multiClaimer].sort((a, b) => b.feeActiveCount - a.feeActiveCount);
    console.log("symbol            feeActive  bpsVector                                 mint");
    console.log("──────            ─────────  ─────────                                 ────");
    for (const s of ranked.slice(0, 15)) {
      const bps = s.bpsVector.join("/");
      console.log(`${s.symbol.padEnd(16)}  ${String(s.feeActiveCount).padEnd(9)}  ${bps.padEnd(40)}  ${s.mint}`);
    }
  }

  if (errors.length > 0) {
    console.error("\n[scout] errors:");
    for (const e of errors.slice(0, 10)) {
      console.error(`  ${e.mint.slice(0, 16)}…  ${e.err.slice(0, 100)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
