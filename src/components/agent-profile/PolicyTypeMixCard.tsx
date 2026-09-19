/**
 * PolicyTypeMixCard — the product mix of the book, as a donut with the policy count in the centre.
 *
 * GROUPING IS DETERMINISTIC AND STATED (no "assorted" bucket that quietly absorbs half the book):
 *
 *   * Types are ordered by policy count descending, then premium, then label.
 *   * The top TOP_N are shown individually.
 *   * Everything beyond them is summed into ONE "Other" slice, and the card says how many types
 *     that is. Any server-side overflow is added into the same slice, so the legend always sums to
 *     the total.
 *   * A stored value that was blank is its own slice, "Not specified" — which is a different fact
 *     from "Other" and must not be hidden inside it.
 *
 * Policy types are NOT hardcoded. Whatever is stored is what is displayed.
 */

import React, { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import {
  MetricUnavailable,
  ProfileEmptyState,
  ProfileSection,
  ProfileSkeletonBlock,
} from "./ProfilePrimitives";
import {
  formatCount,
  formatMonthlyCurrency,
} from "@/lib/profile/profile-format";
import type { PolicyTypeRow } from "@/lib/profile/profile-queries";
import {
  buildPolicyTypeSlices,
  NOT_SPECIFIED_LABEL,
} from "@/lib/profile/policy-type-slices";

export interface PolicyTypeMixCardProps {
  rows: PolicyTypeRow[] | null;
  overflowPolicies: number;
  totalPolicies: number;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  title?: string;
}

export const PolicyTypeMixCard: React.FC<PolicyTypeMixCardProps> = ({
  rows,
  overflowPolicies,
  totalPolicies,
  isLoading,
  error,
  onRetry,
  title = "Policy type mix",
}) => {
  const { slices, groupedTypeCount } = useMemo(
    () => (rows ? buildPolicyTypeSlices(rows, overflowPolicies) : { slices: [], groupedTypeCount: 0 }),
    [rows, overflowPolicies],
  );

  const total = slices.reduce((sum, s) => sum + s.policies, 0);

  return (
    <ProfileSection title={title} description="Share of the book by product type.">
      {error ? (
        <MetricUnavailable title="Policy mix couldn't load" onRetry={onRetry} />
      ) : isLoading || !rows ? (
        <ProfileSkeletonBlock rows={4} />
      ) : slices.length === 0 || total === 0 ? (
        <ProfileEmptyState
          icon={<PieChartIcon className="h-6 w-6" />}
          title="No policies on the book yet"
          description="The product mix appears once policies are recorded against clients."
        />
      ) : (
        <div className="grid items-center gap-6 sm:grid-cols-2">
          <div className="relative mx-auto w-full max-w-[220px]">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={slices}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={88}
                  dataKey="policies"
                  paddingAngle={2}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                >
                  {slices.map((s) => (
                    <Cell key={s.label} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    color: "hsl(var(--foreground))",
                  }}
                  formatter={(value: number, name: string) => [
                    `${formatCount(value)} ${value === 1 ? "policy" : "policies"}`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatCount(totalPolicies)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {totalPolicies === 1 ? "policy" : "policies"}
                </p>
              </div>
            </div>
          </div>

          <ul className="space-y-2.5">
            {slices.map((s) => {
              const pct = total === 0 ? 0 : (s.policies / total) * 100;
              return (
                <li key={s.label} className="flex items-center gap-2.5 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span
                    className={
                      s.isSynthetic
                        ? "min-w-0 flex-1 truncate italic text-muted-foreground"
                        : "min-w-0 flex-1 truncate text-foreground"
                    }
                  >
                    {s.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatCount(s.policies)}
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                    {pct.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!error && rows && groupedTypeCount > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          &ldquo;Other&rdquo; groups the {groupedTypeCount} least-used policy{" "}
          {groupedTypeCount === 1 ? "type" : "types"}.
        </p>
      )}
      {!error && rows && slices.some((s) => s.label === NOT_SPECIFIED_LABEL) && (
        <p className="mt-1 text-xs text-muted-foreground">
          &ldquo;Not specified&rdquo; means the policy type was left blank on those records.
        </p>
      )}
    </ProfileSection>
  );
};
