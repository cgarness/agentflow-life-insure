import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Win {
  id: string;
  agent_name: string;
  contact_name: string;
  campaign_name: string | null;
  created_at: string;
}

// Web Audio API chime generator
function playWinChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.12);
      gain.gain.exponentialDecayToValueAtTime?.(0.01, ctx.currentTime + i * 0.12 + 0.4) ||
        gain.gain.setTargetAtTime(0.01, ctx.currentTime + i * 0.12 + 0.1, 0.1);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.4);
    });
    // Close context after sounds complete
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // Audio not supported
  }
}

// Confetti burst generator
function createConfetti() {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;overflow:hidden;";
  document.body.appendChild(container);

  const colors = ["#22c55e", "#fbbf24", "#3b82f6", "#ffffff", "#10b981", "#f59e0b"];
  const shapes = ["square", "circle"];

  for (let i = 0; i < 40; i++) {
    const confetti = document.createElement("div");
    const size = Math.random() * 10 + 6;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    const left = Math.random() * 100;
    const rotation = Math.random() * 360;
    const duration = Math.random() * 1 + 1.5;
    const delay = Math.random() * 0.5;

    confetti.style.cssText = `
      position: absolute;
      top: -20px;
      left: ${left}%;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${shape === "circle" ? "50%" : "2px"};
      transform: rotate(${rotation}deg);
      animation: confetti-fall ${duration}s ease-out ${delay}s forwards;
    `;
    container.appendChild(confetti);
  }

  // Add keyframes if not exists
  if (!document.getElementById("confetti-style")) {
    const style = document.createElement("style");
    style.id = "confetti-style";
    style.textContent = `
      @keyframes confetti-fall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  // Remove container after animation
  setTimeout(() => container.remove(), 2500);
}

const WinCelebration: React.FC = () => {
  const { user } = useAuth();
  const [queue, setQueue] = useState<Win[]>([]);
  const [currentWin, setCurrentWin] = useState<Win | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const processedIds = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load sound preference
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("user_preferences")
      .select("preference_value")
      .eq("user_id", user.id)
      .eq("preference_key", "win_sound_enabled")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.preference_value !== undefined) {
          setSoundEnabled(data.preference_value === true || data.preference_value === "true");
        }
      });
  }, [user?.id]);

  // Fetch uncelebrated wins
  const fetchUncelebratedWins = useCallback(async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("wins")
      .select("id, agent_name, contact_name, campaign_name, created_at")
      .eq("celebrated", false)
      .gt("created_at", fiveMinutesAgo)
      .order("created_at", { ascending: true });

    if (data) {
      const newWins = data.filter((w) => !processedIds.current.has(w.id));
      if (newWins.length > 0) {
        setQueue((prev) => [...prev, ...newWins]);
        newWins.forEach((w) => processedIds.current.add(w.id));
      }
    }
  }, []);

  // Poll every 10 seconds
  useEffect(() => {
    fetchUncelebratedWins();
    pollTimerRef.current = setInterval(fetchUncelebratedWins, 10000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchUncelebratedWins]);

  // Listen for immediate win trigger from current user
  useEffect(() => {
    const handler = (e: Event) => {
      const win = (e as CustomEvent).detail as Win;
      if (win && !processedIds.current.has(win.id)) {
        processedIds.current.add(win.id);
        setQueue((prev) => [...prev, win]);
      }
    };
    window.addEventListener("win-celebration", handler);
    return () => window.removeEventListener("win-celebration", handler);
  }, []);

  // Process queue - show one win at a time
  useEffect(() => {
    if (currentWin || queue.length === 0) return;
    const [next, ...rest] = queue;
    setCurrentWin(next);
    setQueue(rest);

    // Play sound and confetti
    if (soundEnabled) {
      playWinChime();
    }
    createConfetti();

    // Mark as celebrated in DB
    supabase.from("wins").update({ celebrated: true }).eq("id", next.id).then();

    // Auto-hide after 3 seconds
    const timer = setTimeout(() => {
      setCurrentWin(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [currentWin, queue, soundEnabled]);

  return (
    <AnimatePresence>
      {currentWin && (
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="fixed top-16 left-0 right-0 z-50 flex justify-center pointer-events-none"
        >
          <div className="mx-4 max-w-2xl w-full bg-gradient-to-r from-success to-success/90 rounded-xl shadow-2xl overflow-hidden pointer-events-auto">
            
            <div className="relative px-6 py-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-background/20 flex items-center justify-center shrink-0">
                <Trophy className="w-6 h-6 text-warning" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-primary-foreground font-bold text-lg truncate">
                  {currentWin.agent_name || "An agent"} just sold a policy!
                </p>
                <p className="text-primary-foreground/90 text-sm truncate">
                  Sold to {currentWin.contact_name || "a contact"}
                  {currentWin.campaign_name && ` • ${currentWin.campaign_name}`}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default WinCelebration;
