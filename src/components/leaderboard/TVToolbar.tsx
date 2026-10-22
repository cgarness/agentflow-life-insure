import React from "react";
import { X, Settings, Clock, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface TVToolbarProps {
  clockDisplay: string;
  live: boolean;
  tvDisplayName: string;
  onExit: () => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  /** The options popover holds only the org-wide ticker editor, so only Admin / Team Leader see it. */
  canEditBanner: boolean;
  customBanner: string | null;
  bannerDraft: string;
  onBannerDraftChange: (draft: string) => void;
  savingBanner: boolean;
  onSaveBanner: () => void;
}

/** 3-column toolbar; side clusters sit above the center title for reliable clicks. */
const TVToolbar: React.FC<TVToolbarProps> = ({
  clockDisplay,
  live,
  tvDisplayName,
  onExit,
  settingsOpen,
  onSettingsOpenChange,
  canEditBanner,
  customBanner,
  bannerDraft,
  onBannerDraftChange,
  savingBanner,
  onSaveBanner,
}) => (
  <div className="relative z-[10001] grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-white/5 bg-black/40 px-4 md:px-6 backdrop-blur-md">
    <div className="relative z-20 flex min-w-0 items-center gap-2 md:gap-4">
      {canEditBanner && (
        <>
          <Popover modal={false} open={settingsOpen} onOpenChange={onSettingsOpenChange}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative z-30 h-10 w-10 shrink-0 touch-manipulation rounded-lg border border-white/10 bg-white/5 text-slate-300 shadow-sm transition-all hover:bg-white/10"
                aria-label="TV display options"
                aria-expanded={settingsOpen}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              onEscapeKeyDown={event => {
                event.preventDefault();
                onSettingsOpenChange(false);
              }}
              className="z-[10020] w-80 max-h-[min(85vh,32rem)] overflow-y-auto p-4 sm:w-96 bg-slate-900 border-slate-800 text-slate-200 shadow-2xl"
              align="start"
              side="bottom"
              sideOffset={8}
            >
              <div className="space-y-2">
                <Label htmlFor="tv-ticker-banner" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scrolling ticker (org-wide)</Label>
                <Textarea
                  id="tv-ticker-banner"
                  value={bannerDraft}
                  onChange={e => onBannerDraftChange(e.target.value)}
                  placeholder="Custom message or win feed…"
                  rows={3}
                  className="text-sm bg-slate-800 border-slate-700 focus:ring-blue-500"
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={() => onBannerDraftChange(customBanner ?? "")} disabled={savingBanner}>
                    Reset
                  </Button>
                  <Button type="button" size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={onSaveBanner} disabled={savingBanner || bannerDraft === (customBanner ?? "")}>
                    {savingBanner ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <div className="h-6 w-[1px] bg-white/10 hidden sm:block" />
        </>
      )}
      {/* Bigger clock and live feed */}
      <div className="flex items-center gap-5 text-white">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="text-base font-bold tabular-nums tracking-wide">{clockDisplay}</span>
        </div>
        {live && (
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 shrink-0 text-emerald-400" />
            <span className="hidden text-base font-bold uppercase tracking-widest text-emerald-400 md:inline">
              Live Feed
            </span>
          </div>
        )}
      </div>
    </div>

    <h1
      className="pointer-events-none relative z-10 max-w-[9rem] select-none truncate text-center text-base font-black tracking-tight text-white drop-shadow-md sm:max-w-xs sm:text-lg md:max-w-md md:text-xl"
      title={tvDisplayName}
    >
      {tvDisplayName}
    </h1>

    <div className="relative z-20 flex justify-end">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0 touch-manipulation rounded-lg border border-white/10 bg-white/5 text-slate-300 transition-all hover:bg-red-500/20 hover:text-red-400"
        onClick={onExit}
        aria-label="Exit TV mode"
      >
        <X className="h-5 w-5" />
      </Button>
    </div>
  </div>
);

export default TVToolbar;
