import { useEffect } from "react";
import { Link } from "react-router-dom";
import Logo from "@/components/shared/Logo";
import { googleConnectionsUrl, googleDataPolicyUrl, legalPublication, type LegalSection } from "@/content/legal";

type Props = { title: string; sections: LegalSection[] };

export default function LegalPageLayout({ title, sections }: Props) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | AgentFlow`;
    window.scrollTo(0, 0);
    return () => { document.title = previousTitle; };
  }, [title]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#legal-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:p-3 focus:text-primary">
        Skip to content
      </a>
      <header className="border-b border-border">
        <nav aria-label="Main navigation" className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <Link to="/" aria-label="AgentFlow home"><Logo className="max-w-[200px]" /></Link>
          <div className="flex items-center gap-6 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link>
          </div>
        </nav>
      </header>
      <main id="legal-content" className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <p className="text-sm font-medium text-primary">AgentFlow</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          {legalPublication.approved && legalPublication.effectiveDate
            ? `Effective ${legalPublication.effectiveDate}`
            : `Review copy · ${legalPublication.reviewedOn}`}
        </p>
        {!legalPublication.approved && (
          <aside role="note" className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6">
            <strong>Pending publication approval.</strong> This proposed notice is for owner review and is not ready for submission to Google.
          </aside>
        )}
        <div className="mt-10 space-y-10">
          {sections.map(section => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`}>
              <h2 id={`${section.id}-heading`} className="text-lg font-semibold">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-muted-foreground">
                {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
        <nav aria-label="Privacy controls and support" className="mt-12 flex flex-col items-start gap-3 border-t border-border pt-6 text-sm text-primary">
          <a href={googleConnectionsUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">Manage Google Account connections</a>
          <a href={googleDataPolicyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">Google API Services User Data Policy</a>
          <a href={`mailto:${legalPublication.supportEmail}`} className="break-all hover:underline">{legalPublication.supportEmail}</a>
        </nav>
      </main>
      <footer className="border-t border-border">
        <nav aria-label="Legal pages" className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-3 px-6 py-7 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} AgentFlow</span>
          <Link to="/privacy" className="hover:text-foreground hover:underline">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-foreground hover:underline">Terms of Service</Link>
        </nav>
      </footer>
    </div>
  );
}
