

## Create Modern Landing Page — Life Insurance CRM + Dialer Showcase

### Overview
Build a new `src/pages/LandingPage.tsx` and wire it up in `src/App.tsx` at `/landing`. Dark theme (#020408) with the existing `AnimatedBackground` canvas, blue/cyan/emerald gradients, glassmorphism cards with hover glows, and framer-motion scroll animations throughout.

### Sections

1. **Sticky Nav** — Logo, anchor links (Features, Platform, Testimonials), Sign In / Get Started buttons with gradient CTA
2. **Hero** — Large gradient headline ("The CRM & Dialer That Closes More Policies"), subtitle, two CTAs, floating stat badges (+247% Contact Rate, 80+ Calls/Hr), and a mock dashboard visual with fake widgets/charts
3. **Trusted By** — Row of 8 carrier/agency names with staggered fade-in
4. **Features Bento Grid** — All 11 features showcased:
   - 3 hero cards (AI Agents, Power Dialer, Smart CRM) — large with detailed mock UI visuals (terminal output, waveforms, contact list)
   - 8 standard cards (Dashboard, Conversations, Calendar, Campaigns, Leaderboard, Reports, Training, Settings) — compact with mini mock UIs
   - Each card: glass bg, colored gradient icon, hover glow effect, scroll-triggered entrance
5. **Platform Deep-Dive** — 4 tabbed pillars (AI & Automation, Communication, Management, Performance) with AnimatePresence transitions, stats grid per tab
6. **Stats Bar** — 4 key metrics (10M+ Calls, 500K+ Policies, 99.9% Uptime, 47% Production Increase)
7. **Testimonials** — 3 glass cards with star ratings and quotes from agency owners/producers
8. **Final CTA** — "Ready to Transform Your Agency?" with pulsing gradient border and signup button
9. **Footer** — 4-column layout (Brand, Product, Resources, Company) with bottom bar

### Files

1. **`src/pages/LandingPage.tsx`** — New file, ~450 lines. Uses:
   - `framer-motion` for `useInView`, `AnimatePresence`, scroll-triggered animations
   - `lucide-react` icons for all features
   - Existing `AnimatedBackground` component for the canvas background
   - `Button` from ui/button
   - `Link` from react-router-dom
   - Helper components: `Section` (scroll-triggered wrapper), `GlowCard` (glassmorphism card with hover glow)
   - Feature data array with 11 entries, each containing icon, title, desc, gradient, glow color, and JSX visual mock
   - Pillar data array with 4 entries for tabbed section

2. **`src/App.tsx`** — Add import and public route:
   ```
   import LandingPage from "./pages/LandingPage";
   // Add before the protected routes:
   <Route path="/landing" element={<LandingPage />} />
   ```

### Design Details
- Desktop-optimized: no mobile breakpoints, wide grids, large typography
- Colors: #020408 base, blue-500/cyan-500/emerald-500 gradients matching existing theme
- Cards: `bg-white/[0.03]`, `border-white/[0.08]`, `backdrop-blur-xl`, hover increases boxShadow with feature's glow color
- All animations use `[0.22, 1, 0.36, 1]` easing for smooth entrances
- Mock UI visuals are pure CSS/JSX — no images needed

