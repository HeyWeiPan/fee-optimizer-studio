import type { Route } from "./+types/api.apply-split.build";
import { z } from "zod";
import { bags, BagsApiError } from "../lib/bags-client.server";

/**
 * F5 — Build the unsigned admin update-config transaction.
 *
 * Client posts the desired split (claimer wallets + new basis points + payer).
 * Server forwards to Bags `/fee-share/admin/update-config` and returns the
 * base58-encoded versioned transaction(s) the wallet will sign.
 *
 * The Bags side validates that `payer` is the actual fee-share admin for the
 * mint; we don't re-check here (single source of truth) but we do the BPS-sum
 * and length-pairing checks early to give the client a fast 400 instead of a
 * round-trip-only Bags rejection.
 *
 * Bags error mapping: when Bags rejects, we surface a short, action-oriented
 * hint to the client instead of the raw API blob. The original status + body
 * are preserved on `detail` for debugging.
 */

const BodySchema = z.object({
  mint: z.string().min(32).max(48),
  payer: z.string().min(32).max(48),
  claimers: z
    .array(
      z.object({
        wallet: z.string().min(32).max(48),
        basisPoints: z.number().int().min(0).max(10000),
      }),
    )
    .min(1)
    .max(10),
  additionalLookupTables: z.array(z.string()).optional(),
});

export type BuildSplitResponse = {
  /**
   * One or more base58 unsigned VersionedTransaction(s). For typical splits
   * (≤7 claimers) the array is length 1; larger splits may chunk across txs.
   */
  transactions: Array<{
    blockhash: { blockhash: string; lastValidBlockHeight: number };
    transaction: string;
  }>;
  rateLimit: { remaining: number; resetAt: number };
};

export async function action({ request }: Route.ActionArgs): Promise<BuildSplitResponse> {
  if (request.method !== "POST") {
    throw new Response("method not allowed", { status: 405 });
  }

  let parsed;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (e) {
    throw new Response(
      JSON.stringify({ error: "invalid body", detail: e instanceof Error ? e.message : String(e) }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const sum = parsed.claimers.reduce((s, c) => s + c.basisPoints, 0);
  if (sum !== 10000) {
    throw new Response(
      JSON.stringify({ error: `basisPoints must sum to 10000, got ${sum}` }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  // Bags expects two parallel arrays in claimer-wallet order.
  const claimersArray = parsed.claimers.map((c) => c.wallet);
  const basisPointsArray = parsed.claimers.map((c) => c.basisPoints);

  let transactions;
  try {
    transactions = await bags.updateConfigTx({
      baseMint: parsed.mint,
      claimersArray,
      basisPointsArray,
      payer: parsed.payer,
      additionalLookupTables: parsed.additionalLookupTables,
    });
  } catch (e) {
    if (e instanceof BagsApiError) {
      const { status, error } = mapBuildError(e);
      throw new Response(
        JSON.stringify({ error, detail: { bagsStatus: e.status, body: e.body } }),
        { status, headers: { "content-type": "application/json" } },
      );
    }
    throw e;
  }

  return {
    transactions,
    rateLimit: bags.rateLimit(),
  };
}

/**
 * Translate a `BagsApiError` from `/fee-share/admin/update-config` into a
 * friendly hint. Status is always passed through as 4xx so the client surfaces
 * it as a normal user-facing error rather than a 5xx scare.
 */
function mapBuildError(e: BagsApiError): { status: number; error: string } {
  const blob = JSON.stringify(e.body ?? "").toLowerCase();
  // Bags rejects when the on-chain admin doesn't match `payer`.
  if (e.status === 403 || blob.includes("not the admin") || blob.includes("not admin") || blob.includes("unauthorized")) {
    return {
      status: 403,
      error: "Connected wallet is not the fee-share admin for this token. Reconnect with the admin wallet and retry.",
    };
  }
  if (e.status === 404 || blob.includes("not found") || blob.includes("no fee share")) {
    return {
      status: 404,
      error: "Bags has no fee-share record for this mint. Confirm the token is launched on Bags before applying a split.",
    };
  }
  if (e.status === 429 || blob.includes("rate limit")) {
    return {
      status: 429,
      error: "Bags API rate-limited the build request. Wait ~30s and try again.",
    };
  }
  if (e.status >= 500) {
    return {
      status: 502,
      error: `Bags API ${e.status} while building the transaction. This is upstream — retry shortly.`,
    };
  }
  // Generic 4xx fall-through — keep the upstream status and message.
  return {
    status: e.status >= 400 && e.status < 500 ? e.status : 400,
    error: `Bags rejected the build request: ${truncate(blob, 200)}`,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
