# Commissions navigation — money icon

**Status:** approved for implementation by Chris on 2026-10-20. Branch `codex/commissions-dollar-icon-20261020` from main `e76245414d1348c6483beccb85543443c2c214c1`.

## Scope
Replace the Commissions sidebar icon from Lucide `Wallet` to `CircleDollarSign` (circled dollar symbol). Keep the existing `MainNavItem` icon dimensions, collapsed/mobile rendering, route, label, active styling, permission gating and View As restrictions unchanged.

## Intended files (before implementation)
- `src/components/layout/CommissionsNavItem.tsx`: replace the icon import and prop only
- `WORK_LOG.md`: append newest-first implementation evidence
- This plan: record approval, scope, verification and release boundary

## Guardrails and verification
Read `AGENT_RULES.md`, `VISION.md`, and the newest `WORK_LOG.md` first; preserve all current Commissions Center invariants. This is frontend-only; no database, API, commission math, payment writer, auth or telephony changes. Create a feature-branch PR, do not push to main or deploy without separate release approval. Verify exact source diff, applicable Actions checks (including TypeScript / `npx tsc --noEmit` when supported) and navigation consistency for collapsed/mobile via the shared component. Report any verification not executable.

## Context snapshot
Approved decision: use `CircleDollarSign` (not a literal text or emoji). No migrations or deployment approved.
