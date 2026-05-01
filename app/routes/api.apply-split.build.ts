import type { Route } from "./+types/api.apply-split.build";
import { z } from "zod";
import { bags } from "../lib/bags-client.server";

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

  const transactions = await bags.updateConfigTx({
    baseMint: parsed.mint,
    claimersArray,
    basisPointsArray,
    payer: parsed.payer,
    additionalLookupTables: parsed.additionalLookupTables,
  });

  return {
    transactions,
    rateLimit: bags.rateLimit(),
  };
}
