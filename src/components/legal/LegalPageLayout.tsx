import { Link } from "react-router-dom";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { googleDataPolicyUrl, legalPublication, type LegalSection } from "@/content/legal";

type Props = { title: string; sections: LegalSection[] };
export default function LegalPageLayout({ title, sections }: Props) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-6 pb-20 pt-32">
        <Link to="/" className="text-sm text-primary hover:underline">AgentFlow home</Link>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Draft reviewed {legalPublication.reviewedOn}</p>
        {!legalPublication.approved && (
          <aside role="note" className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-relaxed">
            <strong>Draft — not approved for publication.</strong> Final data retention, deletion and other policy terms are pending approval. This page is not a completed customer policy.
          </aside>
        )}
        <div className="mt-10 space-y-9">
          {sections.map(section => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-muted-foreground">
                {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
        <nav aria-label="Legal resources" className="mt-12 flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-6 text-sm text-primary">
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link to="/terms" className="hover:underline">Terms of Service</Link>
          <a href={googleDataPolicyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">Google API Services User Data Policy</a>
          <a href={`mailto:${legalPublication.supportEmail}`} className="hover:underline">Contact support</a>
        </nav>
      </main>
      <MarketingFooter />
    </div>
  );
}
