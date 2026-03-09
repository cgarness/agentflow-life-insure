import React from "react";
import { Link } from "react-router-dom";
import { Globe, Linkedin, Facebook } from "lucide-react";
import { AFLogo } from "./MarketingNav";

const MarketingFooter: React.FC = () => {
  return (
    <footer className="bg-card/50 border-t border-border/50 py-12 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
        {/* Brand */}
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <AFLogo size={32} />
            <span className="font-bold text-lg">AgentFlow</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            The all-in-one CRM for life insurance professionals.
          </p>
          <div className="flex gap-3">
            {[Globe, Linkedin, Facebook].map((I, idx) => (
              <button
                key={idx}
                className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <I size={16} />
              </button>
            ))}
          </div>
        </div>

        {/* Product */}
        <div>
          <h4 className="font-semibold text-sm mb-4">Product</h4>
          <ul className="space-y-2.5 text-sm text-muted-foreground">
            <li>
              <Link to="/landing#features" className="hover:text-foreground transition-colors">
                Features
              </Link>
            </li>
            <li>
              <Link to="/pricing" className="hover:text-foreground transition-colors">
                Pricing
              </Link>
            </li>
            <li>
              <span className="hover:text-foreground transition-colors cursor-pointer">AI Agents</span>
            </li>
            <li>
              <span className="hover:text-foreground transition-colors cursor-pointer">Integrations</span>
            </li>
            <li>
              <span className="hover:text-foreground transition-colors cursor-pointer">Changelog</span>
            </li>
          </ul>
        </div>

        {/* Company */}
        <div>
          <h4 className="font-semibold text-sm mb-4">Company</h4>
          <ul className="space-y-2.5 text-sm text-muted-foreground">
            {["About", "Blog", "Careers", "Contact", "Partners"].map((l) => (
              <li key={l}>
                {l === "Contact" ? (
                  <Link to="/contact" className="hover:text-foreground transition-colors">{l}</Link>
                ) : (
                  <span className="hover:text-foreground transition-colors cursor-pointer">{l}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Legal */}
        <div>
          <h4 className="font-semibold text-sm mb-4">Legal</h4>
          <ul className="space-y-2.5 text-sm text-muted-foreground">
            {["Privacy Policy", "Terms of Service", "Security", "TCPA Compliance", "DNC Policy"].map((l) => (
              <li key={l}>
                <span className="hover:text-foreground transition-colors cursor-pointer">{l}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-10 pt-6 border-t border-border/30 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">© 2026 AgentFlow. All rights reserved.</p>
        <p className="text-xs text-muted-foreground">Made with ❤️ for life insurance agents</p>
      </div>
    </footer>
  );
};

export default MarketingFooter;
