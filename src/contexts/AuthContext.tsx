import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User as SupabaseUser, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { PROFILE_FETCH_FALLBACK_SELECT } from "@/lib/profile-fetch-columns";
import {
  IMPERSONATION_STORAGE_KEY,
  parseStoredImpersonationProfile,
} from "@/lib/impersonationProfile";

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
  monthly_appointment_goal: number;
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
  platform_role: string | null;
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
  signup: (email: string, password: string, firstName: string, lastName: string, inviteToken?: string | null) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (data: Partial<Profile>) => Promise<void>;
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
    // Rehydrate impersonation from localStorage — FAIL CLOSED.
    //
    // Storage is untrusted and long-lived: it can hold a payload written by an older build (the
    // camelCase `UserProfile` DTO, which has no `id` / `role` / `organization_id`), a hand-edited
    // object, or a truncated write. `parseStoredImpersonationProfile` returns null for anything
    // that cannot supply a scoping identity, and a null impersonation simply means "not
    // impersonating" — the session falls back to the real authenticated profile, which is the safe
    // direction. Running on a half-built profile is exactly the defect this replaces.
    const savedImpersonation = localStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (savedImpersonation) {
      const restored = parseStoredImpersonationProfile(savedImpersonation);
      if (restored) {
        setImpersonatedUser(restored);
      } else {
        console.warn("[Auth] Discarding malformed stored impersonation state.");
        localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
      }
    }

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          if (event === "INITIAL_SESSION") {
            await fetchProfile(currentSession.user.id);
          } else {
            // Use setTimeout to avoid Supabase client deadlock
            setTimeout(() => fetchProfile(currentSession.user.id), 0);
          }
        } else {
          setProfile(null);
          setImpersonatedUser(null);
          localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
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

  /**
   * Account creation — the browser supplies identity only, never authority.
   *
   * `organization_id`, `role`, `upline_id`, `commission_level` and `licensed_states`
   * are deliberately NOT sent: every one of them is derived server-side inside
   * `create-user`, either from the invitation row addressed by `inviteToken`
   * (invite mode) or by minting a founder organization with the service role
   * (self-serve mode). Anything this client sent would be an attacker-chosen claim,
   * so the fields are absent rather than merely ignored. The `create-organization`
   * pre-call and the browser-side `role = "Admin"` hard-code were removed for the
   * same reason — org creation is now internal to `create-user`, which also owns the
   * compensating cleanup that prevents orphaned orgs and auth users.
   */
  const signup = useCallback(async (email: string, password: string, firstName: string, lastName: string, inviteToken?: string | null) => {
    const { data: createData, error: createError } = await supabase.functions.invoke("create-user", {
      body: {
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        signup_source: inviteToken ? "invite" : "self_serve",
        invite_token: inviteToken || null,
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
    localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
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

  const startImpersonation = useCallback((targetProfile: Profile) => {
    // Defence in depth: callers use `toImpersonationProfile`, but a profile missing any of the
    // three scoping fields must never take effect — it would silently widen or blank every
    // scoped surface rather than failing visibly.
    if (!targetProfile?.id || !targetProfile.role || !targetProfile.organization_id) {
      console.error("[Auth] Refusing to impersonate: profile is missing id, role or organization_id.");
      return;
    }
    setImpersonatedUser(targetProfile);
    localStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(targetProfile));
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonatedUser(null);
    localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
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
      startImpersonation, stopImpersonation
    }}>
      {children}
    </AuthContext.Provider>
  );
};
