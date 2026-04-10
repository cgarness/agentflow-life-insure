import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Telnyx phone-number resource IDs are never E.164; never PATCH using +1… */
const isTelnyxPhoneNumberResourceId = (id: string | undefined, e164: string): id is string =>
    !!id && id !== e164 && !id.startsWith("+");

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
            .maybeSingle();

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
        
        const orderId = orderResponse.data?.id as string | undefined;
        console.log(`[Step 1] Order created: ${orderId}. Status: ${orderResponse.data.status}`);
        
        // 2. Resolve Telnyx phone_number resource id (never use E.164 in PATCH URLs)
        let telnyxPhoneNumberId: string | undefined = orderResponse.data?.phone_numbers?.[0]?.id;

        if (!isTelnyxPhoneNumberResourceId(telnyxPhoneNumberId, normalizedNumber) && orderId) {
            console.log("[Step 2] Polling number_order for phone resource id...");
            for (let i = 0; i < 15; i++) {
                if (i > 0) await new Promise((r) => setTimeout(r, 2000));
                let orderStatus: { data?: { status?: string; phone_numbers?: { id?: string }[] } };
                try {
                    orderStatus = await telnyxApiCall("GET", `/number_orders/${orderId}`, apiKey);
                } catch (err) {
                    console.warn(
                        `[Step 2] Order poll attempt ${i + 1} failed:`,
                        err instanceof Error ? err.message : err,
                    );
                    continue;
                }
                const st = orderStatus.data?.status;
                if (st === "failure" || st === "cancelled") {
                    throw new Error("Telnyx reported this number order did not complete.");
                }
                const fromOrder = orderStatus.data?.phone_numbers?.[0]?.id;
                if (isTelnyxPhoneNumberResourceId(fromOrder, normalizedNumber)) {
                    telnyxPhoneNumberId = fromOrder;
                    console.log(`[Step 2] Order poll: found ID ${telnyxPhoneNumberId}`);
                    break;
                }
            }
        }

        if (!isTelnyxPhoneNumberResourceId(telnyxPhoneNumberId, normalizedNumber)) {
            console.log("[Step 2] Listing phone_numbers by E.164...");
            for (let i = 0; i < 8; i++) {
                if (i > 0) await new Promise((r) => setTimeout(r, 2500));
                try {
                    const phoneListResponse = await telnyxApiCall(
                        "GET",
                        `/phone_numbers?filter[phone_number]=${encodeURIComponent(normalizedNumber)}`,
                        apiKey,
                    );
                    const fromList = phoneListResponse.data?.[0]?.id;
                    if (isTelnyxPhoneNumberResourceId(fromList, normalizedNumber)) {
                        telnyxPhoneNumberId = fromList;
                        console.log(`[Step 2] List poll: found ID ${telnyxPhoneNumberId}`);
                        break;
                    }
                } catch (err) {
                    console.warn(`[Step 2] List retry ${i + 1} failed:`, err instanceof Error ? err.message : err);
                }
            }
        }

        const warnings: string[] = [];

        if (!isTelnyxPhoneNumberResourceId(telnyxPhoneNumberId, normalizedNumber)) {
            console.warn("[Step 2] No Telnyx resource id yet; skipping voice/SMS PATCH (order may still be provisioning).");
            warnings.push(
                "Number ordered in Telnyx. If calling or SMS does not work yet, wait a minute and use Sync from Telnyx.",
            );
        }

        // 3. Link Phone Number to Existing TeXML Application (non-fatal — purchase already committed)
        if (isTelnyxPhoneNumberResourceId(telnyxPhoneNumberId, normalizedNumber)) {
            console.log(`[Step 3] Linking to Master voice app: ${VOICE_APP_ID}...`);
            try {
                await telnyxApiCall("PATCH", `/phone_numbers/${telnyxPhoneNumberId}`, apiKey, {
                    connection_id: VOICE_APP_ID,
                });
                console.log("[Step 3] Voice link successful.");
            } catch (err) {
                console.error("[Step 3] Voice link failed:", err);
                warnings.push(
                    `Voice routing was not applied automatically (${err instanceof Error ? err.message : "Telnyx error"}). Try Sync from Telnyx or contact support.`,
                );
            }

            // 4. Assign to Existing Messaging Profile
            console.log(`[Step 4] Assigning to Master Messaging Profile: ${MESSAGING_PROFILE_ID}...`);
            try {
                await telnyxApiCall("PATCH", `/phone_numbers/${telnyxPhoneNumberId}`, apiKey, {
                    messaging_profile_id: MESSAGING_PROFILE_ID,
                });
                console.log("[Step 4] Messaging link successful.");
            } catch (err) {
                console.warn("[Step 4] Messaging assignment failed (continuing):", err);
                warnings.push("SMS profile was not applied automatically; try Sync from Telnyx.");
            }
        }

        // 5. Store in CRM
        const areaCode = extractAreaCode(normalizedNumber);
        console.log(`[Step 5] Saving to CRM DB (Area: ${areaCode}, Assigned: ${reqData.assigned_to || 'unassigned'})...`);
        
        const { count: existingCount } = await supabaseClient
            .from("phone_numbers")
            .select("id", { count: "exact", head: true })
            .eq("status", "active")
            .eq("organization_id", organizationId);

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

        if (dbError) {
            const pgCode = (dbError as { code?: string }).code;
            if (pgCode === "23505") {
                const { data: existingRow } = await supabaseClient
                    .from("phone_numbers")
                    .select("id, organization_id")
                    .eq("phone_number", normalizedNumber)
                    .maybeSingle();
                if (existingRow?.organization_id === organizationId) {
                    return new Response(
                        JSON.stringify({
                            success: true,
                            phone_number: normalizedNumber,
                            telnyx_id: telnyxPhoneNumberId ?? null,
                            duplicate: true,
                            ...(warnings.length ? { warning: warnings.join(" ") } : {}),
                        }),
                        {
                            status: 200,
                            headers: { ...corsHeaders, "Content-Type": "application/json" },
                        },
                    );
                }
            }
            throw new Error(`Database error: ${dbError.message}`);
        }

        return new Response(
            JSON.stringify({
                success: true,
                phone_number: normalizedNumber,
                telnyx_id: telnyxPhoneNumberId ?? null,
                ...(warnings.length ? { warning: warnings.join(" ") } : {}),
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
