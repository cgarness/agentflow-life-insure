import React, { useState, useRef, useCallback, useEffect } from "react";
import { Play, Pause, Volume2, Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface RecordingPlayerProps {
  callId: string;
  /** Compact mode for inline timeline usage */
  compact?: boolean;
  className?: string;
}

/** WebM from MediaRecorder often reports bogus <audio>.duration; decode for a real length. */
async function getDurationFromBlob(blob: Blob): Promise<number> {
  try {
    const ctx = new AudioContext();
    const ab = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(ab.slice(0));
    await ctx.close().catch(() => {});
    const d = audioBuffer.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

function readDurationFromAudioEl(audio: HTMLAudioElement | null): number {
  if (!audio) return 0;
  const d = audio.duration;
  if (Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY) return d;
  try {
    if (audio.seekable && audio.seekable.length > 0) {
      const end = audio.seekable.end(audio.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/**
 * Fetches call recordings from Storage (browser-recorded WebM) or via `recording-proxy` (Telnyx).
 */
export const RecordingPlayer: React.FC<RecordingPlayerProps> = ({
  callId,
  compact = false,
  className = "",
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const syncDurationFromElement = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const d = readDurationFromAudioEl(audio);
    if (d > 0) {
      setDuration((prev) => (prev > 0 ? Math.max(prev, d) : d));
    }
  }, []);

  useEffect(() => {
    fetchedRef.current = false;
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setDuration(0);
    setCurrent(0);
    setError(null);
    setPlaying(false);
  }, [callId]);

  const fetchAudio = useCallback(async () => {
    if (fetchedRef.current || loading) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const { data: callRow } = await supabase
        .from("calls")
        .select("recording_url")
        .eq("id", callId)
        .maybeSingle();

      const recUrl: string | null = callRow?.recording_url;

      let blob: Blob;

      if (recUrl?.startsWith("storage:call-recordings/")) {
        const storagePath = recUrl.replace("storage:call-recordings/", "");
        const { data: b, error: dlErr } = await supabase.storage
          .from("call-recordings")
          .download(storagePath);
        if (dlErr || !b) {
          setError("Recording not available");
          setLoading(false);
          return;
        }
        blob = b;
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          setError("Not authenticated");
          setLoading(false);
          return;
        }

        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recording-proxy`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ call_id: callId }),
          }
        );

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => null);
          setError(errBody?.error || "No recording found");
          setLoading(false);
          return;
        }
        blob = await resp.blob();
      }

      const decodedDur = await getDurationFromBlob(blob);
      if (decodedDur > 0) setDuration(decodedDur);

      setBlobUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [callId, loading]);

  useEffect(() => {
    if (!blobUrl || !audioRef.current) return;
    const el = audioRef.current;
    el.src = blobUrl;
    el.load();
  }, [blobUrl]);

  const togglePlay = async () => {
    if (!blobUrl) {
      await fetchAudio();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrent(audio.currentTime);
    syncDurationFromElement();
  };

  const handleLoadedMetadata = () => {
    syncDurationFromElement();
  };

  const handleDurationChange = () => {
    syncDurationFromElement();
  };

  const handleCanPlay = () => {
    syncDurationFromElement();
  };

  const handleEnded = () => {
    setPlaying(false);
    const audio = audioRef.current;
    if (!audio) return;
    const d = readDurationFromAudioEl(audio);
    if (d > 0) {
      setDuration((prev) => (prev > 0 ? Math.max(prev, d) : d));
      setCurrent(d);
    } else if (Number.isFinite(audio.currentTime)) {
      setCurrent(audio.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setCurrent(val);
    }
  };

  const handleDownload = async () => {
    if (!blobUrl) await fetchAudio();
    if (blobUrl) {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `recording-${callId}.webm`;
      a.click();
    }
  };

  const fmt = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const showScrubber = blobUrl && duration > 0;
  const sliderMax = Math.max(duration, 0.001);
  const sliderValue = Math.min(currentTime, sliderMax);

  const audioHandlers = {
    onTimeUpdate: handleTimeUpdate,
    onLoadedMetadata: handleLoadedMetadata,
    onDurationChange: handleDurationChange,
    onCanPlay: handleCanPlay,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: handleEnded,
    preload: "metadata" as const,
  };

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <audio ref={audioRef} {...audioHandlers} />
        <button
          onClick={togglePlay}
          disabled={loading}
          className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors shrink-0"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : playing ? (
            <Pause className="w-3 h-3" />
          ) : (
            <Play className="w-3 h-3 ml-0.5" />
          )}
        </button>
        {blobUrl && showScrubber && (
          <>
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={0.1}
              value={sliderValue}
              onChange={handleSeek}
              className="flex-1 h-1 accent-primary cursor-pointer"
            />
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums min-w-[72px] text-right">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </>
        )}
        {blobUrl && !showScrubber && !loading && (
          <span className="text-[10px] text-muted-foreground">Loading track…</span>
        )}
        {!blobUrl && !loading && !error && (
          <span className="text-[10px] text-muted-foreground">Click to load</span>
        )}
        {error && (
          <span className="text-[10px] text-destructive truncate max-w-[120px]">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 bg-accent/30 rounded-lg px-3 py-2 ${className}`}>
      <audio ref={audioRef} {...audioHandlers} />
      <button
        onClick={togglePlay}
        disabled={loading}
        className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors shrink-0"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : playing ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {blobUrl && showScrubber ? (
          <>
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={0.1}
              value={sliderValue}
              onChange={handleSeek}
              className="w-full h-1.5 accent-primary cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>{fmt(currentTime)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {loading ? "Loading..." : error || "Click play to load recording"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
        {blobUrl && (
          <button
            onClick={handleDownload}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
