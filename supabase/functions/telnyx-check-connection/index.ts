// Telnyx check connection edge function

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        const { api_key } = await req.json();

        if (!api_key) {
            throw new Error("API Key is required");
        }

        // Attempt to list messaging profiles as a connection test
        const response = await fetch("https://api.telnyx.com/v2/messaging_profiles", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${api_key}`,
                "Content-Type": "application/json",
            },
        });

        if (response.ok) {
            return new Response(
                JSON.stringify({ success: true, message: "Connection successful" }),
                {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        } else {
            const errorData = await response.json();
            throw new Error(errorData.errors?.[0]?.detail || "Authentication failed with Telnyx");
        }

    } catch (error) {
        return new Response(
            JSON.stringify({ success: false, error: error.message ?? "Internal server error" }),
            {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
