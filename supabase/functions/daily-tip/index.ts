import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const AI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!AI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const { firstName } = await req.json();

    const today = new Date();
    const dayOfYear = Math.floor(
      (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
    );
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const weekday = weekdays[today.getDay()];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const month = months[today.getMonth()];
    const day = today.getDate();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a sales coach for life insurance agents. Give ONE short, practical tip — 1 sentence only. Topics: objection handling, prospecting, follow-up, closing, client relationships, or insurance sales tactics. Today is ${weekday}, ${month} ${day} (day ${dayOfYear}). Make the tip unique to today. No fluff, no platitudes. Address agent by first name if provided.`,
          },
          {
            role: "user",
            content: `Tip for ${firstName || "me"} today.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ tip: "Stay focused on your goals today! Every call is an opportunity. 🎯" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ tip: "Remember: consistency beats talent. Keep dialing! 💪" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ tip: "Make today count — every conversation is a chance to help someone protect their family. 🌟" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const tip = data.choices?.[0]?.message?.content || "Stay motivated and keep pushing forward today! 💪";

    return new Response(JSON.stringify({ tip }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("daily-tip error:", e);
    return new Response(
      JSON.stringify({ tip: "Focus on building genuine connections today. People buy from people they trust. 🤝" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
