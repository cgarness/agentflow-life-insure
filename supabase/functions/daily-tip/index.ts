import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a motivational sales coach for life insurance agents. Give ONE brief, actionable sales or business tip of the day. 
            Keep it to 2-3 sentences max. Be specific and practical, not generic. 
            Vary topics: objection handling, prospecting, follow-up, mindset, closing techniques, time management, client relationships.
            Today is ${weekday}, ${month} ${day}, day ${dayOfYear} of the year. Use this date and day of the week to ensure your tip is unique and feels fresh. 
            DO NOT repeat common platitudes. Give a tip that feels like it was written for TODAY specifically. 
            Address the agent by first name if provided.`,
          },
          {
            role: "user",
            content: `Give me today's sales tip. My name is ${firstName || "Agent"}.`,
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
