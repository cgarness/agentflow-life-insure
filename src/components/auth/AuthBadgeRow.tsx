import React from "react";
import { Building2, PhoneCall, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Display-only product-area badges for the bottom of the login card.
 *
 * Deliberately NOT interactive: no links, no buttons, nothing focusable, no
 * hover styles. Each label names a real product area — never a trust,
 * security, or compliance claim. Icons are decorative and hidden from
 * assistive technology; the labels carry the meaning.
 */
const BADGES: Array<{ label: string; Icon: LucideIcon; className: string }> = [
  { label: "CRM", Icon: Users, className: "border-blue-500/30 bg-blue-500/10 text-blue-300" },
  { label: "Dialer", Icon: PhoneCall, className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" },
  { label: "Agency Ops", Icon: Building2, className: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
];

const AuthBadgeRow: React.FC<{ className?: string }> = ({ className }) => (
  <ul className={cn("flex flex-wrap items-center justify-center gap-2", className)}>
    {BADGES.map(({ label, Icon, className: badgeClassName }) => (
      <li
        key={label}
        className={cn(
          "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium tracking-wide",
          badgeClassName,
        )}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </li>
    ))}
  </ul>
);

export default AuthBadgeRow;
