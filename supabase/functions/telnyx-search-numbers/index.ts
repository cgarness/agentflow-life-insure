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

            // Get the user from the auth header
            const authHeader = req.headers.get('Authorization');
            if (authHeader) {
                const { data: { user } } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
                if (user) {
                    // Get the user's organization_id
                    const { data: profile } = await supabaseClient
                        .from("profiles")
                        .select("organization_id")
                        .eq("id", user.id)
                        .single();

                    if (profile?.organization_id) {
                        const { data: config } = await supabaseClient
                            .from("telnyx_settings")
                            .select("api_key")
                            .eq("organization_id", profile.organization_id)
                            .maybeSingle();
                        apiKey = config?.api_key;
                    }
                }
            }

            // Fallback to global settings if no organization-specific settings exist
            if (!apiKey) {
                const { data: globalConfig } = await supabaseClient
                    .from("telnyx_settings")
                    .select("api_key")
                    .eq("id", "00000000-0000-0000-0000-000000000001")
                    .maybeSingle();
                apiKey = globalConfig?.api_key;
            }
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
        const numbers = (rawNumbers || []).map((n: any) => {
            const regionInfo = n.region_information || [];
            
            // Robustly find locality (city) and administrative_area (state) from region_information
            // Telnyx uses various labels like 'location', 'rate_center', or 'locality' for cities
            const locality = regionInfo.find((r: any) => ["location", "rate_center", "locality"].includes(r.region_type))?.region_name || n.locality || null;
            
            // Telnyx uses 'state' or 'administrative_area' for regions
            const region = regionInfo.find((r: any) => ["state", "administrative_area"].includes(r.region_type))?.region_name || n.region || null;
            
            return {
                phone_number: n.phone_number,
                locality: locality,
                region: region,
                region_code: region,
                features: n.features,
                monthly_cost: n.cost_information?.monthly_cost || n.monthly_cost || null,
            };
        });

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
