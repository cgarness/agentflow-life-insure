import React from "react";
import { cn } from "@/lib/utils";

export const PROJECT_STATUS_SECTIONS = [
  { id: "health", label: "Live health" },
  { id: "modules", label: "Modules" },
  { id: "build-queue", label: "Build queue" },
  { id: "tech-debt", label: "Tech debt" },
  { id: "gaps", label: "Feature gaps" },
  { id: "pages", label: "Pages & features" },
  { id: "settings", label: "Settings" },
  { id: "work-log", label: "Work log" },
  { id: "migrations", label: "Migrations" },
  { id: "edge-functions", label: "Edge functions" },
] as const;

export type SectionId = (typeof PROJECT_STATUS_SECTIONS)[number]["id"];

interface SectionNavProps {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}

export const SectionNav: React.FC<SectionNavProps> = ({ active, onSelect }) => (
  <nav className="hidden lg:block w-44 shrink-0 sticky top-24 self-start">
    <ul className="space-y-0.5 text-sm">
      {PROJECT_STATUS_SECTIONS.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => {
              onSelect(s.id);
              document.getElementById(`ps-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded-md transition-colors",
              active === s.id
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  </nav>
);

export const SectionBlock: React.FC<{
  id: SectionId;
  title: string;
  children: React.ReactNode;
}> = ({ id, title, children }) => (
  <section id={`ps-${id}`} className="scroll-mt-24 space-y-3 pb-10">
    <h2 className="text-lg font-semibold text-foreground border-b border-border/50 pb-2">
      {title}
    </h2>
    {children}
  </section>
);
