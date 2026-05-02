import { useEffect, useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import { palette } from "../styles/tokens";
import { Badge } from "./ui";
import {
  connectPhantom,
  disconnectPhantom,
  tryReconnectPhantom,
  signBase58Tx,
  PhantomNotInstalledError,
  getPhantom,
} from "../lib/phantom";
import type { BuildSplitResponse } from "../routes/api.apply-split.build";
import type { SubmitSplitResponse } from "../routes/api.apply-split.submit";

/**
 * Admin-mismatch check. PublicKey.equals() compares the underlying 32-byte
 * representation, so it tolerates the (rare) case where two base58 strings
 * round-trip to the same key. Constructing a PublicKey also throws on
 * invalid input — better to fail loud than silently mis-render.
 */
function pubkeysEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    return new PublicKey(a).equals(new PublicKey(b));
  } catch {
    return false;
  }
}

/**
 * F5 — Apply-split flow component.
 *
 * Owns:
 *   - Phantom connection state (auto-reconnect if previously trusted).
 *   - Admin-mismatch pre-check (the connected wallet must equal the on-chain
 *     fee-share admin; otherwise Bags will reject the build call).
 *   - 4-stage flow: build → sign → submit → done. Each stage exposes its own
 *     status string so the UI shows real progress, not a spinner.
 *
 * Failure modes (all surface inline, never silent):
 *   - Phantom not installed → CTA to install.
 *   - Wrong wallet         → "connected wallet ≠ admin" hint with truncated addr.
 *   - Build / sign / submit error → red banner with the underlying message.
 *
 * The UI is intentionally minimal — no toasts, no modals. The flow state lives
 * adjacent to the simulator table so the user sees the chain of effects right
 * where the change was made.
 */

export type SubmittedTx = {
  index: number; // tx index inside the build response
  signature: string;
};

type FlowState =
  | { phase: "idle" }
  | { phase: "building" }
  | { phase: "signing"; total: number; current: number }
  | { phase: "submitting"; total: number; current: number }
  | { phase: "done"; submitted: SubmittedTx[] }
  | {
      phase: "error";
      stage: "build" | "sign" | "submit";
      message: string;
      /**
       * Signatures already landed before the error. In multi-tx scenarios
       * partial success matters — the user must see what's already on-chain
       * so they don't double-submit or panic-recover.
       */
      submitted: SubmittedTx[];
    };

export function ApplySplitFlow({
  mint,
  adminWallet,
  claimers,
  isValid,
  isDirty,
}: {
  mint: string;
  adminWallet: string;
  claimers: Array<{ wallet: string; basisPoints: number }>;
  isValid: boolean;
  isDirty: boolean;
}) {
  const [connected, setConnected] = useState<string | null>(null);
  const [hasPhantom, setHasPhantom] = useState<boolean>(false);
  const [state, setState] = useState<FlowState>({ phase: "idle" });

  useEffect(() => {
    setHasPhantom(getPhantom() != null);
    void tryReconnectPhantom().then((pk) => {
      if (pk) setConnected(pk);
    });
  }, []);

  const onConnect = useCallback(async () => {
    try {
      const pk = await connectPhantom();
      setConnected(pk);
    } catch (e) {
      if (e instanceof PhantomNotInstalledError) {
        setHasPhantom(false);
      }
      setState({
        phase: "error",
        stage: "build",
        message: e instanceof Error ? e.message : String(e),
        submitted: [],
      });
    }
  }, []);

  const onDisconnect = useCallback(async () => {
    await disconnectPhantom();
    setConnected(null);
    setState({ phase: "idle" });
  }, []);

  const onApply = useCallback(async () => {
    if (!connected) return;
    setState({ phase: "building" });

    let build: BuildSplitResponse;
    try {
      const res = await fetch("/api/apply-split/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mint,
          payer: connected,
          claimers,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "build"));
      }
      build = (await res.json()) as BuildSplitResponse;
    } catch (e) {
      setState({
        phase: "error",
        stage: "build",
        message: e instanceof Error ? e.message : String(e),
        submitted: [],
      });
      return;
    }

    const total = build.transactions.length;
    const submitted: SubmittedTx[] = [];

    // Sign-then-submit per tx. Doing it serially so the user sees one
    // wallet prompt at a time rather than n stacked. On a mid-tx failure
    // the running `submitted` list is forwarded into the error state so
    // partial successes never disappear from the UI.
    for (let i = 0; i < total; i++) {
      const tx = build.transactions[i];

      setState({ phase: "signing", total, current: i + 1 });
      let signedB58: string;
      try {
        signedB58 = await signBase58Tx(tx.transaction);
      } catch (e) {
        setState({
          phase: "error",
          stage: "sign",
          message: e instanceof Error ? e.message : String(e),
          submitted: [...submitted],
        });
        return;
      }

      setState({ phase: "submitting", total, current: i + 1 });
      try {
        const res = await fetch("/api/apply-split/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transaction: signedB58 }),
        });
        if (!res.ok) {
          throw new Error(await readErrorMessage(res, "submit"));
        }
        const out = (await res.json()) as SubmitSplitResponse;
        submitted.push({ index: i, signature: out.signature });
      } catch (e) {
        setState({
          phase: "error",
          stage: "submit",
          message: e instanceof Error ? e.message : String(e),
          submitted: [...submitted],
        });
        return;
      }
    }

    setState({ phase: "done", submitted });
  }, [connected, mint, claimers]);

  const isAdminMatch = pubkeysEqual(connected, adminWallet);
  const inProgress =
    state.phase === "building" ||
    state.phase === "signing" ||
    state.phase === "submitting";

  // ── Disconnected / no Phantom branch ───────────────────────────────────
  if (!hasPhantom) {
    return (
      <div
        className="rounded-md p-3 text-xs"
        style={{
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          color: palette.inkMuted,
        }}
      >
        Phantom wallet not detected.{" "}
        <a
          href="https://phantom.app/download"
          target="_blank"
          rel="noreferrer"
          style={{ color: palette.accent }}
        >
          Install Phantom →
        </a>{" "}
        and reload to apply this split on-chain.
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onConnect}
          className="h-9 px-4 rounded-md text-xs font-medium uppercase tracking-wide"
          style={{
            background: palette.accent,
            color: palette.accentInk,
          }}
        >
          Connect Phantom
        </button>
        <span className="text-xs text-ink-subtle">
          Connect with the admin wallet {shortWallet(adminWallet)} to enable Apply.
        </span>
      </div>
    );
  }

  // ── Connected branch ───────────────────────────────────────────────────
  const buttonDisabled =
    !isValid || !isDirty || !isAdminMatch || inProgress;

  let buttonTitle = "";
  if (!isAdminMatch) buttonTitle = `Connected wallet ≠ admin (${shortWallet(adminWallet)})`;
  else if (!isValid) buttonTitle = "BPS must sum to 10000";
  else if (!isDirty) buttonTitle = "No changes to apply";
  else if (inProgress) buttonTitle = "In progress…";
  else buttonTitle = "Build, sign, and submit the on-chain update";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onApply}
          disabled={buttonDisabled}
          title={buttonTitle}
          className="h-9 px-4 rounded-md text-xs font-medium uppercase tracking-wide disabled:opacity-40"
          style={{
            background: palette.accent,
            color: palette.accentInk,
          }}
        >
          {inProgress ? phaseLabel(state) : "Apply split on-chain"}
        </button>
        <button
          onClick={onDisconnect}
          disabled={inProgress}
          className="h-9 px-3 rounded-md text-xs uppercase tracking-wide disabled:opacity-40"
          style={{
            background: "transparent",
            color: palette.inkMuted,
            border: `1px solid ${palette.borderStrong}`,
          }}
        >
          Disconnect
        </button>
        <span className="text-xs text-ink-subtle">
          Connected: {shortWallet(connected)}
          {!isAdminMatch && (
            <Badge tone="warning">
              <span className="mx-1">⚠ not admin</span>
            </Badge>
          )}
          {isAdminMatch && <Badge tone="success">admin ✓</Badge>}
        </span>
      </div>

      {state.phase === "error" && (
        <div
          className="rounded-md p-3 text-xs space-y-2"
          style={{
            background: palette.bg,
            border: `1px solid ${palette.danger}`,
          }}
        >
          <div style={{ color: palette.danger }}>
            <strong className="uppercase tracking-wider mr-2">
              {state.stage} error:
            </strong>
            {state.message}
          </div>
          {state.submitted.length > 0 && (
            <div className="pt-2" style={{ borderTop: `1px solid ${palette.border}` }}>
              <div className="flex items-center gap-2 mb-1">
                <Badge tone="success">partial</Badge>
                <span className="text-ink-muted">
                  {state.submitted.length} on-chain signature
                  {state.submitted.length === 1 ? "" : "s"} landed before the error
                </span>
              </div>
              <ul className="space-y-1 tabular">
                {state.submitted.map((s) => (
                  <li key={s.signature}>
                    <a
                      href={`https://solscan.io/tx/${s.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: palette.accent }}
                    >
                      {s.signature.slice(0, 12)}…{s.signature.slice(-8)} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {state.phase === "done" && state.submitted.length > 0 && (
        <div
          className="rounded-md p-3 text-xs space-y-2"
          style={{
            background: palette.bg,
            border: `1px solid ${palette.success}`,
          }}
        >
          <div className="flex items-center gap-2">
            <Badge tone="success">submitted</Badge>
            <span className="text-ink-muted">
              {state.submitted.length} on-chain signature
              {state.submitted.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="space-y-1 tabular">
            {state.submitted.map((s) => (
              <li key={s.signature}>
                <a
                  href={`https://solscan.io/tx/${s.signature}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: palette.accent }}
                >
                  {s.signature.slice(0, 12)}…{s.signature.slice(-8)} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function phaseLabel(s: FlowState): string {
  if (s.phase === "building") return "Building tx…";
  if (s.phase === "signing") return `Signing ${s.current}/${s.total}…`;
  if (s.phase === "submitting") return `Submitting ${s.current}/${s.total}…`;
  return "Apply split on-chain";
}

function shortWallet(w: string): string {
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

/**
 * Resource routes return `{ error, detail }` JSON on failure (see
 * api.apply-split.{build,submit}.ts). Prefer the friendly `error` string;
 * fall back to the raw body if parsing fails so we never lose the signal.
 */
async function readErrorMessage(res: Response, stage: "build" | "submit"): Promise<string> {
  const txt = await res.text();
  try {
    const parsed = JSON.parse(txt) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    /* not JSON — fall through */
  }
  return `${stage} failed (${res.status}): ${txt.slice(0, 240)}`;
}
