import React from "react";
import { MotionConfig } from "framer-motion";
import { LockKeyhole } from "lucide-react";
import HomepageNav from "@/components/marketing-v2/HomepageNav";
import HomepageHero from "@/components/marketing-v2/HomepageHero";
import ProductSections from "@/components/marketing-v2/ProductSections";
import { HomepageDetails, HomepageFooter } from "@/components/marketing-v2/HomepageDetails";
import { usePreviewMetadata } from "@/components/marketing-v2/usePreviewMetadata";

/** Private branch-only concept. SuperAdminRoute and Vercel SSO remain required. */
export default function LandingPageV2() {
  usePreviewMetadata();
  return (
    <MotionConfig reducedMotion="user">
      <div id="top" className="min-h-screen bg-[#060c17] text-white selection:bg-sky-600/50">
        <a href="#homepage-v2-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-xl focus:bg-sky-300 focus:px-5 focus:py-3 focus:text-slate-950">Skip to content</a>
        <div className="relative z-[60] border-b border-sky-400/20 bg-sky-950 px-4 py-2 text-center text-[11px] font-medium text-sky-200">
          <LockKeyhole aria-hidden="true" className="mr-2 inline-block align-[-2px]" size={13} />
          Private V2 preview — not the live homepage
        </div>
        <HomepageNav />
        <main id="homepage-v2-main" tabIndex={-1}>
          <HomepageHero />
          <ProductSections />
          <HomepageDetails />
        </main>
        <HomepageFooter />
      </div>
    </MotionConfig>
  );
}
