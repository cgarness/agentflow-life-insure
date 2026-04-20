# Telnyx Migration Audit Report

This document reports all active and inactive references to Telnyx across the AgentFlow codebase to assist in planning the migration to Twilio.

## Section 1: Edge Functions
Located in `supabase/functions/`.

### Active Telnyx Functions
* **telnyx-webhook**
  * **File path:** `supabase/functions/telnyx-webhook/index.ts`
  * **Purpose:** Core Webhook handler receiving all call state events from Telnyx and managing inbound WebRTC routing.
  * **API called:** `POST /v2/calls` (bridge Dial to SIP), `POST /v2/calls/{id}/actions/record_start`
  * **Events handled:** `call.initiated`, `call.answered`, `call.hangup`, `call.recording.saved`. (Explicitly ignores AMD events: `call.machine.detection.ended`, `call.machine.greeting.ended`, etc).
  * **Request payload shape:** Depends on Webhook schema. E.g. `call_control_id`, `call_session_id`, `direction`, `client_state`, `from`, `to`, `recording_urls`.
  * **Response payload shape:** Responds `200 { received: true }`.
  * **Auth method:** Ed25519 Webhook validation using `TELNYX_PUBLIC_KEY`. Fetches API keys from Vault/DB.
  * **Webhook URL registration:** Standard webhook URL registered in the Telnyx Mission Control Portal.
  * **Recording logic:** Reads `phone_settings.recording_enabled`. If true, `handleCallAnswered` triggers `record_start`. Merges `recording_url` into the `calls` table on `call.recording.saved`.
  * **AMD logic:** Deprecated / deliberately ignored in the switch to single-legged WebRTC.

* **telnyx-token**
  * **File path:** `supabase/functions/telnyx-token/index.ts`
  * **Purpose:** Provisions a Telephony Credential for the agent and generates a temporary WebRTC token.
  * **API called:** `GET /v2/telephony_credentials`, `POST /v2/telephony_credentials`, `POST /v2/telephony_credentials/{id}/token`
  * **Auth method:** Telnyx API Key (Bearer).

* **telnyx-buy-number**
  * **File path:** `supabase/functions/telnyx-buy-number/index.ts`
  * **Purpose:** Purchases a phone number when an agency buys a number via the dashboard.
  * **API called:** `POST /v2/number_orders`

* **telnyx-search-numbers**
  * **File path:** `supabase/functions/telnyx-search-numbers/index.ts`
  * **Purpose:** Queries available phone numbers matching area codes/localities.
  * **API called:** `GET /v2/available_phone_numbers`

* **telnyx-sync-numbers**
  * **File path:** `supabase/functions/telnyx-sync-numbers/index.ts`
  * **Purpose:** Pulls all organization numbers from Telnyx and syncs them to the `phone_numbers` table.
  * **API called:** `GET /v2/phone_numbers` and `PATCH /v2/phone_numbers/{id}` (to assign connection IDs).

* **telnyx-sms**
  * **File path:** `supabase/functions/telnyx-sms/index.ts`
  * **Purpose:** Sends outbound SMS messages.
  * **API called:** `POST /v2/messages`

* **telnyx-check-connection**
  * **File path:** `supabase/functions/telnyx-check-connection/index.ts`
  * **Purpose:** Verifies whether an API key provided in settings is valid.
  * **API called:** `GET /v2/messaging_profiles`

* **recording-proxy**
  * **File path:** `supabase/functions/recording-proxy/index.ts`
  * **Purpose:** Streams back recording MP3/WAV files for the React frontend audio player, ensuring authorization.
  * **API called:** `GET /v2/recordings?filter[call_control_id]=...`

* **inbound-call-claim**
  * **File path:** `supabase/functions/inbound-call-claim/index.ts`
  * **Purpose:** Called by the frontend when an agent answers an inbound WebRTC ring to claim ownership of the DB `calls` row. No Telnyx APIs called.

### Legacy / Dead Functions
* **dialer-start-call**: Once used for two-legged dial operations. Uses `POST /v2/calls`. Not invoked directly by the current WebRTC frontend.
* **start-call-recording**: Older decoupled approach to recording? Exists but the core `record_start` logic has been moved inside `telnyx-webhook`'s `call.answered` handler.
* **telnyx-amd-start**: Directory exists, but it's empty (dead code).
* **dialer-hangup**: Calls `POST /v2/calls/{id}/actions/hangup`. Fetched by the frontend (`TelnyxContext`) to sweep orphan/stuck calls.

---

## Section 2: Frontend — WebRTC & Call Control

* **`src/lib/telnyx.ts`**
  * **What it does:** Core initialization of the Telnyx RTC class, exporting the global instance, and wiring event listeners for inbound rings.
  * **SDK imported:** `@telnyx/webrtc`
  * **SDK methods used:** `TelnyxRTC({ login, password })`, `client.connect()`, `client.newCall()`, `call.hangup()`. Uses `navigator.mediaDevices.getUserMedia` for Mic prep.
  * **State managed:** Single `telnyxClient` instance, Pub/Sub system for incoming calls. 
  * **Events listened to:** `telnyx.notification` and `notification` (where `branch === 'incoming'`).

* **`src/contexts/TelnyxContext.tsx`**
  * **What it does:** React Context managing the application-wide telephony state for Dashboard/Dialer usage.
  * **SDK imported:** Handled via helper functions imported from `src/lib/telnyx.ts`.
  * **State managed:** Tracks `status` (idle/ready/error), `callState` (ringing, active, connected, ended), `callDuration`, `currentCall` (telnyx session).
  * **SDK methods used:** Wraps internal `makeCall`, `hangUp`.
  * **Edge connections:** Calls Edge Functions via native frontend `fetch`: `/inbound-call-claim` on manual ring answer, `/dialer-hangup` to kill stranded active sessions. Initiates token request via `supabase.functions.invoke('telnyx-token')`.

* **`src/pages/DialerPage.tsx`**
  * **What it does:** The main Power Dialer UI. Combines queue iteration routines with WebRTC state to autodial leads.
  * **State managed:** Utilizes contextual objects like `telnyxCallState`, `telnyxCurrentCall`, `telnyxStatus`. Owns separate refs like `telnyxCallStateRef` and `wasInboundSessionRef`.
  * **Events:** Syncs UI components visually based on `ringing`, `active`, `ended`.
  * **Edge connections:** No fetch manually. Relies on Context.
  * **Recording UI:** Monitors the arrival of `recording_url` post wrap-up to swap timeline visual cards (no live visualization).
  * **AMD UI:** Displays no explicit AMD detection. Uses strict variables `amd_enabled: false`.

* **`src/components/layout/FloatingDialer.tsx`**
  * **What it does:** Global application dock overlay enabling one-off outbound dialing. Binds Context endpoints directly.

* **`src/components/dialer/IncomingCallModal.tsx`**
  * **What it does:** Listens specifically to inbound ring payloads to prompt the visual Answer or Decline buttons globally.

* **`src/components/ui/RecordingPlayer.tsx`**
  * **What it does:** A web audio player requesting proxied, signed downloads of MP3s securely hitting `/recording-proxy` with the associated Call Control IDs.

* **`src/components/settings/PhoneSettings.tsx`**
  * **What it does:** Component layout enabling administrators to manage Telnyx configurations, including credentials, purchasing endpoints via Edge Functions, and listing registered lines.
  * **Edge connections:** Subscribes via `invoke` to `/telnyx-token`, `/telnyx-search-numbers`, `/telnyx-buy-number`, `/telnyx-sync-numbers`.

---

## Section 3: Database Schema

* **Table: `telnyx_settings`**
  * **`api_key`**: (Text) The root Telnyx Developer Access key.
  * **`connection_id`**: (Text) The WebRTC or specific Credential UUID linked in Mission Control.
  * **`call_control_app_id`**: (Text) The root Call Control Webhook app.
  * **`sip_username`** & **`sip_password`**: (Text) The generated target profiles mapped to the credentials.
  * **Foreign Keys:** Maps heavily per `organization_id` isolated via RLS.

* **Table: `calls`**
  * **`telnyx_call_control_id`**: (Text) Granular ID specific to the PSTN legs; crucial to POST `/v2/calls/{id}/actions/*`.
  * **`telnyx_call_id`**: (Text) Top level Call Session UUID mapped directly cross-webhook.
  * **`recording_url`**: (Text) Stores direct URI endpoints retrieved post `call.recording.saved`.

* **Table: `messages`**
  * **`telnyx_message_id`**: (Text) Keeps exact traces of text messaging references payloaded via endpoints.

* **Table: `phone_numbers`**
  * **`phone_number`**: Stores the raw E.164 strings imported directly from Telnyx queries.

* **Table: `profiles`**
  * **`sip_username`**: (Text) The dynamic webhook target (usually `gencredXXXXX`) generated securely by `/telnyx-token` to connect inbound API dials successfully matching the true browser WebRTC ID.

---

## Section 4: Environment Variables & Secrets

* **Deno / Edge Functions Environment:**
  * **`TELNYX_PUBLIC_KEY`**: Sits hidden either in Vault or Supabase specific Environments. Used exclusively to decipher Ed25519 cryptography verifying the webhook's source requests internally.
  * **`TELNYX_API_KEY`**: Fallback environment variable usually supplanted inherently by actual Database queries for `telnyx_settings`.
* **Frontend Web Setup / `.env`:**
  * **`VITE_TELNYX_SIP_USERNAME`** & **`VITE_TELNYX_SIP_PASSWORD`**: Embedded heavily within local contexts (`.env`) for offline/standalone dev-env `lib/telnyx` testing injections instead of JWT fetching algorithms.
* **App/Connection References:** Root Call Control UUIDs and API keys are mapped dynamically via `supabase` row lookups on tables explicitly preventing codebase hardcodes.

---

## Section 5: Type Definitions & Shared Interfaces

* **Zod Schemas:** (Validation is typically passed statically). Most validations restrict frontend entry points but don't parse standard webhook schemas dynamically with tools like Zod here.
* **TypeScript Types:** (`src/integrations/supabase/types.ts` & others)
  * Implements rigid types enforcing `Database['public']['Tables']['calls']['Row']` where references explicitly include exact key fields: `telnyx_call_control_id: string | null`, `telnyx_call_id: string | null`, `telnyx_error_code: string | null`, and `recording_url: string | null`.

---

## Section 6: Call Flow Walkthrough

### Outbound Call Flow
1. **Agent Action:** Clicks "Dial" pointing at a Prospect.
2. **Setup:** The UI calls `telnyxMakeCall` logic internally wrapped in Context variables.
3. **Trigger:** `lib/telnyx.makeCall` fires `@telnyx/webrtc`'s native `.newCall()` sending standard protocol WebRTC/RTP signals up via `sip.telnyx.com`. 
4. **Initial Catch:** The backend `telnyx-webhook` grabs `call.initiated` from Telnyx REST. Decoding the `client_state` base64 property provided by the browser extracts the exact DB `UUID`. Applies `status: ringing` inside the DB.
5. **Connection / Answer:** Prospect answers PSTN side. Telnyx translates bridging over; sending `call.answered`. 
6. **Recording Loop:** The Webhook validates `phone_settings.recording_enabled` is active. Triggers HTTP POST returning `api.telnyx.com/v2/calls/{cID}/actions/record_start`. 
7. **Termination Logic:** The agent clears, wrapping the call. Call drops, emitting `call.hangup` -> `telnyx-webhook` processes Duration logic into metrics -> logs Activity onto Contact profiles. 
8. **Asynchronous Finalizing:** Few seconds pass. Telnyx transmits `call.recording.saved`. The Webhook grabs the internal dictionary properties parsing MP3/WAV links, placing variables on `calls.recording_url`. 

### Inbound Call Flow
1. **Customer Action:** External Phone hits an Agency DID (Managed via `PhoneSettings`).
2. **Capture:** Telnyx automatically emits `call.initiated` straight to `/telnyx-webhook`.
3. **Lookup Logic:** Webhook cross-references the incoming DID, discovers `organization_id`, isolates associated `telnyx_settings`. 
4. **Bridged Initiation:** Crucially - executing a `POST /v2/calls` back outward. Linking the WebRTC layer via raw SIP routing syntax `sip:<recent_profile.sip_username>@sip.telnyx.com` combined natively with `link_to: original_PSTN_call_control_id`, forcing audio connection endpoints internally.
5. **UI Popup:** The browser interprets `branch === "incoming"` inside its `notification` subscriber. Emits `IncomingCallModal`. 
6. **Accepting Session:** Agent answers the ring. The SIP connects via SDK. The browser then hits our `/inbound-call-claim` edge function telling standard PostgreSQL to map their `agent_id` back onto the existing database session row instantiated by the webhook. 
7. Call behaves uniformly outward identically onward.

---

## Section 7: Feature Inventory

| Feature | Status | Notes |
|---|---|---|
| Outbound dialing | Working | Fully integrated over WebRTC. |
| Two-legged bridge | Not working | Purposely eschewed for low-latency Single-leg setups. |
| Call recording | Working | Triggered dynamically via backend HTTP commands. Fetched safely natively. |
| AMD (Ans. Machine) | Not working | Feature deliberately disabled. Codebase specifically ignores `call.machine.*` Webhook pings. |
| Inbound calls | Working | Custom REST logic mapped via `telnyx-webhook` bridging WebRTC dynamically locally. |
| Call transfer | Not working | No UI mapped. |
| Voicemail drop | Not working | Missing. |
| DTMF (keypad tones) | Partial | Supported naturally by libraries, lacking extensive UI. |
| Multiple concurrent calls | Not working | Forced iteration logic restricting variable states to one `active` Context. |
| Number management | Working | `PhoneSettings` executes REST provisioning inherently. |
| Caller ID configuration | Working | Outbound DID toggled dynamically over Context definitions. |
| Call dispositions | Working | Functions uniformly locally. |
| Call notes | Working | Operable over `contact_activities`. |
| Call duration tracking | Working | Math executed locally by `telnyx-webhook` post-hangup statuses. |
| Agent presence/status | Partial | Relies externally on timeline data constraints. |

---

## Section 8: Risks & Warnings for Twilio Migration

* **Inbound SIP Routing Differences:** The current architecture accomplishes inbound WebRTC routing by explicitly dispatching `POST /v2/calls` to identically match dynamic SIP identities mapping back to UI endpoints natively (`sip:username@sip.telnyx.com`), linking properties natively with `link_to: id`. To replicate this single-legged style with Twilio Voice JS SDK (WebRTC), implementations require creating **TwiML Apps**, resolving logical flow endpoints rendering XML configurations `<Dial><Client>Bob</Client></Dial>` rather than raw SIP routing structures.
* **Webhook Signature Complexity Ed25519:** Code securely handles payload authentications exclusively utilizing raw key pairs evaluating `telnyx-signature-ed25519` hashes embedded within Payload variables mapping toward `TELNYX_PUBLIC_KEY`. Changing to Twilio dictates restructuring evaluations validating `X-Twilio-Signature` utilizing HMAC-SHA1 tokens safely.
* **Database Entanglements:** The schema natively tracks provider-explicit variables locking systems. References containing schema columns like `calls.telnyx_call_id`, `calls.telnyx_call_control_id` or explicit `telnyx_settings` will require database Migrations and structural renames logic.
* **`client_state` Tracking Logic:** Overcoming standard `telnyx-webhook` operations dictates sending a `client_state` base64 value across WebRTC streams for server mapping identifiers natively. Equivalencies integrating securely like Twilio's `customParameters` pass structure differences.
* **Oversized Webhook Control Flow:** The entire `/telnyx-webhook` currently governs a monolithic architecture reaching over 1000 lines, blending user identifications, Multi-Tenant lookup variations, Auth keys integrations, Call tracking calculations, and WebRTC SIP Dial execution. Rewriting these instances in Twilio requires modular splits for longevity.
* **Dead Code Cleanups:** Do not duplicate abandoned endpoints such as `/telnyx-amd-start` or `/dialer-start-call` into the Twilio translation scopes.
* **Recording Variable Extractions:** Fetching Recording URIs parses arbitrary array strings depending on event executions natively (like `recording_urls.mp3` or `public_recording_urls`). Updating ensures we track uniform endpoints directly mapped to Twilio's standardized `RecordingUrl` injections.
