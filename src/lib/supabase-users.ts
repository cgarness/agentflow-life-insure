
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
      "push_notifications_enabled", "carriers", "organization_id", "team_id"
    ];

    const safeColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url", 
      "availability_status", "theme_preference", "created_at"
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
      "push_notifications_enabled", "carriers", "organization_id", "team_id"
    ];

    const safeColumns = [
      "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url", 
      "availability_status", "theme_preference", "created_at"
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

  async invite(data: { firstName: string; lastName: string; email: string; role: UserRole; licensedStates: { state: string; licenseNumber: string }[]; commissionLevel: string; uplineId?: string | null }, organizationId: string | null): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .insert({
        first_name: data.firstName,
        last_name: data.lastName,
        email: data.email,
        role: data.role,
        status: "Pending",
        commission_level: data.commissionLevel,
        licensed_states: data.licensedStates,
        organization_id: organizationId,
        upline_id: data.uplineId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any);
    
    if (error) throw error;
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

  async resendInvite(email: string): Promise<void> {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) throw error;
  },

  async resetPassword(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  },

  async generateInviteLink(data: { firstName: string; lastName: string; email: string; role: UserRole }, organizationId: string | null): Promise<string> {
    const invitePayload = { ...data, organizationId };
    const encoded = btoa(JSON.stringify(invitePayload));
    return `${window.location.origin}/signup?invite=${encoded}`;
  },

  async deleteUser(id: string): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .update({ status: "Deleted" })
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
