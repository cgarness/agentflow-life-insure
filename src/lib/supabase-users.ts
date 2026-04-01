
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
      monthlyTalkTimeGoalHours: row.monthly_talk_time_goal_hours || 0,
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
    }
  };
}

export const usersSupabaseApi = {
  async getAll(filters?: { search?: string; role?: string; status?: string }): Promise<(User & { profile: UserProfile })[]> {
    const allExpectedColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url",
      "availability_status", "theme_preference", "created_at", "last_login_at", "licensed_states",
      "resident_state", "commission_level", "upline_id", 
      "monthly_call_goal", "monthly_policies_goal", "weekly_appointment_goal",
      "monthly_talk_time_goal_hours", "npn", "timezone", 
      "win_sound_enabled", "email_notifications_enabled", "sms_notifications_enabled",
      "push_notifications_enabled", "carriers", "organization_id", "team_id", "is_super_admin"
    ];

    const safeColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url", 
      "availability_status", "theme_preference", "created_at", "is_super_admin"
    ];

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
    
    const { data, error } = await q.order("first_name", { ascending: true });
    
    if (error && error.message.includes("does not exist")) {
      console.warn("Retrying fetch with safe column set due to schema mismatch:", error.message);
      const { data: safeData, error: safeError } = await supabase
        .from("profiles")
        .select(safeColumns.join(","))
        .order("first_name", { ascending: true });
      
      if (safeError) throw safeError;
      return (safeData || []).map(row => rowToUser({
        ...(row as Record<string, any>),
        onboarding_complete: false,
        monthly_call_goal: 0,
        monthly_sales_goal: 0,
        monthly_policies_goal: 0,
        weekly_appointment_goal: 0,
        monthly_talk_time_goal_hours: 0,
        onboarding_items: [],
        licensed_states: [],
        carriers: []
      }));
    }
    
    if (error) throw error;
    
    return (data || []).map(rowToUser);
  },

  async getById(id: string): Promise<User & { profile: UserProfile }> {
    const allExpectedColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url",
      "availability_status", "theme_preference", "created_at", "last_login_at", "licensed_states",
      "resident_state", "commission_level", "upline_id", 
      "monthly_call_goal", "monthly_policies_goal", "weekly_appointment_goal",
      "monthly_talk_time_goal_hours", "npn", "timezone", 
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
      .single();
    
    if (error && error.message.includes("does not exist")) {
      console.warn("Retrying fetch with safe column set due to schema mismatch:", error.message);
      const { data: safeData, error: safeError } = await supabase
        .from("profiles")
        .select(safeColumns.join(","))
        .eq("id", id)
        .single();
      
      if (safeError) throw safeError;
      return rowToUser({
        ...(safeData as Record<string, any>),
        onboarding_complete: false,
        monthly_call_goal: 0,
        monthly_sales_goal: 0,
        monthly_policies_goal: 0,
        weekly_appointment_goal: 0,
        monthly_talk_time_goal_hours: 0,
        onboarding_items: [],
        licensed_states: [],
        carriers: []
      });
    }

    if (error) throw error;
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
    if (data.monthlyTalkTimeGoalHours !== undefined) payload.monthly_talk_time_goal_hours = data.monthlyTalkTimeGoalHours;
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
      "monthly_call_goal", "monthly_policies_goal", "weekly_appointment_goal",
      "monthly_talk_time_goal_hours", "npn", "timezone", 
      "win_sound_enabled", "email_notifications_enabled", "sms_notifications_enabled", 
      "push_notifications_enabled", "carriers", "organization_id", "team_id", "is_super_admin"
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
        monthly_talk_time_goal_hours: 0,
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

  async invite(data: { firstName: string; lastName: string; email: string; role: UserRole; licensedStates: { state: string; licenseNumber: string }[]; commissionLevel: string; uplineId?: string }): Promise<{ invitation_id: string; token: string }> {
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
    return { invitation_id: result.invitation_id, token: result.token };
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

  async resendInvite(id: string): Promise<void> {
    // Look up the existing invitation to get its token and details
    const { data: invitation, error } = await supabase
      .from("invitations")
      .select("token, email, first_name, role")
      .eq("id", id)
      .single();
    if (error || !invitation) throw new Error("Invitation not found");

    const inviteURL = `${window.location.origin}/accept-invite?token=${invitation.token}`;
    await this.sendInviteEmail({
      email: invitation.email,
      firstName: invitation.first_name || "",
      role: invitation.role,
      inviteURL,
    });
  },

  async resetPassword(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  },


  async createInvitation(data: { firstName: string; lastName: string; email: string; role: UserRole; licensedStates: { state: string; licenseNumber: string }[]; commissionLevel: string; uplineId?: string | null }, organizationId: string): Promise<string> {
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
      .select("token")
      .single();

    if (error) throw error;
    return inv.token;
  },

  async getInvitations(organizationId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from("invitations")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async revokeInvitation(id: string): Promise<void> {
    const { error } = await supabase
      .from("invitations")
      .update({ status: "Revoked" })
      .eq("id", id);
    
    if (error) throw error;
  },

  async getInvitationByToken(token: string): Promise<any> {
    const { data, error } = await supabase
      .from("invitations")
      .select("*, organizations(name)")
      .eq("token", token)
      .maybeSingle(); // Use maybeSingle to avoid 406 errors on missing tokens
    
    if (error) {
      console.error("Error fetching invitation:", error);
      throw new Error("Could not verify invitation. Please check your link or try again later.");
    }
    return data;
  },

  async generateInviteLink(token: string): Promise<string> {
    return `${window.location.origin}/accept-invite?token=${token}`;
  },

  async sendInviteEmail(data: { email: string; firstName: string; role: string; inviteURL: string }): Promise<void> {
    const { error } = await supabase.functions.invoke("send-invite-email", {
      body: data,
    });
    if (error) throw error;
  },

  async deleteUser(id: string, transferToUserId?: string): Promise<void> {
    if (transferToUserId) {
      const { leadsSupabaseApi } = await import("./supabase-contacts");
      await leadsSupabaseApi.reassignAllContacts(id, transferToUserId);
    }

    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },

  async getPerformance(userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    
    // Start of this week (Sunday)
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay());
    sunday.setHours(0, 0, 0, 0);
    const startOfWeek = sunday.toISOString();

    const { data: calls } = await supabase
      .from("calls")
      .select("outcome, duration, created_at")
      .eq("agent_id", userId)
      .gte("created_at", startOfMonth);
    
    const { data: apps } = await supabase
      .from("appointments")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("status", "Scheduled")
      .gte("created_at", startOfWeek);

    const callsMonthly = calls?.length || 0;
    const policiesMonthly = calls?.filter(c => (c.outcome || "").toLowerCase().includes("sold")).length || 0;
    const talkTimeMonthlyHours = (calls?.reduce((sum, c) => sum + (c.duration || 0), 0) || 0) / 3600;
    
    const appsWeekly = apps?.length || 0;
    
    return {
      callsMonthly,
      policiesMonthly,
      appsWeekly,
      talkTimeMonthlyHours,
      // For backward compatibility
      callsMade: callsMonthly,
      policiesSold: policiesMonthly,
      appointmentsSet: appsWeekly,
      totalTalkTime: `${talkTimeMonthlyHours.toFixed(1)} hrs`,
      conversionRate: callsMonthly ? `${((policiesMonthly / callsMonthly) * 100).toFixed(1)}%` : "0%",
      recentCalls: [],
    };
  }
};
