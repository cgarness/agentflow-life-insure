import { useMemo } from "react";
import { templateMatchesChannel } from "@/lib/messageTemplateMerge";

export type MessageTemplateRow = {
  id: string;
  name: string;
  type: string | null;
  subject: string | null;
  content: string;
  scope: string | null;
  sms_purpose?: "informational" | "marketing" | null;
};

interface MessageTemplatePickerListProps {
  templates: MessageTemplateRow[];
  loading: boolean;
  organizationId: string | null;
  channel: "sms" | "email";
  search: string;
  onSearchChange: (search: string) => void;
  onPick: (template: MessageTemplateRow) => void;
}

export function MessageTemplatePickerList({
  templates, loading, organizationId, channel, search, onSearchChange, onPick,
}: MessageTemplatePickerListProps) {
  const channelFiltered = useMemo(
    () => templates.filter((t) => templateMatchesChannel(t.type, channel)),
    [templates, channel],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? channelFiltered.filter((t) => t.name.toLowerCase().includes(query))
      : channelFiltered;
  }, [channelFiltered, search]);

  return (
    <>
      <input
        type="search"
        autoComplete="off"
        aria-label="Search templates"
        placeholder="Search templates..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-accent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="min-h-0 max-h-72 overflow-y-auto rounded-lg border border-border">
        {loading ? (
          <div className="space-y-2 p-2" role="status" aria-label="Loading templates">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-accent" />)}
          </div>
        ) : !organizationId ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Select an organization to see templates.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {channelFiltered.length === 0
              ? `No ${channel.toUpperCase()} templates yet. Add them under Settings → Email & SMS Templates.`
              : "No templates match your search."}
          </p>
        ) : (
          <ul className="divide-y divide-border p-1">
            {visible.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onPick(t)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-foreground">{t.name}</span>
                    {t.scope === "personal" && (
                      <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                        Personal
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                    {t.type || "Any"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
