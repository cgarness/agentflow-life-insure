import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@3.2.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailPayload {
  email: string;
  firstName: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: WelcomeEmailPayload = await req.json();
    const { email, firstName } = payload;

    const html = await Deno.readTextFile("./welcome_template.html");
    
    // Simple template replacement
    const personalizedHtml = html
      .replace("{{ .FirstName }}", firstName || "there")
      .replace("{{ .SiteURL }}", Deno.env.get("PUBLIC_SITE_URL") || "https://agentflow.app");

    const { data, error } = await resend.emails.send({
      from: "AgentFlow <onboarding@resend.dev>", // Replace with your verified domain
      to: [email],
      subject: "Welcome to AgentFlow!",
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
