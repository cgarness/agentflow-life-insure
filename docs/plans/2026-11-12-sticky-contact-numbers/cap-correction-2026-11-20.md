# Sticky Contact Numbers — pinned voice cap correction

November 20, 2026 Pacific. Applied at **11:31:09 AM Pacific / 19:31:09 UTC** to AGENTFLOW CRM (`jncvvsvckxhqgqvkppmj`), the backend for primary `agentflow` at `fflagent.com`.

## Outcome

**An established sticky calling number stays usable when it reaches its daily call cap.** The same rule applies to an established SMS number used for voice while the voice identity is unassigned. The cap continues to restrict new automatic rotation choices. One-call overrides do not acquire the new exception.

Chris authorized this correction with “Ok correct the cap behavior and then I will run tests.” Both sticky modes remain enforced for Family First Life - Chris Garness; all other five organizations remain off. No frontend or Edge Function deployment was needed.

## Cause and exact change

The installed database used the same strict readiness helper for both rotation and existing relationships. It returned `daily_limit` for a pinned number, which blocked preview readiness, call authorization and final admission.

The new unexposed `private.affinity_voice_number` first runs the unchanged readiness helper. It changes only `daily_limit` to `ready`, and only for the exact endpoint's established matching voice identity or eligible established SMS fallback while voice is enforced or guard_only. Each of `private.affinity_view`, `public.authorize_contact_call` and `public.admit_twilio_outbound` has one readiness-call substitution; the remaining body and security metadata are preserved.

`private.affinity_number`, `private.affinity_default`, the original admission function and qualification logic are unchanged. There is no cap reset, default-number substitution, relationship write or SMS authorization change. Missing/deleted/inactive numbers, personal-number restrictions, Inbounds-only exclusion, campaign groups, contact access, DNC, stale bindings and review states still block where required. Provider admission rechecks the current identity even if usage crosses the cap after authorization.

The initial campaign-pool suspicion was resolved by tracing its population: the actual frontend retains active agency/group numbers regardless of daily usage and applies the cap during selection. Its source matches deployed frontend `f49e55b770b97155fac46f3e5eeae949ad9f3047`, so no browser-side change is necessary.

## Isolated verification

| Verification | Result |
|---|---|
| Faithful baseline | 85 function and 45 table catalogs match; installed release matches 55 functions, 11 tables and one restricted role |
| Managed role | PostgreSQL17.6, current_user/session_user postgres, NOSUPERUSER |
| Old behavior reproduced | Six continuity failures reproduced on the unchanged installed release |
| Focused cap checks | 20/20 pass after correction |
| Existing native regression | 66/66 groups pass |
| Release and rollback | 5/5 checks pass; exact content preserved across 21 populated tables |
| TypeScript and syntax | Root `npx --no-install tsc --noEmit` (5.8.3) and new test-script syntax pass |
| Independent SQL review | Exact forward and rollback bytes pass semantic/security review |

Positive checks cover 100/100 and 125/100 usage, SMS-to-voice fallback, cap crossing after authorization, read-only preview and guard_only continuity. Negative checks cover rotation, one-off override, reservation/review, group mismatch, inactive/personal numbers, DNC before authorization and after binding, stale assignment generation, and direct private-helper access. The unchanged native suite covers wider tenant, lifecycle, replay, concurrency and telemetry behavior.

Rollback/replay rehearsal refused forward replay, restored all eight original function metadata records and removed only the helper, refused rollback replay, refused deliberately altered preimages, and reapplied the forward correction safely. No production data or credentials were used in the sandbox; its runtime network policy was deny-all and it was stopped after evidence recovery.

## Production readback

All nine expected function metadata records match the native-tested candidate. The new helper has no PUBLIC, anon, authenticated or service_role execute grant; existing owner, ACL, search_path, security mode and volatility are preserved. The one stored migration statement equals the reviewed SQL byte-for-byte.

Fresh preapply (19:29:33 UTC) and postapply (19:31:32 UTC) readbacks agree on modes and state: 3,183 assignments/audit events, two established SMS identities, 44 review endpoints and 3,137 unassigned endpoints; 76 messages, 18 dispatches, four existing call bindings, zero bound dispatches and zero unresolved SMS. Ordinary activity increased calls/bindings earlier during the investigation; those pre-existing changes were not caused by the migration. No real call or text was initiated by this work.

Migration history advances from 386 to 387 records, head `20261120193109`. Frontend pin `f49e55b770b97155fac46f3e5eeae949ad9f3047` and primary deployment `dpl_56mpNPZEL3gNBBAqbHga3Es5Gq7f` remain unchanged. Edge versions remain SMS62/workflow51/confirmation27/SMS-webhook48/inbound-voice73, with ClearPath25 unchanged. No main merge or secondary-project operation occurred.

Advisors add **no findings**. Security remains 2 ERROR / 244 WARN / 67 INFO; performance remains 0 ERROR / 244 WARN with INFO 229→228; health is empty. The resolved informational finding is unused_index on `private.contact_number_events.contact_number_event_endpoint`. Existing errors/warnings remain outside this correction's scope; this is not a clean-security claim.

## Applied source and rollback

| Artifact | Identity |
|---|---|
| Applied migration | `supabase/migrations/20261120193109_sticky_pinned_voice_cap.sql`, 13,897 bytes |
| Migration SHA-256 | `6e88a3472e554ff38c98daa254bea4744dac98a7be82c637b43b6182de2a1bd4` |
| Guarded inverse | `supabase/migrations/rollback/20261120193109_sticky_pinned_voice_cap.rollback.sql`, 14,589 bytes |
| Inverse SHA-256 | `9e5b46e296cd0f47f53f0bd6d57c6f899a856e23db42f3593ab1e90399271803` |
| Native evidence archive SHA-256 | `7986b28bcbc17fdd80a59e5bef60ced63493bf345529cbe034f7deb1993e910d` |

The Supabase2.79.0 CLI generated the initial filename `20261120192402_sticky_pinned_voice_cap.sql`; publication uses the actual production-recorded identity `20261120193109`, with identical tested SQL bytes. No earlier applied migration was edited. Both forward and inverse require their exact preimages and an atomic transaction. Do not replay the forward migration. The inverse was exercised only in isolation; production rollback needs its own instruction and would restore the previous cap refusal without altering modes or identities.

## Test handoff and limits

Refresh the dialer before testing. Confirm an established contact retains the same caller ID on a follow-up call; when that number is at cap, it should still work. Confirm an unassigned contact's rotation does not select an over-cap number. The existing text identity should remain stable across the Dialer, Conversations and Full Contact View.

For a newly established voice relationship, use the appropriate reviewed conversation disposition (Appointment Set, Call Back or Sold); No Answer and other excluded outcomes do not establish one. The 44 historical review endpoints remain review cases and were not changed by this correction.

Controlled real-media/call and SMS-delivery acceptance is Chris's next step. This release does not claim those tests, resolve the inherited application TypeScript/mobile limitations, merge main, enroll numbers or implement automatic SMS setup. The original 88 acceptance IDs remain unchanged.
