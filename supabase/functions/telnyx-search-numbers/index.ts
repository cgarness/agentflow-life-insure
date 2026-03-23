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
        const { area_code, locality, state, contains, starts_with, ends_with, api_key: directApiKey, limit = 20 } = await req.json();

        // Try to use the API key passed directly first, then fall back to database
        let apiKey = directApiKey;

        if (!apiKey) {
            const supabaseClient = createClient(
                Deno.env.get("SUPABASE_URL") ?? "",
                Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
            );

            const { data: config, error: fetchError } = await supabaseClient
                .from("telnyx_settings")
                .select("api_key")
                .maybeSingle();

            if (fetchError) throw fetchError;
            apiKey = config?.api_key;
        }

        if (!apiKey) {
            throw new Error("Telnyx API key not found. Please save your API Key in Settings first.");
        }

        // Build query parameters
        const params = new URLSearchParams();
        params.append("filter[country_code]", "US");
        params.append("filter[features]", "voice");
        params.append("filter[features]", "sms");
        params.append("filter[best_effort]", "true");
        params.append("filter[limit]", limit.toString());

        if (area_code) params.append("filter[national_destination_code]", area_code);
        if (locality) params.append("filter[locality]", locality);
        if (state) params.append("filter[administrative_area]", state);
        if (contains) params.append("filter[phone_number][contains]", contains);
        if (starts_with) params.append("filter[phone_number][starts_with]", starts_with);
        if (ends_with) params.append("filter[phone_number][ends_with]", ends_with);

        // Search Telnyx numbers
        const searchResponse = await fetch(
            `https://api.telnyx.com/v2/available_phone_numbers?${params.toString()}`,
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

        const { data: rawNumbers } = await searchResponse.json();

        // Map to include locality and region for display
        const numbers = (rawNumbers || []).map((n: any) => ({
            phone_number: n.phone_number,
            locality: n.locality || null,
            region: n.region_information?.[0]?.region_name || n.region || null,
            region_code: n.region_information?.[0]?.region_type === "state"
                ? n.region_information?.[0]?.region_name
                : n.region || null,
            features: n.features,
            monthly_cost: n.cost_information?.monthly_cost || n.monthly_cost || null,
        }));

        return new Response(
            JSON.stringify({ numbers }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (error: unknown) {
        console.error("Number search error:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
