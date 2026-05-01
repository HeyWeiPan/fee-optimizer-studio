import type { Route } from "./+types/api.token.$mint";
import { bags, type ClaimEvent, type CreatorInfo, type ClaimerCumulative } from "../lib/bags-client.server";
import { lamportsToSol } from "../lib/format";
import { resolvePeers } from "../lib/peers-snapshot.server";
import type { PeersData } from "../lib/peers";

/**
 * F2 — Per-token inspector data.
 *
 * Joins creator/v3 (fee config + display) with claim-stats (cumulative claimed)
 * by wallet to produce a single per-claimer view. claim-events provides the
 * time-series. lifetime-fees and pool-by-mint round out the header context.
 */

export type ClaimerView = {
  wallet: string;
  display: { username: string | null; pfp: string | null; twitter: string | null; bags: string | null };
  isCreator: boolean;
  isAdmin: boolean;
  basisPoints: number; // current split, from creator/v3 royaltyBps
  pctOfSplit: number;  // basisPoints / 100, for legend
  totalClaimedLamports: string;
  totalClaimedSol: number;
};

export type ClaimEventView = ClaimEvent;

/**
 * 30-day actual-claim aggregate for the F3 simulator.
 *
 * Important: this reflects what was actually *claimed* in the last 30 days,
 * not what was *accrued*. A claimer who never pulled their accrued fees has
 * `actual = 0` here even if their old BPS share entitled them to a slice of
 * gross flow. F3 UI must surface this nuance in tooltip.
 */
export type ThirtyDayWindow = {
  fromUnix: number;
  toUnix: number;
  gross30dTotalLamports: string;
  actual30dByWalletLamports: Record<string, string>;
};

export type TokenView = {
  mint: string;
  feeConfig: {
    claimers: ClaimerView[];
    totalBps: number;          // should equal 10000 (excluding 0-bps creator entries)
    integrityWarning: string | null;
  };
  totals: {
    lifetimeFeesLamports: string;
    lifetimeFeesSol: number;
    claimEventsCount: number;
  };
  claimEvents: ClaimEventView[];
  thirty: ThirtyDayWindow;
  pool: {
    dbcPoolKey: string | null;
    dbcConfigKey: string | null;
    dammV2PoolKey: string | null;
    bagsConfigType: string | null;
  };
  peers: PeersData;
  rateLimit: { remaining: number; resetAt: number };
};

function mergeClaimers(
  creators: CreatorInfo[],
  cumulative: ClaimerCumulative[],
): ClaimerView[] {
  const cumByWallet = new Map(cumulative.map((c) => [c.wallet, c.totalClaimed]));
  return creators.map((c) => {
    const totalClaimed = cumByWallet.get(c.wallet) ?? "0";
    return {
      wallet: c.wallet,
      display: {
        username: c.username && c.username.length > 0 ? c.username : null,
        pfp: c.pfp ?? null,
        twitter: c.twitterUsername ?? null,
        bags: c.bagsUsername ?? null,
      },
      isCreator: c.isCreator,
      isAdmin: c.isAdmin,
      basisPoints: c.royaltyBps,
      pctOfSplit: c.royaltyBps / 100,
      totalClaimedLamports: totalClaimed,
      totalClaimedSol: lamportsToSol(BigInt(totalClaimed)),
    };
  });
}

export async function loader({ params }: Route.LoaderArgs): Promise<TokenView> {
  const mint = params.mint;
  if (!mint) throw new Response("missing :mint", { status: 400 });

  // 6 parallel Bags calls. The 30-day window uses time-mode to capture every
  // event in the slice (offset-mode caps at 100 and would miss the tail for
  // active tokens); the display table uses offset-mode for the most recent 100.
  const nowSec = Math.floor(Date.now() / 1000);
  const fromUnix = nowSec - THIRTY_DAYS_SEC;
  const [creators, cumulative, events, eventsThirty, lifetime, pool] = await Promise.all([
    bags.creatorInfo(mint),
    bags.claimStats(mint),
    bags.claimEvents(mint, { limit: 100, offset: 0 }),
    bags.claimEventsByTime(mint, fromUnix, nowSec),
    bags.lifetimeFees(mint),
    bags.poolByMint(mint).catch(() => null),
  ]);

  const claimers = mergeClaimers(creators, cumulative);

  // Fee-active claimers only (royaltyBps > 0). Creators with 0 BPS are display-only.
  const feeActive = claimers.filter((c) => c.basisPoints > 0);
  const totalBps = feeActive.reduce((sum, c) => sum + c.basisPoints, 0);
  const integrityWarning =
    totalBps === 10000
      ? null
      : `fee-active royaltyBps sums to ${totalBps}, expected 10000`;

  const thirty = computeThirtyDayWindow(eventsThirty, fromUnix, nowSec);

  const lifetimeFeesSol = lamportsToSol(lifetime);
  const feeActiveBps = feeActive
    .map((c) => c.basisPoints)
    .sort((a, b) => b - a);
  const peers = resolvePeers({
    currentMint: mint,
    currentClaimerCount: feeActive.length,
    currentAccrualSol: lifetimeFeesSol,
    currentBpsVector: feeActiveBps,
  });

  return {
    mint,
    feeConfig: { claimers, totalBps, integrityWarning },
    totals: {
      lifetimeFeesLamports: lifetime.toString(),
      lifetimeFeesSol,
      claimEventsCount: events.length,
    },
    claimEvents: events,
    thirty,
    pool: {
      dbcPoolKey: pool?.dbcPoolKey ?? null,
      dbcConfigKey: pool?.dbcConfigKey ?? null,
      dammV2PoolKey: pool?.dammV2PoolKey ?? null,
      bagsConfigType: pool?.bagsConfigType ?? null,
    },
    peers,
    rateLimit: bags.rateLimit(),
  };
}

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

function computeThirtyDayWindow(
  events: ClaimEvent[],
  fromUnix: number,
  toUnix: number,
): ThirtyDayWindow {
  let gross = 0n;
  const byWallet = new Map<string, bigint>();
  for (const e of events) {
    const amt = BigInt(e.amount);
    gross += amt;
    byWallet.set(e.wallet, (byWallet.get(e.wallet) ?? 0n) + amt);
  }

  const actual30dByWalletLamports: Record<string, string> = {};
  for (const [w, amt] of byWallet) actual30dByWalletLamports[w] = amt.toString();

  return {
    fromUnix,
    toUnix,
    gross30dTotalLamports: gross.toString(),
    actual30dByWalletLamports,
  };
}
