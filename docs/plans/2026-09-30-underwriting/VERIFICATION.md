# Direct integration verification

The original offline package was re-executed: 163 Node tests passed; 18 browser scenario groups passed. These results do not constitute repository integration or carrier validation.

This branch adds actual React/Zod host checks, full Vite/Tailwind 3 integration checks, direct-route checks, and pagehide/pageshow sensitive-state clearing. New checks are pending the isolated GitHub runner at the time of source staging. The runner must retain logs and distinguish existing app-typecheck diagnostics from regressions.

No migration, Supabase change, main merge, production deploy or DNS change. Carrier-source, compensation and public-use gates in SOURCE_RECONCILIATION.md remain open. Physical iOS Safari is not claimed as tested.
