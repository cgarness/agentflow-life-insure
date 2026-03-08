

## Redo Landing Page — Modern Desktop-Focused Feature Showcase

### Overview
Rebuild `src/pages/LandingPage.tsx` with the same dark theme and blue/green color palette, but redesigned to be desktop-optimized and to deeply showcase each of the 11 system features (Dashboard, Dialer, Contacts, Conversations, Calendar, Campaigns, Leaderboard, Reports, AI Agents, Training, Settings).

### Design Direction
- Dark background (#030303) with blue-to-green gradient accents (indigo, blue, cyan, emerald, teal)
- Glassmorphism cards with subtle border glow on hover
- Framer Motion scroll-triggered animations throughout
- Desktop-first layout — no mobile hamburger menu, wider grids, larger typography
- Each feature gets a dedicated visual card with a mock UI preview inside it

### Sections

1. **Sticky Nav** — Logo, anchor links (Features, Platform, Testimonials), Sign In / Get Started buttons

2. **Hero** — Large gradient headline, subtitle, two CTAs (magnetic buttons), floating stat badges, animated mesh gradient background, large mock dashboard screenshot placeholder

3. **Trusted By** — Logo marquee (same companies)

4. **Features Overview** — Section header + 3-column bento grid of all 11 features. Each card contains:
   - Icon + title + description
   - A small mock UI visual (terminal for AI, waveform for Dialer, inbox preview for Conversations, etc.)
   - Glass card with colored gradient glow on hover
   - Larger "hero" cards for the 3 flagship features (AI Agents, Dialer, Smart CRM)

5. **Platform Deep-Dive** — Tabbed showcase section with tabs for each major feature group. Clicking a tab shows a large visual placeholder with descriptive text. Groups: AI & Automation, Communication, Management, Performance.

6. **Stats Bar** — 4 key metrics in a row

7. **Testimonials** — 3 glass cards with star ratings and quotes

8. **Final CTA** — "Ready to transform your agency?" with glowing button

9. **Footer** — Same structure, Product/Resources/Company columns

### Technical Details
- Single file replacement: `src/pages/LandingPage.tsx`
- All existing imports (framer-motion, lucide-react, react-router-dom, Button) reused
- MagneticButton and Section helper components kept
- No mobile-specific breakpoints or hamburger menu
- Feature data array expanded to cover all 11 sidebar menu items with unique gradients and mock UI snippets

