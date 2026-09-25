# Open Pool retry guard — live release plan

Approved direction: Chris requested the fix go live without a separate agent test session. Keep the current 120-minute campaign setting.

## Live finding

The canonical queue RPC uses row locks, but its `INSERT ... ON CONFLICT DO NOTHING` returns a campaign lead even if it did not acquire a lock. More significantly, calls to GOAT Open Pool have completed while the corresponding `campaign_leads` rows still have zero attempts and no `retry_eligible_at`. The queue then treats them as new. The observed duplicate calls were 27 seconds apart across agents.

## Scope

1. New migration: amend only `get_next_queue_lead` to exclude a lead with a call in the campaign during its retry window, including calls whose disposition/advance has not been saved. An in-progress call excludes the lead. Keep the existing waterfall, licensing and ownership checks. Check the insert result and never return a row without an acquired lock. Add a supporting partial index for campaign call lookups.
2. Update the queue invariant in `AGENT_RULES.md` and append a `WORK_LOG.md` entry.
3. Typecheck, review the SQL diff, apply the migration, read back the deployed function and campaign state. No simulated agent test. Agents will verify with real calls. Applied as production version `20260925183605`; the live function, index, and unchanged 120-minute setting were read back. The typecheck exits 2 on existing errors in untouched files.

## Limits

This guard prevents re-issuing recently called leads even if the browser fails to advance. It does not repair historical attempt counters or disposition-less calls, and the queue panel's existing availability count may temporarily differ from the newly guarded claim result. Follow up on why call finalization failed and reconcile the metrics in a separate release.
