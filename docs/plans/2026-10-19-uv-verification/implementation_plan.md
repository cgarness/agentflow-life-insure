# UV profile verification wizard — October 19, 2026

Chris requested implementation on October 18 at 20:19 PDT. This scoped request authorizes preparing the implementation and reviewable release. Production backend changes retain AGENT_RULES' exact release approval gate.

## Behavior
- Settings > My Profile has Get verified / Edit verified profile. Modal steps: identity/photo/contact, NPN and canonical state licenses, optional bio and review/confirmation, genuine pending delivery, success only after acknowledgment. Prefill current data on open; preserve drafts on failure. Profile changes remain canonical in AgentFlow.
- Six required items: photo, first+last name, phone, email, NPN, at least one state+license number. No expiration requirement or expiry-based verification; badge means profile details confirmed by the agent, not independent credential checking. Optional dates elsewhere remain untouched.
- Store confirmation and bio in existing private sync row. Derive completeness server-side on each relevant saved change; withdraw badge if incomplete, private, disabled, or not delivered. Stable page URL. No indefinite polling: short pending acknowledgment window only.
- Dark slate View page action, outlined Copy link; emerald badge/accent. Controls on profile remain navigation/copy. Setup in Settings only.
- Receiver accepts optional bio/profile_verified extension to existing signed protocol before sender emits it. Managed profile bio becomes AgentFlow-owned. Protected owner/A2P exclusions, consent forms, sources, messaging, RLS and tenant scope stay intact.

## Files
AF: additive migration; paired payload parser; setup API/hook/wizard/action components; focused UI and SQL integration tests; existing CI; WORK_LOG and AGENT_RULES.
UV: additive migration; paired payload parser; public agent loader/types/badge components; focused public rendering tests; WORK_LOG.

## Verification
Run isolated PostgreSQL/PGlite paired handler tests, save-driven tests, wizard validation/failed-save/pending/confirmed tests, badge removal and tenant/exclusion denial. Preserve exact-base TypeScript diagnostics, run focused lint and builds. Review actual desktop/mobile components through browser CI. Check exact-head CI before release.

## Release and recovery
Read-only preflight function hashes/ACLs and migrations. Deploy compatible receiver migration/Edge, compatible sender Edge, then AF migration (no policy edits), then frontends. One bounded requeue of already-public nonexcluded profiles may be included explicitly in approved release to publish undated licenses; never auto-confirm existing agents. No secrets or source activation changes. Recovery: retain new columns/confirmations, disable new wizard UI and revert protocol producers first; never roll back a receiver while newer payloads are queued. Exact files/hashes/evidence in release.md before asking approval.
