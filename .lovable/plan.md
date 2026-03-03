

## Plan: Futuristic Neon Dashboard Restyle

Restyle `Dashboard.tsx` only with a futuristic, neon-accented aesthetic. No changes to other pages, sidebar, or topbar. The approach uses scoped CSS classes and inline styles within the dashboard component so the neon look is isolated.

### Visual Direction

- Dark glassmorphic cards with subtle backdrop blur and semi-transparent backgrounds
- Neon glow accents: cyan (#06B6D4), magenta/pink (#EC4899), electric green (#22C55E), amber (#F59E0B)
- Stat card numbers get neon text-shadow glow effects
- Card borders use subtle neon-colored border with low opacity
- Icon containers get neon ring glows matching their category color
- Leaderboard rank badges (#1 gold glow, #2 silver, #3 bronze)
- Goal progress bars get neon glow matching their color
- Section headings get a subtle gradient text effect
- Hover states on cards intensify the glow

### Changes

**File: `src/pages/Dashboard.tsx`**
- Wrap the dashboard in a scoped container class
- Replace card classes with glassmorphic variants: semi-transparent bg with backdrop-blur, neon-tinted borders
- Stat card values: add inline `textShadow` with cyan/blue glow
- Icon containers: add `boxShadow` glow rings matching each stat's theme color (blue for calls, green for policies, cyan for appointments, pink for campaigns)
- Win Feed items: neon green accents on avatars
- Follow-up aging badges: neon glow on red/yellow/green states
- Leaderboard: top 3 ranks get gold/silver/bronze neon glow; progress bars get matching box-shadow
- Period toggle buttons get neon outline on active state
- Greeting text gets a subtle gradient (cyan to blue)

**File: `src/index.css`**
- Add a few scoped keyframes and utility classes under a `.dashboard-neon` parent scope:
  - `neon-card`: glassmorphic card base with backdrop-blur
  - `neon-glow-cyan`, `neon-glow-green`, `neon-glow-pink`, `neon-glow-amber`: box-shadow utilities
  - `neon-text`: text-shadow glow utility
  - `neon-pulse`: subtle pulsing glow animation for active elements

### Scope
- Only `Dashboard.tsx` and `index.css` are modified
- All other pages remain untouched
- Uses semantic Tailwind classes where possible, inline styles only for dynamic glow effects (textShadow, boxShadow) since these aren't available as Tailwind utilities

