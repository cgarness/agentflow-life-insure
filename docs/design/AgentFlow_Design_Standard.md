# AgentFlow design palette
Version 1.0 · November 20, 2026 · Signed-in CRM

Use this reference when designing or reviewing an AgentFlow feature. A familiar page has a neutral workspace, one obvious next action, and compact, clearly labeled states. The same roles apply to Dialer, Inbounds, Commissions, Reports, Settings and Automations.

## Foundation

Preserve the AgentFlow wordmark, Inter typography, navy-and-slate surfaces and the app's light default. Honor the selected theme on new screens, dialogs and menus. Inbounds already has a dedicated dark workspace. Use its contrast and visual hierarchy as inspiration for other operational screens. Keep the standard app shell around a feature.

The existing theme defines HSL variables in `src/index.css`, exposes them through `tailwind.config.ts`, and consumes them in `src/components/ui/`. The following values are the v1 design targets. Canvas, cards, primary text, dividers and report series follow the current theme. The asset blue is sampled from the existing logo. Deeper action fills, distinct link and hover roles, stronger control outlines and paired status colors are proposed shared-theme refinements. This guide is a design reference. Theme refinements take effect when integrated into the shared primitives.

## Color roles

| Role | Light | Dark | CSS token target | Use |
| --- | --- | --- | --- | --- |
| Canvas | `#FFFFFF` | `#090E1A` | --background | Page background |
| Card or menu | `#FFFFFF` | `#0F1729` | --card, --popover | Grouped content and overlays |
| Hover surface | `#F1F5F9` | `#1D283A` | --accent / --muted | Interactive rows and secondary controls |
| Main text | `#0F1729` | `#F8FAFC` | --foreground | Headings, values and body copy |
| Secondary text | `#475569` | `#94A3B8` | --muted-foreground | Timestamps, field hints and supporting labels |
| Divider | `#E1E7EF` | `#1D283A` | --border | Subtle separation between groups |
| Control outline | `#64748B` | `#71839B` | --input | Visible boundaries for editable fields and outline buttons |
| Action fill | `#1D4ED8` | `#2563EB` | --primary | Highest-priority action in a region |
| Action label | `#FFFFFF` | `#FFFFFF` | --primary-foreground | Text on filled action and danger buttons |
| Action hover | `#1E40AF` | `#1D4ED8` | --primary-hover (new) | Pointer over a primary button |
| Action pressed | `#1E3A8A` | `#1E40AF` | --primary-pressed (new) | Active pointer or keyboard press |
| Link and focus | `#1D4ED8` | `#93C5FD` | --link (new), --ring | Links and two-pixel keyboard focus ring |
| Danger action | `#B91C1C` | `#B91C1C` | --destructive | Destructive confirmation, with a white label |
| Action blue (logo) | `#3B82F6` | `#3B82F6` | existing logo artwork | Wordmark and small brand accents |

Match card text to the corresponding foreground. Use the shared sidebar palette for navigation. Give the active destination a visible selection marker and a programmatic current state. The wordmark blue stays available for branding even when a button needs a deeper fill.

## Status badges

Each color pair below is ordered **text / background**. Render an explicit status name in sentence case. Add a small icon when it makes similar states easier to distinguish. Informational statuses use badge styling. Links use an underline in body copy.

| Role | Light pair | Dark pair | AgentFlow examples |
| --- | --- | --- | --- |
| Neutral | `#475569` / `#F1F5F9` | `#CBD5E1` / `#1D283A` | Draft, offline, routine pending |
| Information | `#1E40AF` / `#EFF6FF` | `#BFDBFE` / `#172B4A` | Scheduled, syncing, on a call |
| Success | `#166534` / `#DCFCE7` | `#86EFAC` / `#103329` | Registered, paid, available |
| Attention | `#92400E` / `#FEF3C7` | `#FCD34D` / `#392B16` | Action needed, overdue |
| Problem | `#991B1B` / `#FEE2E2` | `#FDA4AF` / `#3A1C28` | Failed, blocked, chargeback |

Use neutral for a commission awaiting its expected payment. Switch to amber when the agent has a follow-up to do. On Phone Numbers, show “Registered” only after the number's SMS registration is confirmed. Keep agency A2P approval and number registration distinct. Red belongs to failed or blocked work and destructive actions. Keep an ordinary “Cancel” dialog button secondary.

Use the existing Badge primitive with shared status variants. Suggested variant names are neutral, info, success, warning and error. Introduce paired badge-text and badge-surface variables centrally when adopting them. The current Badge primitive includes default, secondary, destructive and outline.

## Reporting and recognition

| Existing chart role | Light | Dark |
| --- | --- | --- |
| Production | `#109384` | `#2BD4BD` |
| Appointments | `#773CDD` | `#AA7EF1` |
| Closes | `#DC8F09` | `#FBBD23` |

Keep the existing report-production, report-appointment and report-close mappings across dashboards. Use a legend or direct label and distinguish series with a marker or line style. For chart geometry needed to read data, check contrast against the plot background and adjacent marks. For example, outline a gold close marker on white with `#92400E`. Keep chart labels in the primary text color. Gold may also mark first place with a trophy and a written rank on the leaderboard.

## Screen and component recipes

- **Header and layout.** Place a short page title on the left and the primary action on the right. Stack them on narrow screens. Use a 4 px spacing unit, with 8 px between controls, 16 px inside compact groups and 24 px between major sections. Keep action and state feedback visible without horizontal page scrolling.
- **Type.** Use Inter with a system sans-serif fallback. Use 24/32 px semibold for page titles, 18/24 px semibold for section headings, 14/20 px regular for body or table cells, 14/20 px medium for controls, and 12/16 px medium for metadata. Use 16 px input text on phones. Use 28–32 px semibold and tabular numerals for headline metrics. Keep labels short and in sentence case.
- **Buttons.** One filled primary action per task region. Use outline for secondary actions, ghost for low-emphasis utilities, and the shared destructive variant for a destructive confirmation. Standard height is 40 px, with a 44 px touch target on phones. Use a 6 px corner radius, a 2 px focus ring and a 2 px offset. Keep the label on busy buttons and use a short verb such as “Saving…”. Prevent duplicate submission.
- **Forms and dialogs.** Use a persistent label above each field and a 6 px radius on the control. An error gets a problem-colored message next to the field and a programmatic association. Keep the entered value. A dialog uses the current theme, one clear action and a secondary “Cancel”. Keep keyboard focus inside the open dialog and restore it to the opener on close.
- **Cards and metrics.** Use an 8 px corner radius, 1 px divider border and 16–24 px padding. Show the number prominently with a short label. Restrict KPI accent colors to a small icon, trend or series. Use horizontal dividers or spacing inside a card.
- **Tables and navigation.** Use sentence-case headers, left-aligned names and right-aligned comparable numbers. Align numbers with tabular figures. Give interactive rows a quiet hover, selected rows a persistent marker, and keyboard actions a visible focus ring. On phones, prioritize the record name and state. Put secondary columns in a detail view or allow contained horizontal table scrolling.
- **Motion and feedback.** Use a 150 ms color transition on controls and up to 200 ms for a dialog or panel. Honor reduced-motion preferences. Use visible progress for a slow action, an inline retry for recoverable errors, and a concise empty state with a relevant action. Keep real-time metric updates from shifting the layout.

## Review a new feature

1. Compare a desktop and phone layout in both supported themes. Check the layout at 375 px wide and confirm the primary action and state are easy to find.
2. Walk the primary path using the keyboard. Check focus, hover, pressed, disabled, loading, empty, success and error states where they apply.
3. Aim for at least 4.5:1 for regular text and 3:1 for essential control boundaries and visible focus indicators. Check the actual foreground/background pairing, including hover and tinted badges. Use text or a symbol to communicate each status. The v1 white-on-blue action text measures 6.70:1 in light mode and 5.17:1 in dark mode.
4. Use the shared Button, Input, Badge, Card, Table, Tabs and Dialog components. Look up an existing role before adding a color. If a role is missing, add it once to the shared theme with light/dark values and update this reference. Page code should reference role names such as `bg-primary`, `text-foreground` and `bg-card`.

**Reusable line for feature briefs**

> Follow the AgentFlow Design Palette v1. Use shared components and named color roles, preserve light and dark mode, and review desktop, phone and keyboard states before release.

## Source references

- [Theme colors](https://github.com/cgarness/agentflow-life-insure/blob/main/src/index.css)
- [Tailwind roles and Inter](https://github.com/cgarness/agentflow-life-insure/blob/main/tailwind.config.ts)
- [Default theme](https://github.com/cgarness/agentflow-life-insure/blob/main/src/App.tsx)
- [Shared button](https://github.com/cgarness/agentflow-life-insure/blob/main/src/components/ui/button.tsx)
- [Shared badge](https://github.com/cgarness/agentflow-life-insure/blob/main/src/components/ui/badge.tsx)
- [Inbounds workspace](https://github.com/cgarness/agentflow-life-insure/blob/main/src/components/inbounds/RoomWorkspace.tsx)
- [W3C text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [W3C non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
