/**
 * Minimal Phantom provider helpers (browser-only).
 *
 * Single-wallet integration (Phantom only). Avoids pulling in
 * `@solana/wallet-adapter-*` for the first cut; multi-wallet support can be
 * layered on later.
 *
 * All functions throw a descriptive Error on the unhappy path; callers
 * surface them in the flow state machine.
 */

import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString: () => string } | null;
  isConnected?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  disconnect: () => Promise<void>;
  signTransaction: <T>(tx: T) => Promise<T>;
  signAllTransactions?: <T>(txs: T[]) => Promise<T[]>;
};

declare global {
  interface Window {
    solana?: PhantomProvider;
    phantom?: { solana?: PhantomProvider };
  }
}

export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const fromWindow = window.solana;
  if (fromWindow?.isPhantom) return fromWindow;
  const fromPhantom = window.phantom?.solana;
  if (fromPhantom?.isPhantom) return fromPhantom;
  return null;
}

export class PhantomNotInstalledError extends Error {
  constructor() {
    super("Phantom wallet not detected. Install from https://phantom.app and reload.");
    this.name = "PhantomNotInstalledError";
  }
}

export async function connectPhantom(): Promise<string> {
  const p = getPhantom();
  if (!p) throw new PhantomNotInstalledError();
  const { publicKey } = await p.connect();
  return publicKey.toString();
}

export async function tryReconnectPhantom(): Promise<string | null> {
  const p = getPhantom();
  if (!p) return null;
  try {
    const { publicKey } = await p.connect({ onlyIfTrusted: true });
    return publicKey.toString();
  } catch {
    return null;
  }
}

export async function disconnectPhantom(): Promise<void> {
  const p = getPhantom();
  if (!p) return;
  try {
    await p.disconnect();
  } catch {
    /* swallow — the user already gets the disconnected state */
  }
}

/**
 * Sign a base58-encoded unsigned VersionedTransaction with Phantom.
 * Returns the signed tx, re-encoded to base58.
 */
export async function signBase58Tx(unsignedB58: string): Promise<string> {
  const p = getPhantom();
  if (!p) throw new PhantomNotInstalledError();
  const decoded = bs58.decode(unsignedB58);
  const tx = VersionedTransaction.deserialize(decoded);
  const signed = await p.signTransaction(tx);
  return bs58.encode(signed.serialize());
}
