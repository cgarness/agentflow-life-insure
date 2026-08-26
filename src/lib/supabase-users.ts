
import { supabase } from "@/integrations/supabase/client";
import { User, UserProfile, UserRole, UserStatus } from "@/lib/types";

function rowToUser(row: any): User & { profile: UserProfile } {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role as UserRole,
    avatar: row.avatar_url,
    phone: row.phone,
    status: row.status as UserStatus,
    availabilityStatus: row.availability_status || "Offline",
    themePreference: row.theme_preference || "light",
    isSuperAdmin: row.is_super_admin === true,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
    profile: {
      userId: row.id,
      licensedStates: row.licensed_states || [],
      carriers: row.carriers || [],
      residentState: row.resident_state,
      commissionLevel: row.commission_level || "0%",
      uplineId: row.upline_id,
      onboardingComplete: row.onboarding_complete || false,
      monthlyCallGoal: row.monthly_call_goal || 0,
      monthlyPoliciesGoal: row.monthly_policies_goal || 0,
      weeklyAppointmentGoal: row.weekly_appointment_goal || 0,
      monthlyAppointmentGoal: row.monthly_appointment_goal || 0,
      monthlyPremiumGoal: row.monthly_premium_goal || 0,
      npn: row.npn || "",
      timezone: row.timezone || "Eastern Time (US & Canada)",
      winSoundEnabled: row.win_sound_enabled ?? true,
      emailNotificationsEnabled: row.email_notifications_enabled ?? true,
      smsNotificationsEnabled: row.sms_notifications_enabled ?? false,
      pushNotificationsEnabled: row.push_notifications_enabled ?? true,
      onboardingItems: row.onboarding_items || [],
      organizationId: row.organization_id,
      teamId: row.team_id,
      isSuperAdmin: row.is_super_admin === true,
      billingType: row.billing_type,
    }
  };
}

/** Full profile projection shared by `getAll` and `getByIds`, so the two cannot drift. */
const PROFILE_ALL_COLUMNS = [
  "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url",
  "availability_status", "theme_preference", "created_at", "last_login_at", "licensed_states",
  "resident_state", "commission_level", "upline_id",
  "monthly_call_goal", "monthly_policies_goal", "weekly_appointment_goal", "monthly_appointment_goal",
  "monthly_premium_goal", "npn", "timezone",
  "win_sound_enabled", "email_notifications_enabled", "sms_notifications_enabled",
  "push_notifications_enabled", "carriers", "organization_id", "team_id", "is_super_admin", "billing_type"
];

/** Reduced projection used when a deployment predates one of the columns above. */
const PROFILE_SAFE_COLUMNS = [
  "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url",
  "availability_status", "theme_preference", "created_at", "is_super_admin"
];

/** Defaults standing in for the columns the safe projection cannot select. */
const SAFE_ROW_DEFAULTS = {
  onboarding_complete: false,
  monthly_call_goal: 0,
  monthly_sales_goal: 0,
  monthly_policies_goal: 0,
  weekly_appointment_goal: 0,
  monthly_appointment_goal: 0,
  monthly_premium_goal: 0,
  onboarding_items: [],
  licensed_states: [],
  carriers: [],
};

function rowToSafeUser(row: unknown): User & { profile: UserProfile } {
  return rowToUser({ ...(row as Record<string, any>), ...SAFE_ROW_DEFAULTS });
}

/**
 * `.or()` interpolates a RAW, non-parameterized PostgREST filter string, so a search
 * term carrying filter metacharacters could otherwise produce a malformed expression.
 * Stripping them keeps the term a plain `ilike` pattern. Note this is defence in depth
 * only: the caller's `.in("id", …)` is a separate AND-level filter that no `.or()`
 * content can escape, so a search can narrow the scoped set but never widen it.
 */
function sanitizeProfileSearchTerm(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[,()*\\"']/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
}

/**
 * Contacts → Agents scope traversal bounds.
 *
 * `.in()` is serialized into the PostgREST query string and a response is capped
 * server-side at a row limit, so a frontier is split into id batches AND each batch is
 * read page-by-page until exhausted. Neither bound may silently drop a descendant:
 * the caps below throw rather than return a truncated set.
 */
export const AGENT_SCOPE_ID_BATCH_SIZE = 50;
export const AGENT_SCOPE_PAGE_SIZE = 500;
export const AGENT_SCOPE_MAX_ROUNDS = 100;
export const AGENT_SCOPE_MAX_PAGES_PER_BATCH = 200;

export const usersSupabaseApi = {
  async getAll(filters?: { search?: string; role?: string; status?: string; organizationId?: string }): Promise<(User & { profile: UserProfile })[]> {
    const allExpectedColumns = PROFILE_ALL_COLUMNS;
    const safeColumns = PROFILE_SAFE_COLUMNS;

    let q = supabase.from("profiles").select(allExpectedColumns.join(","));

    if (filters?.search) {
      const search = filters.search.toLowerCase();
      q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (filters?.role && filters.role !== "All") {
      q = q.eq("role", filters.role);
    }

    if (filters?.status && filters.status !== "All") {
      q = q.eq("status", filters.status);
    } else {
      q = q.neq("status", "Deleted");
    }

    if (filters?.organizationId) {
      q = q.eq("organization_id", filters.organizationId);
    }

    const { data, error } = await q.order("first_name", { ascending: true });

    if (error && error.message.includes("does not exist")) {
      console.warn("Retrying fetch with safe column set due to schema mismatch:", error.message);
      let safeQ = supabase.from("profiles").select(safeColumns.join(","));
      if (filters?.organizationId) {
        safeQ = safeQ.eq("organization_id", filters.organizationId);
      }
      const { data: safeData, error: safeError } = await safeQ
        .order("first_name", { ascending: true });
      
      if (safeError) throw safeError;
      return (safeData || []).map(row => rowToUser({
        ...(row as Record<string, any>),
        onboarding_complete: false,
        monthly_call_goal: 0,
        monthly_sales_goal: 0,
        monthly_policies_goal: 0,
        weekly_appointment_goal: 0,
        monthly_appointment_goal: 0,
        monthly_premium_goal: 0,
        onboarding_items: [],
        licensed_states: [],
        carriers: []
      }));
    }
    
    if (error) throw error;
    
    return (data || []).map(rowToUser);
  },

  /**
   * Contacts → Agents scope: the signed-in viewer plus every direct and indirect
   * downline profile, resolved recursively through `profiles.upline_id`.
   *
   * `profiles.hierarchy_path` is deliberately NOT used. Its production values are
   * depth-1 self-labels (a `compute_hierarchy_path` trigger defect), so
   * `is_ancestor_of` is false for every distinct pair and any path-based scope would
   * collapse to self-only for everyone. `upline_id` is the source of truth.
   *
   * This is Contacts-page query scoping, NOT a database authorization boundary: the
   * permissive organization-wide SELECT policy on `profiles` is unchanged and still
   * authorizes same-organization reads.
   *
   * Contract:
   *  - the viewer is always the first scoped id;
   *  - every round is constrained to the viewer's organization, so no edge can leave it;
   *  - NO status filter is applied during traversal — a Deleted intermediate manager
   *    must not sever access to active descendants beneath it — but a Deleted profile
   *    is never added to the returned set;
   *  - a `visited` set makes the walk cycle-safe and guarantees termination;
   *  - frontiers are batched and each batch is paged to exhaustion, so a large result
   *    set can never be silently truncated;
   *  - any error rejects. Callers must fail closed; there is no organization-wide
   *    fallback and no partial result.
   */
  async getAgentScopeIds(params: { viewerId: string; organizationId: string | null }): Promise<string[]> {
    const viewerId = (params.viewerId ?? "").trim();
    const organizationId = (params.organizationId ?? "").trim();
    if (!viewerId || !organizationId) return [];

    const visited = new Set<string>([viewerId]);
    const scoped = new Set<string>([viewerId]);
    let frontier: string[] = [viewerId];
    let rounds = 0;

    while (frontier.length > 0) {
      rounds += 1;
      if (rounds > AGENT_SCOPE_MAX_ROUNDS) {
        throw new Error("Agent scope traversal exceeded its maximum depth.");
      }

      const discovered: string[] = [];

      for (let start = 0; start < frontier.length; start += AGENT_SCOPE_ID_BATCH_SIZE) {
        const batch = frontier.slice(start, start + AGENT_SCOPE_ID_BATCH_SIZE);
        let offset = 0;

        for (let page = 0; ; page += 1) {
          if (page >= AGENT_SCOPE_MAX_PAGES_PER_BATCH) {
            throw new Error("Agent scope traversal exceeded its maximum page count.");
          }

          const { data, error } = await supabase
            .from("profiles")
            .select("id, status")
            .eq("organization_id", organizationId)
            .in("upline_id", batch)
            .order("id", { ascending: true })
            .range(offset, offset + AGENT_SCOPE_PAGE_SIZE - 1);

          if (error) throw error;

          const rows = (data ?? []) as unknown as { id: string | null; status: string | null }[];
          for (const row of rows) {
            const id = row?.id;
            if (!id || visited.has(id)) continue;
            visited.add(id);
            // Enqueued even when Deleted, so the branch below it is still walked.
            discovered.push(id);
            if ((row.status ?? "") !== "Deleted") scoped.add(id);
          }

          if (rows.length < AGENT_SCOPE_PAGE_SIZE) break;
          offset += AGENT_SCOPE_PAGE_SIZE;
        }
      }

      frontier = discovered;
    }

    return Array.from(scoped);
  },

  /**
   * Load full profile rows for an explicit scoped id set.
   *
   * Every query it issues — the primary one AND the schema-column fallback — carries
   * the organization boundary, the explicit id set, the non-deleted visibility rule and
   * (when present) the search term, with the existing `first_name` sort preserved. An
   * empty id set or a missing organization issues NO query at all.
   *
   * `getAll` remains the unscoped organization-wide method and is intentionally
   * untouched, so Settings → User Management and View As are unaffected.
   */
  async getByIds(params: { ids: string[]; organizationId?: string | null; search?: string }): Promise<(User & { profile: UserProfile })[]> {
    const ids = Array.from(
      new Set((params.ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0)),
    );
    const organizationId = (params.organizationId ?? "").trim();
    if (ids.length === 0 || !organizationId) return [];

    // `.in("id", …)` is serialized into the PostgREST query string and a response is
    // capped server-side at a row limit, so a large scoped set is split into batches.
    // A batch never exceeds AGENT_SCOPE_ID_BATCH_SIZE ids and `id` is unique, so a
    // batch can never return more rows than it asked for — batching alone is enough
    // here, with no per-batch paging.
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += AGENT_SCOPE_ID_BATCH_SIZE) {
      batches.push(ids.slice(i, i + AGENT_SCOPE_ID_BATCH_SIZE));
    }

    const term = sanitizeProfileSearchTerm(params.search);
    const scoped = (query: unknown, batch: string[]) => {
      let out = (query as any)
        .eq("organization_id", organizationId)
        .in("id", batch)
        .neq("status", "Deleted");
      if (term) {
        out = out.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`);
      }
      return out;
    };

    const runAllBatches = (columns: string) =>
      Promise.all(
        batches.map((batch) =>
          scoped(supabase.from("profiles").select(columns), batch)
            .order("first_name", { ascending: true }),
        ),
      ) as Promise<{ data: unknown[] | null; error: { message: string } | null }[]>;

    let results = await runAllBatches(PROFILE_ALL_COLUMNS.join(","));
    let mapRow = rowToUser;

    if (results.some((r) => r.error && r.error.message.includes("does not exist"))) {
      const first = results.find((r) => r.error)?.error;
      console.warn("Retrying scoped agent fetch with safe column set due to schema mismatch:", first?.message);
      // The fallback trims COLUMNS, never constraints — every batch runs through the
      // same `scoped` helper, so a missing column can never widen this to all-org
      // profiles. Every batch is retried so the returned rows keep one shape.
      results = await runAllBatches(PROFILE_SAFE_COLUMNS.join(","));
      mapRow = rowToSafeUser;
    }

    // One failed batch fails the whole read — never return the batches that happened
    // to succeed, which would silently under-report the scope.
    for (const result of results) {
      if (result.error) throw result.error;
    }

    const users = results.flatMap((result) => (result.data || []).map(mapRow));
    // Each batch is sorted by the database; across batches the merge must be re-sorted
    // so the caller still receives one first_name-ascending list. A single batch keeps
    // the database ordering untouched.
    if (batches.length > 1) {
      users.sort((a, b) => (a.firstName ?? "").localeCompare(b.firstName ?? ""));
    }
    return users;
  },

  async getById(id: string): Promise<User & { profile: UserProfile }> {
    const allExpectedColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url",
      "availability_status", "theme_preference", "created_at", "last_login_at", "licensed_states",
      "resident_state", "commission_level", "upline_id", 
      "monthly_call_goal", "monthly_policies_goal", "weekly_appointment_goal", "monthly_appointment_goal",
      "monthly_premium_goal", "npn", "timezone",
      "win_sound_enabled", "email_notifications_enabled", "sms_notifications_enabled",
      "push_notifications_enabled", "carriers", "organization_id", "team_id"
    ];

    const safeColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url", 
      "availability_status", "theme_preference", "created_at"
    ];

    const { data, error } = await supabase
      .from("profiles")
      .select(allExpectedColumns.join(","))
      .eq("id", id)
      .maybeSingle();

    if (error && error.message.includes("does not exist")) {
      console.warn("Retrying fetch with safe column set due to schema mismatch:", error.message);
      const { data: safeData, error: safeError } = await supabase
        .from("profiles")
        .select(safeColumns.join(","))
        .eq("id", id)
        .maybeSingle();

      if (safeError) throw safeError;
      if (!safeData) throw new Error("User not found");
      return rowToUser({
        ...(safeData as Record<string, any>),
        onboarding_complete: false,
        monthly_call_goal: 0,
        monthly_sales_goal: 0,
        monthly_policies_goal: 0,
        weekly_appointment_goal: 0,
        monthly_appointment_goal: 0,
        monthly_premium_goal: 0,
        onboarding_items: [],
        licensed_states: [],
        carriers: []
      });
    }

    if (error) throw error;
    if (!data) throw new Error("User not found");
    return rowToUser(data);
  },

  async update(id: string, updates: Partial<User>): Promise<void> {
    const payload: any = {};
    if (updates.firstName !== undefined) payload.first_name = updates.firstName;
    if (updates.lastName !== undefined) payload.last_name = updates.lastName;
    if (updates.email !== undefined) payload.email = updates.email;
    if (updates.phone !== undefined) payload.phone = updates.phone;
    if (updates.role !== undefined) payload.role = updates.role;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.avatar !== undefined) payload.avatar_url = updates.avatar;
    if (updates.isSuperAdmin !== undefined) payload.is_super_admin = updates.isSuperAdmin;
    payload.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", id);
    if (error) throw error;
  },

  async updateProfile(userId: string, data: Partial<UserProfile>): Promise<UserProfile> {
    const payload: any = {};
    if (data.licensedStates !== undefined) payload.licensed_states = data.licensedStates;
    if (data.carriers !== undefined) payload.carriers = data.carriers;
    if (data.residentState !== undefined) payload.resident_state = data.residentState;
    if (data.commissionLevel !== undefined) payload.commission_level = data.commissionLevel;
    if (data.uplineId !== undefined) payload.upline_id = data.uplineId;
    if (data.monthlyCallGoal !== undefined) payload.monthly_call_goal = data.monthlyCallGoal;
    if (data.monthlyPoliciesGoal !== undefined) payload.monthly_policies_goal = data.monthlyPoliciesGoal;
    if (data.weeklyAppointmentGoal !== undefined) payload.weekly_appointment_goal = data.weeklyAppointmentGoal;
    if (data.monthlyAppointmentGoal !== undefined) payload.monthly_appointment_goal = data.monthlyAppointmentGoal;
    if (data.monthlyPremiumGoal !== undefined) payload.monthly_premium_goal = data.monthlyPremiumGoal;
    if (data.npn !== undefined) payload.npn = data.npn;
    if (data.timezone !== undefined) payload.timezone = data.timezone;
    if (data.winSoundEnabled !== undefined) payload.win_sound_enabled = data.winSoundEnabled;
    if (data.emailNotificationsEnabled !== undefined) payload.email_notifications_enabled = data.emailNotificationsEnabled;
    if (data.smsNotificationsEnabled !== undefined) payload.sms_notifications_enabled = data.smsNotificationsEnabled;
    if (data.pushNotificationsEnabled !== undefined) payload.push_notifications_enabled = data.pushNotificationsEnabled;
    payload.updated_at = new Date().toISOString();

    const allExpectedColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url", 
      "availability_status", "theme_preference", "created_at", "licensed_states", 
      "resident_state", "commission_level", "upline_id", 
      "monthly_call_goal", "monthly_policies_goal", "weekly_appointment_goal", "monthly_appointment_goal",
      "monthly_premium_goal", "npn", "timezone",
      "win_sound_enabled", "email_notifications_enabled", "sms_notifications_enabled", 
      "push_notifications_enabled", "carriers", "organization_id", "team_id", "is_super_admin", "billing_type"
    ];

    const safeColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url", 
      "availability_status", "theme_preference", "created_at", "is_super_admin"
    ];

    const { data: result, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select(allExpectedColumns.join(","));
    
    if (error && error.message.includes("does not exist")) {
      console.warn("Retrying update without returning new columns due to schema mismatch:", error.message);
      const { data: safeResult, error: safeError } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", userId)
        .select(safeColumns.join(","));
      
      if (safeError) throw safeError;
      if (!safeResult || safeResult.length === 0) {
        throw new Error("Update failed: User profile not found or permission denied (RLS).");
      }
      
      const u = rowToUser({
        ...(safeResult[0] as Record<string, any>),
        onboarding_complete: false,
        monthly_call_goal: 0,
        monthly_sales_goal: 0,
        monthly_policies_goal: 0,
        weekly_appointment_goal: 0,
        monthly_appointment_goal: 0,
        monthly_premium_goal: 0,
        onboarding_items: [],
        licensed_states: [],
        carriers: []
      });
      return u.profile;
    }
    
    if (error) throw error;
    if (!result || result.length === 0) {
      throw new Error("Update failed: User profile not found or permission denied (RLS). Please ensure you have applied the latest database migrations.");
    }
    
    const u = rowToUser(result[0]);
    return u.profile;
  },

  async invite(data: { firstName: string; lastName: string; email: string; role: UserRole; licensedStates: { state: string; licenseNumber: string }[]; commissionLevel: string; uplineId?: string }): Promise<{ invitation_id: string; token: string; email_sent: boolean }> {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
          licensedStates: data.licensedStates,
          commissionLevel: data.commissionLevel,
          uplineId: data.uplineId,
        }),
      }
    );
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || "Failed to invite user");
    }
    return { invitation_id: result.invitation_id, token: result.token, email_sent: result.email_sent === true };
  },

  async deactivate(id: string): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .update({ 
        status: "Inactive", 
        availability_status: "Offline",
        updated_at: new Date().toISOString()
      })
      .eq("id", id);
    if (error) throw error;
  },

  async reactivate(id: string): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .update({ status: "Active" })
      .eq("id", id);
    if (error) throw error;
  },

  async resetPassword(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  },


  async createInvitation(data: { firstName: string; lastName: string; email: string; role: UserRole; licensedStates: { state: string; licenseNumber: string }[]; commissionLevel: string; uplineId?: string | null }, organizationId: string): Promise<{ id: string; token: string }> {
    const { data: inv, error } = await supabase
      .from("invitations")
      .insert({
        email: data.email,
        first_name: data.firstName,
        last_name: data.lastName,
        role: data.role,
        organization_id: organizationId,
        upline_id: data.uplineId,
        licensed_states: data.licensedStates,
        commission_level: data.commissionLevel,
      })
      .select("id, token")
      .single();

    if (error) throw error;
    return { id: inv.id, token: inv.token };
  },

  async getInvitations(organizationId: string): Promise<any[]> {
    const { data: invitations, error } = await supabase
      .from("invitations")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "Pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    if (!invitations?.length) return [];

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("email")
      .eq("organization_id", organizationId)
      .neq("status", "Deleted");

    if (profilesError) throw profilesError;

    const activeEmails = new Set(
      (profiles || [])
        .map((p) => p.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e))
    );

    return invitations.filter(
      (inv) => !activeEmails.has(inv.email?.trim().toLowerCase())
    );
  },

  async revokeInvitation(id: string): Promise<void> {
    const { error } = await supabase
      .from("invitations")
      .update({ status: "Revoked" })
      .eq("id", id);
    
    if (error) throw error;
  },

  async deleteInvitation(id: string): Promise<void> {
    const { error } = await supabase
      .from("invitations")
      .delete()
      .eq("id", id);
    
    if (error) throw error;
  },

  async getInvitationByToken(token: string): Promise<any> {
    const { data, error } = await supabase
      .rpc("get_invitation_by_token_rpc", { invite_token: token })
      .maybeSingle(); 
    
    if (error) {
      console.error("Error fetching invitation via RPC:", error);
      throw new Error("Could not verify invitation. Please check your link or try again later.");
    }
    
    // The RPC returns the flat record. If we need the organization name joined:
    if (data && !data.organizations) {
      // Small optimization: If organization name is needed, we could have included it in RPC
      // but for now, we'll assume the frontend just needs the core data or we can update the RPC later.
      // Let's check AcceptInvitePage usage... it uses invite.organizations?.name.
    }
    
    return data;
  },

  async generateInviteLink(token: string): Promise<string> {
    return `${window.location.origin}/accept-invite?token=${token}`;
  },

  /**
   * Ask the send-invite-email edge function to (re)send an invitation email.
   * The function looks up the invitation by id and builds the accept link
   * server-side, so no recipient details or URLs are passed from the client.
   */
  async sendInviteEmail(invitationId: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke("send-invite-email", {
      body: { invitation_id: invitationId },
    });
    if (error) {
      // supabase-js surfaces any non-2xx as a FunctionsHttpError whose body
      // holds our specific message ("Invitation is no longer pending", etc.).
      // Without this the admin only ever sees "non-2xx status code".
      let serverMessage: string | null = null;
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const body = await ctx.clone().json();
          if (typeof body?.error === "string" && body.error) serverMessage = body.error;
        } catch {
          // Non-JSON body — fall back to the generic error below.
        }
      }
      throw serverMessage ? new Error(serverMessage) : error;
    }
    if (data && data.success === false) {
      throw new Error(data.error || "Failed to send invitation email");
    }
  },

  async deleteUser(id: string, transferToUserId?: string): Promise<void> {
    if (transferToUserId) {
      const { leadsSupabaseApi } = await import("./supabase-contacts");
      await leadsSupabaseApi.reassignAllContacts(id, transferToUserId);
    }

    // Soft delete: preserve historical rows (calls, wins, etc.) and the auth user.
    // getAll() filters out status="Deleted".
    const { error } = await supabase
      .from("profiles")
      .update({
        status: "Deleted",
        availability_status: "Offline",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async updateBillingType(userId: string, billingType: "agency_covered" | "self_pay"): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .update({ billing_type: billingType, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
  },

  async assignUpline(userId: string, uplineId: string | null): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .update({ upline_id: uplineId, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
  },

  async removeFromTeam(userId: string): Promise<void> {
    return this.assignUpline(userId, null);
  },

  async updateGoals(userId: string, goals: {
    monthlyCallGoal?: number;
    monthlyPoliciesGoal?: number;
    monthlyAppointmentGoal?: number;
    monthlyPremiumGoal?: number;
  }): Promise<void> {
    await this.updateProfile(userId, goals);
  },

  async updateOnboardingItems(userId: string, items: any[]): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_items: items, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
  },

  async getDownlineAgents(uplineId: string): Promise<{ id: string; firstName: string; lastName: string }[]> {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .eq("upline_id", uplineId)
      .neq("status", "Deleted")
      .order("first_name", { ascending: true });

    if (error) {
      console.error("Error fetching downline agents:", error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
    }));
  },

  async getPerformance(userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [{ data: calls }, { data: apps }, { data: winsData }] = await Promise.all([
      supabase
        .from("calls")
        .select("duration, created_at")
        .eq("agent_id", userId)
        .gte("created_at", startOfMonth),
      supabase
        .from("appointments")
        .select("id, created_at")
        .eq("user_id", userId)
        .gte("created_at", startOfMonth)
        .not("status", "in", "(Canceled,Cancelled,Rescheduled,canceled,cancelled,rescheduled)"),
      supabase
        .from("wins")
        .select("premium_amount")
        .eq("agent_id", userId)
        .gte("created_at", startOfMonth),
    ]);

    const callsMonthly = calls?.length || 0;
    const policiesMonthly = winsData?.length || 0;
    const appsMonth = apps?.length || 0;
    const talkTimeMonthlyHours = (calls?.reduce((sum, c) => sum + (c.duration || 0), 0) || 0) / 3600;
    const premiumMonthly = (winsData ?? []).reduce((sum, w) => sum + (Number(w.premium_amount) || 0), 0);

    return {
      callsMonthly,
      policiesMonthly,
      appsMonth,
      talkTimeMonthlyHours,
      premiumMonthly,
      // backward compat aliases
      callsMade: callsMonthly,
      policiesSold: policiesMonthly,
      appointmentsSet: appsMonth,
      totalTalkTime: `${talkTimeMonthlyHours.toFixed(1)} hrs`,
      conversionRate: callsMonthly ? `${((policiesMonthly / callsMonthly) * 100).toFixed(1)}%` : "0%",
      recentCalls: [],
    };
  }
};
