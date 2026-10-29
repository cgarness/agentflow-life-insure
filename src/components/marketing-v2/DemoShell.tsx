import React, { useId, useRef } from "react";
import { Pause, Play } from "lucide-react";
import type { DemoAsset } from "./media";
import { useDemoPlayback } from "./useDemoPlayback";

export default function DemoShell({ asset, children, priority = false, chrome = true }: {
  asset: DemoAsset; children?: React.ReactNode; priority?: boolean; chrome?: boolean;
}) {
  const id = useId();
  const failedSources = useRef(new Set<string>());
  const media = useDemoPlayback();
  const hasRecording = asset.verifiedRecording && Boolean(asset.sources?.length);
  const canPlay = hasRecording && !media.failed;
  return (
    <div ref={media.rootRef} className={chrome ? "overflow-hidden rounded-[22px] border border-white/15 bg-[#0a1525] shadow-[0_24px_80px_rgba(0,0,0,0.35)]" : "overflow-hidden rounded-xl bg-[#0a1525]"}>
      {chrome && <div className="flex h-10 items-center justify-between gap-4 border-b border-white/10 bg-[#101e30] px-4">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map(dot => <span key={dot} className="h-2 w-2 rounded-full bg-slate-500/60" />)}
        </div>
        <span className="truncate text-[11px] font-medium text-slate-300">AgentFlow / {asset.label}</span>
        <span aria-hidden="true" className="h-2 w-8" />
      </div>}
      <div className={"relative overflow-hidden bg-[#0a1424] " + (children ? "min-h-[360px] sm:aspect-[16/10]" : "aspect-[16/10]")}>
        {children ? <div className="absolute inset-0 overflow-hidden">{children}</div> : asset.poster ? (
          <img src={asset.poster} alt={asset.description} width="1440" height="900"
            loading={priority ? "eager" : "lazy"} {...{ fetchpriority: priority ? "high" : "auto" }} decoding="async"
            className="block h-full w-full object-contain" />
        ) : <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-300">{asset.description}</div>}
        {canPlay && <video ref={media.videoRef} id={id} muted loop playsInline preload="none"
          poster={asset.poster} aria-label={`${asset.label} demonstration`} aria-describedby={`${id}-description`}
          className="absolute inset-0 block h-full w-full object-contain" onPlaying={media.onPlaying}
          onPause={media.onPause} onError={event => {
            // React propagates a source error through the video handler; keep
            // format fallback alive until every source fails.
            if (event.target === event.currentTarget) media.onError();
          }} onEnded={media.onPause}>
          {media.attachSources && asset.sources?.map(source => <source key={source.src} src={source.src} type={source.type}
            onError={() => {
              failedSources.current.add(source.src);
              if (failedSources.current.size === asset.sources?.length) media.onError();
            }} />)}
        </video>}
      </div>
      <div className="flex min-h-11 items-center justify-between gap-2 border-t border-white/10 bg-[#07101f] pl-3 pr-1">
        <span className="py-2 text-[10px] font-medium tracking-wide text-slate-300">
          {canPlay ? "Actual interface · synthetic data" : media.failed ? "Recording unavailable · static preview" : "Illustrative preview · recording pending"}
        </span>
        {canPlay && <button type="button" onClick={media.toggle} aria-controls={id}
          aria-label={`${media.playing ? "Pause" : "Play"} ${asset.label} demonstration`}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
          {media.playing ? <Pause aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
          {media.playing ? "Pause" : "Play"}
        </button>}
      </div>
      <p id={`${id}-description`} className="sr-only">{asset.description}</p>
      {media.blocked && <p role="status" className="px-4 py-2 text-xs text-slate-300">Select Play to watch this demonstration.</p>}
    </div>
  );
}
