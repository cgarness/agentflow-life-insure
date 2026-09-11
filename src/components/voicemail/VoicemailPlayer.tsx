import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Voicemail } from "lucide-react";
import {
  fetchVoicemail,
  formatVoicemailDuration,
  getVoicemailPlaybackUrl,
  markVoicemailListened,
  type VoicemailRow,
} from "@/lib/voicemails";

interface VoicemailPlayerProps {
  voicemailId: string;
  compact?: boolean;
  className?: string;
  /** Called after listened_at is stamped (first play). */
  onListened?: () => void;
}

/**
 * Inbound Calling v2 — inline playback of an AgentFlow voicemail (private bucket, signed URL).
 * Works for unlinked callers too: it needs only the voicemail id carried in the notification metadata
 * or the call row, never a contact record.
 */
export const VoicemailPlayer: React.FC<VoicemailPlayerProps> = ({ voicemailId, compact = false, className = "", onListened }) => {
  const [row, setRow] = useState<VoicemailRow | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listenedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const vm = await fetchVoicemail(voicemailId);
        if (cancelled) return;
        if (!vm) { setError("This voicemail is no longer available."); return; }
        setRow(vm);
        listenedRef.current = !!vm.listened_at;
        const signed = await getVoicemailPlaybackUrl(vm);
        if (cancelled) return;
        if (!signed) { setError(vm.status === "purged" ? "This voicemail has expired." : "This voicemail is still being processed."); return; }
        setUrl(signed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the voicemail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [voicemailId]);

  const handlePlay = useCallback(() => {
    if (listenedRef.current) return;
    listenedRef.current = true;
    void markVoicemailListened(voicemailId).then(() => onListened?.()).catch(() => { listenedRef.current = false; });
  }, [voicemailId, onListened]);

  if (loading) {
    return (
      <span className={`inline-flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading voicemail…
      </span>
    );
  }
  if (error || !url) {
    return <span className={`text-xs text-muted-foreground ${className}`}>{error ?? "Voicemail unavailable."}</span>;
  }
  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid="voicemail-player">
      {!compact && <Voicemail className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />}
      <audio controls preload="none" src={url} onPlay={handlePlay} className={compact ? "h-8 w-full max-w-xs" : "h-9 w-full max-w-sm"} aria-label="Voicemail playback" />
      {row?.duration_seconds != null && (
        <span className="shrink-0 text-xs text-muted-foreground">{formatVoicemailDuration(row.duration_seconds)}</span>
      )}
    </div>
  );
};

export default VoicemailPlayer;
