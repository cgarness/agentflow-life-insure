

## Plan: Consolidate Phone System Settings

### What changes

Merge four separate settings sections — **Telnyx & Phone Numbers**, **Voicemail Drop Manager**, **Inbound Call Routing**, and **Predictive Dialer** — into a single **Phone System** tab with internal sub-tabs.

### Implementation

**1. Create `src/components/settings/PhoneSystem.tsx`**
- A wrapper component with a `Tabs` layout (using the existing radix tabs UI).
- Four sub-tabs: **Telnyx & Numbers**, **Voicemail Drops**, **Inbound Routing**, **Predictive Dialer**.
- The first tab renders the existing `<PhoneSettings />` component.
- The other three tabs render their current inline content (voicemail, routing, dialer currently fall through to the generic placeholder in `renderContent`). They will be given dedicated placeholder sections within this component, ready for future buildout.

**2. Update `src/pages/SettingsPage.tsx`**
- Remove the four individual entries from the `sections` array (`phone-settings`, `voicemail`, `routing`, `dialer`).
- Add one entry: `{ slug: "phone-system", icon: Phone, label: "Phone System" }`.
- In `renderContent()`, add `case "phone-system": return <PhoneSystem />;` and remove the old cases.
- Import the new `PhoneSystem` component.

### Result
The sidebar will show a single "Phone System" item. Clicking it shows a tabbed interface with all four sub-sections.

