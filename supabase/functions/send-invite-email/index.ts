import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@3.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteEmailPayload {
  email: string;
  firstName: string;
  role: string;
  inviteURL: string;
}

serve(async (req: Request) => {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set.");
    return new Response(JSON.stringify({ error: "Email service not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const resend = new Resend(RESEND_API_KEY);

  try {
    const payload: InviteEmailPayload = await req.json();
    const { email, firstName, role, inviteURL } = payload;

    const html = await Deno.readTextFile("./invite_template.html");
    
    // Simple template replacement
    const personalizedHtml = html
      .replace("{{ .FirstName }}", firstName || "there")
      .replace("{{ .Role }}", role || "Agent")
      .replace("{{ .InviteURL }}", inviteURL);

    const { data, error } = await resend.emails.send({
      from: "AgentFlow <onboarding@resend.dev>", // Replace with verified domain in production
      to: [email],
      subject: "Invitation to join AgentFlow",
      html: personalizedHtml,
    });

    if (error) {
      console.error("Resend error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
