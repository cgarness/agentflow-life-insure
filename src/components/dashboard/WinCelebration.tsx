import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// TODO: Move WinCelebration to AppLayout.tsx root so it works on all pages

interface WinCelebrationProps {
  userId: string;
}

interface WinBanner {
  id: string;
  agentName: string;
  contactName: string;
  visible: boolean;
}

const WinCelebration: React.FC<WinCelebrationProps> = ({ userId }) => {
  const [banners, setBanners] = useState<WinBanner[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const soundCheckedRef = useRef<boolean | null>(null);

  const checkWins = useCallback(async () => {
    try {
      const { data: newWins } = await supabase
        .from("wins")
        .select("*")
        .eq("celebrated", false)
        .gte("created_at", new Date(Date.now() - 60000).toISOString())
        .limit(5);

      if (!newWins || newWins.length === 0) return;

      // Check sound preference from profiles
      if (soundCheckedRef.current === null) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("win_sound_enabled")
          .eq("id", userId)
          .single();
        soundCheckedRef.current = profile?.win_sound_enabled !== false;
      }

      for (const win of newWins) {
        const banner: WinBanner = {
          id: win.id,
          agentName: win.agent_name || "An agent",
          contactName: win.contact_name || "a client",
          visible: false,
        };

        setBanners((prev) => [...prev, banner]);

        // Animate in
        requestAnimationFrame(() => {
          setBanners((prev) =>
            prev.map((b) => (b.id === win.id ? { ...b, visible: true } : b))
          );
        });

        // Play sound
        if (soundCheckedRef.current) {
          try {
            new Audio("/sounds/win.mp3").play();
          } catch {}
        }

        // Mark as celebrated
        await supabase
          .from("wins")
          .update({ celebrated: true })
          .eq("id", win.id);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
          setBanners((prev) =>
            prev.map((b) => (b.id === win.id ? { ...b, visible: false } : b))
          );
          setTimeout(() => {
            setBanners((prev) => prev.filter((b) => b.id !== win.id));
          }, 500);
        }, 5000);
      }
    } catch {}
  }, [userId]);

  useEffect(() => {
    checkWins();
    timerRef.current = setInterval(checkWins, 10000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkWins]);

  if (banners.length === 0) return null;

  return (
    <>
      {banners.map((banner) => (
        <div
          key={banner.id}
          className="fixed top-0 left-0 right-0 z-[100] transition-transform duration-500 ease-out"
          style={{
            transform: banner.visible ? "translateY(0)" : "translateY(-100%)",
            background: "linear-gradient(to right, #22C55E, #16A34A)",
          }}
        >
          <p className="text-white text-center text-lg font-semibold py-4">
            🎉 {banner.agentName} just sold a policy to {banner.contactName}!
          </p>
        </div>
      ))}
    </>
  );
};

export default WinCelebration;
