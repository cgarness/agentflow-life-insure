import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Calendar, Users, Award, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface DailyBriefingModalProps {
  open: boolean;
  onClose: () => void;
  firstName: string;
  appointments: any[];
  followUps: any[];
  anniversaries: any[];
  stats: any;
}

const BRIEFING_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-briefing`;

const DailyBriefingModal: React.FC<DailyBriefingModalProps> = ({
  open,
  onClose,
  firstName,
  appointments,
  followUps,
  anniversaries,
  stats,
}) => {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const streamBriefing = useCallback(async () => {
    setContent("");
    setError(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(BRIEFING_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          firstName,
          appointments: appointments.slice(0, 5).map((a: any) => ({
            name: a.name,
            type: a.type,
            time: a.time,
          })),
          followUps: followUps.slice(0, 8).map((f: any) => ({
            firstName: f.firstName,
            lastName: f.lastName,
            aging: f.aging,
            leadSource: f.leadSource,
          })),
          anniversaries: anniversaries.slice(0, 5).map((a: any) => ({
            firstName: a.firstName,
            lastName: a.lastName,
            policyType: a.policyType,
            daysUntilAnniversary: a.daysUntilAnniversary,
          })),
          stats,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => null);
        throw new Error(errData?.error || `Request failed (${resp.status})`);
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              setContent(accumulated);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // flush remaining
      if (buffer.trim()) {
        for (let raw of buffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              setContent(accumulated);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Briefing stream error:", err);
        setError(err.message || "Failed to load briefing");
      }
    } finally {
      setIsStreaming(false);
    }
  }, [firstName, appointments, followUps, anniversaries, stats]);

  useEffect(() => {
    if (open) {
      streamBriefing();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [open, streamBriefing]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 bg-card border-border overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                {greeting}, {firstName}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">Here's your day at a glance</p>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2 bg-background/60 rounded-lg px-3 py-2">
              <Calendar className="w-4 h-4 text-primary" />
              <div>
                <p className="text-lg font-bold text-foreground leading-none">{appointments.length}</p>
                <p className="text-[10px] text-muted-foreground">Appointments</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-background/60 rounded-lg px-3 py-2">
              <Users className="w-4 h-4 text-primary" />
              <div>
                <p className="text-lg font-bold text-foreground leading-none">{followUps.length}</p>
                <p className="text-[10px] text-muted-foreground">Follow-ups</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-background/60 rounded-lg px-3 py-2">
              <Award className="w-4 h-4 text-primary" />
              <div>
                <p className="text-lg font-bold text-foreground leading-none">{anniversaries.length}</p>
                <p className="text-[10px] text-muted-foreground">Anniversaries</p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Content */}
        <div className="px-6 py-5 max-h-[360px] overflow-y-auto">
          {error ? (
            <div className="text-center py-8">
              <p className="text-sm text-destructive mb-2">{error}</p>
              <button
                onClick={streamBriefing}
                className="text-sm text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          ) : !content && isStreaming ? (
            <div className="flex items-center gap-3 py-8 justify-center">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <span className="text-sm text-muted-foreground">Preparing your briefing…</span>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-foreground [&_p]:text-foreground [&_li]:text-foreground [&_strong]:text-foreground">
              <ReactMarkdown>{content}</ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5 rounded-sm" />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          >
            Let's Go 🚀
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DailyBriefingModal;
