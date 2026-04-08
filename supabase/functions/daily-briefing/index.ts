import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { firstName, appointments, followUps, anniversaries, stats } = await req.json();

    const AI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!AI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const now = new Date();
    const hour = now.getHours();
    const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    const systemPrompt = `You are an AI assistant for an insurance agency CRM called AgentFlow. You provide a concise, motivational daily briefing for insurance agents.

Rules:
- Address the agent by first name
- Keep it to 3-4 short paragraphs max
- Use bullet points for action items
- Be motivational but professional
- Mention specific numbers from the data provided
- If there are overdue follow-ups (aging >= 5 days), flag them as urgent
- Use markdown formatting (bold, bullets)
- Do NOT use headings (no # or ##)
- At the very end, add a separator line "---" followed by a short motivational or insurance-industry tip of the day on a new line, prefixed with "💡 **Tip of the Day:** ". Make it unique and actionable — rotate between sales tips, mindset advice, client relationship wisdom, and productivity hacks. Never repeat generic platitudes.`;

    const userPrompt = `${timeGreeting}, ${firstName || "Agent"}! Here is today's data:

**Appointments today:** ${appointments?.length || 0}
${appointments?.map((a: any) => `- ${a.name} (${a.type}) at ${a.time}`).join("\n") || "None scheduled"}

**Follow-ups due:** ${followUps?.length || 0}
${followUps?.map((f: any) => `- ${f.firstName} ${f.lastName} — ${f.aging} days since last contact (${f.leadSource})`).join("\n") || "None"}

**Policy anniversaries coming up:** ${anniversaries?.length || 0}
${anniversaries?.map((a: any) => `- ${a.firstName} ${a.lastName} — ${a.policyType} in ${a.daysUntilAnniversary} days`).join("\n") || "None"}

**Today's stats:**
- Calls made: ${stats?.totalCallsToday || 0}
- Policies sold this month: ${stats?.policiesSoldThisMonth || 0}
- Appointments this week: ${stats?.appointmentsThisWeek || 0}
- Active campaigns: ${stats?.activeCampaigns || 0}

Generate a daily briefing summary for this agent.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI service unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("daily-briefing error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
