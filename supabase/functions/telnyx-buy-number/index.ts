import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { randomBytes } from "node:crypto";

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
        const { phone_number, api_key: directApiKey } = await req.json();

        if (!phone_number) {
            throw new Error("Phone number is required");
        }

        const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // 1. Get API Key - prefer directly passed key, fall back to database
        let apiKey = directApiKey;

        if (!apiKey) {
            const { data: config, error: fetchError } = await supabaseClient
                .from("phone_settings")
                .select("*")
                .eq("id", SINGLETON_ID)
                .maybeSingle();

            if (fetchError) throw fetchError;
            apiKey = config?.api_key;
        }

        if (!apiKey) throw new Error("Telnyx API key not found. Please save your API Key in Settings first.");

        const webhookUrl = "https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/telnyx-webhook";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const appName = `AgentFlow CRM ${timestamp}`;

        // 2. Order the Phone Number
        console.log(`Ordering number: ${phone_number}...`);
        const orderResponse = await telnyxApiCall("POST", "/number_orders", apiKey, {
            phone_numbers: [{ phone_number }]
        });

        // We assume the order completes successfully (usually instant for single local numbers). 
        // In a robust production environment, you might poll the order status.

        // 3. Create Outbound Voice Profile
        console.log(`Creating Outbound Profile: ${appName}...`);
        const profileResponse = await telnyxApiCall("POST", "/outbound_voice_profiles", apiKey, {
            name: appName,
            max_destination_rate: "0.05", // basic fraud protection
            billing_group_id: null,
            concurrent_call_limit: 10,
        });
        const profileId = profileResponse.data.id;

        // 4. Create TeXML Application
        console.log(`Creating TeXML App: ${appName}...`);
        const appResponse = await telnyxApiCall("POST", "/texml_applications", apiKey, {
            application_name: appName,
            voice_url: webhookUrl,
            voice_method: "POST",
            voice_fallback_url: webhookUrl,
            status_callback: webhookUrl,
            status_callback_method: "POST",
            outbound_voice_profile_id: profileId, // Link the profile here!
        });
        const appId = appResponse.data.id;

        // 5. Create SIP Credentials linked to this profile
        const sipUsername = `crm_${crypto.randomUUID().split("-")[0]}`;
        const sipPassword = generatePassword(16);

        console.log(`Creating SIP Credentials for ${sipUsername}...`);
        // Note: Telnyx SIP Credentials (Telephony Credentials) might need to be linked 
        // to a SIP Connection, or you can use the generic TeXML application credentials directly.
        // For TeXML applications, it's often best to create a credential connection:

        const credentialConnectionParams = {
            connection_name: `${appName} Credentials`,
            user_name: sipUsername,
            password: sipPassword,
            outbound: {
                outbound_voice_profile_id: profileId
            }
        };

        let sipConnectionId = null;
        try {
            const credentialResponse = await telnyxApiCall("POST", "/credential_connections", apiKey, credentialConnectionParams);
            sipConnectionId = credentialResponse.data.id;
        } catch (err) {
            console.error("Failed to create credential connection", err);
        }

        // 6. Update the Phone Number to use our new application
        console.log(`Linking Phone Number to TeXML App...`);
        await telnyxApiCall("PATCH", `/phone_numbers/${encodeURIComponent(phone_number)}`, apiKey, {
            connection_id: appId
        });

        // 7. Store everything in the CRM
        console.log(`Saving to database...`);
        const { error: dbError } = await supabaseClient
            .from("phone_numbers")
            .insert([{
                phone_number: phone_number,
                friendly_name: "Automated Line",
                status: "active",
                // In a real multi-agent scenario, you'd store the sipUsername and password on this row 
                // to pass to the dialer for this specific user. For now, since the dialer relies on the 
                // singleton 'phone_settings', we'll update the master settings with these new keys.
            }]);

        if (dbError) {
            console.error("Database error saving phone number:", dbError);
        }

        // Update global CRM settings with the latest master connection and SIP details
        await supabaseClient
            .from("phone_settings")
            .upsert({
                id: SINGLETON_ID,
                application_sid: appId,
                account_sid: sipUsername,
                auth_token: sipPassword,
                updated_at: new Date().toISOString()
            });

        return new Response(
            JSON.stringify({
                success: true,
                phone_number,
                message: "Number purchased and fully configured successfully."
            }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (error: unknown) {
        console.error("Provisioning error:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
