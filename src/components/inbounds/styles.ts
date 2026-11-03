export const panel =
  "overflow-hidden rounded-2xl border border-slate-600 bg-gradient-to-br from-slate-800 to-slate-900 shadow-lg shadow-black/10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500";
export const field =
  "w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-3 text-sm text-white placeholder:text-slate-400 transition-colors hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-emerald-300 motion-reduce:transition-none";
const buttonBase =
  "rounded-lg border px-4 py-2.5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 motion-reduce:transition-none";
export const button =
  buttonBase +
  " border-slate-500 bg-slate-700 text-white hover:border-blue-300 hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/20";
export const primary =
  buttonBase +
  " border-emerald-300 bg-emerald-300 text-slate-950 hover:border-emerald-200 hover:bg-emerald-200 hover:shadow-lg hover:shadow-emerald-400/25";
export const danger =
  buttonBase +
  " border-rose-400 bg-rose-600 text-white hover:border-rose-300 hover:bg-rose-500 hover:shadow-lg hover:shadow-rose-500/25";
export const textButton =
  "rounded underline underline-offset-4 transition-colors hover:text-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 motion-reduce:transition-none";
