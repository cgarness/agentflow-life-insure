# CG Financial SMS activation — October 8, 2026 UTC

Chris's October 7 instruction to get SMS working authorizes the prepared release and five-sender activation. This supersedes the earlier pending-release approval notes. SMS must remain paused until credentials, workers and authentic individual registration events are verified; then a controlled consenting-recipient test establishes actual delivery/STOP/HELP behavior.

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

Current access limitation: Supabase connector supports migrations/functions but not Edge secrets; dashboard secret administration requires secure sign-in. Complete the authorized setup that does not require that sign-in first.

Account-specific provisioning SQL is retained byte-for-byte in Supabase hosted migration 20261008022519 (SHA-256 23fd9abf657277d386eade6861c31d8418bc5e5e62ea1eb9da79af704f359d91). It is not published in GitHub because repository secret protection rejects the Twilio Account SID. The reviewed schema migrations and all application source are published; no credential or account identifier is encoded to bypass this rule.

At 02:36 UTC all five attachments were read back, callbacks unchanged, and the genuine signed number-registration.pending event for every selected sender was received. Event sink DG9d0ece22b1edafde710778f66b17b1e4 and subscription DF20da66efdfba81d476eb054e5c199ef7 subscribe to 15 current published compliance event schemas. Receipt of a pending event is not registration success.

By 02:39 UTC Twilio emitted successful-registration events for all five senders. Hosted migration 20261008024411 processed the authenticated inbox through the existing number-event RPC; all five are registered, with zero unprocessed events. SMS remains paused and no dispatch exists.
