// The persisted model is server-owned. The browser receives a whitelisted DTO.
// deno-lint-ignore no-explicit-any
export type Db = any;
export type Account = {
  organization_id: string;
  account_sid: string;
  account_scope: "master" | "subaccount";
  primary_profile_sid: string;
  enabled: boolean;
  sms_enforced: boolean;
  enrollment_verified_at: string | null;
  resources_reconciled_at: string | null;
  fee_version: string;
  fees: { label: string; amount: string }[];
  fees_valid_until: string;
  theme_id?: string;
};
export type Registration = {
  organization_id: string;
  created_by: string;
  draft: Record<string, string>;
  version: number;
  account_sid: string | null;
  brand_inquiry_id: string | null;
  brand_bundle_sid: string | null;
  brand_sid: string | null;
  brand_status: string;
  identity_status: string | null;
  brand_errors: unknown[];
  messaging_service_sid: string | null;
  campaign_inquiry_id: string | null;
  campaign_sid: string | null;
  campaign_status: string;
  campaign_errors: unknown[];
  is_test: boolean;
  operation_id: string | null;
  operation_kind: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
};
export type Credentials = { accountSid: string; authToken: string };
export class A2pError extends Error {
  constructor(public code: string, message: string, public status = 400, public uncertain = false) {
    super(message);
  }
}
export function brandReady(r: Pick<Registration, "brand_status" | "identity_status" | "is_test">): boolean {
  return !r.is_test && r.brand_status === "APPROVED" &&
    ["VERIFIED", "VETTED_VERIFIED"].includes(r.identity_status ?? "");
}
export function campaignReady(r: Registration): boolean {
  return brandReady(r) && r.campaign_status === "VERIFIED";
}
export function canResume(status: string): boolean {
  return ["not_started", "draft", "DRAFT", "FAILED", "REJECTED"].includes(status);
}
export function configReady(a: Account | null, now = Date.now()): boolean {
  return !!a?.enabled && a.sms_enforced && !!a.enrollment_verified_at && !!a.resources_reconciled_at &&
    Array.isArray(a.fees) &&
    a.fees.length > 0 &&
    a.fees.every((f) =>
      typeof f?.label === "string" && f.label.length > 0 && typeof f?.amount === "string" && f.amount.length > 0
    ) && new Date(a.fees_valid_until).getTime() > now;
}
export function safeErrors(input: unknown): { code: string; message: string }[] {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return list.slice(0, 15).map((v) =>
    typeof v === "string" ? { code: "", message: v.slice(0, 1200) } : {
      code: String(v?.code ?? v?.error_code ?? "").slice(0, 80),
      message: String(
        v?.description ?? v?.error_description ?? v?.message ?? v?.failure_reason ?? "Provider review needs attention.",
      ).slice(
        0,
        1200,
      ),
    }
  );
}
