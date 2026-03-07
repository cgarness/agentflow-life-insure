

# Moveable & Resizable Dashboard Widgets + More Stats

## Overview
Transform the dashboard from a fixed grid into a free-form drag-and-drop, resizable widget layout (like Grafana or Windows widgets). Add several new stat widgets to the customize drawer.

## New Dependency
Install `react-grid-layout` — the standard React library for draggable + resizable grid layouts. It handles collision detection, grid snapping, responsive breakpoints, and resize handles out of the box. This is far more reliable than building custom drag+resize from scratch.

## New Widgets to Add (6 additional)
These will be added to the `DEFAULT_WIDGETS` array and the customize drawer:

| ID | Label | Content |
|----|-------|---------|
| `missed-calls` | Missed Calls | Already rendered inside `quick-actions` — extract as standalone widget |
| `anniversaries` | Policy Anniversaries | Already rendered inside `quick-actions` — extract as standalone widget |
| `conversion-rate` | Conversion Rate | Stat card showing leads converted to "Closed Won" as a percentage |
| `avg-talk-time` | Avg Talk Time | Stat card showing average call duration |
| `pipeline-value` | Pipeline Value | Stat card showing estimated value of active leads |
| `goals-progress` | Goals Progress | Progress bars for monthly call, sales, and appointment goals |

## Technical Approach

### 1. Install `react-grid-layout`
Add `react-grid-layout` and its types. This gives us `<ResponsiveGridLayout>` with built-in drag handles and resize handles.

### 2. Define grid layout per widget
Each widget gets a default grid position (`x, y, w, h`) on a 12-column grid:
- `stat-cards`: full width (w=12, h=2)
- `daily-briefing`: w=7, h=4
- `activity-chart`: w=7, h=3
- `recent-activity`: w=7, h=3
- `quick-actions` (Follow Up Queue only): w=5, h=4
- `missed-calls`: w=5, h=3
- `anniversaries`: w=5, h=3
- `leaderboard`: w=12, h=4
- New stat widgets: w=3, h=2 each

### 3. Persist layout positions + sizes
Extend the localStorage key to store both widget visibility AND grid layout positions (`{widgets: WidgetConfig[], layouts: ReactGridLayout.Layouts}`).

### 4. Refactor Dashboard.tsx rendering
- Replace the manual grid logic with `<ResponsiveGridLayout>`
- Each visible widget wrapped in a `<div key={id}>` grid item
- Extract `quick-actions` into 3 separate widgets (Follow Up Queue, Missed Calls, Anniversaries)
- Add render cases for the new stat widgets

### 5. Update CustomizeDrawer
- Add the 6 new widgets to the list
- Keep existing drag-to-reorder and toggle functionality (this now controls which widgets appear on the grid)

### 6. Widget chrome
Each widget card gets:
- A subtle drag handle bar at the top (using `react-grid-layout`'s `draggableHandle` prop)
- Resize handle in bottom-right corner (built into `react-grid-layout`)
- The existing card styling preserved

### 7. CSS for react-grid-layout
Import the required CSS (`react-grid-layout/css/styles.css`, `react-resizable/css/styles.css`) and add minor overrides for the resize handle and placeholder styling to match the app theme.

## Files to Create/Modify
- `src/pages/Dashboard.tsx` — replace grid rendering with `ResponsiveGridLayout`, add new widget render cases, persist layout positions
- `src/components/dashboard/CustomizeDrawer.tsx` — add new widgets to the list
- `src/index.css` — add react-grid-layout CSS overrides
- `src/lib/supabase-dashboard.ts` — no changes (new stats derived from existing data)

## Build Error Fix
The existing build error is about a Deno/Supabase edge function type resolution issue (`openai` package in `supabase/functions/`). This is unrelated to the dashboard and won't block the frontend build. Will address only if it blocks the preview.

