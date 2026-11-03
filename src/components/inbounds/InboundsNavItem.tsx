import { Headphones, ExternalLink } from "lucide-react";
import { INBOUNDS_ENABLED } from "@/lib/inbounds/contracts";
export function InboundsNavItem({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  if (!INBOUNDS_ENABLED) return null;
  return (
    <a
      href="/inbounds"
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      title="Inbounds · opens a new tab"
      aria-label="Inbounds · opens a new tab"
      className={
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-slate-800 " +
        (collapsed ? "justify-center" : "")
      }
    >
      <Headphones className="h-5 w-5 shrink-0" />
      {!collapsed && (
        <>
          <span>Inbounds</span>
          <ExternalLink className="ml-auto h-3 w-3" />
        </>
      )}
    </a>
  );
}
