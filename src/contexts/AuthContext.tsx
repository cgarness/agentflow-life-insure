import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User as SupabaseUser, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { needsAppOnboardingWizard } from "@/lib/onboarding-wizard";
import { PROFILE_FETCH_FALLBACK_SELECT } from "@/lib/profile-fetch-columns";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  availability_status: string;
  avatar_url: string;
  theme_preference: string;
  licensed_states: any[];
  carriers: any[];
  resident_state: string;
  commission_level: string;
  upline_id: string;
  onboarding_complete: boolean;
  monthly_call_goal: number;
  monthly_policies_goal: number;
  weekly_appointment_goal: number;
  monthly_premium_goal: number;
  npn: string;
  timezone: string;
  win_sound_enabled: boolean;
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  push_notifications_enabled: boolean;
  organization_id: string | null;
  team_id: string | null;
  is_super_admin: boolean;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: SupabaseUser | null;
  profile: Profile | null; // This will return impersonated profile if active
  realProfile: Profile | null; // This always returns the actual authenticated profile
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isBuildingOrganization: boolean;
  impersonatedUser: Profile | null;
  isImpersonating: boolean;
  login: (email: string, password: string) => Promise<SupabaseUser>;
  signup: (email: string, password: string, firstName: string, lastName: string, orgId?: string | null, uplineId?: string | null, role?: string, licensedStates?: any[], commissionLevel?: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (data: Partial<Profile>) => Promise<void>;
  checkProfileSetupNeeded: () => boolean;
  markProfileSetupSeen: (skipped: boolean) => void;
  startImpersonation: (profile: Profile) => void;
  stopImpersonation: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [impersonatedUser, setImpersonatedUser] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuildingOrganization, setIsBuildingOrganization] = useState(false);

  const fetchProfile = useCallback(async (userId: string) => {
    const applyRow = (row: Record<string, unknown>) => {
      if (row.status === "Inactive") {
        console.warn("User account is inactive. Logging out.");
        void supabase.auth.signOut();
        return;
      }
      setProfile(row as unknown as Profile);
    };

    // Prefer full row; on schema drift, fall back to an explicit wide column list (not the legacy 10-col subset,
    // which wiped phone / resident_state / timezone from React after onboarding when USER_UPDATED refetched).
    let { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error?.message?.includes("does not exist")) {
      console.warn("Profile fetch: retrying with explicit columns:", error.message);
      const second = await supabase
        .from("profiles")
        .select(PROFILE_FETCH_FALLBACK_SELECT)
        .eq("id", userId)
        .maybeSingle();
      data = second.data as typeof data;
      error = second.error;
    }

    if (error) {
      console.error("fetchProfile failed:", error.message);
      return;
    }

    if (data) applyRow(data as Record<string, unknown>);
  }, []);

  useEffect(() => {
    // Load impersonation state from localStorage on mount
    const savedImpersonation = localStorage.getItem("agentflow_impersonation");
    if (savedImpersonation) {
      try {
        setImpersonatedUser(JSON.parse(savedImpersonation));
      } catch (e) {
        console.error("Failed to parse impersonation state", e);
        localStorage.removeItem("agentflow_impersonation");
      }
    }

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          // Use setTimeout to avoid Supabase client deadlock
          setTimeout(() => fetchProfile(currentSession.user.id), 0);
        } else {
          setProfile(null);
          setImpersonatedUser(null);
          localStorage.removeItem("agentflow_impersonation");
        }

        if (event === "INITIAL_SESSION") {
          setIsLoading(false);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) {
        await fetchProfile(currentSession.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // Token refreshing loop for new un-stamped sessions
  useEffect(() => {
    if (session?.user && profile?.organization_id && profile?.role) {
      const orgIdClaim = session.user.app_metadata?.organization_id;
      const roleClaim = session.user.app_metadata?.role;
      
      const needsOrgRefresh = !orgIdClaim || orgIdClaim !== profile.organization_id;
      const needsRoleRefresh = !roleClaim || roleClaim !== profile.role;
      
      if (needsOrgRefresh || needsRoleRefresh) {
        setIsBuildingOrganization(true);
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          const { data } = await supabase.auth.refreshSession();
          const newOrgId = data.session?.user?.app_metadata?.organization_id;
          const newRole = data.session?.user?.app_metadata?.role;
          
          const orgSync = newOrgId === profile.organization_id;
          const roleSync = newRole === profile.role;
          
          if ((orgSync && roleSync) || attempts > 10) {
            clearInterval(interval);
            if (data.session) setSession(data.session);
            setIsBuildingOrganization(false);
            if (attempts > 10) console.warn("[Auth] Token refresh timed out. Role/Org RLS evaluation may be stale.");
          }
        }, 1000);
        return () => clearInterval(interval);
      } else {
        setIsBuildingOrganization(false);
      }
    }
  }, [session, profile]);

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.user) throw new Error("No user returned from sign-in");
    return data.user;
  }, []);

  const signup = useCallback(async (email: string, password: string, firstName: string, lastName: string, orgId?: string | null, uplineId?: string | null, role?: string, licensedStates?: any[], commissionLevel?: string) => {
    const signupSource = orgId ? "invite" : "self_serve";
    let resolvedOrgId = orgId;
    let resolvedRole = role || "Agent";

    // If no orgId provided (uninvited signup), create a new organization
    // and make this user the founding Admin
    if (!resolvedOrgId) {
      const orgName = `${firstName}'s Agency`;
      const orgSlug = `${firstName.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`;
      
      const { data: orgData, error: orgInvokeError } = await supabase.functions.invoke("create-organization", {
        body: { name: orgName, slug: orgSlug }
      });

      if (orgInvokeError || !orgData?.success) {
        throw new Error("Failed to create organization: " + (orgInvokeError?.message || "Unknown error"));
      }

      resolvedOrgId = orgData.organization_id;
      resolvedRole = "Admin"; // Founders are always Admins of their own org
    }

    const { data: createData, error: createError } = await supabase.functions.invoke("create-user", {
      body: {
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        organization_id: resolvedOrgId,
        upline_id: uplineId || null,
        role: resolvedRole,
        licensed_states: licensedStates || [],
        commission_level: commissionLevel || "0%",
        signup_source: signupSource,
      },
    });
    if (createError) throw createError;
    if (!createData?.success) throw new Error(createData?.error || "Signup failed");
  }, []);

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setProfile(null);
    setSession(null);
    setImpersonatedUser(null);
    localStorage.removeItem("agentflow_impersonation");
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }, []);

  const updateProfile = useCallback(async (data: Partial<Profile>) => {
    if (!user) return;
    const { data: row, error } = await supabase
      .from("profiles")
      .update(data)
      .eq("id", user.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (row) setProfile(row as unknown as Profile);
    else setProfile((prev) => (prev ? { ...prev, ...data } : prev));
  }, [user]);

  const checkProfileSetupNeeded = useCallback((): boolean => {
    if (!user || !profile) return false;
    if (needsAppOnboardingWizard(user)) return false;

    const isComplete = !!(
      profile.first_name?.trim() &&
      profile.last_name?.trim() &&
      profile.phone?.trim() &&
      profile.resident_state?.trim()
    );

    if (isComplete) return false;

    const storageKey = `agentflow-profile-setup-${user.id}`;
    const stored = localStorage.getItem(storageKey);

    if (!stored) return true;

    try {
      const parsed = JSON.parse(stored) as { firstLoginComplete: boolean; lastSkippedAt: string | null };
      if (!parsed.firstLoginComplete) return true;
      if (parsed.lastSkippedAt) {
        const daysSinceSkipped = (Date.now() - new Date(parsed.lastSkippedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceSkipped > 3) return true;
      }
      return false;
    } catch {
      return true;
    }
  }, [user, profile]);

  const markProfileSetupSeen = useCallback((skipped: boolean) => {
    if (!user) return;
    const storageKey = `agentflow-profile-setup-${user.id}`;
    const entry = {
      firstLoginComplete: true,
      lastSkippedAt: skipped ? new Date().toISOString() : null,
    };
    localStorage.setItem(storageKey, JSON.stringify(entry));
  }, [user]);

  const startImpersonation = useCallback((targetProfile: Profile) => {
    setImpersonatedUser(targetProfile);
    localStorage.setItem("agentflow_impersonation", JSON.stringify(targetProfile));
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonatedUser(null);
    localStorage.removeItem("agentflow_impersonation");
    // Return to Agencies (super-admin) dashboard
    window.location.href = "/super-admin";
  }, []);

  if (isBuildingOrganization) {
    return (
      <div className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center flex-col bg-background">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-lg font-medium text-foreground">Loading your agency</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{
      user, 
      profile: impersonatedUser || profile, 
      realProfile: profile,
      impersonatedUser,
      isImpersonating: !!impersonatedUser,
      session, isAuthenticated: !!session, isLoading, isBuildingOrganization,
      login, signup, logout, resetPassword, updateProfile,
      checkProfileSetupNeeded, markProfileSetupSeen,
      startImpersonation, stopImpersonation
    }}>
      {children}
    </AuthContext.Provider>
  );
};
