import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
    description: "Ring the last agent to call this number.",
  },
  {
    key: "campaign_agents",
    label: "Campaign Agents",
    description:
      "Rings agents in active campaigns using this number's group; skipped if no campaign matches.",
  },
  {
    key: "state_licensed",
    label: "State-Licensed Agents",
    description:
      "Requires a mapped caller area code and a current license in that state.",
  },
  {
    key: "all_available",
    label: "All Available Agents",
    description: "Ring all active agents with a registered phone.",
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
            If the primary agent is unavailable, try these tiers in order.
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
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {tier.label}
                    {(key === "campaign_agents" || isStateTier) && <Popover>
                      <PopoverTrigger asChild><button type="button" aria-label={`About ${tier.label.toLowerCase()}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Info className="h-4 w-4" aria-hidden="true" /></button></PopoverTrigger>
                      <PopoverContent className="text-xs" aria-label={tier.label}>{tier.description}</PopoverContent>
                    </Popover>}
                  </div>
                  {key !== "campaign_agents" && !isStateTier && <div className="text-xs text-muted-foreground">{tier.description}</div>}
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
                      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                        {tier.label}
                        {(key === "campaign_agents" || isStateTier) && <Popover>
                          <PopoverTrigger asChild><button type="button" aria-label={`About ${tier.label.toLowerCase()}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Info className="h-4 w-4" aria-hidden="true" /></button></PopoverTrigger>
                          <PopoverContent className="text-xs" aria-label={tier.label}>{tier.description}</PopoverContent>
                        </Popover>}
                      </div>
                      {key !== "campaign_agents" && !isStateTier && <div className="text-xs text-muted-foreground/80">{tier.description}</div>}
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
