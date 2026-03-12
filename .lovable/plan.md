

# Fix Appointment Scheduler & Build Errors

## Problem
The `Disposition` type includes an `appointmentScheduler` property, and the code references it in multiple places (DialerPage disposition workflow, DispositionsManager settings, supabase-dispositions mapper), but:

1. **Build error**: The 6 mock dispositions in `src/lib/mock-data.ts` are missing `appointmentScheduler`, causing TS2741 errors.
2. **Database missing column**: The `dispositions` table lacks an `appointment_scheduler` boolean column, so the supabase-dispositions mapper reads `undefined` and the appointment scheduler toggle in settings has no effect.

## Plan

### Step 1: Add `appointment_scheduler` column to the database
Run a migration to add the missing column:
```sql
ALTER TABLE public.dispositions
ADD COLUMN appointment_scheduler boolean NOT NULL DEFAULT false;
```

### Step 2: Fix mock data in `src/lib/mock-data.ts`
Add `appointmentScheduler: false` to all 6 mock disposition objects (lines 134-139).

These two changes fix the build errors and make the appointment scheduler feature functional end-to-end (disposition settings toggle → DB persistence → dialer post-call popup).

