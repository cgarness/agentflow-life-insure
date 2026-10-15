/* eslint-disable react-refresh/only-export-components -- mirrors the real context module (a hook plus a provider); fixture only */
import React from "react";
import { FIXTURE } from "./supabase";

/** Fixture-only `@/contexts/AuthContext`: one synthetic real agent, never View As. */
const profile = {
  id: FIXTURE.actor, first_name: "Avery", last_name: "Agent", email: "agent@example.test", phone: null, role: "Agent",
  status: "Active", organization_id: FIXTURE.org, team_id: null, is_super_admin: false, platform_role: null,
  sms_notifications_enabled: false, push_notifications_enabled: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};
const value = {
  user: { id: FIXTURE.actor, email: profile.email, app_metadata: {}, user_metadata: {} },
  profile,
  realProfile: profile,
  session: { access_token: "fixture-token", user: { id: FIXTURE.actor } },
  isAuthenticated: true,
  isLoading: false,
  isBuildingOrganization: false,
  impersonatedUser: null,
  isImpersonating: false,
  login: async () => ({ id: FIXTURE.actor }),
  signup: async () => {},
  logout: async () => {},
  resetPassword: async () => {},
  updateProfile: async () => {},
  startImpersonation: async () => false,
  stopImpersonation: () => {},
};
export type Profile = typeof profile;
export const useAuth = () => value;
export const AuthProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
