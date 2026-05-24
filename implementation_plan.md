# Implementation Plan — Remove AI Settings Tab from Settings

**Date:** 2026-05-24
**Branch:** `claude/remove-ai-settings-tab-xAhQR`

---

## Goal

Remove the placeholder AI Settings tab from the Settings navigation and renderer. This does not remove any AI backend logic, workflow AI nodes, environment variables, prompt libraries, or Control Center. It only removes the hardcoded placeholder tab that is not a real agency-facing configuration surface.

---

## Scope Confirmed

After reading AGENT_RULES.md, VISION.md, WORK_LOG.md (latest entry: 2026-05-23 — no conflicts), and searching the codebase:

- `Bot` is **only imported for the AI Settings entry** in `settingsConfig.ts`. It is also used independently in: `Sidebar.tsx` (AI Agents nav), `Permissions.tsx` (AI Agents feature), `workflow-types.ts` (assign_ai_agent node), `LandingPage.tsx`, `LandingPageTest1.tsx` — none of those are touched.
- `permissionDefaults.ts` derives `DEFAULT_SETTINGS_SECTIONS` dynamically from `ALL_SETTINGS_SECTIONS`, so removing the entry from `settingsConfig.ts` automatically drops it from permissions — no manual edit needed.
- `?section=ai` needs a redirect in `SettingsPage.tsx` (same pattern as the existing `master-admin` redirect).

---

## Files to Touch (3 files)

| File | Change |
|------|--------|
| `src/config/settingsConfig.ts` | Remove `{ slug: "ai", icon: Bot, label: "AI Settings" }` from "Automation & API" sections; remove `Bot` from the import line |
| `src/components/settings/SettingsRenderer.tsx` | Remove `case "ai":` block (the hardcoded provider/model input renderer) |
| `src/pages/SettingsPage.tsx` | Add `?section=ai` → `my-profile` redirect in the existing redirect `useEffect` |
| `WORK_LOG.md` | Append newest-first entry |

---

## Do Not Touch

- AI backend logic
- Workflow AI nodes/actions (`workflow-types.ts`, workflow Edge Functions)
- `src/components/layout/Sidebar.tsx` (AI Agents nav item uses `Bot` independently)
- `src/components/settings/Permissions.tsx` (AI Agents feature gate uses `Bot` independently)
- Environment variables
- Prompt libraries
- Control Center
- Database schema/RLS
- Any other Settings tab

---

## Diff Preview

### 1. `src/config/settingsConfig.ts`

Remove `Bot` from the import; remove the `ai` entry from "Automation & API":

```diff
-  Building2, Users, Phone, FileText, List, Zap, Mail, Shield,
-  Bot, Ban,
+  Building2, Users, Phone, FileText, List, Zap, Mail, Shield,
+  Ban,
...
-      { slug: "ai", icon: Bot, label: "AI Settings" },
```

### 2. `src/components/settings/SettingsRenderer.tsx`

Remove `case "ai":` block (lines 56-65):

```diff
-    case "ai": return (
-      <div className="space-y-4">
-        <h3 className="text-lg font-semibold">AI Settings</h3>
-        ...
-      </div>
-    );
```

### 3. `src/pages/SettingsPage.tsx`

Add redirect in the existing `useEffect`:

```diff
     if (searchParams.get("section") === "master-admin") {
       setSearchParams({ section: "my-profile" }, { replace: true });
     }
+    if (searchParams.get("section") === "ai") {
+      setSearchParams({ section: "my-profile" }, { replace: true });
+    }
```

---

## Verification Plan

1. `npx tsc --noEmit` — 0 errors expected
2. `npm test -- --run` — all tests pass
3. Manual: Settings sidebar no longer shows "AI Settings"
4. Manual: `?section=ai` redirects to My Profile
5. Manual: No other Settings tab affected

---

## Awaiting Chris's Explicit Approval Before Modifying Files
