/* eslint-disable react-refresh/only-export-components -- mirrors the real context module (a hook plus a provider); fixture only */
import React from "react";

/** Fixture-only `@/contexts/TwilioContext`: no voice device, no selected caller ID (agency fallback). */
export type MakeCallOptions = Record<string, unknown>;
const value = { selectedCallerNumber: null, status: "idle", callState: "idle", errorMessage: null };
export const useTwilio = () => value;
export const TwilioProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
