import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { User as SupabaseUser, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { PROFILE_FETCH_FALLBACK_SELECT } from "@/lib/profile-fetch-columns";
import {
  clearStoredImpersonation,
  profileRowToImpersonationProfile,
  readStoredImpersonationTarget,
  writeStoredImpersonationTarget,
} from "@/lib/impersonationProfile";
import type { StoredImpersonationPointer } from "@/lib/impersonationProfile";

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
  /**
   * Activate a "View As" for one target profile.
   *
   * ONLY the target's ID is read from the argument — pass the id itself, or any object carrying
   * one. Role, status, organization and the super-admin flag are read back from `profiles` on the
   * server; a caller cannot supply them. Resolves `true` only when the impersonation actually took
   * effect, so a caller cannot navigate into a session that was refused.
   */
  startImpersonation: (target: string | { id: string }) => Promise<boolean>;
  stopImpersonation: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [impersonatedUser, setImpersonatedUser] = useState<Profile | null>(null);
  /**
   * The untrusted pointer read from storage — owner AND target — worthless until the effect below
   * validates it. The OWNER half is what makes it addressable: `localStorage` is per-origin, not
   * per-account, so an intent parked by one operator is still sitting there for the next account
   * that signs in on the same browser.
   */
  const [pendingImpersonation, setPendingImpersonation] = useState<StoredImpersonationPointer | null>(null);
  /**
   * The REAL session profile as of the latest commit.
   *
   * `startImpersonation` is asynchronous, so the `profile` it authorised against is a snapshot taken
   * before a network round-trip. During that round-trip the session can sign out, be demoted, or be
   * replaced by a different account signing in — and committing regardless would activate an
   * impersonation the CURRENT session never authorised (worst case: a second Super Admin from
   * another organization inherits a target validated against the first one's). The revocation effect
   * below cannot cover it: it does nothing when `profile` is null, and nothing when the new account
   * is itself a Super Admin. So the activation re-reads this ref after the await instead.
   */
  const realProfileRef = useRef<Profile | null>(null);

  /**
   * The authenticated user id this provider currently trusts, written SYNCHRONOUSLY the moment a
   * session is adopted — before any profile fetch is even scheduled.
   *
   * Session identity changes one layer BELOW the profile that authority is read from, and it does
   * not change at the same time. `onAuthStateChange` awaits `fetchProfile` only for
   * `INITIAL_SESSION`; every other event — `SIGNED_IN` above all — defers it through `setTimeout`
   * to avoid a Supabase client deadlock. Between the event and that deferred fetch the session is
   * already B while the trusted profile is still A, so an in-flight activation started by A saw a
   * profile that matched itself and committed. Comparing the profile to the profile can never catch
   * that; comparing both to the SESSION can.
   */
  const sessionUserIdRef = useRef<string | null>(null);
  /**
   * Bumped whenever the trusted identity changes, whenever an authority attempt starts, and
   * whenever `logout` / `stopImpersonation` express newer intent. Every asynchronous authority
   * attempt captures it and refuses to commit if it has moved.
   */
  const authorityGenRef = useRef(0);
  /**
   * Counts AUTH EVENTS (and explicit local sign-outs), so an in-flight `getSession()` bootstrap can
   * tell "nothing has happened yet" from "something has happened since".
   *
   * `sessionUserIdRef.current === null` cannot make that distinction: it is the value before the
   * listener has delivered anything AND the value after it has delivered `SIGNED_OUT`. A bootstrap
   * that resolved with the pre-sign-out session therefore read `null`, concluded it was still the
   * newest word on the subject, and adopted a session the user had already left — restoring the
   * user, the session and the profile of an account that is signed out.
   *
   * An id comparison cannot close it either, for the same reason it could not close the
   * `A → B → A` case: the discriminator is not WHICH identity, it is WHETHER anything newer has
   * spoken. That is a count, so this is a count. It is bumped SYNCHRONOUSLY at the top of every
   * auth callback — `SIGNED_OUT` above all — and by `logout()` before it awaits anything.
   */
  const authEventEpochRef = useRef(0);

  /**
   * The ONLY way the real profile is written. The ref is updated SYNCHRONOUSLY with the state, not
   * from an effect: an effect-written mirror lags by a commit, and the whole point of the ref is to
   * be exact at the moment an in-flight `startImpersonation` re-checks it.
   */
  const applyRealProfile = useCallback(
    (next: Profile | null | ((prev: Profile | null) => Profile | null)) => {
      // The ref is the faithful mirror because this is the only writer of `profile`, so it can also
      // serve as `prev` for the functional form. Nothing is written from inside a state updater:
      // React may invoke an updater twice (StrictMode) or discard it (concurrent rendering).
      const resolved = typeof next === "function"
        ? (next as (p: Profile | null) => Profile | null)(realProfileRef.current)
        : next;
      realProfileRef.current = resolved;
      setProfile(resolved);
    },
    [],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuildingOrganization, setIsBuildingOrganization] = useState(false);

  /**
   * Adopt an authenticated session identity. MUST be called synchronously, before the new profile
   * fetch is scheduled.
   *
   * When the identity actually changes, everything the PREVIOUS identity authorised dies here and
   * now: its real profile, its live impersonation, its pending restore target, its persisted
   * pointer, and — through the generation bump — every direct or restore attempt still in flight.
   * A first adoption (`prev === null`) authorised nothing yet, so it must NOT clear the pointer the
   * page was loaded with; that is the legitimate restore path.
   */
  const adoptSessionIdentity = useCallback((nextUserId: string | null) => {
    const prev = sessionUserIdRef.current;
    const identityChanged = prev !== nextUserId;
    sessionUserIdRef.current = nextUserId;
    if (identityChanged) {
      // Supersede every in-flight attempt started under the previous identity.
      authorityGenRef.current += 1;
    }

    const scrub = () => {
      applyRealProfile(null);
      setImpersonatedUser(null);
      setPendingImpersonation(null);
      clearStoredImpersonation();
    };

    // A SIGNED-OUT session holds no authority, whether or not the identity "changed". A page that
    // boots signed out has `prev === null === nextUserId`, and the pointer has ALREADY been read
    // from storage into `pendingImpersonation` by the effect body above — so an
    // identity-change-only teardown scrubs nothing and the next login inherits a target it never
    // asked for, within the same page life. This branch must stay separate from the one below.
    if (nextUserId === null) {
      scrub();
      return;
    }
    // Same account, nothing to invalidate.
    if (!identityChanged) return;
    // FIRST adoption: nothing was authorised under a previous identity, and the pointer the page
    // was loaded with is this session's own. Clearing it here would break the legitimate restore.
    if (prev === null) return;
    scrub();
  }, [applyRealProfile]);

  const fetchProfile = useCallback(async (userId: string) => {
    const applyRow = (row: Record<string, unknown>) => {
      if (row.status === "Inactive") {
        console.warn("User account is inactive. Logging out.");
        void supabase.auth.signOut();
        return;
      }
      applyRealProfile(row as unknown as Profile);
    };

    // Prefer full row; on schema drift, fall back to an explicit wide column list (not the legacy 10-col subset,
    // which wiped phone / resident_state / timezone from React after onboarding when USER_UPDATED refetched).
    //
    // The supabase client returns `{ error }` for a PostgREST error but THROWS for a transport-level
    // failure. This function is invoked from `setTimeout(...)` with nothing to catch it, so a throw
    // would surface as an unhandled rejection and leave the session with no profile and no log line
    // anyone could act on.
    let data: Record<string, unknown> | null = null;
    let error: { message?: string } | null = null;
    try {
      const first = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      data = first.data as typeof data;
      error = first.error;
    } catch (e) {
      console.error("fetchProfile failed (transport):", e instanceof Error ? e.message : String(e));
      return;
    }

    if (error?.message?.includes("does not exist")) {
      console.warn("Profile fetch: retrying with explicit columns:", error.message);
      try {
        const second = await supabase
          .from("profiles")
          .select(PROFILE_FETCH_FALLBACK_SELECT)
          .eq("id", userId)
          .maybeSingle();
        data = second.data as typeof data;
        error = second.error;
      } catch (e) {
        console.error("fetchProfile fallback failed (transport):", e instanceof Error ? e.message : String(e));
        return;
      }
    }

    // A response may only be applied while the session it was requested FOR is still the live one.
    // Without this, a slow read for account A lands after B has taken over and reinstates A as the
    // trusted real profile — re-authorising an identity that is no longer signed in. One check,
    // placed after BOTH possible reads and before anything is applied.
    if (sessionUserIdRef.current !== userId) return;

    if (error) {
      // A failed lookup leaves the session with NO trusted profile. It must not fall back to
      // whatever the previous identity left behind — `adoptSessionIdentity` already cleared that.
      console.error("fetchProfile failed:", error.message);
      return;
    }

    if (data) applyRow(data as Record<string, unknown>);
  }, [applyRealProfile]);

  useEffect(() => {
    // Read the stored POINTER only — never an impersonation.
    //
    // Storage is attacker-controlled. The previous implementation rehydrated a whole `Profile`
    // from it after validating only its shape, so any signed-in user could write
    // `{ id, role: "Admin", organization_id }` and become an organization-wide viewer in every
    // frontend scoping surface. Nothing here grants authority: the candidate pointer is parked and only
    // becomes an impersonation in the effect below, after the REAL database-backed profile has
    // loaded and proven `is_super_admin`, after the pointer has proven it was parked by THIS
    // operator, and after the target has been re-fetched from the server.
    setPendingImpersonation(readStoredImpersonationTarget());

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        // SYNCHRONOUS, and FIRST — before the profile fetch below is awaited or scheduled. This is
        // the whole fix: for every event except INITIAL_SESSION the fetch is deferred, so anything
        // that reads authority in the meantime must already see the new identity.
        //
        // The epoch is bumped for EVERY event, including `SIGNED_OUT` and including one that
        // delivers the same identity again. It does not describe the identity; it records that the
        // listener has spoken, which is the only thing an in-flight bootstrap needs to know.
        authEventEpochRef.current += 1;
        adoptSessionIdentity(currentSession?.user?.id ?? null);
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          if (event === "INITIAL_SESSION") {
            await fetchProfile(currentSession.user.id);
          } else {
            // Use setTimeout to avoid Supabase client deadlock. Deferring the fetch is safe now:
            // `adoptSessionIdentity` has already invalidated the previous identity's authority, and
            // `fetchProfile` refuses to apply a result whose session is no longer live.
            setTimeout(() => fetchProfile(currentSession.user.id), 0);
          }
        }
        // A signed-out session needs no extra teardown: `adoptSessionIdentity(null)` did it.

        if (event === "INITIAL_SESSION") {
          setIsLoading(false);
        }
      }
    );

    // THEN check for existing session.
    //
    // The epoch is captured HERE, immediately before the request is started, so that anything the
    // listener (or `logout`) does from this instant onwards is visible as a change.
    const bootstrapEpoch = authEventEpochRef.current;

    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      const bootstrapUserId = currentSession?.user?.id ?? null;
      // `getSession()` answers with whatever session existed when it was CALLED. Anything newer
      // wins — a different account signing in, the SAME account signing out, or a `logout()` that
      // has not yet been echoed back as an event. Adopting a stale answer over any of those
      // reinstates the user, the session and the profile of an account that is no longer signed in.
      //
      // This is deliberately NOT an id comparison. `sessionUserIdRef.current === null` is both
      // "the listener has not spoken yet" and "the listener said SIGNED_OUT", and a bootstrap
      // carrying the pre-sign-out session cannot tell those apart from the id alone.
      if (authEventEpochRef.current !== bootstrapEpoch) {
        setIsLoading(false);
        return;
      }
      adoptSessionIdentity(bootstrapUserId);
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) {
        await fetchProfile(currentSession.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, adoptSessionIdentity]);

  // ── Impersonation authority ───────────────────────────────────────────────────────────────────
  //
  // Restoring a "View As" is an AUTHORITY decision and must be re-proved on every load. Three
  // rules, all fail-closed:
  //
  //  1. The stored intent must be ADDRESSED TO the account now holding the session. `localStorage`
  //     is scoped to the origin, not to the account, so a pointer parked by operator X outlives X
  //     signing out and is still there when Y signs in on the same browser. A pointer with no
  //     recorded owner — every legacy payload — is unattributable and is refused by the reader.
  //  2. The REAL, database-backed profile must say `is_super_admin === true`. `profile` here is the
  //     real one — the provider only swaps in `impersonatedUser` when building the context value.
  //     This is what stops a forged storage payload from elevating an ordinary Agent.
  //  3. The target is RE-FETCHED from `profiles` by id. Nothing about the viewed user (role,
  //     organization, super-admin flag) is ever taken from storage. RLS confines this read to the
  //     Super Admin's own organization, so a target outside it simply does not resolve.
  //
  // Anything that fails — not a Super Admin, target missing, deleted, malformed, or a query error —
  // clears both the pending candidate and the stored pointer, leaving the session on its real
  // profile. A demotion or an organization move therefore cannot be outlived by stale storage.
  useEffect(() => {
    if (!pendingImpersonation) return;
    // Wait for the real profile; `null` here means "not loaded yet", not "not authorized".
    if (!profile) return;

    let cancelled = false;

    const refuse = (reason: string) => {
      if (cancelled) return;
      console.warn(`[Auth] Not restoring "View As": ${reason}`);
      setImpersonatedUser(null);
      setPendingImpersonation(null);
      clearStoredImpersonation();
    };

    // OWNERSHIP GATE — first, and BEFORE any lookup of the target is issued.
    //
    // A stored intent means "this operator chose to view that user". It says nothing to anybody
    // else, so whether the account now signed in is ALSO entitled to view that user is the wrong
    // question: the right one is whether this intent was addressed to them at all. Asking the
    // wrong one is what let a second Super Admin inherit the first one's parked target on a shared
    // browser — and it also meant a foreign pointer bought a `profiles` lookup before being
    // refused. Nothing is read from the database on behalf of an intent that is not ours.
    if (pendingImpersonation.ownerProfileId !== profile.id) {
      refuse("the stored intent was parked by a different account.");
      return;
    }
    const targetProfileId = pendingImpersonation.targetProfileId;

    if (profile.is_super_admin !== true) {
      refuse("the signed-in account is not a Super Admin.");
      return;
    }
    if (targetProfileId === profile.id) {
      refuse("the target is the signed-in account itself.");
      return;
    }
    // The trusted profile must belong to the CURRENT session. Between a session replacement and its
    // deferred profile fetch it belongs to the previous account, and a restore decided from it
    // would be authorised by an identity that is no longer signed in.
    const sessionAtStart = sessionUserIdRef.current;
    // The capture is load-bearing (the supersede check below reads it); the comparison itself is
    // belt and braces, since `adoptSessionIdentity` has already nulled the profile in that case.
    if (!sessionAtStart || profile.id !== sessionAtStart) return;
    const genAtStart = authorityGenRef.current;

    void (async () => {
      // A transport-level failure THROWS rather than returning `{ error }`. Unwrapped, inside this
      // fire-and-forget async IIFE, that became an unhandled rejection: the pointer was never
      // cleared and every reload retried the same doomed restore.
      let data: unknown = null;
      try {
        const res = await supabase
          .from("profiles")
          .select("*")
          .eq("id", targetProfileId)
          // The tenant boundary is expressed in the QUERY, not left to RLS or to the global
          // uniqueness of a UUID (AGENT_RULES §3). A pointer to a foreign profile resolves to no
          // row here regardless of what any policy would have returned.
          .eq("organization_id", profile.organization_id)
          .maybeSingle();
        if (cancelled) return;
        if (res.error) {
          refuse(`the target could not be read (${res.error.message}).`);
          return;
        }
        data = res.data;
      } catch (e) {
        if (cancelled) return;
        refuse(`the target could not be read (${e instanceof Error ? e.message : String(e)}).`);
        return;
      }

      if (cancelled) return;
      // SUPERSEDED — silently. `refuse()` would clear storage, and storage may already belong to a
      // newer activation that started while this restore was in flight.
      if (sessionUserIdRef.current !== sessionAtStart || authorityGenRef.current !== genAtStart) {
        console.warn('[Auth] Discarding a "View As" restore: a newer session or request superseded it.');
        // The PENDING POINTER must go, even though storage must not: this effect is keyed on
        // [pendingImpersonation, profile], so leaving it set means the next profile change —
        // a token refresh, a replayed INITIAL_SESSION — re-runs the whole restore and overwrites the
        // target the operator actually chose. Storage is left alone because a newer activation may
        // already own it.
        setPendingImpersonation((cur) => (cur === pendingImpersonation ? null : cur));
        return;
      }
      const restored = profileRowToImpersonationProfile(data);
      if (!restored) {
        refuse("the target is missing, deleted, or lacks a scoping identity.");
        return;
      }
      // Explicit tenant check, not inherited from RLS. `profiles_select_org` /
      // `super_admin_own_org` already confine a Super Admin to their home organization, but
      // AGENT_RULES §3 requires the query path to constrain this itself rather than represent a
      // policy as the application's boundary. Without it, a stored pointer to a foreign profile
      // would move the effective organization if that policy ever widened.
      if (restored.organization_id !== profile.organization_id) {
        refuse("the target is outside the signed-in account's organization.");
        return;
      }
      setImpersonatedUser(restored);
      setPendingImpersonation(null);
    })();

    return () => { cancelled = true; };
  }, [pendingImpersonation, profile]);

  /**
   * A live impersonation is revoked the moment the real account stops being ALLOWED to hold it.
   *
   * Watching `is_super_admin` alone was too narrow to be the safety net an asynchronous activation
   * needs: it never fired when the real profile became `null`, and never when a DIFFERENT account
   * took over the session — including another Super Admin, in another organization, who would then
   * inherit a target validated against the previous account's tenant.
   *
   * `profile === null` is deliberately NOT treated as a revocation on its own: it is also the
   * transient state while the profile is still loading, and both sign-out paths already clear the
   * impersonation explicitly. What is revoked here is a real profile that no longer qualifies.
   */
  useEffect(() => {
    if (!impersonatedUser || !profile) return;
    const reason =
      profile.is_super_admin !== true
        ? "the signed-in account is no longer a Super Admin"
        : profile.organization_id !== impersonatedUser.organization_id
          ? "the signed-in account is no longer in the viewed user's organization"
          : profile.id === impersonatedUser.id
            ? "the signed-in account is now the viewed account itself"
            : null;
    if (!reason) return;
    console.warn(`[Auth] Ending "View As": ${reason}.`);
    setImpersonatedUser(null);
    clearStoredImpersonation();
  }, [profile, impersonatedUser]);

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
    } else {
      // No session, or no profile to build against — including the window `adoptSessionIdentity`
      // opens on every identity change, when the real profile is deliberately null. Without this
      // the flag latches ON and `AuthProvider` renders "Loading your agency" INSTEAD of its
      // children, blanking the whole application until a reload.
      setIsBuildingOrganization(false);
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

  /**
   * Sign out. LOCAL AUTHORITY IS REVOKED FIRST, SYNCHRONOUSLY, BEFORE THE FIRST AWAIT.
   *
   * `supabase.auth.signOut()` is a network round-trip. Tearing down after it left a window — the
   * whole duration of that request — in which the user had pressed "Log out" and the provider
   * still held a live Super Admin profile, a live impersonation, an un-bumped authority
   * generation and a stored pointer. An activation or a stored-pointer restore that was already in
   * flight would re-check `realProfileRef` / `authorityGenRef`, find them exactly as it left them,
   * and COMMIT — installing a "View As" into a session the user had already ended. The teardown
   * that arrived afterwards could not undo an activation it had never seen coming.
   *
   * Intent is expressed the instant it is known, so everything below runs before anything is
   * awaited: the two counters supersede every in-flight attempt, and the identity, the effective
   * profile, the pending restore and the stored pointer all go at once.
   *
   * FAIL-CLOSED on a rejecting `signOut()`. None of this is rolled back if the remote call fails.
   * A failed sign-out means the refresh token may still be live at the server, which is a reason to
   * hold LESS authority in this tab, not more; the error propagates so the caller can surface it,
   * and the local session stays revoked either way. The `SIGNED_OUT` event, if it ever arrives, is
   * a no-op: `adoptSessionIdentity` is idempotent.
   */
  const logout = useCallback(async () => {
    sessionUserIdRef.current = null;
    // Supersede every in-flight activation and restore, and invalidate any bootstrap `getSession()`
    // still in flight so its (pre-logout) answer cannot resurrect the session that just ended.
    authorityGenRef.current += 1;
    authEventEpochRef.current += 1;
    setUser(null);
    applyRealProfile(null);
    setSession(null);
    setImpersonatedUser(null);
    setPendingImpersonation(null);
    clearStoredImpersonation();

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, [applyRealProfile]);

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
    if (row) applyRealProfile(row as unknown as Profile);
    else applyRealProfile((prev) => (prev ? { ...prev, ...data } : prev));
  }, [user, applyRealProfile]);

  /**
   * Direct activation — SERVER-AUTHORITATIVE.
   *
   * The argument is a POINTER, not a profile: only its id is read, and every scoping field is then
   * read back from `profiles`. Mapping the caller's own object was the defect this replaces — the
   * real caller was authenticated correctly, but the target's role, status, organization and
   * super-admin flag all came from the argument, so a candidate claiming `role: "Admin"` over a
   * database row that says `role: "Agent"` produced an organization-wide effective viewer.
   *
   * Every gate the RESTORE path applies is applied here too, against the same server row. The two
   * are the only ways an impersonation can begin, and a check present on one but not the other is
   * not a check at all.
   */
  const startImpersonation = useCallback(async (target: unknown): Promise<boolean> => {
    const refuse = (reason: string) => {
      console.error(`[Auth] Refusing to impersonate: ${reason}`);
      return false;
    };

    // The ONLY field read from the argument.
    const rawId =
      typeof target === "string"
        ? target
        : target && typeof target === "object" && !Array.isArray(target)
          ? (target as { id?: unknown }).id
          : undefined;
    const targetId = typeof rawId === "string" ? rawId.trim() : "";
    if (!targetId) return refuse("no target profile id was supplied.");

    const sessionAtStart = sessionUserIdRef.current;
    if (!sessionAtStart) return refuse("there is no authenticated session.");

    // AUTHORITY GATE — the trusted, database-backed profile of the REAL session user decides this,
    // never a prop, never storage, never the effective profile. `profile` is the real one here
    // (the context exposes it as `realProfile`; `profile` is only swapped in the provider value).
    if (profile?.is_super_admin !== true) {
      return refuse("the signed-in account is not a Super Admin.");
    }
    if (!profile.organization_id) {
      return refuse("the signed-in account has no organization.");
    }
    if (targetId === profile.id) {
      return refuse("the target is the signed-in account itself.");
    }
    // The trusted profile must belong to the CURRENT session, checked BEFORE any query is issued.
    // In the window between a session replacement and its deferred profile fetch, `profile` is the
    // previous account's — and authorising from it is exactly the defect this closes.
    // Belt and braces, stated honestly: `adoptSessionIdentity` clears the real profile on every
    // identity change, so `profile?.is_super_admin !== true` above already refuses here and
    // deleting these three lines breaks no test. Kept as the explicit statement of the rule the
    // contract asks for — a profile that predates the live session authorises nothing, not even a
    // query.
    if (profile.id !== sessionAtStart) {
      return refuse("the trusted profile does not belong to the current session.");
    }

    // GENERATION. Bumped only once the request is known to be well-formed and authorised, so an
    // activation refused for a malformed argument or a dead session cannot cancel a legitimate one
    // already in flight. From here on it expresses the newest intent: it supersedes any older
    // activation and any pending stored-pointer restore, so whichever target was REQUESTED last
    // wins regardless of the order the responses come back in.
    const genAtStart = (authorityGenRef.current += 1);

    // The tenant boundary is expressed in the QUERY, not left to RLS or to the global uniqueness
    // of a UUID (AGENT_RULES §3). A target outside the real account's organization resolves to no
    // row here regardless of what any policy would have returned.
    // The supabase client returns `{ error }` for a PostgREST error but THROWS for a transport-level
    // failure (DNS, TLS, an aborted fetch). Both are "unreadable target", and neither may escape as a
    // rejection: callers treat this as a boolean, so a throw would become an unhandled rejection that
    // navigates nowhere and tells the user nothing.
    let data: unknown = null;
    try {
      const res = await supabase
        .from("profiles")
        .select("*")
        .eq("id", targetId)
        .eq("organization_id", profile.organization_id)
        .maybeSingle();
      if (res.error) {
        // An unreadable target is a refusal, never a fall-back to whatever the caller passed in.
        return refuse(`the target could not be read (${res.error.message}).`);
      }
      data = res.data;
    } catch (e) {
      return refuse(`the target could not be read (${e instanceof Error ? e.message : String(e)}).`);
    }

    // RE-CHECK, in the order that matters. Everything above was decided from a pre-await snapshot.
    //
    // The SESSION check is the load-bearing one: it is the only thing that catches a `SIGNED_IN`
    // replacement, because the deferred profile fetch means the profile still matches ITSELF while
    // the session has already moved on. The GENERATION check catches a newer activation, a
    // `logout()` and a `stopImpersonation()`. The profile check then catches a demotion or an
    // organization move within one unchanged session.
    // Belt and braces, stated honestly: `adoptSessionIdentity` bumps the generation on every
    // identity change, so the check below already catches this and deleting these three lines
    // breaks no test. Kept because it names the actual condition — if the generation bump were ever
    // moved or narrowed, this is the check that would still hold the line.
    if (sessionUserIdRef.current !== sessionAtStart) {
      return refuse("the authenticated session changed while the target was being verified.");
    }
    if (authorityGenRef.current !== genAtStart) {
      return refuse("a newer request superseded this activation.");
    }
    const live = realProfileRef.current;
    if (
      !live ||
      live.id !== profile.id ||
      live.is_super_admin !== true ||
      live.organization_id !== profile.organization_id
    ) {
      return refuse("the signed-in account changed while the target was being verified.");
    }

    const resolved = profileRowToImpersonationProfile(data);
    if (!resolved) {
      return refuse("the target is missing, not an eligible active account, or lacks a scoping identity.");
    }
    // Belt and braces: the query already constrains this, so a mismatch would mean the row shape
    // changed underneath us.
    if (resolved.organization_id !== profile.organization_id) {
      return refuse("the target is outside the signed-in account's organization.");
    }
    if (resolved.id === profile.id) {
      return refuse("the target is the signed-in account itself.");
    }

    setImpersonatedUser(resolved);
    // Persisted only AFTER the server row validated, and only the two identifiers. Role and
    // organization are re-derived from the server on reload; the OWNER half records whose intent
    // this is, so no other account that later signs in on this browser can pick it up.
    writeStoredImpersonationTarget(profile.id, resolved.id);
    return true;
  }, [profile]);

  const stopImpersonation = useCallback(() => {
    // Newer intent: anything still in flight must not be able to re-establish what this ends.
    authorityGenRef.current += 1;
    setImpersonatedUser(null);
    setPendingImpersonation(null);
    clearStoredImpersonation();
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
