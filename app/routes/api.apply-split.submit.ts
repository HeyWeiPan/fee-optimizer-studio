import type { Route } from "./+types/api.apply-split.submit";
import { z } from "zod";
import { bags, BagsApiError } from "../lib/bags-client.server";

/**
 * F5 — Submit a signed admin update-config transaction.
 *
 * Bags `/solana/send-transaction` accepts a base58-encoded signed
 * VersionedTransaction and returns the on-chain signature (or an error if
 * sim fails / blockhash is stale). We pass through with no transformation;
 * any extra retry / preflight policy belongs at the wallet-flow layer, not
 * here.
 *
 * Bags error mapping: stale blockhash, simulation failure, and insufficient
 * funds all return as 4xx with action-oriented hints instead of raw blobs.
 */

const BodySchema = z.object({
  /** base58-encoded signed VersionedTransaction.serialize() */
  transaction: z.string().min(1),
});

export type SubmitSplitResponse = {
  signature: string;
  rateLimit: { remaining: number; resetAt: number };
};

export async function action({ request }: Route.ActionArgs): Promise<SubmitSplitResponse> {
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

  let signature: string;
  try {
    signature = await bags.sendTransaction(parsed.transaction);
  } catch (e) {
    if (e instanceof BagsApiError) {
      const { status, error } = mapSubmitError(e);
      throw new Response(
        JSON.stringify({ error, detail: { bagsStatus: e.status, body: e.body } }),
        { status, headers: { "content-type": "application/json" } },
      );
    }
    throw e;
  }

  return {
    signature,
    rateLimit: bags.rateLimit(),
  };
}

/**
 * Translate a `BagsApiError` from `/solana/send-transaction` into a friendly
 * hint. The most common failure modes:
 *   - stale blockhash    → user took too long between build and sign
 *   - simulation fail    → on-chain validator rejected the tx
 *   - insufficient SOL   → payer wallet can't cover network fee
 */
function mapSubmitError(e: BagsApiError): { status: number; error: string } {
  const blob = JSON.stringify(e.body ?? "").toLowerCase();
  if (blob.includes("blockhash") && (blob.includes("expired") || blob.includes("not found"))) {
    return {
      status: 410,
      error: "Transaction blockhash expired before submit. Click Apply again to rebuild and re-sign.",
    };
  }
  if (blob.includes("insufficient") || blob.includes("lamports")) {
    return {
      status: 402,
      error: "Payer wallet has insufficient SOL to cover the network fee. Top up and retry.",
    };
  }
  if (blob.includes("simulation") || blob.includes("simulate")) {
    return {
      status: 400,
      error: `On-chain simulation failed: ${truncate(blob, 200)}`,
    };
  }
  if (e.status === 429 || blob.includes("rate limit")) {
    return {
      status: 429,
      error: "Bags API rate-limited the submit request. Wait ~30s and try again.",
    };
  }
  if (e.status >= 500) {
    return {
      status: 502,
      error: `Bags API ${e.status} while submitting. This is upstream — wait and retry.`,
    };
  }
  return {
    status: e.status >= 400 && e.status < 500 ? e.status : 400,
    error: `Bags rejected the submit: ${truncate(blob, 200)}`,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
