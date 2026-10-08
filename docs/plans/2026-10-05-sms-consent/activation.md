# CG Financial SMS activation — October 8, 2026 UTC

Chris's October 7 instruction to get SMS working and subsequent explicit approval authorize the prepared release, server credentials, five-sender activation and an informational test to his own confirmed phone. All five senders are now active. The live opt-in confirmation was delivered at 03:52 UTC on October 8. HELP/STOP return-message verification still requires Chris's phone replies.

The existing master account (verified owning account recorded in the private provider packet) owns approved Brand BNfcfb0b4cf4d48b6ca16336c44b6b6e7d (APPROVED/VERIFIED), service MG7fad5487a26f23727408342cc5db5346 and Campaign QE2c6890da8086d771620e9b13fadeba0b (VERIFIED, CTI94X9). Provider readback at 2026-10-08 02:22:13 UTC returned no Campaign errors. The separate agency subaccount and all voice routing remain intact.

Final five: +12162706473, +12136676225, +19162998778, +14632313033 and +15673645227. The older proposed +19096108403/+17143642905 remain in Conversations and are excluded. Exactly five existing numbers, no purchases or transfers.

Release order:
1. Apply the two byte-identical reviewed consent migrations and deploy all eight reviewed entry points with complete imports and custom authentication.
2. Apply guarded preparation migrations: map the approved resources and exact five existing sender records, turn independent consent enforcement on with sends paused, and map UV with relay disabled. Do not claim Embeddable onboarding entitlement or fabricate fee acceptance.
3. Configure Twilio Event Streams before attaching five numbers. Persist authentic signed number-registration events and process them with the existing service-only RPC. Membership alone never establishes registration.
4. Provision SMS_BRIDGE_SECRET in both projects, SMS_CONSENT_WORKER_TOKEN in AgentFlow, UV_CONSENT_WORKER_TOKEN in UV, and A2P_RECONCILE_SECRET in AgentFlow through Supabase secret management. Matching worker tokens go in Vault; configure authenticated one-minute recovery. No secret is written to git or client code.
5. Verify post-commit pg_net wake and recovery. Establish the same future activation watermark on both sides, verify selected registration readiness and provider response settings, and enable relay/sending. Do not enroll older website records or replay old workflows.
6. Release the reviewed frontend and preserve the newer Dialer redial fix. Verify exact production commit/deployment and conduct a controlled owned-recipient test after actual consent.

Recovery: pause sends and relay; retain enforcement, records, suppressions, outbox and dispatch receipts. Do not clear STOP or retry an uncertain provider request. Keep all voice assignments and other eleven senders unchanged.

Server credential setup is complete. Four separately generated scoped credentials are saved in Edge secrets, and the three worker credentials match their Vault entries. No credential value is included in this record.

Account-specific provisioning SQL is retained byte-for-byte in Supabase hosted migration 20261008022519 (SHA-256 23fd9abf657277d386eade6861c31d8418bc5e5e62ea1eb9da79af704f359d91). It is not published in GitHub because repository secret protection rejects the Twilio Account SID. The reviewed schema migrations and all application source are published; no credential or account identifier is encoded to bypass this rule.

At 02:36 UTC all five attachments were read back, callbacks unchanged, and the genuine signed number-registration.pending event for every selected sender was received. Event sink DG9d0ece22b1edafde710778f66b17b1e4 and subscription DF20da66efdfba81d476eb054e5c199ef7 subscribe to 15 current published compliance event schemas. Receipt of a pending event is not registration success.

By 02:39 UTC Twilio emitted successful-registration events for all five senders. Hosted migration 20261008024411 processed the authenticated inbox through the existing number-event RPC; all five are registered, with zero unprocessed events.

## Activated production state

| Change | Repository migration | Hosted migration |
| --- | --- | --- |
| AF authenticated SMS and A2P recovery | 20261008033044_cg_financial_sms_recovery.sql | 20261008033218 |
| UV authenticated outbox recovery | 20261008033052_cg_financial_consent_recovery.sql | 20261008033219 |
| UV normalizer server grant | 20261008034820_consent_bridge_normalizer_permission.sql | 20261008034841 |
| AF exact-five activation | 20261008035004_cg_financial_sms_activate.sql | 20261008035126 |
| UV future-event relay activation | 20261008035005_cg_financial_consent_activate.sql | 20261008035127 |

All three one-minute jobs are active; direct worker and post-commit pg_net probes return HTTP 200. AF sends and UV relay share `2026-10-08T03:52:00Z` as the activation watermark. Enforcement remains enabled. The account's `enrollment_verified_at` remains null; this release does not assert Embeddable onboarding entitlement or approve new provider charges.

Live verification found two integration defects before sending: Supabase removes `/functions/v1` before invoking Edge handlers, and the UV invoker RPC lacked EXECUTE on the phone normalizer. The exact two accepted paths still use the canonical public path in the HMAC; wrong paths, tampered bodies and replays fail. Only service_role gained the pure normalizer grant; anon/authenticated remain denied. Receiver bundles `agentflow-consent` and `sms-consent-events` were deployed as v3 and read back byte-identical.

The owned-recipient browser submission at 03:52:15 UTC recorded one informational grant and one marketing non-grant under disclosure `2026-10-05-policy-clarifications`. The transactional outbox delivered in one attempt; AF created one enrollment and one confirmation. Its shared dispatch path checked current consent twice and submitted from +12162706473. A separate authenticated Twilio Message-resource read returned **delivered**, no provider error, and the expected Messaging Service. One send exists; there was no duplicate or historical replay. Exact request/event/message IDs are retained in the private submission record.

The original website intake/two events remain intact. Website totals after this test are two intake requests and four purpose events. Marketing remains unconfirmed and unauthorized for the test recipient.

## Verification boundaries

The focused Deno regression covers public/runtime path acceptance and wrong-path/query/signature rejection. The paired SQL harness now reproduces production function ACLs and performs intake as anon before switching to the service role for the bridge. All schema/ACL migrations run; named production-only mapping, Vault/Cron and activation operations are excluded from a synthetic database and are verified with the hosted guarded migration/readback evidence above.

Controlled inbound HELP/STOP and agency-wide blocking across the other four senders remain pending authentic phone replies. No inbound event or consumer opt-out is fabricated. The application currently records provider acceptance; delivery for this test was verified directly against Twilio. Automatic final-delivery status callbacks are not implemented in this release. Signed-in manual-composer verification is not claimed by the automated enrollment test.
