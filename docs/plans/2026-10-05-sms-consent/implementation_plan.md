# AgentFlow CG Financial SMS consent integration plan

Prepared for Chris Garness on October 5, 2026. Status: implementation approved by Chris on October 5, 2026 at 12:44 PDT; isolated implementation in progress. This plan completes the engineering needed to connect the released Underwriter Verified consent forms to AgentFlow and prepare one CG Financial agency registration using five existing agency numbers.

Approval of this plan authorizes isolated implementation and testing in the two repositories. Production migrations, Edge deployments, integration secrets, SMS activation, provider resource changes, registration fees and live messages remain subject to a concrete release review. AgentFlow AGENT_RULES.md section 8 requires this plan approval before code changes.

## Verified starting point

| System | Current evidence |
| --- | --- |
| AgentFlow repository | cgarness/agentflow-life-insure; fetched main b90e12d3bdcfb188ca0fbc6f25e971aaf77ddbf1 |
| AgentFlow production database | jncvvsvckxhqgqvkppmj |
| Agency | a0000000-0000-0000-0000-000000000001; Family First Life - Chris Garness; Chris confirmed this maps to CG Financial |
| Website repository | cgarness/underwriter-verified |
| Website release handoff | PR 12 merged; production commit 8a1d81e78d096c521b325b2b8232c204007e881e; Vercel dpl_CqBeMgK7cXhc6AyAAtUiNkvaDGVa, READY according to the release handoff |
| Website production database | jzdzeevjpootbeuniygx; independently rechecked read-only |
| Website profile | e7c2f35a-e215-4e9e-9492-176a344384eb; cg-financial/christopher-garness |
| Consent version | 2026-10-05-policy-clarifications is sole current version; September 29 remains historical |
| Website migration | Hosted 20261005190344; release handoff maps it to repository 20261005182200_advance_a2p_policy_disclosure.sql; never replay |
| Current website records | 0 intake requests, 0 consent events, 0 suppressions at this audit |
| Current agency A2P records | 0 accounts, 0 registrations, 0 numbers at this audit |

Read-only source inspection confirms the deployed A2P foundation described by the repository remains the starting architecture. Relevant SMS/A2P paths have not changed between the prior reviewed checkout and fetched main. Full deployed Edge bundle comparison must be refreshed before release. Open PR titles show no competing A2P implementation; preserve the unrelated Google, underwriting and reporting work. The existing local A2P wizard plan is not on main and is not part of this build.

The manual and workflow paths contain differing CRM account references. Provider ownership, profile role/status and existing resources remain unverified and must be reconciled from the private submission packet before activation. No blocked browser login was retried.

## Scope and preserved behavior

Initial activation covers CG Financial only. Other agencies keep their current behavior until separately onboarded. Within CG Financial, every outbound application SMS must pass the same policy, including a sender outside the selected set, a recipient without a CRM contact, and delayed or retried work. The selected five are the only permitted launch senders after registration approval.

Keep calls, Voice JWT, TwiML applications, inbound routing, forwarding, recordings, caller ID, number assignment and the existing agency DNC implementation unchanged. SMS STOP adds SMS suppression; it does not silently rewrite voice DNC. The existing agency DNC must nevertheless block application SMS. Website consent belongs to CG Financial and cannot authorize another agency or sender brand. Meta, purchased/imported leads, calls and contact creation do not establish website SMS permission.

## Implementation design

### 1 Bind the two systems securely

Add an explicit server-managed mapping between the AgentFlow organization and the exact UV project/profile UUID and slugs. Verify the mapping on both sides, including normalized sender identity. Browser-supplied organization, profile, consent text or allowed flags are never authoritative.

Use a narrow authenticated UV Edge endpoint for current eligibility and suppression synchronization. AgentFlow must not receive the UV service-role key. Use separately scoped integration credentials stored only in Edge secrets, signed canonical request bodies, method/path binding, timestamp limits, constant-time verification and replay protection for mutations. UV's own server credential remains inside UV. Bound payload size, timeout and allowed operations; redact phone and secret material from operational logs.

UV remains the authority for original consent evidence and its immutable disclosure/policy version. AgentFlow retains source event identifiers and purpose-specific evidence references needed for audit and confirmation handling. No bulk copy of customer profiles or tax documents is required. Eligibility responses bind the exact agency/profile, normalized recipient, requested purpose, decision, source evidence IDs and check time.

### 2 Capture events and confirmations reliably

Add a transactional outbox alongside newly committed UV consent events, preserving the existing intake transaction and historical evidence. Network delivery happens after commit, so an unavailable AgentFlow endpoint does not lose a website request. Deliver signed events to an idempotent AgentFlow receiver, with bounded retries and a monitored recovery worker. Group the two purpose events by intake request before deciding whether a confirmation is due.

Normal delivery should dispatch promptly after commit; a scheduled recovery sweep handles failures. Confirm the supported database webhook/worker mechanism and its permissions during implementation before finalizing migrations. Synthetic tests must demonstrate the normal immediate path and delayed recovery, not merely a periodic polling approximation.

A new qualifying enrollment receives one matching confirmation: informational only, marketing only, or both. Neither checked produces no message. An unchanged repeat submission, duplicate event, later unchecked form or STOP does not create a new enrollment. Use a unique agency/recipient/enrollment receipt and retain the exact selected purpose set. A genuinely new purpose may need a new scoped confirmation; do not imply permission for the other purpose.

Use the confirmation drafts already prepared in the submission packet, including sender, frequency/rates, HELP/support and STOP. Confirmations pass sender readiness, DNC and suppression checks. If registration or sending is not ready, keep enrollment confirmation visibly pending and block recurring program messages; do not send or later mass-replay old confirmations. Establish an explicit activation watermark and a bounded reviewed recovery rule before enabling delivery.

### 3 Gate every outbound send

Create a shared server-side dispatch policy used by twilio-sms and workflow-executor. It must check authenticated actor/contact scope where relevant, selected sender, pinned provider account, current A2P readiness, explicit message purpose, current UV eligibility, local SMS suppression and existing normalized agency DNC immediately before provider submission.

Use an independent agency SMS enforcement setting, so disabling A2P registration actions or a missing registration row cannot restore legacy sends for an enrolled agency. Missing mapping, unknown purpose, stale/failed consent check, provider mismatch or database error blocks the send. Do not cache an allowed consent result across queued dispatches or retries.

Add an explicit informational/marketing choice to the existing message composer and workflow SMS configuration. Any promotional or mixed-purpose content requires marketing permission. Templates carry reviewed purpose metadata; free-form messages require a deliberate purpose selection. This records agent intent and does not claim automatic legal classification. Legacy workflow nodes without a purpose remain blocked for the enrolled agency until reviewed. No AI classifier may downgrade marketing to informational.

Inventory all indirect callers. The current inbound-voice after-hours helper calls twilio-sms without a user session; do not broaden authentication or unblock that path as a side effect. It must continue to fail safely unless separately wired through an authenticated internal sender and the same consent policy. Calls alone do not grant SMS consent. No voice source change is proposed in this build.

Add durable send-intent receipts and stable request IDs for manual, workflow and confirmation sends. Prevent double-click/retry duplication. If provider acceptance is known but CRM persistence fails, preserve that outcome and reconcile. If the HTTP result is uncertain, hold for reconciliation instead of blindly sending again. Do not assume the provider offers an idempotency guarantee it has not documented.

### 4 Persist opt-outs across the agency

Validate inbound Twilio signatures with credentials for the verified owning account and bind AccountSid, destination number and Messaging Service to the agency. Do not trust a signed event for a different account or rely solely on contact matching. The current webhook's single environment-token assumption requires review against the selected account.

Persist opt-out evidence and current suppression keyed by organization plus normalized recipient before acknowledging successful processing. Process STOP and the provider's standard supported variants, trusted OptOutType=STOP, provider block error 21610, and reviewed non-keyword revocation recorded by an authorized operator. An unknown CRM contact must still be suppressed across all five agency senders and any future agency sender.

Use durable provider event/message IDs for replay safety. Suppression succeeds independently of ordinary message history, notification or activity writes. If critical suppression persistence fails, return a retryable failure and alert operators; do not return a false successful acknowledgement. Retry failed synchronization to UV from a durable local outbox while local blocking remains effective.

When Twilio Advanced Opt-Out supplies OptOutType, it has already handled the corresponding automatic response; return no duplicate reply. Verify provider STOP/HELP text and support information during account setup. HELP must not grant consent. START/provider unblocking does not silently clear local suppression, agency DNC or manufacture marketing permission. Initial release keeps re-enrollment blocked pending an explicit audited flow that appends new evidence; historical suppressions are never deleted.

Enforce suppression again at the final application handoff. Document and test the race boundary: an already accepted provider message cannot be recalled by a later STOP. Do not claim an atomic transaction across two databases and Twilio.

### 5 Make status understandable

Reuse the existing A2P tab and compact composer status. Show informational consent, marketing consent, suppression and provider readiness separately. A missing permission should say why sending is blocked without exposing another tenant's evidence. Preserve unsent drafts and existing contact layouts. Do not show a success state before a provider acknowledgement or manufacture delivery status.

Registration preparation stays distinct from actual provider submission. Keep the existing hosted flow, operation locks, signed Event Streams and reconciliation worker. Opening a hosted Brand/Campaign flow can create resources; it is not a read-only preview. A broader EIN onboarding wizard is outside this build.

## Intended file changes

Implementation will use fresh isolated branches from current main in each repository. Before editing, refresh AGENTS.md where present, AGENT_RULES.md, VISION.md, WORK_LOG.md and the A2P release documents; preserve concurrent work. New migration names will be generated by the Supabase CLI, not guessed or copied from already applied migrations.

| Repository | Existing files or proposed new area | Purpose |
| --- | --- | --- |
| AgentFlow | supabase/functions/twilio-sms/index.ts; workflow-executor/index.ts; twilio-sms-webhook/index.ts | Common dispatch and durable suppression |
| AgentFlow | supabase/functions/_shared/sms/ (new); _shared/a2p/sending.ts as needed | Consent client, policy, scoped event validation and dispatch receipts; preserve A2P gate |
| AgentFlow | supabase/functions/sms-consent-events/ and sms-consent-worker/ (new) | Signed event ingestion, confirmations and recovery |
| AgentFlow | New supabase/migrations files; supabase/config.toml | Additive mapping/evidence/suppression/outbox/receipt schema and secure function configuration |
| AgentFlow | src/components/messaging/MessageComposePanel.tsx; src/pages/Conversations.tsx; src/components/contacts/FullScreenContactView.tsx | Carry purpose and stable request ID through existing composers; extract helpers rather than growing large components |
| AgentFlow | src/lib/workflow-types.ts; src/components/workflows/panels/ActionConfigPanel.tsx and actionForms.tsx | Validated workflow purpose and existing template contract |
| AgentFlow | src/components/settings/phone/a2p/ targeted components and types | Separate consent readiness from provider approval |
| AgentFlow | Targeted Deno/React/SQL tests; existing A2P CI or focused new SMS workflow | Authorization, adverse cases, retries and isolation |
| AgentFlow | docs/plans/2026-10-05-sms-consent/implementation_plan.md, release.md, verification.md; WORK_LOG.md; AGENT_RULES.md if a new invariant is established | Durable build and release evidence |
| Underwriter Verified | New supabase/functions/agentflow-consent/ and consent-event-worker/; shared bridge helper; supabase/config.toml | Scoped eligibility/suppression API and event delivery |
| Underwriter Verified | New forward migration and isolated SQL/Edge integration tests | Outbox and restricted bridge operations; preserve intake and historical evidence |
| Underwriter Verified | docs/A2P_READINESS.md; docs/RELEASE_PREFLIGHT.md; WORK_LOG.md | Integration and coordinated activation records |

New tables must have explicit grants and RLS; no anonymous or browser writes to evidence, suppression, mapping or dispatch state. Keep broad service-role access inside each project's backend, expose only narrow authorized operations, and add no public security-definer bypass. Existing RLS, ownership and DNC rules remain intact. Do not blindly push all repository migrations or re-enable automatic production schema deployment.

## Acceptance evidence

- Neither, informational only, marketing only and both choices produce the correct permissions and confirmation behavior.
- STOP before or after a grant, STOP from an unmatched contact, switching sender numbers, later checked/unchecked forms, HELP, START and provider 21610 preserve the expected agency-wide blocking.
- Wrong agency/profile/account/service, forged or replayed bridge/webhook requests, absent purpose, stale event, missing configuration and failed eligibility/database requests cause no provider send.
- Duplicate clicks, concurrent workers, duplicate delivery, timeout after provider acceptance and failed history persistence do not automatically duplicate a message.
- Delayed/retried workflows resolve current phone and permissions at dispatch, including after contact conversion, reassignment, number changes and DNC changes.
- Browser tests cover both composer entry points, workflow configuration, blocked reasons, preserved drafts, account switching and phone widths. Retain existing layout.
- Run native PostgreSQL concurrent/security tests plus targeted Deno/React tests, both meaningful TypeScript checks, scoped lint, build, existing A2P and Dialer DNC regression gates. Compare against the exact base's existing diagnostics rather than claiming a globally clean repository.
- Isolated end-to-end test: website submission -> immutable purpose evidence -> signed event -> confirmation receipt -> permitted synthetic dispatch -> STOP -> blocked manual/workflow dispatch. All provider interactions use a non-production test double unless a separate controlled live test is authorized.
- Verify unchanged voice/routing/JWT/TwiML/number-assignment source and protected DNC definitions. No live agent/customer calls or messages are part of these tests.

## Registration preparation and five numbers

Carry forward the private submission packet's confirmed IRS identity, address, proprietor, contact details, website-only sources and estimate of fewer than 1,000 texts on the busiest agency day. Keep the full EIN only in the private source document and approved provider identity fields. Prepare the EIN-backed Low-Volume Standard / Low Volume Mixed route, subject to verified account eligibility and actual segment/carrier limits. Five numbers do not multiply the brand's allowance.

| Selected sender | Existing CRM Twilio number reference |
| --- | --- |
| +12162706473 | PN1982b5e219b25ff92daa123638bad549; current default |
| +19096108403 | PNe370ab9eccda90790e2a2a3d31df2fe5 |
| +12136676225 | PNc00214a3e0b1bb188890115f57c196c9 |
| +17143642905 | PNac5451ba0a09ce7cad8d0d56d020faa6 |
| +19162998778 | PN17e3b0257b58b736d0160b457eca2a80 |

All five are active agency records in the fresh CRM read. Provider-side ownership, SMS capability, service membership and registration remain pending. Leave the other 11 senders outside initial SMS activation and preserve all voice assignments. Support number +19097756963 is not a selected sender.

Provider inventory must establish the actual owner Account SID, Customer Profile role/identity/approval, Trust Product, Brand, Campaign, Messaging Service, five PN resources, STOP/HELP settings, hosted Embeddable entitlement if used, signed event subscription and worker configuration. An empty AgentFlow table does not establish that Twilio has no existing resources. Use authorized read-only access or a redacted provider export; the earlier blocked login must not be bypassed. This access gap does not prevent isolated engineering.

## Release order and approval boundaries

1. Chris approves this implementation plan; build and verify the isolated branches, including the narrow UV backend bridge. No production changes follow merely from this approval.
2. Prepare a release package with exact PR heads, migration SQL/hashes and project IDs, complete deployed Edge preimages, new secret names without values, callbacks/jobs, activation settings and recovery actions. Resolve provider account ownership before activation.
3. After exact production approval, apply only the additive reviewed migrations, deploy the authenticated bridge and all SMS paths, verify readback and publish the frontend. Confirmations and messaging stay disabled until provider readiness is established. Coordinate a brief SMS pause during activation; voice operation stays unchanged.
4. Enforce the CG Financial deny-by-default policy, then establish the reviewed source watermark and event workers. Never disable enforcement to get around a failed deployment. Recovery pauses SMS and retains evidence/outboxes/receipts; fix forward.
5. Present exact Brand/Campaign fields, samples, URLs, account, existing resources and current fees for Chris's submission approval. No registration or fee acceptance occurs automatically.
6. After provider approval and separate authorized number linking, attach only the five selected numbers, reconcile their individual registration and service status, and perform a controlled test with an owned consenting recipient. Verify STOP from one number blocks the other four. Do not replay old jobs or confirmations.

Website refinements are complete according to the release handoff, and their database version is independently confirmed. Registration remains unsubmitted. Sending remains unready until integration, provider reconciliation and controlled activation are complete. Website dependency advisories stay in a separate security cleanup.

## References

- Existing submission packet: https://chatgpt.com/space/page_e41995bf6e54819180708df1683fd0f5
- AgentFlow A2P release source: https://github.com/cgarness/agentflow-life-insure/blob/b90e12d3bdcfb188ca0fbc6f25e971aaf77ddbf1/docs/plans/2026-10-03-a2p/release.md
- Website release: https://github.com/cgarness/underwriter-verified/pull/12
- Twilio messaging policy: https://www.twilio.com/en-us/legal/messaging-policy
- Twilio Advanced Opt-Out and duplicate-response guidance: https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out
- Twilio recurring campaign onboarding: https://help.twilio.com/articles/11847054539547
- Supabase explicit table grants: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
