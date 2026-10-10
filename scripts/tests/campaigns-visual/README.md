# Isolated Campaigns browser gate

Loads the real Campaigns page (`src/pages/Campaigns.tsx`) with its real components, hooks, query adapters, model and preference writer. Only auth, permissions, branding and the Supabase transport are replaced (`stubs.ts`), with clearly synthetic campaigns and people. No auth token, hosted endpoint or customer record is used, and nothing here is reachable from the production build.

The stub transport emulates `campaigns_select` RLS per persona and the `get_campaign_card_stats` scope (Personal campaigns only to their owner), so the Admin persona shows the stored-counter fallback for other agents' Personal campaigns. `user_preferences` reads/writes go to this origin's local storage and are recorded, so the gate can prove that page loads never write.

`entry.tsx` reproduces the app shell's content box — the fixed 240px sidebar from `md` up (64px when `?sidebar=collapsed`) and `AppLayout`'s `p-4 lg:p-6` — so screenshots show the widths users actually get. Query parameters: `persona=admin|agent`, `theme=dark|light`, `sidebar=expanded|collapsed`, `state=default|empty|error|loading|stats-error|stats-loading`, `org=active|suspended`.

From the repository root:

```bash
npx vite --config scripts/tests/campaigns-visual/vite.config.ts
PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHROMIUM_PATH=/absolute/path/to/chrome node scripts/tests/campaigns-visual/verify.mjs
```

`CAMPAIGNS_VISUAL_OUTPUT` selects the evidence directory. The verifier blocks every off-origin request and checks: desktop/tablet/mobile widths (1440, 1280, 1024, 768, 390) in dark and light with the sidebar expanded and collapsed; no page overflow; desktop table at ≥1280px and stacked rows below; Open actions within the viewport; expanded rows that do not navigate; the Columns editor, overflow menu and a horizontally scrolled all-columns table with the sticky Actions column; save → reload persistence with reads only on load; Agent persona (counts, no Duplicate, no New Campaign); empty, error, loading and metrics-unavailable states; and the agency lock.

This is a real-browser synthetic gate. It does not establish hosted login, PostgREST transport, production data accuracy or role authorization in a signed-in browser. Review screenshots before release; execution status belongs in the WORK_LOG, not this README.
