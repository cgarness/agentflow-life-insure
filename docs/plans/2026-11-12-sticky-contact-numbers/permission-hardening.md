# Sticky Contact Numbers — permanent-change permission correction

November 19, 2026 Pacific. Scope: the existing Sticky Contact Numbers candidate on PR #531, serving the primary AgentFlow project at fflagent.com. Production installation and activation remain separately held. The additional Vercel project is outside this release scope.

## Finding and correction

The candidate's permanent-change RPC verified contact visibility, organization, ownership and hierarchy, but did not call the existing `has_contacts_permission` gate. A readable Agent-owned lead could therefore be reassigned even with `contacts.leads.edit = false`. The shared-endpoint helper also dropped contact type, so it could not require edit permission for every lead, client and recruit sharing a recipient phone. Separately, SQL NULL made the audit-reason length predicate unknown instead of true; the RPC accepted a missing reason. These defects were reproduced against the original four candidate migrations, not inferred from UI behavior.

The CLI-generated `20261120060345_sticky_contact_numbers_edit_permissions.sql` replaces only `private.affinity_all_editable` and `public.change_contact_number`. The public RPC requires the addressed contact's exact edit capability before creating or changing an assignment. The helper retains each shared row's contact type and requires its existing edit permission plus the existing owner/Admin/Team Leader hierarchy rule. It verifies the actual session actor, active profile, organization and role. NULL/invalid channels and NULL/blank/out-of-range reasons are refused; valid reasons are whitespace-normalized and retained in the audit event.

Both original function definitions have exact preimage guards. `CREATE OR REPLACE` preserves owners, grants and security modes. No contact RLS, permission defaults, sender readiness, ordinary sends, previews, call admission, number enrollment or policy membership is changed. The four earlier migration sources remain byte-identical. This correction is a fifth new migration and must not be substituted into a historical file.

## Native regression evidence

The isolated PostgreSQL 17.11 baseline rebuilt from the full repository and retained applied-source captures matched all 85 function and 45 table catalog comparisons. Its database listens on loopback only; fixtures use reserved synthetic identities. The Sandbox contains no production credentials and permits no Supabase or Twilio destinations.

The updated `scripts/sticky-numbers/database-tests.mjs` retains the original 52 groups and adds 14 independent groups, using the real `authenticated` role, real RLS and real permission records:

- Agent and Team Leader × leads, clients and recruits: readable contacts refuse permanent change/reset with the matching edit flag false, on new and established assignments.
- Shared lead/client/recruit endpoints require every relevant edit key, including downline ownership.
- Existing missing-row/missing-key defaults and Admin authority remain intact.
- NULL, blank, whitespace-only, short and oversized reasons, plus NULL/invalid channels, refuse without any assignment, version or audit mutation.
- Valid three-character and 200-character reasons preserve exact normalized audit evidence.

Two independent runs against the original four migrations fail with `Missing expected rejection`: denied edit permission and NULL audit reason. The same test code against all five migrations passes all 66 groups. Failed operations compare complete assignment and event JSON, including absence of newly created rows. Permission fixtures and Team Leader hierarchy changes are restored exactly.

`STICKY_TEST_GROUP=edit-permissions`, `change-validation`, or `hardening` selects only the new regression groups; an unset selector runs all 66. The test runner still refuses external database URLs.

## Other verification and release scope

`npx tsc --noEmit`, Node syntax validation and scoped ESLint on the changed test runner pass. Application TypeScript still reports exactly the same 78 diagnostics as the saved main baseline and previous candidate after line-number normalization; no new diagnostics were introduced. The frontend and five complete Edge deployment packages are unchanged. Existing Edge/browser/performance proofs remain applicable; this update changes only permanent reassignment and its tests.

The release transaction is regenerated for all five migrations, with exact history bytes and all feature modes off. The old four-migration installation hash is superseded. The active release packet identifies the newly rehearsed installer, postimages and primary-only frontend path. No production SQL, deployment, settings change, history seed, activation, real call or text was performed in this correction.

Current read-only production checks found 22 of 22 active agency numbers registered, in the sender pool and selected by the existing policy. That is current readiness evidence, not work performed by this correction and not an automatic-enrollment implementation. Future automatic enrollment remains separate.
