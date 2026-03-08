import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { area_code, limit = 10 } = await req.json();

        if (!area_code) {
            throw new Error("Area code is required");
        }

        const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // Get Telnyx API Key from database
        const { data: config, error: fetchError } = await supabaseClient
            .from("phone_settings")
            .select("api_key")
            .eq("id", SINGLETON_ID)
            .maybeSingle();

        if (fetchError) throw fetchError;
        const apiKey = config?.api_key;

        if (!apiKey) {
            throw new Error("Telnyx API key not found in Settings");
        }

        // Search Telnyx numbers
        const searchResponse = await fetch(
            `https://api.telnyx.com/v2/available_phone_numbers?filter[features]=voice&filter[features]=sms&filter[national_destination_code]=${area_code}&filter[best_effort]=true&filter[limit]=${limit}`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
            }
        );

        if (!searchResponse.ok) {
            const errData = await searchResponse.json();
            console.error("Telnyx search error:", errData);
            throw new Error(errData.errors?.[0]?.detail || "Failed to search Telnyx numbers");
        }

        const { data: numbers } = await searchResponse.json();

        return new Response(
            JSON.stringify({ numbers }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (error) {
        console.error("Number search error:", error);
        return new Response(
            JSON.stringify({ error: error.message ?? "Internal server error" }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
