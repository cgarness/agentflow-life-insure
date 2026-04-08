import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";

/* ──────────────────────────────────────────────
   AF LOGO COMPONENT
   ────────────────────────────────────────────── */
export const AFLogo = ({ size = 36 }: { size?: number }) => (
  <div
    className="rounded-lg bg-primary flex items-center justify-center font-bold text-primary-foreground select-none"
    style={{ width: size, height: size, fontSize: size * 0.4 }}
  >
    AF
  </div>
);

/* ──────────────────────────────────────────────
   NAV LINKS DATA
   ────────────────────────────────────────────── */
type NavItem = { label: string; href: string; type: "anchor" | "link" };

const NAV_LINKS: NavItem[] = [
  { label: "Features", href: "#features", type: "anchor" },
  { label: "Pricing", href: "/pricing", type: "link" },
  { label: "Testimonials", href: "#testimonials", type: "anchor" },
  { label: "FAQ", href: "#faq", type: "anchor" },
];

const scrollTo = (href: string) => {
  const el = document.querySelector(href);
  el?.scrollIntoView({ behavior: "smooth" });
};

/* ══════════════════════════════════════════════
   MARKETING NAV
   ══════════════════════════════════════════════ */
const MarketingNav: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const isLandingPage = location.pathname === "/landing" || location.pathname === "/";

  const handleNavClick = (item: NavItem) => {
    if (item.type === "anchor" && isLandingPage) {
      scrollTo(item.href);
    }
  };

  return (
    <header className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border/40">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Left – Logo */}
        <Link to="/landing" className="flex items-center gap-2.5">
          <AFLogo />
          <span className="font-bold text-lg text-foreground">AgentFlow</span>
        </Link>

        {/* Center – Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((item) =>
            item.type === "link" ? (
              <Link
                key={item.href}
                to={item.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                {item.label}
              </Link>
            ) : isLandingPage ? (
              <button
                key={item.href}
                onClick={() => handleNavClick(item)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                {item.label}
              </button>
            ) : (
              <Link
                key={item.href}
                to={`/landing${item.href}`}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                {item.label}
              </Link>
            )
          )}
        </nav>

        {/* Right – CTA */}
        <div className="hidden md:flex items-center gap-4">
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Log In
          </Link>
          <Link
            to="/login"
            className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.45)] hover:scale-105 transition-all duration-200"
          >
            Start Free Trial
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden text-foreground" onClick={() => setMobileMenuOpen(true)}>
          <Menu size={24} />
        </button>
      </div>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-8"
          >
            <button
              className="absolute top-5 right-6 text-foreground"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X size={28} />
            </button>
            {NAV_LINKS.map((item) =>
              item.type === "link" ? (
                <Link
                  key={item.href}
                  to={item.href}
                  className="text-xl font-medium text-foreground"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ) : isLandingPage ? (
                <button
                  key={item.href}
                  className="text-xl font-medium text-foreground"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setTimeout(() => scrollTo(item.href), 200);
                  }}
                >
                  {item.label}
                </button>
              ) : (
                <Link
                  key={item.href}
                  to={`/landing${item.href}`}
                  className="text-xl font-medium text-foreground"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              )
            )}
            <Link
              to="/login"
              className="h-12 px-8 rounded-xl bg-primary text-primary-foreground text-base font-semibold flex items-center"
              onClick={() => setMobileMenuOpen(false)}
            >
              Start Free Trial
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default MarketingNav;
