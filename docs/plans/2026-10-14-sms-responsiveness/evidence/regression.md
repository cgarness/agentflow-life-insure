# Regression evidence: base vs candidate, tied to full SHAs

- **Base:** `main` `dacd921903a867de99276f8709f829995602c3bd`, as a detached worktree.
- **Candidate:** `3582ea109caadcd752e61b7daea8d2e85492e80f`. Application source is identical from `c367457` onward; the only later `src/` change is the added test `src/components/messaging/__tests__/pendingSmsBridgeMount.test.ts`. Later commits change only `docs/`, `WORK_LOG.md` and `measurements/`, and `git diff 3582ea1 <published head> -- src scripts .github` is empty (re-checked at publication; plan §14).
- **Method:** the repository's own `scripts/verify_reports_frontend.py`, run locally exactly as `.github/workflows/reports-frontend.yml` runs it (`REPORTS_BASE_SHA`, a base worktree with shared `node_modules` because `package-lock.json` is identical). For each SHA it runs both `tsc` configurations and the full Vitest suite (`--maxWorkers=2`, JSON reporter plus the runtime-error reporter, no `VITE_SUPABASE_*`). It asserts:
  - no new TypeScript diagnostic (file, code and message, as a multiset);
  - an identical root `tsc` exit code;
  - no new failing test or file;
  - no new unhandled runtime error;
  - Reports tests pass;
  - ESLint on the changed TypeScript files and `npm run build` pass.
- **CI reruns it on the published head.** Its artifact is `reports-frontend-evidence-<run_id>` (`base.json`, `branch.json`, `summary.json`).

Local result: `exit 0 (all assertions held). Exit codes: base root tsc 0, app tsc 2, Vitest 1; candidate root tsc 0, app tsc 2, Vitest 1; Reports tests 0; ESLint on changed TypeScript 0; build 0. Passed tests: base 5183, candidate 5350. Failing tests: 1 on each side (the same one). Failing files: the same 10 on each side. Reported unhandled runtime errors: 0.`. Per-file results for both SHAs: `vitest-files-dacd921903a8.json` and `vitest-files-3582ea109caa.json` in this folder (counts per file, failing tests with masked first lines, the skipped inventory; no test output).

### Vitest totals

| | Base `dacd921903a8` | Candidate `3582ea109caa` |
|---|---|---|
| Test files | 332 | 339 |
| numTotalTestSuites | 1532 | 1570 |
| numPassedTestSuites | 1521 | 1559 |
| numFailedTestSuites | 11 | 11 |
| numTotalTests | 5218 | 5385 |
| numPassedTests | 5183 | 5350 |
| numFailedTests | 1 | 1 |
| numPendingTests | 34 | 34 |
| numTodoTests | 0 | 0 |

### Failing tests

- Base: `src/lib/caller-id-selection.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Base: `src/lib/custom-fields-settings.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Base: `src/hooks/__tests__/dialerCampaignPresenceHook.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Base: `src/lib/__tests__/contactName.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Base: `src/lib/__tests__/contactScope.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Base: `src/lib/__tests__/leadDisposition.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Base: `src/lib/__tests__/recordingRetentionVoicemail.test.ts` › handler wiring the authentication and conversation-recording purge are byte-identical to deployed v29 — `AssertionError: expected 'import { createClient } from "https:/…' to be 'import { createClient } from "https:/…' // Object.is equality`
- Base: `src/lib/__tests__/userLocalDayBounds.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Base: `src/lib/control-center/runtimeEventLogger.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Base: `src/components/contacts/__tests__/addLeadAssignmentGate.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/lib/caller-id-selection.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/lib/custom-fields-settings.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/hooks/__tests__/dialerCampaignPresenceHook.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/lib/__tests__/contactName.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/lib/__tests__/contactScope.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/lib/__tests__/leadDisposition.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/lib/__tests__/recordingRetentionVoicemail.test.ts` › handler wiring the authentication and conversation-recording purge are byte-identical to deployed v29 — `AssertionError: expected 'import { createClient } from "https:/…' to be 'import { createClient } from "https:/…' // Object.is equality`
- Candidate: `src/lib/__tests__/userLocalDayBounds.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/lib/control-center/runtimeEventLogger.test.ts` › <file failed to run> — `supabaseUrl is required.`
- Candidate: `src/components/contacts/__tests__/addLeadAssignmentGate.test.ts` › <file failed to run> — `supabaseUrl is required.`

New failures on the candidate: none.

### Why 10 files fail on both sides

`reports-frontend` sets no `VITE_SUPABASE_*` variables. Ten test files import the real Supabase client at load time and stop with `supabaseUrl is required.` They fail identically on base and candidate, and the script asserts that.

With dummy variables (`TZ=UTC`, `VITE_SUPABASE_URL=http://127.0.0.1:54321` and synthetic anon/publishable keys), all of them load. A full run in that mode at each SHA gave:

| Dummy-env full suite | Base `dacd921903a8` | Candidate `3582ea109caa` |
|---|---|---|
| Tests | 5,301 | 5,468 |
| Passed | 5,266 | 5,433 |
| Failed | 1 (`recordingRetentionVoicemail`) | 1 (the same test) |
| Skipped | 34 | 34 |

- **Base tests absent on the candidate:** exactly the 12 mapped in `test-mapping.md`.
- **Status changes:** none. No base failure now passes, and no base pass now fails.

### Skipped tests

Base 34, candidate 34. Only on base: none. Only on candidate: none.

| File | Skipped |
|---|---|
| `src/components/contacts/__tests__/addTaskModalDueDate.test.tsx` | 2 |
| `src/components/contacts/__tests__/fullScreenContactViewSchedule.test.tsx` | 3 |
| `src/components/dashboard/__tests__/localCalendar.test.ts` | 12 |
| `src/lib/__tests__/contactFollowUps.test.ts` | 1 |
| `src/lib/__tests__/recordingRetentionBaseline.test.ts` | 1 |
| `src/lib/__tests__/reportsIntegrity.test.ts` | 1 |
| `src/lib/__tests__/saveAppointmentPayload.test.ts` | 2 |
| `src/lib/__tests__/taskDates.test.ts` | 4 |
| `src/lib/__tests__/voicemailOwnership.test.ts` | 1 |
| `src/lib/calendar/__tests__/localDateTime.test.ts` | 7 |

### Per-file differences

Files only on the candidate (7): `src/components/conversations/__tests__/conversationThreadPendingSms.test.tsx`, `src/components/messaging/__tests__/pendingSmsBridgeMount.test.ts`, `src/components/messaging/__tests__/pendingSmsStatus.test.tsx`, `src/lib/sms-send/__tests__/pendingSmsStore.test.ts`, `src/lib/sms-send/__tests__/sendManualSms.test.ts`, `src/lib/sms-send/__tests__/smsDisplayMerge.test.ts`, `src/lib/sms-send/__tests__/smsSendResult.test.ts`

Files only on base (0): none

| File in both | Base passed/failed/skipped | Candidate passed/failed/skipped |
|---|---|---|
| `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx` | 18/0/0 | 25/0/0 |
| `src/pages/__tests__/conversationsSendContract.test.tsx` | 25/0/0 | 30/0/0 |

### `tsc -p tsconfig.app.json` diagnostics (file, code, message; multiset)

Base 85, candidate 84.

New on the candidate: none

Removed on the candidate:
- 1× `src/pages/__tests__/conversationsSendContract.test.tsx` TS2339: Property 'bind' does not exist on type 'never'.

Unchanged diagnostics by file:

| File | Code | Count |
|---|---|---|
| `src/components/calendar/AppointmentModal.tsx` | TS2345 | 1 |
| `src/components/contacts/AddTaskModal.tsx` | TS2345 | 1 |
| `src/components/contacts/AgentModal.tsx` | TS2353 | 1 |
| `src/components/contacts/ContactsFilterModal.tsx` | TS2367 | 1 |
| `src/components/contacts/ConvertLeadModal.tsx` | TS2322 | 1 |
| `src/components/contacts/KanbanCard.tsx` | TS2339 | 1 |
| `src/components/dashboard/__tests__/dashboardDateBounds.test.ts` | TS2869 | 1 |
| `src/components/layout/Sidebar.tsx` | TS2367 | 1 |
| `src/components/settings/CallScripts.tsx` | TS2769 | 1 |
| `src/components/settings/ContactManagement.tsx` | TS2339 | 1 |
| `src/components/settings/CustomMenuLinks.tsx` | TS2339 | 1 |
| `src/components/settings/HierarchyTree.tsx` | TS2345 | 1 |
| `src/components/settings/HierarchyTree.tsx` | TS2352 | 1 |
| `src/components/settings/NumberReputation.tsx` | TS2352 | 1 |
| `src/components/settings/Permissions.tsx` | TS2769 | 2 |
| `src/components/settings/phone/CarrierReputationPanel.tsx` | TS2322 | 1 |
| `src/components/settings/phone/TrustHubRegistrationPanel.tsx` | TS2339 | 2 |
| `src/components/settings/phone/usePhoneSettingsController.ts` | TS2769 | 2 |
| `src/components/settings/templateAttachmentUtils.ts` | TS2345 | 1 |
| `src/components/settings/useTemplateModalForm.ts` | TS2339 | 1 |
| `src/components/workflows/NewFolderModal.tsx` | TS2345 | 1 |
| `src/constants/trainingData.ts` | TS2353 | 5 |
| `src/contexts/AuthContext.tsx` | TS2352 | 1 |
| `src/contexts/TwilioContext.tsx` | TS2322 | 1 |
| `src/contexts/TwilioContext.tsx` | TS2367 | 1 |
| `src/contexts/TwilioContext.tsx` | TS2367 | 4 |
| `src/contexts/__tests__/impersonationAuthority.test.tsx` | TS2352 | 1 |
| `src/contexts/__tests__/impersonationAuthority.test.tsx` | TS2352 | 1 |
| `src/contexts/__tests__/sessionIdentityAuthority.test.tsx` | TS2345 | 1 |
| `src/hooks/useLeadLock.ts` | TS2352 | 2 |
| `src/hooks/useResources.ts` | TS2322 | 1 |
| `src/hooks/useResources.ts` | TS2322 | 1 |
| `src/hooks/useTraining.ts` | TS2322 | 1 |
| `src/hooks/useTraining.ts` | TS2339 | 1 |
| `src/hooks/useTraining.ts` | TS2339 | 1 |
| `src/lib/__tests__/contactsAgentsScope.test.tsx` | TS2339 | 1 |
| `src/lib/__tests__/contactsGatingRender.test.tsx` | TS2339 | 1 |
| `src/lib/__tests__/contactsRender.test.tsx` | TS2339 | 1 |
| `src/lib/__tests__/impersonationProfile.test.ts` | TS2322 | 1 |
| `src/lib/__tests__/profileScopeAndOrgTree.test.ts` | TS2493 | 1 |
| `src/lib/__tests__/voicemailCleanupStarvation.test.ts` | TS2339 | 1 |
| `src/lib/__tests__/voicemailOwnershipRecovery.test.ts` | TS2353 | 1 |
| `src/lib/profile/profile-org-view.ts` | TS2344 | 1 |
| `src/lib/supabase-messages.ts` | TS2345 | 1 |
| `src/lib/supabase-messages.ts` | TS2352 | 1 |
| `src/lib/supabase-messages.ts` | TS2589 | 2 |
| `src/lib/supabase-recruits.ts` | TS2741 | 1 |
| `src/lib/supabase-users.ts` | TS2551 | 1 |
| `src/lib/twilio-voice.ts` | TS2353 | 1 |
| `src/pages/LandingPageTest1.tsx` | TS2322 | 5 |
| `src/pages/SuperAdminDashboard.tsx` | TS2352 | 1 |
| `src/pages/SuperAdminDashboard.tsx` | TS2352 | 1 |
| `src/pages/SuperAdminOrgDetail.tsx` | TS2352 | 1 |
| `src/pages/Training.tsx` | TS2345 | 1 |
| `src/pages/__tests__/contactsAgentsRenderIsolation.test.tsx` | TS2339 | 1 |
| `src/pages/__tests__/contactsImportHistoryTab.test.tsx` | TS2339 | 1 |
| `src/pages/__tests__/contactsViewAsFailClosed.test.tsx` | TS2339 | 1 |
| `src/pages/__tests__/contactsViewAsPreferences.test.tsx` | TS2339 | 1 |
| `src/pages/__tests__/conversationsViewAs.test.tsx` | TS2339 | 1 |
| `src/pages/__tests__/onboardingFounderFlow.test.tsx` | TS2493 | 2 |
| `src/pages/__tests__/onboardingInviteFlow.test.tsx` | TS2493 | 1 |
| `src/pages/__tests__/onboardingLicensedStates.test.tsx` | TS2493 | 1 |
| `supabase/functions/recording-retention-purge/voicemail.ts` | TS2322 | 1 |
| `supabase/functions/recording-retention-purge/voicemail.ts` | TS2339 | 1 |
| `supabase/functions/recording-retention-purge/voicemail.ts` | TS2339 | 3 |


## The pre-existing failure: `recordingRetentionVoicemail`

- **Test:** `src/lib/__tests__/recordingRetentionVoicemail.test.ts` › handler wiring › the authentication and conversation-recording purge are byte-identical to deployed v29.
- **Assertion:** `expect(stripped).toBe(region(v29))`, failing with `AssertionError: expected 'import { createClient } from "https:/…' to be 'import { createClient } from "https:/…' // Object.is equality`.
- **Cause, read from the test:**
  - It compares `supabase/functions/recording-retention-purge/index.ts` in the working tree with `git show origin/main:<same path>` (a moving ref, labelled "deployed v29").
  - It first strips three permitted insertions from the **working-tree** copy only.
  - Since PR #388 (`7126ce1`) put those insertions on `main`, the two sides differ by exactly those insertions, and the test fails on `main` itself.
- **Scope:**
  - The branch changes nothing under `supabase/` (`git diff dacd921 HEAD -- supabase/` is empty).
  - The failure is identical at both SHAs.
  - It is `skipIf(!gitRefReadable("origin/main"))`, so it runs only where `origin/main` exists. It runs locally and in `reports-frontend` (`fetch-depth: 0`), and on both sides of that comparison.
- **Not changed here.** It is unrelated to this work, and nothing was deleted, skipped, weakened or silenced. Fixing the test is separate work.

## CI coverage of every changed file

`sms-consent.yml` runs on `pull_request` with a path filter. `reports-frontend.yml` runs on any `src/**` change and executes the whole Vitest suite at the base and the candidate.

| Changed file(s) | `sms-consent` path filter | Executed by |
|---|---|---|
| `src/App.tsx` | `src/App.tsx` (added 2026-10-15) | `pendingSmsBridgeMount.test.ts` in the SMS Vitest step (added 2026-10-15); full suite in `reports-frontend` |
| `src/lib/sms-send/*.ts` (5 modules) | `src/lib/sms-send/**` | `src/lib/sms-send/__tests__` (4 suites) in the SMS Vitest step; the browser fixture |
| `src/lib/sms-intent.ts` | `src/lib/sms-*` | imported by `pendingSmsStore.ts`: `pendingSmsStore.test.ts` (request identity, D2) directly, and every surface suite through the store |
| `src/hooks/usePendingSms.ts` | `src/hooks/usePendingSms.ts` | `conversationThreadPendingSms.test.tsx`, `fullScreenContactViewConversation.test.tsx`; the fixture |
| `src/components/messaging/PendingSmsStatus.tsx`, `PendingSmsAuthorityBridge.tsx` | `src/components/messaging/**` | `pendingSmsStatus.test.tsx`, `pendingSmsBridgeMount.test.ts`, the surface suites; the fixture (it mounts the bridge) |
| `src/components/conversations/ConversationThread.tsx` | `src/components/conversations/**` | `conversationThreadPendingSms.test.tsx`, `conversationThreadIsolation.test.tsx`, `conversationsSendContract.test.tsx`; the fixture |
| `src/pages/Conversations.tsx` | `src/pages/Conversations.tsx` | `conversationsSendContract.test.tsx`, `conversationsViewAs.test.tsx`; the fixture |
| `src/components/contacts/FullScreenContactView.tsx`, `conversation-history/{ConversationTimeline,SmsHistoryItem,conversationTypes}` | `src/components/contacts/**` | `fullScreenContactViewConversation.test.tsx`; the fixture |
| The 8 changed or new test files | covered by the same globs | each is named in the SMS Vitest step (by file or by `src/lib/sms-send/__tests__`) |
| `scripts/tests/sms-responsiveness/**` | `scripts/tests/sms-responsiveness/**` | step "SMS responsiveness fixture": builds the fixture and runs `measure.mjs` with 5 sends. Expected blocks (`SMS_EXPECT_BLOCKED`) warn; anything else fails. Evidence uploads as `sms-consent-browser`. |
| `.github/workflows/sms-consent.yml` | itself | — |

`dialer-dnc-backend` (on `src/**`), `reporting-integrity` (on `src/**`) and `onboarding-emails` (on `src/App.tsx`) also run on this PR. All three are isolated: disposable loopback Postgres and dummy Supabase URLs, with no `secrets.*`.
