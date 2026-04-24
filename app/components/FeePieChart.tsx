import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { palette } from "../styles/tokens";
import { shortAddr } from "./ui";

export type ClaimerSlice = {
  wallet: string;
  label: string;
  basisPoints: number;
};

export function FeePieChart({ claimers }: { claimers: ClaimerSlice[] }) {
  // Pie only renders fee-active (>0 BPS) claimers. 0-BPS rows are display-only
  // and would distort the visual.
  const data = claimers
    .filter((c) => c.basisPoints > 0)
    .map((c) => ({
      name: c.label || shortAddr(c.wallet),
      wallet: c.wallet,
      value: c.basisPoints,
    }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-ink-subtle text-sm">
        no fee-active claimers
      </div>
    );
  }

  return (
    <div className="w-full h-64">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            stroke={palette.surface}
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={palette.chart[i % palette.chart.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0];
              const value = p.value as number;
              return (
                <div
                  className="px-3 py-2 text-xs tabular"
                  style={{
                    background: palette.surface,
                    border: `1px solid ${palette.border}`,
                    borderRadius: 8,
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
                  }}
                >
                  <div className="font-medium" style={{ color: palette.ink }}>
                    {p.payload.name}
                  </div>
                  <div style={{ color: palette.inkMuted }}>
                    {(value / 100).toFixed(2)}% · {value.toLocaleString()} BPS
                  </div>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
