export type Draft = {
  businessName: string;
  brandType: "STANDARD" | "SOLE_PROPRIETOR";
  website: string;
  description: string;
  privacyUrl: string;
  termsUrl: string;
};
export type ReviewError = { code: string; message: string };
export type Registration = {
  draft: Draft;
  version: number;
  brand_status: string;
  identity_status: string | null;
  brand_errors: ReviewError[];
  campaign_status: string;
  campaign_errors: ReviewError[];
  is_test: boolean;
  last_synced_at: string | null;
  sync_error: string | null;
  operation_pending: boolean;
};
export type Overview = {
  registration: Registration | null;
  setup_ready: boolean;
  account_enabled: boolean;
  sms_enforced: boolean;
  fees: { label: string; amount: string }[];
  fee_version: string | null;
  fees_valid_until: string | null;
  phones: { id: string; phone_number: string; status: string; assignment_type: string }[];
  numbers: {
    phone_number_id: string;
    status: string;
    pool_member: boolean;
    checked_at: string | null;
    failure_reason: string | null;
  }[];
  history: { id: string; kind: string; detail: Record<string, unknown>; created_at: string }[];
};
export type Session = { sessionId: string; sessionToken: string; stage: "brand" | "campaign" };
export const emptyDraft: Draft = {
  businessName: "",
  brandType: "STANDARD",
  website: "",
  description: "",
  privacyUrl: "",
  termsUrl: "",
};
export function brandApproved(r: Registration | null) {
  return !!r && !r.is_test && r.brand_status === "APPROVED" &&
    ["VERIFIED", "VETTED_VERIFIED"].includes(r.identity_status ?? "");
}
export function campaignApproved(r: Registration | null) {
  return brandApproved(r) && r?.campaign_status === "VERIFIED";
}
export function statusLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    not_started: "Not started",
    not_found: "Provider record missing — contact support",
    draft: "Draft",
    DRAFT: "Draft",
    PENDING: "Under review",
    IN_REVIEW: "Under review",
    IN_PROGRESS: "Under review",
    APPROVED: "Approved",
    VERIFIED: "Approved",
    FAILED: "Needs correction",
    REJECTED: "Rejected",
    SUSPENDED: "Suspended",
    registered: "Registered",
    unregistered: "Not registered",
    pending_registration: "Registration pending",
    pending_deregistration: "Removal pending",
    failed: "Registration failed",
    unknown: "Unknown",
  };
  return labels[value ?? ""] ?? (value ? value.replace(/_/g, " ") : "Not verified");
}
