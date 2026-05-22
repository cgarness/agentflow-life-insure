import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
          muted: "hsl(var(--sidebar-muted))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "leaderboard-flash": {
          "0%": {
            opacity: "0.85",
            transform: "translateY(-6px)",
            boxShadow: "inset 0 0 0 1px hsl(45 93% 47% / 0.5), 0 0 0 0 hsl(45 93% 47% / 0)",
            backgroundColor: "hsl(45 93% 47% / 0.28)",
          },
          "15%": {
            opacity: "1",
            transform: "translateY(0)",
            boxShadow:
              "inset 0 0 0 1px hsl(45 93% 47% / 0.65), 0 0 28px 6px hsl(45 93% 47% / 0.45)",
            backgroundColor: "hsl(45 93% 47% / 0.22)",
          },
          "45%": {
            boxShadow:
              "inset 0 0 0 1px hsl(45 93% 47% / 0.45), 0 0 20px 4px hsl(45 93% 47% / 0.28)",
            backgroundColor: "hsl(45 93% 47% / 0.14)",
          },
          "100%": {
            boxShadow: "inset 0 0 0 1px transparent, 0 0 0 0 transparent",
            backgroundColor: "transparent",
          },
        },
        "leaderboard-spotlight": {
          "0%, 100%": {
            boxShadow:
              "inset 0 0 0 1px rgba(251, 146, 60, 0.35), 0 0 12px rgba(249, 115, 22, 0.12)",
          },
          "50%": {
            boxShadow:
              "inset 0 0 0 1px rgba(251, 146, 60, 0.55), 0 0 20px rgba(249, 115, 22, 0.22)",
          },
        },
        "rank-up-glow": {
          "0%": {
            backgroundColor: "hsl(142 90% 42% / 0.22)",
            boxShadow:
              "inset 0 0 22px hsl(142 100% 55% / 0.22), 0 0 18px hsl(142 100% 50% / 0.38)",
          },
          "100%": {
            backgroundColor: "transparent",
            boxShadow: "none",
          },
        },
        "rank-down-glow": {
          "0%": {
            backgroundColor: "hsl(0 90% 58% / 0.22)",
            boxShadow:
              "inset 0 0 22px hsl(0 100% 62% / 0.22), 0 0 18px hsl(0 100% 58% / 0.38)",
          },
          "100%": {
            backgroundColor: "transparent",
            boxShadow: "none",
          },
        },
        "fire-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.7", transform: "scale(1.15)" },
        },
        "fire-flicker": {
          "0%, 100%": { opacity: "1", transform: "scale(1) rotate(0deg)" },
          "25%": { opacity: "0.8", transform: "scale(1.1) rotate(-3deg)" },
          "50%": { opacity: "1", transform: "scale(1.2) rotate(2deg)" },
          "75%": { opacity: "0.9", transform: "scale(1.1) rotate(-1deg)" },
        },
        "tv-trophy-shimmer": {
          "0%, 100%": { filter: "drop-shadow(0 0 4px hsl(45 93% 47% / 0.3))" },
          "50%": { filter: "drop-shadow(0 0 12px hsl(45 93% 47% / 0.6))" },
        },
        "ticker": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-25%)" },
        },
        "reputation-grid": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "28px 28px" },
        },
        "reputation-scan-sweep": {
          "0%": { transform: "translateY(-140%)" },
          "100%": { transform: "translateY(480%)" },
        },
        "reputation-pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.4", filter: "blur(8px)" },
          "50%": { opacity: "0.8", filter: "blur(12px)" },
        },
        "rank-pill-pop": {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.14)" },
          "100%": { transform: "scale(1)" },
        },
        "new-leader-pulse": {
          "0%": { boxShadow: "0 0 0 0 hsl(45 93% 47% / 0.5)" },
          "35%": { boxShadow: "0 0 28px 8px hsl(45 93% 47% / 0.35)" },
          "100%": { boxShadow: "0 0 0 0 hsl(45 93% 47% / 0)" },
        },
        "agent-win-highlight": {
          "0%": { outline: "2px solid hsl(45 93% 47% / 0.75)", outlineOffset: "2px" },
          "100%": { outline: "2px solid transparent", outlineOffset: "2px" },
        },
        "stat-bump": {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(1.04)" },
          "100%": { transform: "scale(1)" },
        },
        "tv-metric-flash": {
          "0%": { opacity: "0.55", transform: "scale(0.92)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "tv-new-leader-banner": {
          "0%": { opacity: "0", transform: "translateY(-100%) scale(0.96)" },
          "12%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "88%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateY(-8px) scale(0.98)" },
        },
        "floating": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "leaderboard-flash": "leaderboard-flash 3.2s ease-out",
        "leaderboard-spotlight": "leaderboard-spotlight 2.4s ease-in-out infinite",
        "rank-up-glow": "rank-up-glow 1.5s ease-out",
        "rank-down-glow": "rank-down-glow 1.5s ease-out",
        "fire-pulse": "fire-pulse 1.5s ease-in-out infinite",
        "fire-flicker": "fire-flicker 0.8s ease-in-out infinite",
        "tv-trophy-shimmer": "tv-trophy-shimmer 2s ease-in-out infinite",
        "ticker": "ticker 30s linear infinite",
        "reputation-grid": "reputation-grid 10s linear infinite",
        "reputation-scan-sweep": "reputation-scan-sweep 3.2s ease-in-out infinite",
        "reputation-pulse-dot": "reputation-pulse-dot 1.4s ease-in-out infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "rank-pill-pop": "rank-pill-pop 0.55s ease-out",
        "new-leader-pulse": "new-leader-pulse 2.4s ease-out",
        "agent-win-highlight": "agent-win-highlight 1.5s ease-out",
        "stat-bump": "stat-bump 0.65s ease-out",
        "tv-metric-flash": "tv-metric-flash 0.65s ease-out",
        "tv-new-leader-banner": "tv-new-leader-banner 2.8s ease-out forwards",
        "floating": "floating 4s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")], // eslint-disable-line @typescript-eslint/no-require-imports
} satisfies Config;
