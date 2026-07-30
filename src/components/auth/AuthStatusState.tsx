import React from "react";
import type { LucideIcon } from "lucide-react";
import Logo from "@/components/shared/Logo";
import { cn } from "@/lib/utils";
import { AUTH_HEADING_CLASS, AUTH_SUBHEADING_CLASS } from "@/components/auth/authTheme";

type StatusTone = "neutral" | "success" | "error" | "warning" | "info";

interface AuthStatusStateProps {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Buttons/links rendered under the copy. */
  children?: React.ReactNode;
  tone?: StatusTone;
  /** Spin the icon (loading states only). Essential feedback, so not motion-gated. */
  spin?: boolean;
  /** Announce this state to assistive technology as it appears. */
  live?: boolean;
}

const TONES: Record<StatusTone, string> = {
  neutral: "border-white/10 bg-white/[0.03] text-slate-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  error: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  info: "border-blue-500/30 bg-blue-500/10 text-blue-300",
};

/**
 * Centered icon + heading + copy + actions.
 *
 * Powers every non-form auth surface: `/confirmation`, all `/accept-invite` states,
 * `/auth/callback`, and the reset-password invalid/success screens. The icon is
 * decorative (`aria-hidden`) and always paired with text, so meaning never depends
 * on the glyph or its colour alone.
 */
const AuthStatusState: React.FC<AuthStatusStateProps> = ({
  icon: Icon,
  title,
  description,
  children,
  tone = "neutral",
  spin = false,
  live = false,
}) => (
  <div
    className="flex flex-col items-center text-center"
    role={live ? "status" : undefined}
    aria-live={live ? "polite" : undefined}
  >
    <Logo variant="full" themeOverride="dark" iconClassName="h-10 w-10" textClassName="h-5" className="mb-8" />

    <span
      aria-hidden="true"
      className={cn("mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border", TONES[tone])}
    >
      <Icon className={cn("h-7 w-7", spin && "animate-spin")} />
    </span>

    <h1 className={cn(AUTH_HEADING_CLASS, "text-balance text-2xl")}>{title}</h1>
    {description && <div className={cn(AUTH_SUBHEADING_CLASS, "mt-3 text-pretty leading-relaxed")}>{description}</div>}
    {children && <div className="mt-8 flex w-full flex-col items-center gap-3">{children}</div>}
  </div>
);

export default AuthStatusState;
