import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, GitBranch, Info } from "lucide-react";
import { motion } from "framer-motion";

export type FallbackTierKey =
  | "last_agent"
  | "campaign_agents"
  | "state_licensed"
  | "all_available";

interface TierDef {
  key: FallbackTierKey;
  label: string;
  description: string;
}

const TIERS: TierDef[] = [
  {
    key: "last_agent",
    label: "Last Agent",
    description: "Ring the agent who last placed an outbound call to this caller.",
  },
  {
    key: "campaign_agents",
    label: "Campaign Agents",
    description:
      "Ring agents assigned to an active campaign whose number group includes the dialed number. Skipped if this number isn't in any campaign's number group.",
  },
  {
    key: "state_licensed",
    label: "State-Licensed Agents",
    description:
      "Ring agents licensed in the state mapped to the caller's area code. Requires the area code in the Area Code Mapping table and a current license for that state.",
  },
  {
    key: "all_available",
    label: "All Available Agents",
    description: "Ring every active agent in the organization with a registered Twilio device.",
  },
];

const TIER_BY_KEY: Record<FallbackTierKey, TierDef> = TIERS.reduce(
  (acc, t) => ({ ...acc, [t.key]: t }),
  {} as Record<FallbackTierKey, TierDef>,
);

interface FallbackChainSectionProps {
  value: string[];
  onChange: (next: string[]) => void;
  hasStateLicenses?: boolean;
}

function isValidTier(key: string): key is FallbackTierKey {
  return key === "last_agent" || key === "campaign_agents" || key === "state_licensed" || key === "all_available";
}

export const FallbackChainSection: React.FC<FallbackChainSectionProps> = ({
  value,
  onChange,
  hasStateLicenses,
}) => {
  const enabled = value.filter(isValidTier);
  const enabledSet = new Set(enabled);
  const disabled = TIERS.filter((t) => !enabledSet.has(t.key)).map((t) => t.key);

  const toggle = (key: FallbackTierKey, on: boolean) => {
    if (on) {
      if (enabledSet.has(key)) return;
      onChange([...enabled, key]);
    } else {
      onChange(enabled.filter((k) => k !== key));
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...enabled];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
      <Card className="border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm">
        <div className="h-1 w-full bg-cyan-500/80"></div>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <GitBranch className="w-5 h-5 text-cyan-500" />
            Inbound Fallback Chain
          </CardTitle>
          <CardDescription>
            When a call comes in and the primary agent is unavailable, the system tries each tier in order until someone answers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {enabled.map((key, idx) => {
            const tier = TIER_BY_KEY[key];
            const isStateTier = key === "state_licensed";
            return (
              <div
                key={key}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                    aria-label={`Move ${tier.label} up`}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={idx === enabled.length - 1}
                    onClick={() => move(idx, 1)}
                    aria-label={`Move ${tier.label} down`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500/15 text-cyan-600 text-xs font-semibold">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{tier.label}</div>
                  <div className="text-xs text-muted-foreground">{tier.description}</div>
                  {isStateTier && hasStateLicenses === false && (
                    <div className="mt-1 flex items-start gap-1 text-[11px] text-amber-600">
                      <Info className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>No state licenses configured yet. Add licenses in the State Licenses tab.</span>
                    </div>
                  )}
                </div>
                <Switch checked onCheckedChange={(on) => toggle(key, on)} />
              </div>
            );
          })}

          {disabled.length > 0 && (
            <div className="pt-2 mt-2 border-t border-border/40 space-y-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground/80">Disabled</div>
              {disabled.map((key) => {
                const tier = TIER_BY_KEY[key];
                const isStateTier = key === "state_licensed";
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-lg border border-dashed border-border/40 bg-transparent p-3 opacity-70"
                  >
                    <div className="w-7" />
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
                      —
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-muted-foreground">{tier.label}</div>
                      <div className="text-xs text-muted-foreground/80">{tier.description}</div>
                      {isStateTier && hasStateLicenses === false && (
                        <div className="mt-1 flex items-start gap-1 text-[11px] text-amber-600/80">
                          <Info className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>No state licenses configured yet. Add licenses in the State Licenses tab.</span>
                        </div>
                      )}
                    </div>
                    <Switch checked={false} onCheckedChange={(on) => toggle(key, on)} />
                  </div>
                );
              })}
            </div>
          )}

          {enabled.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No fallback tiers enabled. Calls that the primary agent does not answer go straight to the unanswered action below.
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default FallbackChainSection;
