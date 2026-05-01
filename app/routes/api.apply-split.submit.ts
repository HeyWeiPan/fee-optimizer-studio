import type { Route } from "./+types/api.apply-split.submit";
import { z } from "zod";
import { bags } from "../lib/bags-client.server";

/**
 * F5 — Submit a signed admin update-config transaction.
 *
 * Bags `/solana/send-transaction` accepts a base58-encoded signed
 * VersionedTransaction and returns the on-chain signature (or an error if
 * sim fails / blockhash is stale). We pass through with no transformation;
 * any extra retry / preflight policy belongs at the wallet-flow layer, not
 * here.
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

  const signature = await bags.sendTransaction(parsed.transaction);

  return {
    signature,
    rateLimit: bags.rateLimit(),
  };
}
