# Historical commission backfill — five-policy preparation

**Status:** IN DEVELOPMENT on `chatgpt/commission-age-optional-20261023`; **no production data changes authorized or performed**.

## Goal and authorization
Chris requested that AgentFlow prepare past sales for commission tracking without agents opening each policy, then limited the first batch to four Americo sales and one Mutual of Omaha sale. He explicitly requested that ChatGPT make the code changes. This authorizes a branch, tests, and reviewable pull request only. Applying a migration, merging/deploying the frontend, and saving historical commission estimates are separate production approvals.

Read before implementation: `AGENT_RULES.md`, `VISION.md`, the latest entries in `WORK_LOG.md`, and the saved-commissions Phase 2A and Commissions Center contracts. The existing agent-level commission access, captured seller, immutable estimate history and 75% advance remain unchanged.

## Read-only production findings (2026-10-23)
In the home organization there are 23 linked sales, 11 without active/on-hold commission estimates, nine of those predating the October 20 frontend release. Exactly five currently unestimated primary-policy sales match carrier names normalized by trim and lowercase to Americo (four) or Mutual of Omaha (one). They are credited to two agents, and each has a policy premium, sale date, effective date and agent level 80; no insured age or DOB was saved. These are production observations, not a write manifest. Do not commit client names, policy IDs, contact identifiers, private rates outside approved tests, or customer data.

Current selected FFL compensation grid revision 5 is effective **2026-10-16**. At level 80 it offers age-unrestricted Americo Eagle Premier (75%) and Mutual of Omaha Final Expense (70%). These products and rates are *candidates*, not verified sold products or historical commission contracts. Americo client rows describe only Final Expense or Whole Life; exact Eagle Premier product identity is not recorded. There is no authority to backfill using an assumed product or to represent today's grid as the sale-time grid.

## Implementation
1. **Age optional only for wholly age-independent products.** Treat age as `null` when genuinely unknown; do not infer it or save `0` as a placeholder. If any variant on the selected product has a minimum or maximum age, the age stays required. Keep term-length validation and ambiguous matches strict. This applies to the preview and record-later flows; the general Calculator remains age-required unless explicitly designed otherwise.
2. **Database migration (not applied).** Drop `NOT NULL` on `insured_age` in the captures and estimates tables; retain `CHECK 0..100` for non-null ages. Adjust `private.policy_commission_valid_slot` to accept JSON null only for insured age while requiring all other fields; adjust `private.policy_commission_grid_facts` to reject unknown age if ANY product variant has an age bound, even if another variant is unbounded. Preserve function owners, ACL, signature, RLS, replay, writer authorization, all other validations and audit history; guard migrations against unexpected function drift.
3. **Frontend.** Allow a missing age only in the policy commission preview for wholly age-independent products; send JSON `null` in the estimate's captured inputs, parse nullable age on reads, and label the input optional. Never auto-select an unverified insurance product or assume carrier-specific rules from a policy-type label.
4. **Backfill preview (no writes).** Provide an operator-readable, aggregate/sanitized report of the five eligible sale records and missing inputs with a strict five-policy gate; never create a second commission writer or automatically mark receipts paid. Execution should reuse authenticated `record_policy_commission_estimate_later` with request IDs, per-policy idempotency, existing permission checks and explicitly selected products. No batch may proceed until its exact policy-to-product mapping, estimated amounts and applicable historical rates have separate approval.
5. **Tests.** Cover null-age success on wholly unbounded products, null-age refusal on bounded and mixed products, fixed age behavior, overlap failure, schema parsing, case/trim carrier matching, sale-time product non-inference, zero/unknown premium, idempotency and duplicate guard. Run `npx tsc --noEmit` and targeted Vitest/SQL harness where supported.

## Intended files before editing
- `supabase/migrations/20261023180000_policy_commission_optional_age.sql` (new)
- `supabase/tests/policy_commission_optional_age.sql` (new)
- `src/lib/commission/{matching,calculator,schemas,policyPreview,capture,trackingSchemas}.ts`
- `src/components/commission/preview/{PolicyCommissionEstimate,PolicyCommissionInputs}.tsx`
- `src/lib/commission/__tests__/{policyPreview,capture}.test.ts` (and focused tests if needed)
- `scripts/policy_commission_historical_preview.sql` (new, read-only review)
- `docs/plans/2026-10-23-historical-commission-backfill/implementation_plan.md`
- `WORK_LOG.md` (preserve all prior entries, prepend newest first)
- `AGENT_RULES.md` only if a new invariant is verified

## Release gates
A. Build and verify on a feature branch, leave as draft PR, do not push main.
B. Explicit migration approval with exact migration diff, then read-back, advisor checks and validation.
C. Separate approval for frontend release and runtime verification.
D. Review exact **five** policy IDs, seller ownership, selected actual product, historical/current rate basis, premium source, rounding and amounts; approve this manifest explicitly before any commission data mutation. Apply through reviewed authenticated writer(s), verify five current estimates, original sales unchanged, no duplicate/installment/receipt anomalies. Recheck for drift before any write.

## Context snapshot
- Decisions: don't invent age; exact product must be selected, not inferred; historical rates unverified.
- Backend: no migration applied; data untouched.
- Blocker: product identity not confirmed; age-required production schema remains active until separately approved.
- Next: finish branch edits/tests and open a draft PR for review.
