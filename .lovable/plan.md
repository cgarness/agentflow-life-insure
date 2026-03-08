

## Plan: AI-Powered Daily Briefing Pop-up on First Login

### Overview
On each user's first dashboard visit of the day, show a modal with an AI-generated summary of their day — appointments, follow-ups due, anniversaries, and actionable priorities. Uses Lovable AI (Gemini) via an edge function.

### Components

**1. Edge Function: `supabase/functions/daily-briefing/index.ts`**
- Accepts user context (appointments, follow-ups, anniversaries, stats) from the client
- Sends it to Lovable AI gateway with a system prompt like: "You are a helpful insurance agency assistant. Summarize the agent's day in 3-4 short paragraphs. Be motivational but concise. Use bullet points for action items."
- Returns streamed AI response
- Handles 429/402 errors

**2. New Component: `src/components/dashboard/DailyBriefingModal.tsx`**
- Dialog/modal with a dark themed card matching the app style
- Shows AI-generated briefing with streaming text (tokens render as they arrive)
- Header: "Good morning, {name} — Here's your day" with a sparkle/AI icon
- Quick stats row at top (appointments count, follow-ups count, anniversaries)
- AI narrative summary below, rendered with markdown
- "Let's Go" dismiss button
- Loading state with a typing indicator while AI generates

**3. First-Login-of-Day Detection (in Dashboard.tsx)**
- On mount, check `localStorage` key `briefing-last-shown-{userId}` against today's date
- If not shown today, open the modal after dashboard data loads
- On dismiss, write today's date to localStorage

**4. Data Flow**
```text
Dashboard loads data → checks localStorage → opens modal
  → sends today's data to edge function → streams AI response
  → user reads & dismisses → localStorage updated
```

### Files Changed
- `supabase/functions/daily-briefing/index.ts` — new edge function
- `supabase/config.toml` — add function config
- `src/components/dashboard/DailyBriefingModal.tsx` — new modal component
- `src/pages/Dashboard.tsx` — add modal trigger logic

### Notes
- Uses existing dashboard data (appointments, followUps, anniversaries, stats) already fetched — no extra DB queries
- Fallback: if AI call fails, show a simple non-AI summary with the raw data
- `react-markdown` not installed; will render with basic HTML or add the dependency

