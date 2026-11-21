import type { NumberType } from "./contracts.ts";

export type SetupJob = {
  purchase_id: string;
  kind: "trust" | "sms";
  lease_token: string;
  organization_id: string;
  actor_id: string;
  account_sid: string;
  phone_number_id: string;
  phone_sid: string;
  phone_number: string;
  number_type: NumberType;
  attempts: number;
};

export type SetupOutcome = {
  state: "complete" | "waiting" | "retry" | "review";
  code: string;
  retrySeconds?: number;
  profileSid?: string;
};
