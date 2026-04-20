export type TrustNumberRow = {
  id: string;
  phone_number: string;
  shaken_stir_attestation?: string | null;
  attestation_level?: string | null;
  trust_hub_status?: string | null;
  status?: string | null;
  twilio_sid?: string | null;
};
