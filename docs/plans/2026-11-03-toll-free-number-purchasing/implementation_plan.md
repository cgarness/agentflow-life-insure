# AgentFlow — Toll-Free Number Purchasing

**Prepared:** November 3, 2026, Pacific time

**Status:** IMPLEMENTED AND VERIFIED on the review branch — November 4, 2026 UTC; NOT released

**Repository:** cgarness/agentflow-life-insure

**Reviewed main:** 0e74428259275c9281518832747a627a4f635a80

**Production inspected read-only:** AGENTFLOW CRM / jncvvsvckxhqgqvkppmj

**Feature branch:** feat/toll-free-number-purchase-20261103. Implementation is local; its remote head and main were rechecked at the reviewed baseline after testing. No branch publication or deployment was triggered.

## 1. Approval boundary

Chris approved this plan after the read-only inspection and file manifest. Branch implementation, a pending migration, documentation and isolated tests are authorized. Main and the existing feature branch were rechecked at 0e744282; all six live bundle versions/hashes and the open PR list are unchanged from planning. No production operation is authorized by this build approval.

The exact database migration, complete Edge bundles, frontend release, and any actual number purchase/assignment/test call remain separately gated. Production data may never be used to unblock a test.

## 2. Inspection and conflict findings

Read AGENT_RULES.md, VISION.md, current WORK_LOG.md entries, the active purchase UI, TwilioContext caller-ID guards, the shared SMS authorization path, current Inbounds settings/RPCs, and the live Edge bundles below.

| Area | Verified finding | Plan decision |
|---|---|---|
| Source | Main 0e744282 includes Inbounds release and the latest metrics/navigation changes. | Build from current main and recheck before editing. |
| Work in progress | Reviewed filenames from 15 open PRs; none modifies NumberManagementSection or the two search/purchase handlers. | No direct purchase implementation conflict found. |
| Existing branch | feat/toll-free-number-purchase-20261103 is exactly main. | Reuse after approval if still unchanged; do not overwrite another author's subsequent work. |
| Related SMS work | Open PR #429 modifies START/consent/lifecycle files. Open PR #444 contains ClearPath code already present live but ahead of main. | Do not merge either or include their changes incidentally. Preserve live bundle bytes outside the approved patch. |
| Documentation conflict | VISION's older summary says numbers use organization subaccounts. AGENT_RULES invariant 24 and live purchase code require master-owned caller IDs. | Follow invariant 24. Apply the approved one-line VISION correction, with no account migration. |
| Search | twilio-search-numbers v58 supports US/Local only and loads organization subaccount credentials. | Add a distinct US/TollFree path using the existing master credential resolver. Preserve local filters, endpoint, and inventory-account behavior. |
| Purchase | twilio-buy-number v64 purchases an exact number on master and inserts the authenticated profile's organization_id. | Retain the provisioning endpoint and ownership architecture. |
| Authorization | Both handlers authenticate a user and load organization_id, but do not currently require an active Admin profile. | Enforce active database-backed Admin/Super Admin authority before any provider request. Super Admin remains home-organization scoped. |
| Price | NumberManagementSection currently displays a hardcoded USD 3 estimate. | Replace purchase estimates with a current account-specific quote and final review. |
| Retry safety | No purchase-operation table exists. Purchase occurs before the phone row insert; a failed insert leaves a paid provider number without a saved row. | Add a durable operation ledger and atomic claim/finalize functions. |
| Number schema | phone_number is globally unique; twilio_sid is not uniquely indexed. assignment_type defaults to agency; inbounds_only exists. | Explicitly save agency ownership and null assignee; use ledger uniqueness and existing phone uniqueness without changing old rows. |
| Current population | 21 phone-number rows; zero toll-free and zero Inbounds-only rows at inspection. | No backfill, transfer, cleanup, or designation. |
| Inbounds | Live set_inbounds_number derives the active actor/org, requires Admin/Super Admin and routing v2, and applies the dedicated-number constraints. | Reuse the existing authenticated workflow after purchase. Do not set inbounds_only using service-role inserts. |
| SMS | registeredSender returns early for non-enforced A2P organizations. Every existing outbound SMS entry point reaches this shared gate before sending. | Reject toll-free senders before this legacy return, including manual, workflow, confirmation, and owner-alert paths. |

### Live Edge baseline

All inspected functions are ACTIVE, have verify_jwt=false and no import map. Preserve these settings.

| Function | Version | Bundled files |
|---|---:|---:|
| twilio-search-numbers | 58 | 2 |
| twilio-buy-number | 64 | 3 |
| twilio-sms | 60 | 13 |
| workflow-executor | 49 | 14 |
| sms-consent-worker | 25 | 13 |
| clearpath-lead-alert | 24 | 13 |

Search and purchase entry files match main byte-for-byte. Purchase's live twilioNumberConfig helper lacks the callback retry fragment present in main. Workflow/confirmation bundles carry older sms/dispatch and sms/wire modules; ClearPath's live entry/handler/message are ahead of main. The shared a2p/sending module matches main in all four sending bundles.

**Release assembly must preserve these live differences:** download each complete live bundle again; replace only explicitly approved modules; retain all other bytes, configuration, URL fields and callback behavior. Type-check and test the complete assembled packages. Do not deploy every current-main shared file indiscriminately. Do not patch existing Twilio numbers or invoke callback reconciliation.

Live history contains 353 migrations, including 20261103191631_inbounds_room_v1. Existing Inbounds definitions were read directly; set_inbounds_number definition MD5 is 3644bc3abc3deaabcb8d99b6b5c6ae20. Recheck before release, never replay its migration.

Security advisors were captured as a baseline: 264 findings across seven categories. The existing RLS-disabled app_config and webhook_debug_log findings remain separate security work. Compare advisors after the authorized new migration; do not broaden this feature to repair them.

## 3. User experience

Keep Settings > Phone System > Phone Numbers and the current cart workflow.

1. Add Local / Toll-Free selection. Local remains the default, with the existing area-code, state and city filters.
2. Toll-Free offers Prefer 800, 800 only, and 888 only. Prefer 800 requests both supported prefixes and displays 800 results first. It does not require local city/state filters.
3. Results show the actual E.164 number and rental price with its billing period. Toll-free results have a small Toll-Free label; no city/state is invented.
4. Add to cart remains a selection action. Review purchase shows every selected number, its type, current rental, currency, monthly total, and applicable inbound usage rate. Additional usage/taxes must not be represented as included in the rental.
5. An explicit final purchase button submits only reviewed, unexpired quotes. Changed pricing requires another review; unavailable numbers are never silently substituted.
6. During purchase, use a synchronous in-flight guard and clear item-level status. A timeout becomes Checking status / Needs review, never an invitation to buy it again.
7. Purchased numbers appear in the existing management list with agency ownership, no assigned agent, and a concise SMS unavailable indicator for toll-free numbers.
8. The admin then explicitly uses the existing Use for Inbounds control. Successful set_inbounds_number designation excludes it from automatic rotation, manual caller-ID selection, campaign groups, and the server admission path.

Inbounds designation is intentionally a separate action. Before designation the number is an ordinary agency number; this plan does not claim it is already receive-only. If a single combined purchase-and-designate interaction is later requested, it must use an authenticated atomic finalization workflow so there is no intermediate outbound-eligible window.

Extract only the purchase UI from the existing 1,109-line NumberManagementSection. Keep new React components under 200 lines; do not refactor unrelated release, routing, assignment, group, or reputation controls. Use Tailwind and Zod. Avoid explanatory panels and implementation language in the UI.

## 4. Inventory and provider account

For new toll-free search, use the account returned by loadOutboundTwilioCreds, the same resolver used for current caller-ID provisioning:

- GET /2010-04-01/Accounts/{master}/AvailablePhoneNumbers/US/TollFree.json
- AreaCode=800 or AreaCode=888; VoiceEnabled=true.
- Prefer 800 combines bounded results, checks exact US E.164/prefix, removes duplicates, sorts 800 before 888, and enforces the total limit.
- A failed 800 lookup must not be described as no 800 inventory. Surface a controlled search failure or explicitly identified partial result.
- Do not use inventory SMS capability as messaging approval.

Local search retains its present US/Local filters and subaccount inventory lookup. Its selected number is checked against the master purchasing context during review, as all purchases remain master-owned. No organization subaccount transfer, Voice JWT change, or new telephony provider is included.

## 5. Quotes, real pricing, and safe version compatibility

Use the master account's current pricing rather than the retail base price:

- Phone number rental: GET https://pricing.twilio.com/v1/PhoneNumbers/Countries/US, matching the number type and current_price/price_unit.
- Selected-number voice pricing: GET https://pricing.twilio.com/v2/Voice/Numbers/{E164}, or the matching US toll-free inbound rate where appropriate.
- Treat monetary amounts as validated decimal values and currencies; do not use a generic USD 3 fallback.
- Show the recurring rental separately from per-minute usage. Do not invent a signup fee, markup, tax-inclusive total, or new AgentFlow billing flow.
- If the applicable price cannot be verified, review/purchase is unavailable.
- Quotes are server records bound to actor, organization, master account, selected number, number type, exact price snapshot and expiry (proposed five minutes). Browser amounts never authorize a purchase.

**Critical deployment compatibility:** create quotes/review through the non-purchasing twilio-search-numbers endpoint. The old buy handler ignores an unfamiliar action field; sending action=quote together with its legacy phone_number field could actually buy a number.

New purchase/status requests use quote_id / operation_id and a stable request_id, not a raw legacy phone_number payload. Old purchase code therefore rejects an unfamiliar new request without buying. The upgraded handler refuses unquoted legacy purchases with a clear refresh-and-review response. New UI validates the response protocol before enabling purchase. There is no legacy purchase fallback.

Search defaults remain compatible with old local-search callers. A stale purchasing tab may need a reload to gain the required price review; local search, cart selection, exact-number purchase, naming and webhook behavior remain supported.

## 6. Authorization and tenant ownership

For search, quote, status and purchase:

- Validate the Bearer token using auth.getUser; do not rely on the deployment flag or browser role.
- Read the actual profile with maybeSingle. Require status Active, organization_id present, and role Admin or Super Admin.
- Retain organization telephony provisioning/suspension checks. Derive the tenant from the profile, never from a client-selected organization.
- Client actor/org/context values are consistency checks only. Refuse mismatches and View As purchase requests. Frontend uses realProfile and isImpersonating, invalidates stale requests on identity/org changes, and prevents old async responses from restoring a previous account's cart or quote.
- Recheck authorization immediately before a first paid attempt.
- Once an attempt is made, its original organization/account/number binding is immutable. Recovery must never move a purchased number into a newly selected or changed organization.
- Keep credentials and raw provider authorization headers server-side. Use bounded public errors; do not return another organization's number ownership or operation details.

Explicit final number fields: organization_id from the trusted operation; assignment_type='agency'; assigned_to=NULL; is_default=false; is_direct_line=false; inbounds_only=false; status='active'; trust_hub_status='pending'. Preserve the existing canonical webhook destinations and methods.

## 7. Durable duplicate prevention and recovery

One additive migration creates a server-only, organization-scoped purchase ledger (proposed private.phone_number_purchase_operations), with RLS and no anonymous/authenticated direct access, plus narrow service-only functions for quote creation, claim, provider receipt and atomic finalization.

Each operation records the immutable tenant, initiating administrator, account, exact number/type, request key, reviewed quote, state, attempt timestamp, provider PN SID when known, and final phone row ID. Never store credentials or full provider responses.

Required behavior:

1. Atomically claim an operation before any Twilio purchase POST. Serialize by master account plus exact number across organizations as well as by organization/request key. A second key must not create a concurrent charge for the same number.
2. Reject a reused request key with changed number, price, account or organization. Return the existing result/status for an identical replay.
3. Before the first POST, recheck availability, current pricing and ownership. Existing numbers are not repurchased or silently adopted.
4. Send exactly one POST with PhoneNumber equal to the reviewed number and the existing configuration. Never ask Twilio to choose a number by AreaCode.
5. Verify the returned account, E.164, PN SID and expected capabilities. Save the provider receipt before finalization where possible.
6. Insert the phone row and mark the operation complete in one database transaction. Preserve the original organization binding and all existing phone rows; do not use an overwrite/upsert across tenants.
7. If a confirmed provider purchase has a recorded PN SID but row persistence fails, retry only verification/finalization for that same receipt. Do not purchase again.
8. If a timeout, malformed success, process crash or lost receipt makes the external outcome uncertain, retain an irreversible attempted/needs_review barrier. No lease expiry or new key automatically authorizes another POST.
9. Reconciliation can inspect master-owned numbers read-only, with exact number comparison. Presence on the shared master account alone is not proof that this organization purchased it. Without a durable receipt or other reviewed operation provenance, leave needs_review for separately authorized support recovery.
10. Never automatically release/refund/delete a number to compensate for a database failure.

Proposed states: quoted, purchasing, purchased_pending_save, completed, failed_before_purchase, needs_review. Quote expiry may close an unattempted quote; it must not reset a charged/uncertain operation. No automatic retry worker, cron job, cross-tenant recovery console, or historical backfill is required for this release.

The application provides retry protection. No endpoint-specific purchase idempotency guarantee was found in the reviewed Twilio create documentation; do not assume a generic Idempotency-Key header makes POST retries safe.

## 8. Toll-free SMS and preservation of calling

This is a voice-only toll-free release. Block toll-free SMS server-side before the shared A2P legacy bypass. Recognize all currently supported NANP toll-free prefixes defensively, while offering only 800/888 for purchase.

Do not add toll-free numbers to a 10DLC campaign, infer SMS approval from Trust Hub/capabilities/service membership, or change existing Trust Hub statuses. A separate verified per-number toll-free messaging workflow is required before any future enablement. There is no automatic SMS-enable switch in this release.

The shared change must reach all four deployed consumers: twilio-sms, workflow-executor, sms-consent-worker, and clearpath-lead-alert. Preserve each live bundle's unrelated modules, including ClearPath's already-live alert copy and the existing STOP/START/consent behavior. Gate tests must show zero Messages POSTs from a blocked toll-free sender.

No changes to TwilioContext, Voice.js device.connect, re-entrancy guards, token generation, call ownership, duration writers, routing engine, scripts, outcomes, dispositions, recording handlers, or live voice webhooks are planned.

## 9. Planned file manifest

Paths below are the intended edit boundary, subject only to a documented refinement before editing if implementation inspection proves a different split is necessary. No unrelated files may be changed.

### Existing runtime files

| Path | Change |
|---|---|
| src/components/settings/phone/NumberManagementSection.tsx | Replace inline purchase block with scoped purchase component; add toll-free/SMS status display. |
| src/components/settings/phone/numberSearchSchema.ts | Local/Toll-Free discriminated validation; retain Local behavior. |
| src/lib/caller-id-selection.ts | Remove the final raw-first-row fallback when every supplied number is Inbounds-only; reject a known dedicated fallback number. Ordinary selection tiers stay unchanged. |
| supabase/functions/twilio-search-numbers/index.ts | Admin authorization; new master toll-free search; non-purchasing quote/review action. |
| supabase/functions/twilio-buy-number/index.ts | Validated quote/operation contract; durable purchase/status/finalization. |
| supabase/functions/_shared/a2p/sending.ts | Toll-free denial before any legacy permission fallback. |

### New runtime modules

| Path | Purpose |
|---|---|
| src/components/settings/phone/NumberPurchaseDialog.tsx | Purchase dialog and Local/Toll-Free filters. |
| src/components/settings/phone/NumberPurchaseResults.tsx | Available numbers and cart selections. |
| src/components/settings/phone/NumberPurchaseReview.tsx | Explicit exact-number, price and item-status review. |
| src/components/settings/phone/useNumberPurchase.ts | Scoped state, request identity, async and double-click guards. |
| src/lib/phone-number-purchase.ts | Typed Edge calls, quote/result protocol and display helpers. |
| supabase/functions/_shared/phoneNumbers/contracts.ts | Bounded request/response validation and number classification. |
| supabase/functions/_shared/phoneNumbers/auth.ts | Database-backed active agency-admin authorization and status checks. |
| supabase/functions/_shared/phoneNumbers/inventory.ts | Local/TollFree provider search and exact-number checks. |
| supabase/functions/_shared/phoneNumbers/pricing.ts | Account pricing and quote terms. |
| supabase/functions/_shared/phoneNumbers/purchase.ts | Single-attempt provider orchestration and ledger RPC calls. |

### Schema, verification and release preparation

| Path | Purpose |
|---|---|
| supabase/migrations/pending/20261104005554_phone_number_purchase_operations.sql | CLI-generated additive server-only ledger/claim/finalize migration; applied only to isolated synthetic test databases during build. |
| supabase/tests/phone_number_purchases.sql | Synthetic privileges, ownership, state and Inbounds assignment assertions. |
| scripts/tests/phone-number-purchases/run.mjs | Isolated database fixture runner. |
| scripts/tests/phone-number-purchases/concurrency.mjs | True concurrent transaction tests. |
| scripts/tests/phone-number-purchases/browser/{vite.config.mjs,index.html,main.tsx,auth.ts,client.ts,check.mjs} | Synthetic actual-dialog desktop/mobile and keyboard verification, with external requests blocked. |
| src/components/settings/phone/__tests__/NumberPurchaseDialog.test.tsx | Local/toll-free/cart/price/version/scope interaction tests. |
| src/components/settings/phone/__tests__/useNumberPurchase.test.tsx | Duplicate click, stale request, partial result and identity-change tests. |
| src/components/settings/phone/__tests__/numberSearchSchema.test.ts | Local validation compatibility and toll-free prefix/input boundaries. |
| supabase/functions/_shared/phoneNumbers/purchase_test.ts | Mocked inventory, pricing, authorization, purchase and recovery tests. |
| supabase/functions/twilio-search-numbers/search_test.ts | Actual handler authorization, inventory account, quote action and old/new protocol tests. |
| supabase/functions/twilio-buy-number/purchase_test.ts | Actual billable-boundary, durable replay and assembled webhook preservation tests. |
| supabase/functions/_shared/a2p/tollFreeSending_test.ts | Toll-free gate before all legacy/enforced SMS branches. |
| src/lib/caller-id-selection.test.ts | Toll-free Inbounds-only fixtures covering existing caller-ID exclusions. |
| scripts/prepare-phone-number-release.mjs | Prepare full packages from pinned live bundles with an explicit module-change allowlist; no deployment action. |
| .github/workflows/phone-number-purchases.yml | Secret-free targeted frontend/Edge/native PostgreSQL verification; no deployment. |

After approval, Supabase CLI v2.84.5 generated `20261104005554_phone_number_purchase_operations.sql` with `supabase migration new phone_number_purchase_operations`. Its path is recorded above before SQL implementation; it remains under pending until separate database release authorization. No existing migration is modified or replayed in production.

Implementation inspection found one directly relevant defense gap: `selectOutboundCallerId` ends with `phones[0]` after all eligibility tiers reject an all-Inbounds-only input. Existing callers prefilter and the server blocks such calls, but the helper itself could return that dedicated number. The one-return refinement listed above makes the approved outbound exclusion complete without changing ordinary local selection, Voice.js, routing, or telemetry.

### Documentation

| Path | Change |
|---|---|
| implementation_plan.md | Newest-first pointer/status; preserve previous plans. |
| docs/plans/2026-11-03-toll-free-number-purchasing/implementation_plan.md | This complete plan and approval/decision record. |
| docs/plans/2026-11-03-toll-free-number-purchasing/verification.md | Actual test evidence and limits after implementation. |
| docs/plans/2026-11-03-toll-free-number-purchasing/release-manifest.json | Exact migration and complete Edge package hashes for separate release review. |
| WORK_LOG.md | Newest-first implementation and verification entry; no false release claim. |
| AGENT_RULES.md | Purchase idempotency, quote compatibility, SMS gate and live-bundle preservation invariant. |
| VISION.md | One-line correction of caller-ID master ownership versus other subaccount flows. |

No generated browser DB-type change is required if the ledger remains private and new RPCs are only invoked by server code. If a browser-facing RPC is introduced, amend this manifest and justify it before editing; do not regenerate the entire existing types file.

## 10. Verification matrix

| Area | Required assertions |
|---|---|
| Local regression | Existing default mode, area/state/city filters, metadata/naming, cart and exact-number selection continue; local inventory path is preserved. |
| Toll-free search | 800-first ordering, 888 fallback, prefix-only modes, empty inventory, duplicate rows, bad provider response, bounded limit, capabilities and no invented location. |
| Account scope | Toll-free inventory, quote and purchase use the purchasing master; org subaccount status still gates access. |
| Authorization | Anonymous/invalid JWT, Agent, Team Leader, inactive profile, suspended org, missing org, cross-org ID, stale identity and View As all fail before provider mutation. |
| Quote | Exact number/currency/rental/usage terms displayed; missing, expired, tampered or changed quote cannot buy; availability loss never substitutes another number. |
| Version skew | New review against old handlers never reaches IncomingPhoneNumbers POST; old unquoted purchase against new handler fails safely; unsupported response protocol disables final confirmation. |
| Duplicate prevention | Double-click, same-key concurrent requests, different keys for same number, different organizations targeting same master number, reload/replay and cart partial failures produce at most one purchase POST. |
| Recovery | Provider success + failed save, lost response, timeout, malformed response, crashed attempt, different master number owner and ambiguous number discovery never trigger automatic repurchase/adoption. |
| Ownership | Saved row has original authenticated organization, agency role, no assignee/default/direct-line, pending Trust Hub; arbitrary browser ownership fields are rejected. |
| Inbounds | Existing authenticated set_inbounds_number accepts eligible purchased 800/888 rows; denies non-admin/cross-org/default/personal/direct-line/routing-v1 cases; unauthorized service-role shortcut is refused. |
| Outbound exclusion | Designated toll-free number is excluded from automatic, manual, campaign and final/server admission paths. Existing ordinary local-number selection remains valid. |
| SMS | All offered and recognized toll-free prefixes fail before A2P legacy bypass; manual/workflow/confirmation/owner-alert transports issue zero message sends; existing local SMS/consent/STOP behavior remains. |
| Preservation | Exact deployed voice/SMS URL/method/config baseline retained; no source drift silently included; no changes to call records, status/duration writers, ownership or disposition logic. |

Run mocked Deno handler tests, meaningful Vitest interaction tests, isolated native PostgreSQL concurrency/ACL tests, existing Inbounds/caller-ID/A2P/SMS regression suites, npx tsc --noEmit, actual application typecheck against the exact main baseline, scoped lint, production build, and full assembled Edge bundle compilation. Root TypeScript alone is not proof of an error-free application.

Run provisioning payload assertions against the assembled live-derived bundle as well as source modules. A test using only main's newer callback helper would not prove preservation of the deployed purchase callback configuration.

Use a synthetic actual-component browser fixture for desktop and narrow/mobile widths, keyboard review/confirm/cancel, long numbers/prices, errors and in-flight states. No calls or messages to real people. Do not claim provider inventory, price access or live media acceptance from mocks.

## 11. Release gates

1. **Implementation approval:** branch code, pending SQL and isolated tests only.
2. **Review candidate:** report exact diff, tests, full package hashes, known baseline failures, source/live preservation and remaining uncertainty.
3. **Database release approval:** approve exact migration bytes for production. Apply once and verify recorded history, RLS, ACLs and advisors.
4. **Edge release approval:** separately approve six complete packages. Ship SMS guard packages before making toll-free purchasing available; preserve verify_jwt=false and all unrelated live files. Read back every deployed file.
5. **Frontend release approval:** merge/release only after compatible backend verification. Older purchasing tabs may require refresh for quote review. No direct main push.
6. **Transaction/room/media authorization:** only after a real number and live quote are presented, obtain separate authorization for any assistant-executed purchase, Inbounds designation and controlled call/media test.

Rollback should first hide/revert the new UI while preserving charge records, ownership, SMS denial and the no-retry barrier. Never delete the ledger or release a paid number as an automatic rollback. No provider migration, old-number callback reconciliation, historical repair or SMS verification submission is included.

## 12. Provider documentation reviewed

- [Twilio toll-free inventory](https://www.twilio.com/docs/phone-numbers/api/availablephonenumber-tollfree-resource): US TollFree resource and AreaCode/voice filters.
- [Twilio phone-number pricing](https://www.twilio.com/docs/phone-numbers/pricing): account-specific pricing by country and number type.
- [Twilio selected-number voice pricing](https://www.twilio.com/docs/voice/pricing-api/voicenumber-resource): selected-number inbound usage pricing.
- [Twilio IncomingPhoneNumbers](https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource): exact PhoneNumber provisioning and owned-number retrieval.
- [Twilio error 30032](https://www.twilio.com/docs/api/errors/30032): pending/unverified toll-free SMS is blocked.
- [Twilio A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc): toll-free verification is separate from local 10DLC registration.
- [Supabase Edge authentication](https://supabase.com/docs/guides/functions/auth-headers): preserve this project's explicitly inspected deployment flags and in-handler authentication. No auth-platform migration is part of this feature.

The provider's current master-account rates, actual number availability and enabled Pricing API permissions were not queried with account credentials during planning. They must be verified through the approved server implementation before any purchase is offered.

## 13. Completed implementation and review corrections

The approved file manifest is implemented. New purchase components are under 200 lines; the existing large management component shrank by more than 300 lines. No package or lockfile change was necessary. Independent review corrected the Voice Pricing v2 decoder to use `destination_number`, documented nullable pricing handling, and expiry handling for a status-only request that never reached a claim. Tests cover all three cases.

Pricing uses verified current rental and inbound voice rates. Only wholly absent/null selected-number inbound fields permit the matching, unique US number-type current-rate lookup; malformed, mismatched, ambiguous or unavailable pricing fails closed. Decimal strings remain exact in review and totals.

The final release assembler verifies pinned live metadata, aggregate source bytes, explicit changed-module allowlists, dependency closure and per-file hashes. All six complete packages compile with the original frozen lock. Their 52 unrelated live modules remain byte-for-byte unchanged. Negative tests reject altered source bytes, versions or JWT settings before package writes. Full provider requests were mocked; no real availability, price access or paid transaction was tested.

Verification details and commands: [verification.md](verification.md). Exact pending SQL, frontend hashes and six complete function payload hashes: [release-manifest.json](release-manifest.json).

## 14. Context snapshot

**Changes:** Local/Toll-Free UI and exact-price review; scoped Admin handlers; durable private purchase ledger; SMS denial; focused caller-ID fallback correction; isolated regression/concurrency/browser tests; full live-derived release assembly and documentation.

**Decisions:** Local remains the default and retains subaccount inventory; 800 preferred/888 supported on master; all purchases use master; agency/unassigned saves; irreversible attempted barrier; PN-receipt-only recovery; separate existing authenticated Inbounds designation; toll-free voice only.

**Migrations/deploys/transactions:** One pending migration, applied only to fresh synthetic databases. Six complete Edge packages prepared. Zero production migrations, deployments, assignments, purchases, calls or SMS. No main merge or remote branch push.

**Verification:** 68 frontend/caller-ID/Inbounds tests; 44 mocked purchase tests; 55 SMS/A2P/ClearPath regression tests; 24 additional gate runs against four live-derived sending packages; six full frozen-lock Edge compilations; 131 SQL assertions and 12 real concurrent transaction scenarios; desktop/mobile/keyboard recovery checks. Root TypeScript, scoped lint and production build pass. Exact-main application diagnostics remain 79/79 with zero new errors.

**Blockers:** No remaining implementation blocker. Production inventory and master-account Pricing API access are unverified. Existing application type diagnostics and bundle-size warnings remain outside this scope.

**Next:** Review the concrete branch, pending SQL and manifest. Refresh live baselines before approving the exact database, six Edge packages and frontend release. Keep any real purchase, Inbounds designation and media test separately authorized.
