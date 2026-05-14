export type AgencyGroup = {
  id: string;
  name: string;
  master_organization_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AgencyGroupMember = {
  id: string;
  agency_group_id: string;
  organization_id: string | null;
  role: "leader" | "member";
  status: "invited" | "active" | "left" | "removed";
  invite_email: string | null;
  invite_expires_at: string | null;
  joined_at: string | null;
  invited_at: string | null;
  organizations?: { name: string } | null;
};

export type AgencyGroupResource = {
  id: string;
  agency_group_id: string;
  uploaded_by_org_id: string;
  uploaded_by_user_id: string;
  title: string;
  description: string | null;
  resource_type: "script" | "document" | "objection_sheet" | "training_video" | "other";
  file_url: string;
  file_name: string | null;
  file_size_bytes: number | null;
  created_at: string;
  organizations?: { name: string } | null;
};
