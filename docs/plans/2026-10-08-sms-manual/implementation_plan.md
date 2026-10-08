# Restore straightforward manual SMS

Chris requested the rollback and working production manual SMS on October 8, 2026 at 07:41 PDT. This supersedes the recent requirement that a human-composed message must select a purpose and have a matching Underwriter Verified enrollment/confirmation. The approved five-number A2P configuration stays active. The unmerged START work is excluded.

## Intended behavior

- Contacts and Conversations present the existing message composer, Templates and Send. Remove the purpose dropdown and the informational/marketing readiness paragraphs and refresh link. Do not add replacement explanatory UI text.
- An authenticated agency user can send a normal manual text to an accessible contact without a UV website enrollment or confirmation. Record this as a manual message, not an inferred consent grant.
- Resolve a valid registered SMS sender on the server, honoring an eligible selected number and otherwise using the agency SMS default. A voice-only caller ID must not break SMS or be changed by texting.
- Retain account/contact access, agency DNC, recipient STOP/provider blocks, provider registration, message history and duplicate-attempt protection. Preserve website records and stricter automated/workflow enrollment behavior.
- No consent/suppression deletion, old-message replay, customer test messages, Campaign change or START release.

## Files and implementation

- Manual composer surfaces and associated frontend send helpers/tests: remove purpose/readiness dependencies; retain in-flight guards, own-account scope and failed drafts.
- `supabase/functions/twilio-sms/index.ts` and a small server sender helper: select manual mode internally after authentication and contact access checks, resolve the actual SMS sender, ignore client purpose classification.
- `_shared/sms/dispatch.ts` and a forward migration: record manual receipts with no fabricated UV evidence; skip UV/confirmation requirements only for actor/contact-bound manual sends. Preserve final STOP/DNC serialization, selected sender and dispatch receipts. Existing workflow/confirmation callers stay purpose-specific.
- Meaningful SQL, Edge and composer tests: manual send without UV enrollment, default sender with voice caller ID, STOP/DNC blocking, duplicate sends, denied scope, real history and failed drafts.
- `WORK_LOG.md` and `AGENT_RULES.md`: record the owner-directed manual-SMS behavior and minimal-UI preference.

## Verification and release

1. Confirm live source/schema and deployed Edge preimages; isolate from concurrent work.
2. Test manual behavior and retained blocks, run existing SMS/A2P/DNC checks, TypeScript/lint/build and desktop/mobile composer checks.
3. Apply only the new compatible forward migration, deploy/read back the complete twilio-sms bundle, and publish/merge the reviewed frontend change through the existing deployment path.
4. Verify live release assets and production configuration. The supplied screenshot uses a fake seeded phone, and Chris's last verified real test phone is STOP-suppressed; do not send to either or erase its opt-out to manufacture a delivery test. Report that live delivery needs an eligible real handset if no suitable explicitly authorized recipient is available.

Recovery: previous Edge/frontend remain compatible with the additive manual category. Revert the new entry-point/manual composer changes if required while preserving history and the five registered senders.
