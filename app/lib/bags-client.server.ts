import { z } from "zod";
import { env } from "./env.server";

const BASE = "https://public-api-v2.bags.fm/api/v1";
const SAFETY_FLOOR = 500; // park when remaining < SAFETY_FLOOR — leave buffer on the shared 1000/h Bags API budget

class RateLimitState {
  remaining = 1000;
  resetAt = 0; // unix seconds
  lastSeen = 0;

  observe(headers: Headers) {
    const r = headers.get("x-ratelimit-remaining");
    const reset = headers.get("x-ratelimit-reset");
    if (r != null) this.remaining = Number(r);
    if (reset != null) this.resetAt = Number(reset);
    this.lastSeen = Math.floor(Date.now() / 1000);
  }

  needsPark(): number | null {
    if (this.remaining >= SAFETY_FLOOR) return null;
    const now = Math.floor(Date.now() / 1000);
    const wait = Math.max(0, this.resetAt - now);
    // Don't park if reset is < 60s away — avoids burning latency on
    // imminent-reset noise during sliding-window attribution.
    if (wait < 60) return null;
    return wait;
  }
}

const rate = new RateLimitState();

async function sleep(seconds: number) {
  await new Promise((r) => setTimeout(r, seconds * 1000));
}

export class BagsApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: unknown,
  ) {
    super(`Bags API ${status} on ${path}: ${JSON.stringify(body)}`);
    this.name = "BagsApiError";
  }
}

type FetchInit = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

async function bagsFetch<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  init: FetchInit = {},
): Promise<z.infer<T>> {
  const wait = rate.needsPark();
  if (wait != null) {
    console.warn(`[bags-client] rate floor hit, sleeping ${wait}s`);
    await sleep(wait + 1);
  }

  const url = new URL(`${BASE}${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { "x-api-key": env.BAGS_API_KEY };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const res = await fetch(url, { method: init.method ?? "GET", headers, body });
  rate.observe(res.headers);

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new BagsApiError(res.status, path, await res.text().catch(() => ""));
  }

  if (!res.ok || (json as { success?: boolean }).success === false) {
    throw new BagsApiError(res.status, path, json);
  }

  return schema.parse(json) as z.infer<T>;
}

// ────────────────────────────────────────────────────────────────────────────
// Schemas (response payloads)
// ────────────────────────────────────────────────────────────────────────────

const SuccessEnvelope = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ success: z.literal(true), response: inner });

const FeeShareAdminListSchema = SuccessEnvelope(
  z.object({ tokenMints: z.array(z.string()) }),
);

const LifetimeFeesSchema = SuccessEnvelope(z.string());

// Per-claimer cumulative — minimal shape (verified live 2026-04-30: docs claimed
// many display fields here, but the real response is just wallet/mint/totalClaimed).
const ClaimerCumulativeSchema = z.object({
  wallet: z.string(),
  tokenMint: z.string(),
  totalClaimed: z.string(),
});
const ClaimStatsSchema = SuccessEnvelope(z.array(ClaimerCumulativeSchema));

// Creator/v3: the actual source-of-truth for current fee config + display info
// (royaltyBps + username/pfp/twitter/bags). docs incorrectly attribute these
// fields to claim-stats; they live here.
const CreatorInfoSchema = z.object({
  username: z.string().nullable(),
  pfp: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  providerUsername: z.string().nullable().optional(),
  royaltyBps: z.number(),
  isCreator: z.boolean(),
  wallet: z.string(),
  isAdmin: z.boolean(),
  twitterUsername: z.string().nullable().optional(),
  bagsUsername: z.string().nullable().optional(),
});
const CreatorInfoListSchema = SuccessEnvelope(z.array(CreatorInfoSchema));

const ClaimEventSchema = z.object({
  wallet: z.string(),
  isCreator: z.boolean(),
  amount: z.string(),
  signature: z.string(),
  // verified live: timestamp is a JSON number (unix seconds), not a string
  // despite docs claiming "string"
  timestamp: z.number(),
});
const ClaimEventsSchema = SuccessEnvelope(
  z.object({ events: z.array(ClaimEventSchema) }),
);

const PoolInfoSchema = SuccessEnvelope(
  z
    .object({
      tokenMint: z.string(),
      dbcPoolKey: z.string().nullable().optional(),
      dbcConfigKey: z.string().nullable().optional(),
      // verified live: field name is `dammV2PoolKey`, not `dammPoolKey` as docs imply
      dammV2PoolKey: z.string().nullable().optional(),
      bagsConfigType: z.string().nullable().optional(),
      status: z.string().optional(),
    })
    .passthrough(),
);

const FeedItemSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  description: z.string().nullable(),
  image: z.string().nullable(),
  tokenMint: z.string(),
  status: z.enum(["PRE_LAUNCH", "PRE_GRAD", "MIGRATING", "MIGRATED"]),
  twitter: z.string().nullable(),
  website: z.string().nullable(),
  launchSignature: z.string().nullable(),
  accountKeys: z.array(z.string()),
  numRequiredSigners: z.number().nullable(),
  uri: z.string().nullable(),
  dbcPoolKey: z.string().nullable(),
  dbcConfigKey: z.string().nullable(),
});
const LaunchFeedSchema = SuccessEnvelope(z.array(FeedItemSchema));

const UpdateConfigSchema = SuccessEnvelope(
  z.object({
    transactions: z.array(
      z.object({
        blockhash: z.object({
          blockhash: z.string(),
          lastValidBlockHeight: z.number(),
        }),
        transaction: z.string(),
      }),
    ),
  }),
);

const SendTxSchema = SuccessEnvelope(z.string());

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export const bags = {
  /** Tokens where `wallet` is fee-share admin. */
  async adminList(wallet: string) {
    const res = await bagsFetch("/fee-share/admin/list", FeeShareAdminListSchema, {
      query: { wallet },
    });
    return res.response.tokenMints;
  },

  /** Total lifetime fees (lamports as bigint). */
  async lifetimeFees(tokenMint: string): Promise<bigint> {
    const res = await bagsFetch("/token-launch/lifetime-fees", LifetimeFeesSchema, {
      query: { tokenMint },
    });
    return BigInt(res.response);
  },

  /**
   * Per-claimer cumulative — minimal shape (wallet, totalClaimed). Use
   * `creatorInfo` for current fee split + display fields.
   */
  async claimStats(tokenMint: string) {
    const res = await bagsFetch("/token-launch/claim-stats", ClaimStatsSchema, {
      query: { tokenMint },
    });
    return res.response;
  },

  /**
   * Creator info per mint — source of truth for current fee split (royaltyBps),
   * admin/creator flags, and display fields (username/pfp/twitter/bags).
   * Returns one entry per claimer-or-creator (creators with 0 BPS appear too).
   */
  async creatorInfo(tokenMint: string) {
    const res = await bagsFetch(
      "/token-launch/creator/v3",
      CreatorInfoListSchema,
      { query: { tokenMint } },
    );
    return res.response;
  },

  /** Claim event history (offset paginated, max 100/page). */
  async claimEvents(
    tokenMint: string,
    opts: { limit?: number; offset?: number } = {},
  ) {
    const res = await bagsFetch(
      "/fee-share/token/claim-events",
      ClaimEventsSchema,
      { query: { tokenMint, mode: "offset", limit: opts.limit ?? 100, offset: opts.offset ?? 0 } },
    );
    return res.response.events;
  },

  /**
   * Time-windowed claim events. Use for accurate slices (e.g. 30-day
   * simulator window) — offset mode caps at 100 and may miss the tail
   * for high-activity tokens.
   */
  async claimEventsByTime(
    tokenMint: string,
    fromUnix: number,
    toUnix: number,
  ) {
    const res = await bagsFetch(
      "/fee-share/token/claim-events",
      ClaimEventsSchema,
      { query: { tokenMint, mode: "time", from: fromUnix, to: toUnix } },
    );
    return res.response.events;
  },

  /** Pool keys (DBC + DAMM v2) for a given mint. */
  async poolByMint(tokenMint: string) {
    const res = await bagsFetch(
      "/solana/bags/pools/token-mint",
      PoolInfoSchema,
      { query: { tokenMint } },
    );
    return res.response;
  },

  /** Full launch feed (no pagination params; filter client-side by status). */
  async launchFeed() {
    const res = await bagsFetch("/token-launch/feed", LaunchFeedSchema);
    return res.response;
  },

  /** Build admin update-config tx (returns base58 versioned unsigned tx[s]). */
  async updateConfigTx(input: {
    baseMint: string;
    claimersArray: string[];
    basisPointsArray: number[];
    payer: string;
    additionalLookupTables?: string[];
  }) {
    if (input.claimersArray.length !== input.basisPointsArray.length) {
      throw new Error("claimersArray and basisPointsArray length mismatch");
    }
    const sum = input.basisPointsArray.reduce((a, b) => a + b, 0);
    if (sum !== 10000) throw new Error(`basisPointsArray must sum to 10000, got ${sum}`);
    if (input.claimersArray.length > 7 && !input.additionalLookupTables?.length) {
      throw new Error(">7 claimers requires additionalLookupTables");
    }
    const res = await bagsFetch(
      "/fee-share/admin/update-config",
      UpdateConfigSchema,
      { method: "POST", body: input },
    );
    return res.response.transactions;
  },

  /** Submit a base58-encoded signed Solana tx; returns the signature. */
  async sendTransaction(transaction: string) {
    const res = await bagsFetch(
      "/solana/send-transaction",
      SendTxSchema,
      { method: "POST", body: { transaction } },
    );
    return res.response;
  },

  rateLimit() {
    return { remaining: rate.remaining, resetAt: rate.resetAt, lastSeen: rate.lastSeen };
  },
};

export type CreatorInfo = z.infer<typeof CreatorInfoSchema>;
export type ClaimerCumulative = z.infer<typeof ClaimerCumulativeSchema>;
export type ClaimEvent = z.infer<typeof ClaimEventSchema>;
export type FeedItem = z.infer<typeof FeedItemSchema>;
