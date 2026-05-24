# Implementation Plan — Remove Legacy Master Admin Settings Tab

Remove the legacy, generic database-editing Settings tab ("Master Admin") because it has been fully replaced by dedicated settings tabs (Agencies, Control Center, and Super Admin org access).

## User Review Required

> [!IMPORTANT]
> - **Removal of Master Admin:**
>   - The "Master Admin" section will be removed from the Settings page config.
>   - The file `src/components/settings/MasterAdmin.tsx` will be deleted.
>   - Any references to `"master-admin"` in the rendering system and configuration will be cleaned up.
>   - Direct URL navigation to `?section=master-admin` will fall back safely to `My Profile` or the placeholder view.

## Open Questions

There are no outstanding open questions.

## Proposed Changes

---

### Settings Configuration

#### [MODIFY] [settingsConfig.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/config/settingsConfig.ts)
- Remove `{ slug: "master-admin", icon: Database, label: "Master Admin" }` from the `SETTINGS_CONFIG` array under the `System` category.

---

### Permissions Defaults

#### [MODIFY] [permissionDefaults.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/config/permissionDefaults.ts)
- Remove `"master-admin"` from the `PLATFORM_ONLY_SETTINGS_SLUGS` constant array:
  ```typescript
  export const PLATFORM_ONLY_SETTINGS_SLUGS = ["twilio-connection"] as const;
  ```

---

### Settings Rendering

#### [MODIFY] [SettingsRenderer.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/settings/SettingsRenderer.tsx)
- Remove `import MasterAdmin from "@/components/settings/MasterAdmin";`.
- Remove the `case "master-admin"` switcher branch.

---

### Component Deletion

#### [DELETE] [MasterAdmin.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/settings/MasterAdmin.tsx)
- Delete the legacy generic database editing component file entirely.

---

### Documentation & History

#### [MODIFY] [WORK_LOG.md](file:///Users/chrisgarness/Projects/agentflow-life-insure/WORK_LOG.md)
- Log the removal of the Master Admin tab newest-first.

---

## Verification Plan

### Automated Tests
- Run typechecking to verify no broken imports or stale TS references:
  ```bash
  npx tsc --noEmit
  ```
- Run tests:
  ```bash
  npm test -- --run
  ```

### Manual Verification
1. Log in as Super Admin, navigate to Settings, and verify that "Master Admin" is no longer visible in the sidebar/navigation under "System".
2. Manually append `?section=master-admin` to the URL. Verify that it falls back safely to default/placeholder/My Profile, does not render the old generic editor, and produces no console errors.
