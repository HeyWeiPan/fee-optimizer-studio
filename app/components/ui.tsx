import type { ReactNode, HTMLAttributes, ButtonHTMLAttributes } from "react";

export function Card({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg p-6 ${className}`}
      style={{ boxShadow: "0 1px 0 rgba(0, 0, 0, 0.3)" }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
}) {
  const toneColor = {
    default: "var(--color-ink)",
    accent: "var(--color-accent)",
    success: "var(--color-success)",
    warning: "var(--color-warning)",
    danger: "var(--color-danger)",
  }[tone];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-ink-subtle">
        {label}
      </span>
      <span
        className="font-display text-3xl tabular"
        style={{ color: toneColor }}
      >
        {value}
      </span>
      {hint != null && (
        <span className="text-xs text-ink-muted tabular">{hint}</span>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "success" | "warning" | "danger" | "muted";
}) {
  const styles = {
    default: { bg: "var(--color-bg)", fg: "var(--color-ink-muted)", border: "var(--color-border)" },
    accent: { bg: "var(--color-accent-soft)", fg: "var(--color-accent)", border: "transparent" },
    success: { bg: "var(--color-success-soft)", fg: "var(--color-success)", border: "transparent" },
    warning: { bg: "var(--color-warning-soft)", fg: "var(--color-warning)", border: "transparent" },
    danger: { bg: "var(--color-danger-soft)", fg: "var(--color-danger)", border: "transparent" },
    muted: { bg: "transparent", fg: "var(--color-ink-subtle)", border: "var(--color-border)" },
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium tracking-wide"
      style={{
        background: styles.bg,
        color: styles.fg,
        border: `1px solid ${styles.border}`,
      }}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
}) {
  const base =
    "inline-flex items-center gap-2 px-4 h-10 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variantStyle =
    variant === "primary"
      ? { background: "var(--color-accent)", color: "var(--color-accent-ink)" }
      : {
          background: "transparent",
          color: "var(--color-ink)",
          border: "1px solid var(--color-border-strong)",
        };
  return (
    <button
      className={`${base} ${className}`}
      style={variantStyle}
      onMouseEnter={(e) => {
        if (variant === "primary")
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--color-accent-hover)";
      }}
      onMouseLeave={(e) => {
        if (variant === "primary")
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--color-accent)";
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-baseline justify-between">
          <a href="/" className="font-display text-xl">
            Fee Optimizer Studio
          </a>
          <span className="text-xs text-ink-subtle uppercase tracking-widest">
            for Bags creators
          </span>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-10">{children}</main>
    </div>
  );
}

export function shortAddr(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function fmtSolNum(sol: number, digits = 4): string {
  if (sol === 0) return "0";
  if (sol < 0.0001) return "< 0.0001";
  return sol.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function formatTimestamp(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
