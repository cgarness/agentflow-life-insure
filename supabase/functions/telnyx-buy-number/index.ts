import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

// Helper for generating secure passwords
const generatePassword = (length = 16) => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let password = "";
    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        password += chars[randomValues[i] % chars.length];
    }
    return password;
};

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
            // Default to + for other formats, but primarily focusing on US/E.164
            normalizedNumber = `+${normalizedNumber}`;
        }

        console.log(`[Provisioning] Normalized number: ${normalizedNumber}`);

        const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telnyx-webhook`;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const appName = `AgentFlow CRM ${timestamp}`;

        const VOICE_APP_ID = "2911194903079814357";
        const MESSAGING_PROFILE_ID = "40019cd5-f007-4511-93c2-216916e1da07";

        // 2. Purchase the Phone Number
        console.log(`[Step 1] Purchasing number: ${normalizedNumber}...`);
        const orderResponse = await telnyxApiCall("POST", "/number_orders", apiKey, {
            phone_numbers: [{ phone_number: normalizedNumber }]
        });
        
        console.log(`[Step 1] Order created: ${orderResponse.data.id}. Status: ${orderResponse.data.status}`);
        
        // 3. Extract or Fetch the Phone Number UUID
        let telnyxPhoneNumberId = orderResponse.data?.phone_numbers?.[0]?.id;
        
        if (!telnyxPhoneNumberId) {
            console.log("[Step 1.5] ID not in immediate response, entering retry loop...");
            
            // Retry loop to find the ID in owned numbers
            for (let i = 0; i < 5; i++) {
                const waitTime = (i + 1) * 2000;
                console.log(`[Step 1.5] Retry ${i + 1}: Waiting ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                try {
                    const phoneListResponse = await telnyxApiCall("GET", `/phone_numbers?filter[phone_number]=${encodeURIComponent(normalizedNumber)}`, apiKey);
                    if (phoneListResponse.data?.[0]?.id) {
                        telnyxPhoneNumberId = phoneListResponse.data[0].id;
                        console.log(`[Step 1.5] Found ID after ${i + 1} retries: ${telnyxPhoneNumberId}`);
                        break;
                    }
                } catch (err) {
                    console.warn(`[Step 1.5] Filter query failed on retry ${i + 1}:`, err.message);
                }
            }
        }

        // Final fallback to normalized number (deprecated behavior in Telnyx but might work on some accounts)
        if (!telnyxPhoneNumberId) {
            console.warn("[Step 1.5] Failed to find UUID, falling back to E.164 string path.");
            telnyxPhoneNumberId = normalizedNumber;
        }

        // 4. Create Outbound Voice Profile
        console.log(`[Step 2] Creating Outbound Profile: ${appName}...`);
        const profileResponse = await telnyxApiCall("POST", "/outbound_voice_profiles", apiKey, {
            name: appName,
            max_destination_rate: "0.05",
            billing_group_id: null,
            concurrent_call_limit: 10,
        });
        const profileId = profileResponse.data.id;

        // 5. Create TeXML Application
        console.log(`[Step 3] Creating TeXML App: ${appName}...`);
        const appResponse = await telnyxApiCall("POST", "/texml_applications", apiKey, {
            application_name: appName,
            voice_url: webhookUrl,
            voice_method: "POST",
            voice_fallback_url: webhookUrl,
            status_callback: webhookUrl,
            status_callback_method: "POST",
            outbound_voice_profile_id: profileId,
        });
        const appId = appResponse.data.id;

        // 6. Create SIP Credentials
        const sipUsername = `crm_${crypto.randomUUID().split("-")[0]}`;
        const sipPassword = generatePassword(16);

        console.log(`[Step 4] Creating SIP Credentials: ${sipUsername}...`);
        const credentialConnectionParams = {
            connection_name: `${appName} Credentials`,
            user_name: sipUsername,
            password: sipPassword,
            outbound: {
                outbound_voice_profile_id: profileId
            }
        };

        try {
            await telnyxApiCall("POST", "/credential_connections", apiKey, credentialConnectionParams);
        } catch (err) {
            console.error("[Step 4] Failed to create SIP connection:", err);
            // Non-critical, continue
        }

        // 7. Link Phone Number to TeXML Application
        console.log(`[Step 5] Linking Phone Number ${telnyxPhoneNumberId} to App ${appId}...`);
        try {
            await telnyxApiCall("PATCH", `/phone_numbers/${telnyxPhoneNumberId}`, apiKey, {
                connection_id: appId
            });
            console.log("[Step 5] Link successful.");
        } catch (err) {
            console.error("[Step 5] Link failed:", err);
            // If it's a 404, we might still be hitting inventory lag
            throw new Error(`Failed to link number to voice app after purchase. Step 5 failed: ${err.message}`);
        }

        // 8. Store in CRM
        console.log(`[Step 6] Saving to CRM database (Assigned To: ${reqData.assigned_to || 'unassigned'})...`);
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
                created_at: new Date().toISOString(),
            }]);

        if (dbError) console.error("[Step 6] CRM DB Error:", dbError);

        await supabaseClient
            .from("phone_settings")
            .upsert({
                organization_id: organizationId,
                application_sid: appId,
                account_sid: sipUsername,
                auth_token: sipPassword,
                updated_at: new Date().toISOString()
            }, { onConflict: "organization_id" });

        const warnings: string[] = [];

        // 9. Assign to Messaging Profile
        console.log(`[Step 7] Assigning to Messaging Profile...`);
        try {
            await telnyxApiCall("PATCH", `/phone_numbers/${telnyxPhoneNumberId}`, apiKey, {
                messaging_profile_id: MESSAGING_PROFILE_ID
            });
            console.log("[Step 7] Messaging link successful.");
        } catch (err) {
            console.error("[Step 7] Messaging assignment failed:", err);
            warnings.push("Messaging profile assignment failed — please assign manually in Telnyx portal");
        }

        return new Response(
            JSON.stringify({
                success: true,
                phone_number: normalizedNumber,
                warnings,
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
