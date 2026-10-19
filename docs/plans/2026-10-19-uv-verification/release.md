# Prepared release — not live

Production release requires Chris's exact approval under AgentFlow AGENT_RULES §production access. Scope: the two migrations below; compatible `agentflow-profile-sync` (UV) and `uv-profile-sync-worker` (AF) Edge packages; paired frontend PRs. Existing exclusions/source settings/credentials/RLS/A2P functions remain intact. Do not deploy other functions.

## Migrations
- af: `20261019032157_uv_profile_verification_wizard.sql` SHA256 `79c9851c9d533bb48f0ac8acb8c613090512a35a640c3d4de5bbed22f6158268`
- uv: `20261019032157_agentflow_profile_verification.sql` SHA256 `3cc77401f4cac1da813f77d6b0f13c1d74df1f711b182308e43653300de3be65`

## Sequence
1. Re-read production function hashes/ACLs and migration history. Guarded source hashes must match the migration assertions. Read back each existing Edge package before replacement.
2. Apply UV migration; deploy compatible UV receiver; compare deployed file bytes. Old signed payloads remain accepted; omitted verification stays false and omitted bio is preserved.
3. Deploy compatible AF worker (same payload parser); compare deployed bytes. Apply AF migration. No auto-confirmation or bulk publication; existing profiles pick up the rule on their next relevant save.
4. Merge/deploy reviewed UI candidates only after backend compatibility and CI pass. Verify served bundles, canonical URLs, and unchanged protected owner page. Use the test account for real wizard acceptance only with agent confirmation; no fabricated production biography or license.

## Verification
Local: 120 focused AF tests, 125 UV tests, builds, focused lint; paired old/new receiver path and wizard SQL rollback/scope/required fields tested in isolated PGlite. Native PostgreSQL and desktop/mobile screenshots are CI gates, not claimed passed yet. Exact TypeScript baseline comparison is recorded before release.

## Recovery
Revert frontend deployments to hide the new setup flow if needed. Preserve private confirmation/bio columns, published links and version/revision history. Keep the compatible receiver/worker parser while new payloads exist; never roll a receiver back before producers and queued payloads are reconciled. No destructive rollback of canonical profile/license information. No secret rotation or A2P changes.
