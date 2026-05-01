#!/usr/bin/env tsx
/**
 * F4 — Build peers snapshot from a single launch-feed pass.
 *
 * Output: app/data/peers-snapshot.json — read at request time by the F2
 * loader to populate `peers` on TokenView.
 *
 * Per sample we capture (mint, symbol, claimerCount, accrualSol, bpsVector)
 * — exactly what the resolver needs to match a cluster (claimerCount band ×
 * accrual band) and compute per-rank median + IQR.
 *
 * Pre-flight: aborts if remaining < 600. Concurrency capped at 4. With
 * launchFeed = 100 candidates, each one needs creatorInfo + lifetimeFees in
 * parallel = ~200 API calls. Stays well above the 500 floor on a healthy
 * budget.
 *
 * Usage:
 *   pnpm tsx scripts/build-peers-snapshot.ts [--limit N]
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { bags } from "../app/lib/bags-client.server";
import { lamportsToSol } from "../app/lib/format";

const ARG = (name: string) => {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const LIMIT = ARG("limit") ? Number(ARG("limit")) : undefined;
const STATUSES = new Set(["MIGRATED", "PRE_GRAD"]);
const CONCURRENCY = 4;
const OUT_PATH = join(process.cwd(), "app", "data", "peers-snapshot.json");

type SampleOut = {
  mint: string;
  symbol: string;
  status: string;
  claimerCount: number;
  accrualSol: number;
  bpsVector: number[];
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
  console.error("[snapshot] fetching launch feed...");
  const feed = await bags.launchFeed();
  const rl = bags.rateLimit();
  console.error(
    `[snapshot] feed=${feed.length}, rate.remaining=${rl.remaining}`,
  );

  if (rl.remaining < 600) {
    console.error(
      `[snapshot] ABORT: remaining=${rl.remaining} < 600 floor. Defer 30 min and retry.`,
    );
    process.exit(2);
  }

  let candidates = feed.filter((f) => STATUSES.has(f.status));
  if (LIMIT) candidates = candidates.slice(0, LIMIT);
  // 2 calls per mint (creatorInfo + lifetimeFees). Reserve 600-floor.
  const budget = Math.max(0, Math.floor((rl.remaining - 600) / 2));
  if (candidates.length > budget) {
    console.error(
      `[snapshot] trimming candidates ${candidates.length} → ${budget} to preserve 600-floor`,
    );
    candidates = candidates.slice(0, budget);
  }
  console.error(
    `[snapshot] sampling ${candidates.length} mints @ concurrency=${CONCURRENCY}`,
  );

  const samples: SampleOut[] = [];
  let errCount = 0;

  await pmap(
    candidates,
    async (t) => {
      try {
        const [info, lifetime] = await Promise.all([
          bags.creatorInfo(t.tokenMint),
          bags.lifetimeFees(t.tokenMint),
        ]);
        const feeActive = info.filter((c) => c.royaltyBps > 0);
        samples.push({
          mint: t.tokenMint,
          symbol: t.symbol,
          status: t.status,
          claimerCount: feeActive.length,
          accrualSol: lamportsToSol(lifetime),
          bpsVector: feeActive
            .map((c) => c.royaltyBps)
            .sort((a, b) => b - a),
        });
      } catch (e) {
        errCount++;
        if (errCount <= 5) {
          console.error(
            `[snapshot] err on ${t.tokenMint.slice(0, 12)}…: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`,
          );
        }
      }
    },
    CONCURRENCY,
  );

  const finalRl = bags.rateLimit();
  console.error(
    `[snapshot] done. samples=${samples.length}, errors=${errCount}, remaining=${finalRl.remaining}`,
  );

  const out = {
    generatedAt: new Date().toISOString(),
    source: "bags-public-api-v2/launchFeed+creatorInfo+lifetimeFees",
    sampleCount: samples.length,
    samples,
  };

  mkdirSync(join(process.cwd(), "app", "data"), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.error(`[snapshot] wrote ${OUT_PATH}`);

  // Quick distribution recap
  const byClaimer = new Map<number, number>();
  for (const s of samples) {
    byClaimer.set(s.claimerCount, (byClaimer.get(s.claimerCount) ?? 0) + 1);
  }
  console.error(
    `[snapshot] claimerCount distribution: ${[...byClaimer.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${k}:${v}`)
      .join(" ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
