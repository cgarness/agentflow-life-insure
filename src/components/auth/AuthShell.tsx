import React, { useEffect } from "react";
import { cn } from "@/lib/utils";

interface AuthShellProps {
  /** Max width of the card. `md` for forms/status pages, `lg` for the taller signup. */
  contentWidth?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

const WIDTHS: Record<NonNullable<AuthShellProps["contentWidth"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

/**
 * Full-viewport shell shared by every AgentFlow authentication page: a solid
 * black page with a single centered dark-navy card.
 *
 * `min-h-dvh` (Tailwind 3.4 dynamic viewport height) replaces `min-h-screen`, which
 * leaves a white gap under mobile browser chrome. `.dark` is set explicitly because
 * the app's default theme is `light` — without it every shadcn primitive rendered
 * inside would resolve its near-white semantic tokens.
 *
 * Centering uses flex + `m-auto` on the card column: the card sits dead-center
 * while it fits the viewport, and tops out against the shell's `py-10` padding and
 * scrolls naturally once content is taller (e.g. `/signup` at short viewports).
 */
const AuthShell: React.FC<AuthShellProps> = ({ contentWidth = "md", children }) => {
  // The app's `<body>` carries the light `--background`, which shows through as a
  // white band on overscroll/rubber-banding even though the shell fills the viewport.
  // Tint the body black for the lifetime of any auth page, then restore it.
  useEffect(() => {
    document.body.classList.add("bg-black");
    return () => document.body.classList.remove("bg-black");
  }, []);

  return (
    <div className="dark relative flex min-h-dvh w-full overflow-x-hidden bg-black text-slate-100">
      <main className={cn("relative m-auto w-full px-5 py-10 sm:px-8", WIDTHS[contentWidth])}>
        {/* 1px static gradient border — cobalt top-left, slate through the middle,
            restrained violet bottom-right — with a deep drop shadow and a very
            faint static blue glow. The inner face is opaque so the gradient only
            ever reads as the card's edge. */}
        <div className="rounded-2xl bg-gradient-to-br from-blue-500/50 via-slate-600/30 to-violet-500/45 p-px shadow-[0_10px_40px_rgba(0,0,0,0.65),0_0_60px_-20px_rgba(59,130,246,0.28)]">
          <div className="rounded-[15px] bg-[#0c1222] p-6 sm:p-8">{children}</div>
        </div>
      </main>
    </div>
  );
};

export default AuthShell;
