# Implementation Plan — Conversation History call-disposition badges use agency disposition colors

**Task branch:** `claude/conversation-history-disposition-colors` (from `origin/main` `74e9942` = PR #359 squash-merge)
**Date:** 2026-08-18 · **Status:** PLAN — awaiting Chris's approval. No source file modified. Supersedes the shipped #359 plan (WORK_LOG 2026-08-17 records that ship).
**Reading:** AGENT_RULES.md + VISION.md unchanged since the 2026-08-17 full read (verified by diff `018739e..74e9942` — the only delta on main is #359 itself); newest WORK_LOG entries (2026-08-17 redesign, 2026-08-12 policy-dates) read.

## Root cause (confirmed on merged main)

`CallHistoryItem.tsx` renders the disposition badge with hardcoded neutral classes `bg-muted text-foreground/70` — agency colors in `dispositions.color` are never consulted, so "Appointment Set" shows gray.

## Surgical fix

1. **`src/components/contacts/FullScreenContactView.tsx`** — add one org-scoped `dispositionsSupabaseApi.getAll(organizationId)` promise to the existing parallel `loadData` fetch (guarded on `organizationId`; **`.catch` → `[]` + `console.error`** so a failure can never reject the conversation load or trigger the load-error notice — `getAll` throws on error). Build `dispositionColors: Record<string, string>` keyed by the canonical `normalizeDispositionValue(name)` (trim + lowercase, reused from `supabase-contacts.ts` per AGENT_RULES §5 — no new normalizer), values = `dispositions.color`. One fetch per contact open, zero per-item queries. Pass to `<ConversationTimeline dispositionColors={…}/>`.
2. **`ConversationTimeline.tsx`** — optional `dispositionColors?: Record<string, string>` prop, passed through to `CallHistoryItem` only.
3. **`CallHistoryItem.tsx`** — resolve `dispositionColors?.[normalizeDispositionValue(item.dispositionName)]`; when found, badge renders `style={getStatusColorStyle(color)}` (existing treatment: rgba-tinted background, matching colored text, matching border via an added `border` class); when absent (unknown/deleted legacy name, fetch failed, no map) the current neutral `bg-muted text-foreground/70` badge stays byte-identical. The status text shown when no disposition exists stays muted/neutral. Card shell unchanged. **Not** pipeline-stage colors — `dispositions.color` only.
4. **NEW `src/components/contacts/__tests__/conversationDispositionColors.test.tsx`** — fail-first (run against unmodified source first): (a) "Appointment Set" with `#8B5CF6` renders `color: #8B5CF6` + `rgba(139, 92, 246, 0.15)` background; (b) trimmed case-insensitive match (`" appointment set "` row ↔ configured "Appointment Set"); (c) unknown legacy disposition keeps the neutral classes and no inline style; (d) `getAll` rejection → timeline still renders all items, badge neutral, no load-error notice; (e) SMS/email/details/recording assertions unchanged in the same render.
5. `implementation_plan.md` (this file) · `WORK_LOG.md` entry after implementation. **No other file.**

## Verification

Fail-first record → implement → focused new suite + existing `fullScreenContactViewConversation` / `conversationTypes` / `fullScreenContactViewQuickCall` / `fullScreenContactViewScore` suites → full contacts suites → `npx tsc --noEmit` + app-tsc multiset vs clean-main worktree (zero new errors) → ESLint (new/touched files clean; FSCV multiset ≤ main) → `npm run build` → `git diff --check`. No deploy, no merge.

## Exclusions honored

No schema/migration/RLS/Edge/backend change; no disposition-settings, pipeline-stage, Dialer, SMS/email, or feature changes. `getStatusColorStyle`'s inline style object is the established house pattern for dynamic DB colors (FSCV status pill precedent) — not a Tailwind-only violation.

**STOP — awaiting Chris's approval before touching source files.**
