

## Root Cause

The **CompanyBranding** and **Permissions** components use **hardcoded inline `style={}` attributes** with dark hex colors like `backgroundColor: "#1E293B"`, `backgroundColor: "#0F172A"`, `color: "#F1F5F9"`, etc. These override the app's theme system regardless of whether light or dark mode is active.

Meanwhile, **DispositionsManager** and **ContactManagement** correctly use Tailwind's **semantic CSS variables** — classes like `bg-card`, `text-foreground`, `bg-accent`, `border`, `text-muted-foreground` — which automatically adapt to the current theme (light `:root` or `.dark` vars defined in `index.css`).

Your app's light mode has:
- `--background: 0 0% 100%` (white)
- `--card: 0 0% 100%` (white)
- `--foreground: 222 47% 11%` (dark text)

But CompanyBranding and Permissions ignore these entirely because they use inline styles forcing dark colors.

## The Fix

Replace all hardcoded inline `style={{ backgroundColor: "#1E293B" }}` / `color: "#F1F5F9"` / etc. in **CompanyBranding.tsx** and **Permissions.tsx** with the equivalent Tailwind theme classes:

| Hardcoded style | Correct Tailwind class |
|---|---|
| `backgroundColor: "#0F172A"` | `bg-background` |
| `backgroundColor: "#1E293B"` | `bg-card` |
| `border: "1px solid #334155"` | `border` |
| `color: "#F1F5F9"` | `text-foreground` |
| `color: "#94A3B8"` | `text-muted-foreground` |
| `color: "#64748B"` | `text-muted-foreground` |
| `backgroundColor: "#3B82F6"` | `bg-primary` |
| `backgroundColor: "#334155"` | `bg-muted` or `bg-accent` |

This involves:
1. **CompanyBranding.tsx** — Remove all inline `style={}` on the form card, popover, inputs, and labels. Replace with `className` equivalents (`bg-card border`, `bg-background`, `text-foreground`, etc.)
2. **Permissions.tsx** — Same treatment across accordion sections, role tabs, radio pills, page/feature rows, data access cards, and the confirm dialog. The `AlertDialogContent` style overrides also need removal.

## Prevention Going Forward

The rule is simple: **never use hardcoded hex colors in inline styles for theme-dependent elements.** Always use Tailwind's semantic classes (`bg-card`, `bg-background`, `text-foreground`, `bg-accent`, `text-muted-foreground`, `border`, `bg-primary`, etc.) which are defined in `index.css` and respond to light/dark mode automatically. Inline `style={{ backgroundColor }}` should only be used for truly dynamic, user-chosen colors (like color swatches/pickers).

