/**
 * Lamports → SOL display helpers. NEVER do arithmetic on Number(lamports);
 * lifetime accruals on popular tokens overflow safely as BigInt only.
 */

const LAMPORTS_PER_SOL = 1_000_000_000n;

export function lamportsToSol(lamports: bigint): number {
  // Two-stage: integer SOL portion + fractional. Avoids precision loss on small fractions.
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  return Number(whole) + Number(frac) / Number(LAMPORTS_PER_SOL);
}

export function formatSol(lamports: bigint, opts: { digits?: number } = {}): string {
  const sol = lamportsToSol(lamports);
  const d = opts.digits ?? 4;
  return sol.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function bpsToPct(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}
