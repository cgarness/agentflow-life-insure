
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
    lastLoginAt: null,
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
      monthlySalesGoal: row.monthly_sales_goal || 0,
      weeklyAppointmentGoal: row.weekly_appointment_goal || 0,
      monthlyTalkTimeGoalHours: row.monthly_talk_time_goal_hours || 0,
      npn: row.npn || "",
      timezone: row.timezone || "Eastern Time (US & Canada)",
      winSoundEnabled: row.win_sound_enabled ?? true,
      emailNotificationsEnabled: row.email_notifications_enabled ?? true,
      smsNotificationsEnabled: row.sms_notifications_enabled ?? false,
      pushNotificationsEnabled: row.push_notifications_enabled ?? true,
      onboardingItems: row.onboarding_items || [],
    }
  };
}

export const usersSupabaseApi = {
  async getAll(filters?: { search?: string; role?: string; status?: string }): Promise<(User & { profile: UserProfile })[]> {
    let q = supabase.from("profiles").select("*");
    
    if (filters?.search) {
      const search = filters.search.toLowerCase();
      q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }
    
    if (filters?.role && filters.role !== "All") {
      q = q.eq("role", filters.role);
    }
    
    if (filters?.status && filters.status !== "All") {
      q = q.eq("status", filters.status);
    }
    
    const { data, error } = await q.order("first_name", { ascending: true });
    if (error) throw error;
    
    return (data || []).map(rowToUser);
  },

  async getById(id: string): Promise<User & { profile: UserProfile }> {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();
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
    if (data.onboardingComplete !== undefined) payload.onboarding_complete = data.onboardingComplete;
    if (data.monthlyCallGoal !== undefined) payload.monthly_call_goal = data.monthlyCallGoal;
    if (data.monthlySalesGoal !== undefined) payload.monthly_sales_goal = data.monthlySalesGoal;
    if (data.weeklyAppointmentGoal !== undefined) payload.weekly_appointment_goal = data.weeklyAppointmentGoal;
    if (data.monthlyTalkTimeGoalHours !== undefined) payload.monthly_talk_time_goal_hours = data.monthlyTalkTimeGoalHours;
    if (data.npn !== undefined) payload.npn = data.npn;
    if (data.timezone !== undefined) payload.timezone = data.timezone;
    if (data.winSoundEnabled !== undefined) payload.win_sound_enabled = data.winSoundEnabled;
    if (data.emailNotificationsEnabled !== undefined) payload.email_notifications_enabled = data.emailNotificationsEnabled;
    if (data.smsNotificationsEnabled !== undefined) payload.sms_notifications_enabled = data.smsNotificationsEnabled;
    if (data.pushNotificationsEnabled !== undefined) payload.push_notifications_enabled = data.pushNotificationsEnabled;
    if (data.onboardingItems !== undefined) payload.onboarding_items = data.onboardingItems;
    payload.updated_at = new Date().toISOString();

    const { data: result, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select()
      .single();
    if (error) throw error;
    
    const u = rowToUser(result);
    return u.profile;
  },

  async invite(data: { firstName: string; lastName: string; email: string; role: UserRole; licensedStates: { state: string; licenseNumber: string }[]; commissionLevel: string }): Promise<void> {
    console.log("Inviting user:", data);
    return Promise.resolve();
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
    console.log("Resending invite to:", id);
    return Promise.resolve();
  },

  async resetPassword(id: string): Promise<void> {
    console.log("Resetting password for:", id);
    return Promise.resolve();
  },

  async generateInviteLink(data: any): Promise<string> {
    const params = new URLSearchParams();
    if (typeof data === "string") {
      params.set("invite", data);
    } else {
      const encoded = btoa(JSON.stringify(data));
      params.set("invite", encoded);
    }
    return `${window.location.origin}/signup?${params.toString()}`;
  },

  async deleteUser(id: string): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },

  async getPerformance(userId: string) {
    const { data: calls } = await supabase
      .from("calls")
      .select("outcome, duration")
      .eq("agent_id", userId);
    
    const { data: apps } = await supabase
      .from("appointments")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "Scheduled");

    const callsMade = calls?.length || 0;
    const policiesSold = calls?.filter(c => (c.outcome || "").toLowerCase().includes("sold")).length || 0;
    const totalDuration = calls?.reduce((sum, c) => sum + (c.duration || 0), 0) || 0;
    
    return {
      callsMade,
      policiesSold,
      appointmentsSet: apps?.length || 0,
      totalTalkTime: `${(totalDuration / 3600).toFixed(1)} hrs`,
      conversionRate: callsMade ? `${((policiesSold / callsMade) * 100).toFixed(1)}%` : "0%",
      recentCalls: [],
    };
  }
};
