import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

// Helper for making Telnyx API calls
const telnyxApiCall = async (method: string, endpoint: string, apiKey: string, body?: any) => {
    const url = `https://api.telnyx.com/v2${endpoint}`;
    const response = await fetch(url, {
        method,
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const errData = await response.json();
        console.error(`Telnyx API Error on ${endpoint}:`, errData);
        throw new Error(errData.errors?.[0]?.detail || `Failed to call Telnyx API: ${endpoint}`);
    }

    return response.json();
};

// Helper for extracting area code
const extractAreaCode = (num: string) => {
    const cleaned = num.replace(/\D/g, "");
    const digits = cleaned.startsWith("1") && cleaned.length === 11 ? cleaned.slice(1) : cleaned;
    return digits.slice(0, 3);
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const reqData = await req.json();
        const { phone_number, api_key: directApiKey } = reqData;

        if (!phone_number) {
            throw new Error("Phone number is required");
        }

        const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // Get the user from the auth header
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) throw new Error("No authorization header");
        
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
        if (userError || !user) throw new Error("Invalid user token");

        // Get the user's organization_id from their profile
        const { data: profile, error: profileError } = await supabaseClient
            .from("profiles")
            .select("organization_id")
            .eq("id", user.id)
            .single();

        if (profileError || !profile?.organization_id) {
            throw new Error("User has no associated organization");
        }

        const organizationId = profile.organization_id;

        // 1. Get API Key - prefer directly passed key, fall back to telnyx_settings table
        let apiKey = directApiKey;

        if (!apiKey) {
            const { data: config, error: fetchError } = await supabaseClient
                .from("telnyx_settings")
                .select("api_key")
                .eq("organization_id", organizationId)
                .maybeSingle();

            if (fetchError) throw fetchError;
            apiKey = config?.api_key;
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

        if (!apiKey) throw new Error("Telnyx API key not found. Please save your API Key in Settings first.");

        // Normalize phone number to E.164 (ensure +1 for US/Canada)
        let normalizedNumber = phone_number.replace(/[\s\-\(\)\.]/g, "");
        if (normalizedNumber.length === 10) {
            normalizedNumber = `+1${normalizedNumber}`;
        } else if (normalizedNumber.length === 11 && normalizedNumber.startsWith("1")) {
            normalizedNumber = `+${normalizedNumber}`;
        } else if (!normalizedNumber.startsWith("+")) {
            normalizedNumber = `+${normalizedNumber}`;
        }

        console.log(`[Provisioning] Normalized number: ${normalizedNumber}`);

        // Master IDs for CRM assignment
        const VOICE_APP_ID = "2911194903079814357"; // "AgentFlow Call Control"
        const MESSAGING_PROFILE_ID = "40019cd5-f007-4511-93c2-216916e1da07"; // "AgentFlow"

        // 1. Purchase the Phone Number
        console.log(`[Step 1] Purchasing number: ${normalizedNumber}...`);
        const orderResponse = await telnyxApiCall("POST", "/number_orders", apiKey, {
            phone_numbers: [{ phone_number: normalizedNumber }]
        });
        
        console.log(`[Step 1] Order created: ${orderResponse.data.id}. Status: ${orderResponse.data.status}`);
        
        // 2. Extract or Fetch the Phone Number UUID
        let telnyxPhoneNumberId = orderResponse.data?.phone_numbers?.[0]?.id;
        
        if (!telnyxPhoneNumberId) {
            console.log("[Step 2] ID not in immediate response, entering retry loop...");
            for (let i = 0; i < 5; i++) {
                const waitTime = (i + 1) * 2000;
                await new Promise(resolve => setTimeout(resolve, waitTime));
                try {
                    const phoneListResponse = await telnyxApiCall("GET", `/phone_numbers?filter[phone_number]=${encodeURIComponent(normalizedNumber)}`, apiKey);
                    if (phoneListResponse.data?.[0]?.id) {
                        telnyxPhoneNumberId = phoneListResponse.data[0].id;
                        console.log(`[Step 2] Found ID: ${telnyxPhoneNumberId}`);
                        break;
                    }
                } catch (err) {
                    console.warn(`[Step 2] Retry ${i + 1} failed:`, err.message);
                }
            }
        }

        if (!telnyxPhoneNumberId) {
            console.warn("[Step 2] Using normalized number as fallback ID.");
            telnyxPhoneNumberId = normalizedNumber;
        }

        // 3. Link Phone Number to Existing TeXML Application
        console.log(`[Step 3] Linking to Master voice app: ${VOICE_APP_ID}...`);
        try {
            await telnyxApiCall("PATCH", `/phone_numbers/${telnyxPhoneNumberId}`, apiKey, {
                connection_id: VOICE_APP_ID
            });
            console.log("[Step 3] Voice link successful.");
        } catch (err) {
            console.error("[Step 3] Voice link failed:", err);
            throw new Error(`Failed to configure voice: ${err.message}`);
        }

        // 4. Assign to Existing Messaging Profile
        console.log(`[Step 4] Assigning to Master Messaging Profile: ${MESSAGING_PROFILE_ID}...`);
        try {
            await telnyxApiCall("PATCH", `/phone_numbers/${telnyxPhoneNumberId}`, apiKey, {
                messaging_profile_id: MESSAGING_PROFILE_ID
            });
            console.log("[Step 4] Messaging link successful.");
        } catch (err) {
            console.warn("[Step 4] Messaging assignment failed (continuing):", err);
        }

        // 5. Store in CRM
        const areaCode = extractAreaCode(normalizedNumber);
        console.log(`[Step 5] Saving to CRM DB (Area: ${areaCode}, Assigned: ${reqData.assigned_to || 'unassigned'})...`);
        
        const { count: existingCount } = await supabaseClient
            .from("phone_numbers")
            .select("id", { count: "exact", head: true })
            .eq("status", "active");

        const isFirstNumber = (existingCount ?? 0) === 0;

        const { error: dbError } = await supabaseClient
            .from("phone_numbers")
            .insert([{
                phone_number: normalizedNumber,
                friendly_name: "Automated Line",
                status: "active",
                is_default: isFirstNumber,
                organization_id: organizationId,
                assigned_to: reqData.assigned_to || null,
                area_code: areaCode,
                spam_status: "Unknown",
                created_at: new Date().toISOString(),
            }]);

        if (dbError) throw new Error(`Database error: ${dbError.message}`);

        return new Response(
            JSON.stringify({
                success: true,
                phone_number: normalizedNumber,
                telnyx_id: telnyxPhoneNumberId,
            }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (error: unknown) {
        console.error("[Final Error] Provisioning failed:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
