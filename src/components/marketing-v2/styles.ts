export const easing = [0.22, 1, 0.36, 1] as const;
const buttonBase = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060c17]";
export const primaryButton = buttonBase + " bg-sky-400 text-slate-950 shadow-[0_0_30px_rgba(14,165,233,0.18)] hover:bg-sky-300";
export const outlineButton = buttonBase + " border border-white/20 bg-white/[0.04] text-white hover:border-sky-400/60 hover:bg-white/[0.08]";
