import React from "react";
import type { CodeRefs } from "@/lib/project-status/treeUtils";

const CodeRefsPanel: React.FC<{ code?: CodeRefs }> = ({ code }) => {
  if (!code) return null;

  const sections: { label: string; items?: string[] }[] = [
    { label: "Files", items: code.files },
    { label: "Hooks", items: code.hooks },
    { label: "Functions / logic", items: code.functions },
    { label: "Tables", items: code.tables },
    { label: "RPCs", items: code.rpcs },
    { label: "Edge functions", items: code.edgeFunctions },
  ].filter((s) => s.items && s.items.length > 0);

  if (sections.length === 0) return null;

  return (
    <div className="mt-2 rounded-md bg-muted/40 border border-border/50 p-3 text-xs space-y-2">
      {sections.map((s) => (
        <div key={s.label}>
          <p className="font-medium text-muted-foreground mb-1">{s.label}</p>
          <ul className="space-y-0.5 font-mono text-[11px] text-foreground/90">
            {s.items!.map((item) => (
              <li key={item} className="break-all">{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default CodeRefsPanel;
