# AgentFlow — Life Insurance CRM & Power Dialer
**Owner:** Chris Garness

## Project Overview
AgentFlow is a niche-specific CRM and Power Dialer built exclusively for Life Insurance Agencies. It integrates high-velocity calling via Telnyx, multi-tenant lead management via Supabase, and a premium enterprise UI.

## How to Edit This Code

### 1. Work with AI Engineering (Recommended)
This project is primarily built and maintained using **Agentic AI Engineering**. 
- Provide instructions, feedback, or screenshots directly to your AI Assistant.
- The AI agent will manage the codebase, implement features, and push changes directly to the `main` branch to keep environments in sync.

### 2. Manual Local Development
If you need to work locally:
1.  **Clone the repository**: `git clone <YOUR_GIT_URL>`
2.  **Install dependencies**: `npm install`
3.  **Start development server**: `npm run dev`
4.  **Run tests**: `npm test`

## Technologies Used
- **Frontend**: Vite, React (TypeScript), Tailwind CSS, Radix UI, Lucide
- **State & Data**: Supabase (PostgreSQL), TanStack Query, Zod
- **Telephony**: Telnyx WebRTC SDK
- **Backend**: Supabase Edge Functions (Deno), Resend SDK

## Deployment
The project is configured for deployment via **Vercel** and **Supabase Edge Functions**.
- Pushing to `main` triggers an automatic build/deploy cycle.
- Manual Edge Function deploys: `supabase functions deploy [function-name]`

