import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import {
  parsePhoneSettingsSecretBundle,
  stringifyPhoneSettingsSecretBundle,
  TWILIO_API_KEY_SECRET_JSON_KEY,
  type InboundRoutingStrategy,
  type PhoneSettingsSecretBundle,
} from "./phoneSettingsSecretJson";
import { isCallRecordingEnabledDb } from "@/lib/call-recording-policy";
import type { PhoneNumberRow } from "./NumberManagementSection";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
}

type PhoneSettingsRow = {
  id: string;
  account_sid: string | null;
  auth_token: string | null;
  api_key: string | null;
  api_secret: string | null;
  application_sid: string | null;
  recording_enabled: boolean | null;
  trust_hub_profile_sid?: string | null;
  shaken_stir_enabled?: boolean | null;
};

export const formatPhone = formatPhoneNumber;

export type PhoneSettingsController = ReturnType<typeof usePhoneSettingsController>;

export function usePhoneSettingsController() {
  const { organizationId } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [phoneSettingsId, setPhoneSettingsId] = useState<string | null>(null);

  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [applicationSid, setApplicationSid] = useState("");
  const [recordingEnabled, setRecordingEnabled] = useState(true);

  const [trustHubProfileSid, setTrustHubProfileSid] = useState<string | null>(null);
  const [shakenStirEnabled, setShakenStirEnabled] = useState(true);
  const [savingShaken, setSavingShaken] = useState(false);

  const [secretBundle, setSecretBundle] = useState<PhoneSettingsSecretBundle>(parsePhoneSettingsSecretBundle(null));

  const [originals, setOriginals] = useState({
    accountSid: "",
    authToken: "",
    apiKeySid: "",
    apiKeySecret: "",
    applicationSid: "",
    recordingEnabled: true,
  });

  const [numbers, setNumbers] = useState<PhoneNumberRow[]>([]);
  const [agents, setAgents] = useState<Profile[]>([]);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const inboundRouting: InboundRoutingStrategy =
    secretBundle.inbound_routing === "all-ring" ? "all-ring" : "assigned";

  const hasChanges =
    accountSid !== originals.accountSid ||
    authToken !== originals.authToken ||
    apiKeySid !== originals.apiKeySid ||
    apiKeySecret !== originals.apiKeySecret ||
    applicationSid !== originals.applicationSid ||
    recordingEnabled !== originals.recordingEnabled;

  const buildSecretPayload = useCallback(
    (over: Partial<PhoneSettingsSecretBundle>): PhoneSettingsSecretBundle => ({
      ...secretBundle,
      ...over,
      [TWILIO_API_KEY_SECRET_JSON_KEY]: apiKeySecret,
    }),
    [secretBundle, apiKeySecret],
  );

  const persistSecretBundle = useCallback(
    async (patch: Partial<PhoneSettingsSecretBundle>, successMessage?: string) => {
      if (!organizationId) return;
      const next = buildSecretPayload(patch);
      const apiSecretStr = stringifyPhoneSettingsSecretBundle(next);
      const { error } = await supabase.from("phone_settings").upsert(
        {
          id: phoneSettingsId || undefined,
          organization_id: organizationId,
          provider: "twilio",
          account_sid: accountSid || null,
          auth_token: authToken || null,
          api_key: apiKeySid || null,
          api_secret: apiSecretStr,
          application_sid: applicationSid || null,
          recording_enabled: recordingEnabled,
          shaken_stir_enabled: shakenStirEnabled,
          trust_hub_profile_sid: trustHubProfileSid,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>,
        { onConflict: "organization_id" },
      );
      if (error) {
        console.error(error);
        toast.error(`Could not save: ${error.message}`);
        return;
      }
      setSecretBundle(next);
      if (successMessage) toast.success(successMessage);
    },
    [
      organizationId,
      phoneSettingsId,
      accountSid,
      authToken,
      apiKeySid,
      apiKeySecret,
      applicationSid,
      recordingEnabled,
      shakenStirEnabled,
      trustHubProfileSid,
      buildSecretPayload,
    ],
  );

  const fetchData = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [settingsRes, numbersRes, agentsRes] = await Promise.all([
      supabase.from("phone_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
      supabase.from("phone_numbers").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, first_name, last_name").eq("status", "Active"),
    ]);

    const row = settingsRes.data as PhoneSettingsRow | null;
    if (row) {
      setPhoneSettingsId(row.id);
      setAccountSid(row.account_sid || "");
      setAuthToken(row.auth_token || "");
      setApiKeySid(row.api_key || "");
      setApplicationSid(row.application_sid || "");
      setRecordingEnabled(isCallRecordingEnabledDb(row.recording_enabled));
      setTrustHubProfileSid(row.trust_hub_profile_sid ?? null);
      setShakenStirEnabled(row.shaken_stir_enabled !== false);

      const bundle = parsePhoneSettingsSecretBundle(row.api_secret);
      const secretFromJson = bundle[TWILIO_API_KEY_SECRET_JSON_KEY] || "";
      setApiKeySecret(secretFromJson);
      setSecretBundle(bundle);

      setOriginals({
        accountSid: row.account_sid || "",
        authToken: row.auth_token || "",
        apiKeySid: row.api_key || "",
        apiKeySecret: secretFromJson,
        applicationSid: row.application_sid || "",
        recordingEnabled: isCallRecordingEnabledDb(row.recording_enabled),
      });
    } else {
      setPhoneSettingsId(null);
      setAccountSid("");
      setAuthToken("");
      setApiKeySid("");
      setApiKeySecret("");
      setApplicationSid("");
      setRecordingEnabled(true);
      setTrustHubProfileSid(null);
      setShakenStirEnabled(true);
      setSecretBundle(parsePhoneSettingsSecretBundle(null));
      setOriginals({
        accountSid: "",
        authToken: "",
        apiKeySid: "",
        apiKeySecret: "",
        applicationSid: "",
        recordingEnabled: true,
      });
    }

    setNumbers((numbersRes.data || []) as PhoneNumberRow[]);
    setAgents((agentsRes.data || []) as Profile[]);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!organizationId) return;
    setSaving(true);
    const nextBundle = buildSecretPayload({});
    const apiSecretStr = stringifyPhoneSettingsSecretBundle(nextBundle);
    const { error } = await supabase.from("phone_settings").upsert(
      {
        id: phoneSettingsId || undefined,
        organization_id: organizationId,
        provider: "twilio",
        account_sid: accountSid.trim(),
        auth_token: authToken,
        api_key: apiKeySid.trim(),
        api_secret: apiSecretStr,
        application_sid: applicationSid.trim(),
        recording_enabled: recordingEnabled,
        shaken_stir_enabled: shakenStirEnabled,
        trust_hub_profile_sid: trustHubProfileSid,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>,
      { onConflict: "organization_id" },
    );
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(`Failed to save: ${error.message}`);
      return;
    }
    setSecretBundle(nextBundle);
    setOriginals({
      accountSid: accountSid.trim(),
      authToken,
      apiKeySid: apiKeySid.trim(),
      apiKeySecret,
      applicationSid: applicationSid.trim(),
      recordingEnabled,
    });
    toast.success("Phone settings saved");
    await fetchData();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("twilio-token");
      if (error) throw error;
      if (data && typeof data === "object" && "token" in data && (data as { token?: string }).token) {
        setTestResult({ success: true, message: "Twilio token issued — connection looks good." });
      } else {
        setTestResult({
          success: false,
          message: (data as { error?: string })?.error || "Unexpected response from token service",
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Connection failed";
      setTestResult({ success: false, message: msg });
    }
    setTesting(false);
  };

  const handleLocalPresenceToggle = async (enabled: boolean) => {
    await persistSecretBundle({ local_presence_enabled: enabled }, enabled ? "Local presence on" : "Local presence off");
  };

  const handleInboundRoutingChange = async (v: InboundRoutingStrategy) => {
    await persistSecretBundle({ inbound_routing: v }, "Inbound routing updated");
  };

  const handleVoicemailToggle = async (enabled: boolean) => {
    await persistSecretBundle({ voicemail_enabled: enabled }, enabled ? "Voicemail on" : "Voicemail off");
  };

  const handleShakenStirChange = async (enabled: boolean) => {
    if (!organizationId) return;
    setSavingShaken(true);
    setShakenStirEnabled(enabled);
    const { error } = await supabase.from("phone_settings").upsert(
      {
        id: phoneSettingsId || undefined,
        organization_id: organizationId,
        provider: "twilio",
        account_sid: accountSid || null,
        auth_token: authToken || null,
        api_key: apiKeySid || null,
        api_secret: stringifyPhoneSettingsSecretBundle(buildSecretPayload({})),
        application_sid: applicationSid || null,
        recording_enabled: recordingEnabled,
        shaken_stir_enabled: enabled,
        trust_hub_profile_sid: trustHubProfileSid,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>,
      { onConflict: "organization_id" },
    );
    setSavingShaken(false);
    if (error) {
      toast.error(error.message);
      setShakenStirEnabled(!enabled);
      return;
    }
    toast.success(enabled ? "SHAKEN/STIR preference on" : "SHAKEN/STIR preference off");
  };

  const uniqueAreaCodes = [...new Set(numbers.filter((n) => n.status === "active").map((n) => n.area_code).filter(Boolean))] as string[];

  return {
    loading,
    organizationId,
    fetchData,
    numbers,
    setNumbers,
    agents,
    uniqueAreaCodes,
    accountSid,
    setAccountSid,
    authToken,
    setAuthToken,
    apiKeySid,
    setApiKeySid,
    apiKeySecret,
    setApiKeySecret,
    applicationSid,
    setApplicationSid,
    recordingEnabled,
    setRecordingEnabled,
    trustHubProfileSid,
    shakenStirEnabled,
    savingShaken,
    secretBundle,
    hasChanges,
    saving,
    testing,
    testResult,
    inboundRouting,
    handleSave,
    handleTest,
    handleLocalPresenceToggle,
    handleInboundRoutingChange,
    handleVoicemailToggle,
    handleShakenStirChange,
  };
}
