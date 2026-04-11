import React, { useState, useRef, useCallback, useEffect } from "react";
import { Play, Pause, Trash2, Phone, User, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export interface VoicemailRecord {
  id: string;
  organization_id: string;
  agent_id: string | null;
  contact_id: string | null;
  caller_number: string;
  recording_url: string | null;
  duration_seconds: number | null;
  transcription: string | null;
  is_read: boolean;
  created_at: string;
  contact?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

interface Props {
  voicemail: VoicemailRecord;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
  onCallBack: (phone: string, contactId: string | null) => void;
}

const formatPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
};

const formatDuration = (secs: number | null): string => {
  if (!secs || secs < 0) return "--:--";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const VoicemailRow: React.FC<Props> = ({ voicemail, onMarkRead, onDelete, onCallBack }) => {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const fetchAudio = useCallback(async (): Promise<string | null> => {
    if (blobUrl) return blobUrl;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Not authenticated");
        return null;
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
          body: JSON.stringify({ voicemail_id: voicemail.id }),
        }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        toast.error(err?.error || "No recording available");
        return null;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      return url;
    } catch (e: any) {
      toast.error(e.message || "Failed to load voicemail");
      return null;
    } finally {
      setLoading(false);
    }
  }, [voicemail.id, blobUrl]);

  const togglePlay = async () => {
    if (!audioRef.current) return;
    if (!blobUrl) {
      const url = await fetchAudio();
      if (!url) return;
      audioRef.current.src = url;
    }
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((e) => toast.error(e.message));
      if (!voicemail.is_read) onMarkRead(voicemail.id);
    }
  };

  const displayName = voicemail.contact
    ? `${voicemail.contact.first_name || ""} ${voicemail.contact.last_name || ""}`.trim() || "Unknown"
    : "Unknown Caller";

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
        voicemail.is_read
          ? "border-border bg-card"
          : "border-primary/40 bg-primary/5 font-medium"
      }`}
    >
      <button
        onClick={togglePlay}
        disabled={loading || !voicemail.recording_url}
        className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 disabled:opacity-40 flex items-center justify-center shrink-0"
        title={voicemail.recording_url ? "Play voicemail" : "Recording not ready"}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        ) : playing ? (
          <Pause className="w-4 h-4 text-primary" />
        ) : (
          <Play className="w-4 h-4 text-primary ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {!voicemail.is_read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
          <p className="text-sm text-foreground truncate">{displayName}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatPhone(voicemail.caller_number)} · {formatDuration(voicemail.duration_seconds)} ·{" "}
          {formatDistanceToNow(new Date(voicemail.created_at), { addSuffix: true })}
        </p>
        {voicemail.transcription && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
            "{voicemail.transcription}"
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onCallBack(voicemail.caller_number, voicemail.contact_id)}
          className="w-8 h-8 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-green-600"
          title="Call back"
        >
          <Phone className="w-4 h-4" />
        </button>
        {voicemail.contact_id && (
          <button
            onClick={() => (window.location.href = `/contacts/${voicemail.contact_id}`)}
            className="w-8 h-8 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground"
            title="Open contact"
          >
            <User className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => onDelete(voicemail.id)}
          className="w-8 h-8 rounded-md hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  );
};

export default VoicemailRow;
