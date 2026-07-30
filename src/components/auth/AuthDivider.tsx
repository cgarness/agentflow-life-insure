import React from "react";
import { cn } from "@/lib/utils";

/**
 * Static header-to-content divider for the auth form pages: a thin centered
 * line, ~60% of the content width, fading blue → faint cyan → restrained
 * violet with transparent ends. Purely decorative — never animated.
 */
const AuthDivider: React.FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden="true"
    className={cn(
      "mx-auto h-px w-3/5 bg-[linear-gradient(90deg,transparent,rgba(59,130,246,0.55),rgba(34,211,238,0.35),rgba(139,92,246,0.55),transparent)]",
      className,
    )}
  />
);

export default AuthDivider;
