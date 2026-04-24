import type { Route } from "./+types/home";
import { Form, Link, useNavigation } from "react-router";
import { bags } from "../lib/bags-client.server";
import { lamportsToSol } from "../lib/format";
import {
  Badge,
  Card,
  PageShell,
  Stat,
  fmtSolNum,
  shortAddr,
} from "../components/ui";

/**
 * F1 — Token enumerator.
 *
 * Server-side loader: if `?wallet=` is present, fetch admin/list and per-mint
 * lifetime fees. Renders a ranked list with click-through to F2 inspector.
 *
 * Empty wallet, empty admin list, and populated list are all valid render
 * branches — the live API can return any of the three depending on whether
 * the wallet has ever been added as a Bags fee-share admin.
 */

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Fee Optimizer Studio" },
    {
      name: "description",
      content:
        "Tune your Bags token fee splits with data: per-claimer accruals, simulator, recommended splits.",
    },
  ];
}

export type HomeLoaderData =
  | { state: "empty" }
  | {
      state: "loaded";
      wallet: string;
      tokens: { mint: string; lifetimeFeesLamports: string; lifetimeFeesSol: number }[];
      rateLimit: { remaining: number; resetAt: number };
    };

export async function loader({ request }: Route.LoaderArgs): Promise<HomeLoaderData> {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet")?.trim();
  if (!wallet) return { state: "empty" };

  const mints = await bags.adminList(wallet);
  const rows = await Promise.all(
    mints.map(async (mint) => {
      const lamports = await bags.lifetimeFees(mint);
      return {
        mint,
        lifetimeFeesLamports: lamports.toString(),
        lifetimeFeesSol: lamportsToSol(lamports),
      };
    }),
  );
  rows.sort((a, b) => b.lifetimeFeesSol - a.lifetimeFeesSol);

  return {
    state: "loaded",
    wallet,
    tokens: rows,
    rateLimit: bags.rateLimit(),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const data = loaderData as HomeLoaderData;
  const nav = useNavigation();
  const isLoading = nav.state === "loading";

  return (
    <PageShell>
      <div className="space-y-10">
        <section className="space-y-4 max-w-2xl">
          <h1 className="font-display text-5xl leading-tight">
            Tune your token's fee split with{" "}
            <span style={{ color: "var(--color-accent)" }}>data</span>.
          </h1>
          <p className="text-ink-muted text-base leading-relaxed">
            Inspect per-claimer accruals, simulate alternative splits before
            you change them on-chain, and let the recommendation engine compare
            your token to similar Bags launches.
          </p>
        </section>

        <Card>
          <Form method="get" className="flex gap-3 items-end">
            <div className="flex-1">
              <label
                htmlFor="wallet"
                className="block text-xs uppercase tracking-wider text-ink-subtle mb-2"
              >
                Connected wallet
              </label>
              <input
                id="wallet"
                name="wallet"
                type="text"
                placeholder="e.g. 4NeBxj4jgPh82UZFFPsudmxxumtL3Zoqej8EGfd38eYJ"
                defaultValue={data.state === "loaded" ? data.wallet : ""}
                className="w-full h-11 px-3 rounded-md tabular text-sm"
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border-strong)",
                  color: "var(--color-ink)",
                  outline: "none",
                }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="h-11 px-5 rounded-md text-sm font-medium tracking-wide disabled:opacity-50"
              style={{
                background: "var(--color-accent)",
                color: "var(--color-accent-ink)",
              }}
            >
              {isLoading ? "Loading…" : "Load tokens"}
            </button>
          </Form>
        </Card>

        {data.state === "empty" && (
          <Card className="text-center py-16">
            <p className="text-ink-muted">
              Paste an admin wallet above to see the tokens you can tune.
            </p>
            <p className="text-ink-subtle text-xs mt-4 tabular">
              early preview · wallet adapter coming soon
            </p>
          </Card>
        )}

        {data.state === "loaded" && (
          <section className="space-y-5">
            <header className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl">
                {data.tokens.length === 0
                  ? "No tokens"
                  : `${data.tokens.length} token${data.tokens.length === 1 ? "" : "s"}`}
              </h2>
              <span className="text-xs text-ink-subtle tabular">
                rate budget · {data.rateLimit.remaining}/1000 remaining
              </span>
            </header>

            {data.tokens.length === 0 ? (
              <Card className="text-center py-16">
                <p className="text-ink-muted">
                  This wallet isn't fee-share admin on any Bags tokens.
                </p>
                <p className="text-ink-subtle text-xs mt-4 tabular">
                  wallet · {shortAddr(data.wallet)}
                </p>
              </Card>
            ) : (
              <div className="grid gap-3">
                {data.tokens.map((t) => (
                  <Link
                    key={t.mint}
                    to={`/token/${t.mint}`}
                    className="block group"
                  >
                    <Card
                      className="flex items-center justify-between hover:border-accent transition-colors"
                      style={{
                        cursor: "pointer",
                      }}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="font-display text-lg group-hover:text-accent">
                          {shortAddr(t.mint)}
                        </span>
                        <span className="text-xs text-ink-subtle tabular">
                          {t.mint}
                        </span>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="text-xs uppercase tracking-wider text-ink-subtle">
                            lifetime
                          </div>
                          <div
                            className="font-display text-xl tabular"
                            style={{ color: "var(--color-accent)" }}
                          >
                            {fmtSolNum(t.lifetimeFeesSol)} SOL
                          </div>
                        </div>
                        <span
                          className="text-2xl"
                          style={{ color: "var(--color-ink-subtle)" }}
                        >
                          ›
                        </span>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </PageShell>
  );
}
