

## Plan: Fix Calendar Selection + Add View Contact Button + Fix Build Error

### 1. Fix build error — `src/lib/telnyx.ts` line 29
Change `callerIdNumber` to `callerNumber`.

### 2. Fix double-selection appearance — `src/components/calendar/MonthView.tsx` line 95
The today cell always gets `bg-primary/5` background, making it look selected alongside the actually selected day.

**Fix**: Change the condition from `isToday && cell.inMonth` to `isToday && cell.inMonth && isSelected` so the background highlight only applies when today IS the selected day.

### 3. Add "View Contact" button — `src/components/calendar/AppointmentModal.tsx` line 186
Currently the "Full View →" link only shows when `editing && contactInfo`. Change the condition to also show when a contact is linked in a new appointment (i.e., when `contactInfo` exists regardless of editing state). Also rename the link text to "View Contact" for clarity.

**Change**: Line 186 — remove the `editing &&` condition so it reads `{contactInfo && (`.

