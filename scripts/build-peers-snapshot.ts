#!/usr/bin/env tsx
/**
 * F4 — Build / enrich peers snapshot from launch-feed sampling.
 *
 * Output: app/data/peers-snapshot.json — read at request time by the F2
 * loader to populate `peers` on TokenView.
 *
 * Per sample we capture (mint, symbol, claimerCount, accrualSol, bpsVector)
 * — exactly what the resolver needs to match a cluster (claimerCount band ×
 * accrual band) and compute per-rank median + IQR.
 *
 * Default: merge mode. Existing samples are preserved; only mints not yet in
 * the snapshot are sampled this run. The Bags `/token-launch/feed` endpoint
 * returns the whole live feed in one shot (no pagination), so growing the
 * snapshot beyond a single feed pass requires re-running the script over time
 * as the feed rotates.
 *
 * Pre-flight: aborts if remaining < 600. Concurrency capped at 4. Budget
 * reserves a 600-floor: each candidate costs 2 calls (creatorInfo +
 * lifetimeFees), so candidate cap = floor((remaining - 600) / 2).
 *
 * Flags:
 *   --fresh             Discard existing snapshot and start over (defaults to merge).
 *   --limit N           Cap new-candidate count for this run.
 *   --rounds N          Repeat the sample-and-merge loop N times.
 *   --sleep-min M       Minutes between rounds (default 30 — feed rotates).
 *
 * Examples:
 *   pnpm tsx scripts/build-peers-snapshot.ts                       # one merge pass
 *   pnpm tsx scripts/build-peers-snapshot.ts --rounds 4 --sleep-min 30  # 2-hour grow loop
 *   pnpm tsx scripts/build-peers-snapshot.ts --fresh               # rebuild from scratch
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bags } from "../app/lib/bags-client.server";
import { lamportsToSol } from "../app/lib/format";

const ARG = (name: string) => {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const HAS = (name: string) => process.argv.includes(`--${name}`);

const LIMIT = ARG("limit") ? Number(ARG("limit")) : undefined;
const ROUNDS = ARG("rounds") ? Math.max(1, Number(ARG("rounds"))) : 1;
const SLEEP_MIN = ARG("sleep-min") ? Math.max(0, Number(ARG("sleep-min"))) : 30;
const FRESH = HAS("fresh");

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

type SnapshotFile = {
  generatedAt: string;
  source: string;
  sampleCount: number;
  samples: SampleOut[];
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadExisting(): SampleOut[] {
  if (FRESH) return [];
  if (!existsSync(OUT_PATH)) return [];
  try {
    const raw = readFileSync(OUT_PATH, "utf8");
    const parsed = JSON.parse(raw) as SnapshotFile;
    if (!Array.isArray(parsed.samples)) return [];
    return parsed.samples;
  } catch (e) {
    console.error(
      `[snapshot] WARN: failed to parse existing snapshot, starting fresh: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return [];
  }
}

function writeSnapshot(samples: SampleOut[]) {
  const out: SnapshotFile = {
    generatedAt: new Date().toISOString(),
    source: "bags-public-api-v2/launchFeed+creatorInfo+lifetimeFees",
    sampleCount: samples.length,
    samples,
  };
  mkdirSync(join(process.cwd(), "app", "data"), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
}

async function runOnce(existing: SampleOut[]): Promise<SampleOut[]> {
  const seen = new Set(existing.map((s) => s.mint));
  console.error(
    `[snapshot] existing sample count = ${existing.length} (${seen.size} unique mints)`,
  );

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

  let candidates = feed
    .filter((f) => STATUSES.has(f.status))
    .filter((f) => !seen.has(f.tokenMint));
  const overlap = feed.filter((f) => STATUSES.has(f.status) && seen.has(f.tokenMint)).length;
  console.error(
    `[snapshot] feed candidates: ${candidates.length} new, ${overlap} already in snapshot`,
  );

  if (LIMIT) candidates = candidates.slice(0, LIMIT);
  // 2 calls per mint (creatorInfo + lifetimeFees). Reserve 600-floor.
  const budget = Math.max(0, Math.floor((rl.remaining - 600) / 2));
  if (candidates.length > budget) {
    console.error(
      `[snapshot] trimming candidates ${candidates.length} → ${budget} to preserve 600-floor`,
    );
    candidates = candidates.slice(0, budget);
  }
  if (candidates.length === 0) {
    console.error(`[snapshot] nothing new this round; existing snapshot kept.`);
    return existing;
  }
  console.error(
    `[snapshot] sampling ${candidates.length} new mints @ concurrency=${CONCURRENCY}`,
  );

  const newSamples: SampleOut[] = [];
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
        newSamples.push({
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
    `[snapshot] round done. new=${newSamples.length}, errors=${errCount}, remaining=${finalRl.remaining}`,
  );

  return [...existing, ...newSamples];
}

async function main() {
  let samples = loadExisting();
  const startCount = samples.length;

  for (let r = 0; r < ROUNDS; r++) {
    if (r > 0) {
      console.error(`[snapshot] sleeping ${SLEEP_MIN}m before round ${r + 1}/${ROUNDS}…`);
      await sleep(SLEEP_MIN * 60 * 1000);
    }
    console.error(`\n[snapshot] === round ${r + 1}/${ROUNDS} ===`);
    samples = await runOnce(samples);
    writeSnapshot(samples);
    console.error(`[snapshot] wrote ${OUT_PATH} (total samples = ${samples.length})`);
  }

  // Quick distribution recap
  const byClaimer = new Map<number, number>();
  for (const s of samples) {
    byClaimer.set(s.claimerCount, (byClaimer.get(s.claimerCount) ?? 0) + 1);
  }
  console.error(
    `\n[snapshot] === final ===\ngrowth: ${startCount} → ${samples.length} (+${samples.length - startCount})\nclaimerCount distribution: ${[...byClaimer.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${k}:${v}`)
      .join(" ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
