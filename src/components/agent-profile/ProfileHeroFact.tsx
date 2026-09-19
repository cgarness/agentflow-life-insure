/**
 * ProfileHeroFact — one labelled fact in the hero's identity strip.
 *
 * Split out of ProfileHero purely so that file stays under the 200-line component rule. Everything
 * here is a theme token, and the value is rendered as a node so a caller can pass a muted
 * "Not on file" placeholder rather than a fabricated value.
 */

import React from "react";

export const ProfileHeroFact: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}> = ({ icon, label, value }) => (
  <div className="flex items-start gap-2.5">
    <span className="mt-0.5 shrink-0 text-muted-foreground/70">{icon}</span>
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  </div>
);
