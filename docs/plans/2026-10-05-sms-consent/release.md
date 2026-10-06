# CG Financial SMS integration release review

Status: local implementation prepared; **not production-ready for activation**. No production migration, function deployment, secret, cron, registration submission, provider fee, sender attachment or message was created. Chris explicitly approved GitHub publication, draft PRs and CI on October 6. Production actions still require a separately reviewed release.

## Review branches

- AgentFlow: `codex/cg-financial-sms-consent-20261005`, repository `cgarness/agentflow-life-insure`.
- Underwriter Verified: `codex/agentflow-consent-bridge-20261005`, repository `cgarness/underwriter-verified`.
- UV paired source: `d2a9c3266dec05211c54d5a86c10ef3b947d5922`. The AF verification workflow pins this exact commit.
- See `verification.md` for passed checks and explicit native/browser/provider limits. See `manifest.json` for the implementation file and migration hashes.

## Behavior

The website transaction creates durable consent events and an outbox. A signed worker delivers each request's two purpose decisions to the matching AF agency; no leads are automatically created. New purposes enqueue the matching CG Financial enrollment confirmation. Ordinary recurring/manual/workflow SMS stays blocked until confirmation acceptance. Old events/workflows do not cross activation, and confirmations older than 30 minutes require review rather than mass replay.

Every enrolled-agency manual, workflow and confirmation dispatch uses the shared gate: current actor/contact where relevant, exact selected agency sender, pinned registered provider account/service, explicit purpose, fresh website eligibility, agency DNC, local suppression and durable dispatch receipt. Prepared work checks current recipient again before handoff; converted leads require opening/reviewing the client record. Disabling registration actions cannot restore legacy sending. Provider timeout or history-persistence uncertainty holds the attempt for reconciliation.

Inbound signatures use the owning account's verified credential and bind AccountSid, MessageSid, destination and MessagingServiceSid. STOP variants/OptOutType and direct 21610 rejections create durable agency suppression even without a contact. Local blocking precedes website relay and ordinary history writes. HELP/START do not enroll or clear suppression; no duplicate provider opt-out reply is generated. The authenticated `sms-consent-status` revoke action supports an operator-recorded non-keyword opt-out, bound to the accessible contact and real actor. Its current UI exposes readiness; a dedicated operator opt-out control is not included.

## Exact deployment scope — separate approval required

| System | Project | New migration | Edge functions |
| --- | --- | --- | --- |
| AgentFlow | `jncvvsvckxhqgqvkppmj` | `20261005194649_sms_consent_dispatch.sql` | New `sms-consent-events`, `sms-consent-worker`, `sms-consent-status`; updates `twilio-sms`, `twilio-sms-webhook`, `workflow-executor` |
| UV | `jzdzeevjpootbeuniygx` | `20261005194718_agentflow_consent_bridge.sql` | New `agentflow-consent`, `consent-event-worker` |

Before requesting release approval: publish review branches, open draft PRs, pass exact-head native/browser CI, compare deployed Edge bundles with source, record preimages and migration checksums, and resolve the provider inventory. No migration automatically seeds a policy or activates texting. Apply only the two reviewed additive migrations, never all pending repository migrations or the already applied UV legal migration.

Backend/schema/functions precede frontend. Deploy the complete set of SMS paths before enforcement. The paired secrets are `SMS_BRIDGE_SECRET` (shared scoped HMAC key), AF `SMS_CONSENT_WORKER_TOKEN`, and UV `UV_CONSENT_WORKER_TOKEN`; their values are never published. Matching Vault names are `sms_consent_worker_token` and `uv_consent_worker_token`. Authenticated worker recovery runs every minute with monitored retries. Confirm real pg_net wake after commit before enabling relay.

Bind AF's confirmed CG Financial agency to UV profile `e7c2f35a-e215-4e9e-9492-176a344384eb`, `cg-financial/christopher-garness`. Verify normalized Christopher Garness / CG Financial identity. Install the independent enforced policy with sends paused. Establish the same reviewed activation watermark in both projects; keep sends paused until Brand/Campaign and sender readiness are independently verified. Coordinate a brief SMS pause for activation; voice stays unchanged.

## Five-number launch boundary

Only these previously selected agency numbers are candidates. Provider ownership/SMS capability/service membership/registration must be read back before attachment or activation.

| Number | Existing PN reference |
| --- | --- |
| +12162706473 | PN1982b5e219b25ff92daa123638bad549 |
| +19096108403 | PNe370ab9eccda90790e2a2a3d31df2fe5 |
| +12136676225 | PNc00214a3e0b1bb188890115f57c196c9 |
| +17143642905 | PNac5451ba0a09ce7cad8d0d56d020faa6 |
| +19162998778 | PN17e3b0257b58b736d0160b457eca2a80 |

The other 11 senders stay excluded from initial SMS activation. Support 909-775-6963 is not a launch sender. No number assignment, voice caller ID, forwarding, DNC implementation or routing change is authorized here.

## Remaining provider work

Use the private confirmed business packet for legal identity/EIN, website-only sources and sample messages. Inventory existing customer profiles, Trust Product/Brand/Campaign, owning account, Messaging Service and five PN resources before creating anything. The differing CRM account references are unresolved; no blocked Twilio login or human verification is bypassed. Obtain authorized provider access or a redacted inventory export. Confirm current route eligibility, fees, segments/volume, callback ownership and STOP/HELP text. Submit only after a separate concrete registration approval; attach five numbers only after their separate authorization and provider approval.

## Recovery

Pause `send_enabled` and UV relay, retain enforcement and all evidence/outbox/receipts. Do not delete STOP, weaken DNC ACLs, reset uncertain attempts or rerun old confirmations. Reconcile provider SIDs/status before deciding an attempt's outcome. If the provider accepted before STOP, the application cannot recall that message; there is no atomic transaction across AF, UV and Twilio. Fix forward, preserving all history and active voice operation.
