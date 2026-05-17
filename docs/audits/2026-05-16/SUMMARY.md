# Documentation Restructure — Audit Summary (2026-05-16)

## Deliverable paths

| File | Purpose |
|------|---------|
| `docs/audits/2026-05-16/AUDIT_REPORT.md` | Full eight-area audit + open questions |
| `docs/audits/2026-05-16/AGENT_RULES.draft.md` | Replacement `AGENT_RULES.md` |
| `docs/audits/2026-05-16/VISION.draft.md` | Replacement `VISION.md` |
| `docs/audits/2026-05-16/WORK_LOG.draft.md` | Replacement `WORK_LOG.md` (Twilio era forward) |
| `docs/audits/2026-05-16/WORK_LOG_2026_pre_twilio.draft.md` | Archive pre-2026-04-18 Section 3 history |
| `docs/audits/2026-05-16/SUMMARY.md` | This file |

**Note:** Drafts live under `agentflow-life-insure/` (actual repo root). No live files were modified.

---

## Operations when Chris approves

### Renames / moves

1. `git mv agentflow-life-insure/ROADMAP.md agentflow-life-insure/WORK_LOG.md`
2. `mkdir -p agentflow-life-insure/docs/archive`
3. `git mv` or copy approved `WORK_LOG_2026_pre_twilio.draft.md` → `docs/archive/WORK_LOG_2026_pre_twilio.md`
4. Replace `AGENT_RULES.md` with `AGENT_RULES.draft.md` (or merge diff)
5. Replace `VISION.md` with `VISION.draft.md`
6. Replace `WORK_LOG.md` body with `WORK_LOG.draft.md` (trimmed structure)

### Content strips (from old ROADMAP)

- Remove **§1 System Status & Module Health** → absorbed into `VISION.md` + `AGENT_RULES.md`
- Remove **§4 Phase 4 Deployment Strategy**
- Remove **§5 Refactor & Technical Debt** (open items → AGENT_RULES “Known Tech Debt” or close)
- Remove duplicate **Context Snapshot** sections §5–§9 at file tail (optional: mine any still-open items first)
- Remove Telnyx references in **`docs/index.html`**, **`docs/SETTINGS_LAYOUT.md`**, **`docs/DIALER_DIAGNOSTIC_REPORT.md`**

### Post-rename reference updates

- Cursor rules / user rules that say “read ROADMAP.md” → **`WORK_LOG.md`**
- `AGENT_RULES.md` golden rule #1: read **`WORK_LOG.md`**

---

## Resolve before commit (from audit §9)

1. Decommission **Telnyx Edge Functions** on production?
2. Apply **`tasks`** migration or keep deferred?
3. Ship **`campaigns.leads_called`** or remove UI?
4. **`dial_sessions`** — build or cancel?
5. Mark **Conversations** GA and **AI Agents** mock-only in VISION?
6. Document **home org UUID** in AGENT_RULES?
7. Confirm **workflow pg_cron** + `private.workflow_engine_config` populated?
8. Redeploy **`twilio-buy-number`** / **`twilio-trust-hub`** with `verify_jwt: false`?

---

## Suggested git commit sequence

```bash
cd /Users/CHRIS/AgentFlow/agentflow-life-insure

# 1. Archive + rename (structure only)
git mv ROADMAP.md WORK_LOG.md
mkdir -p docs/archive
cp docs/audits/2026-05-16/WORK_LOG_2026_pre_twilio.draft.md docs/archive/WORK_LOG_2026_pre_twilio.md

# 2. Replace governing docs from approved drafts
cp docs/audits/2026-05-16/AGENT_RULES.draft.md AGENT_RULES.md
cp docs/audits/2026-05-16/VISION.draft.md VISION.md
cp docs/audits/2026-05-16/WORK_LOG.draft.md WORK_LOG.md

# 3. Docs hygiene (separate commit recommended)
# Edit docs/index.html, docs/SETTINGS_LAYOUT.md — Telnyx → Twilio

# 4. Commit
git add AGENT_RULES.md VISION.md WORK_LOG.md docs/archive/ docs/audits/
git commit -m "$(cat <<'EOF'
docs: restructure governing docs after 2026-05-16 audit

Rename ROADMAP to WORK_LOG, archive pre-Twilio history, and align
AGENT_RULES and VISION with Twilio single-leg production reality.
EOF
)"
```

Optional follow-up commits: decommission Telnyx functions, apply `tasks` migration, fix `verify_jwt` deploy drift, `DialerPage` refactor.

---

## Three most critical deltas

1. **Telephony:** Production is **Twilio single-leg WebRTC**; **VISION** and **docs/** still say Telnyx; **15+ Telnyx Edge Functions** still deployed though removed from repo.
2. **Schema narrative:** **`organizations` exists**; ROADMAP still lists it as missing; **`tasks` / `dial_sessions` / `leads_called`** still missing on prod.
3. **Scale debt:** **`DialerPage.tsx` (3,806 lines)** and **`TwilioContext.tsx` (2,149 lines)** far exceed the 200-line rule — feature work must go in subcomponents.

---

## Blockers encountered during audit

- None for read-only audit.
- **WORK_LOG drafts** are large (~300k chars post-Twilio) because they preserve full ROADMAP work-log prose; review in editor with fold/search.
- Migration disk vs remote version IDs differ for the same logical change — always use Supabase **`list_migrations`**, not filename equality.
