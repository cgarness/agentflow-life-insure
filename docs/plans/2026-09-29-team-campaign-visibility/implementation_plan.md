# Team campaign details — narrowed display-only release

Chris clarified on October 2, 2026 at 19:22 LA: show the current Team campaign lead's details without blur, like Personal, while keeping existing locking logic. Proceed approved.

## Implementation

Use the existing Team field grid and loaded campaign/master data immediately after the canonical queue confirms this agent's current lock. Display does not wait for outbound ringing, answer, or hard claim. Keep actual call state for Edit/Sold/Convert. Preserve Personal and Open Pool behavior. Hide stale rows during loading, advance, context switch, and lock loss.

Files: src/pages/DialerPage.tsx; src/components/dialer/LeadCard.tsx; comments in TeamOpenLeadDetails.tsx; src/hooks/useTeamCampaignLeadVisibility.ts; src/lib/teamCampaignLeadVisibility.ts; corresponding hook/card/page/wiring tests. Reuse previously tested display implementation. No new dependencies or data reads.

Remove the unused display RPC hook and tests, pending P2 migration, backend-only workflow/runner/fixtures and recovery script from the release. Update this plan, the withdrawn design, root §21, WORK_LOG and PR #401. Retain the two already-applied migration files exactly as the production record; do not rerun or roll them back as part of a UI change.

## Release and verification

Run focused Team display, page, lock/claim/reveal regression tests; root TypeScript and production build; compare existing application diagnostics via CI. Publish the revised PR, verify exact-head CI, merge, and observe the production deployment.

## Scope and limits

No manager review screen, historical association validation, ownership repair, membership change, database mutation, or new Contacts permission is part of this release. The former global P2 release gate is withdrawn with that unshipped expansion, not bypassed. Existing Contacts authorization still controls which master fields are returned; removing blur cannot synthesize a master field that the current data read does not return. The existing campaign-copy notice remains for that case. This release must not be described as changing those data permissions.
