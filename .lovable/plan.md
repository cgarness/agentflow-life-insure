

# Plan: Populate Leaderboard Test Data

## Current State
- 4 profiles exist: 1 admin (Chris Garness), 3 agents (Justify Kotelnycky, unnamed agent, test testi)
- No call/win/appointment data to drive leaderboard animations

## What Needs to Happen

### 1. Create more agent profiles
Insert 4 additional agent profiles so the leaderboard has 6-7 agents competing (more interesting visually).

### 2. Insert goals
Add goals for calls, policies, and appointments so goal progress bars work.

### 3. Insert calls data (bulk)
~200+ calls spread across agents over the last 30 days with varying dispositions (Sold, Not Interested, No Answer, Call Back, Appointment Set). This drives:
- Call volume charts
- Policies sold counts
- Conversion rates
- Talk time stats
- Fire status (some agents get extra calls today)

### 4. Insert wins data
~15-20 wins tied to agents so the Win Feed sidebar populates.

### 5. Insert appointments
~10-15 appointments so "Appointments Set" metric works.

### 6. Insert dialer sessions
A few sessions per agent for efficiency calculations.

### 7. Insert dispositions
Ensure the dispositions table has entries (Sold, Not Interested, No Answer, Call Back, Appointment Set) so disposition lookups work.

## Data Distribution Strategy
- Give one agent significantly more calls today (triggers "On Fire" / "Blazing")
- Give one agent calls on 5+ consecutive days (triggers streak badge)
- Make rankings close so auto-refresh cycles are likely to show rank changes
- Spread wins across agents unevenly for competitive podium

## Technical Details
- All inserts use the Supabase insert tool (not migrations)
- Agent IDs from existing profiles + 4 new ones
- Calls spread across the current month with `started_at` timestamps
- Some calls today to make "Today" period interesting

