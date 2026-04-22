import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { ExternalLink, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomMenuLinkOpenMode } from "@/hooks/useCustomMenuLinks";

const AppLinkEmbedPage: React.FC = () => {
  const { linkId } = useParams<{ linkId: string }>();
  const { organizationId } = useOrganization();

  const { data: link, isLoading, isError } = useQuery({
    queryKey: ["custom_menu_link", linkId, organizationId],
    enabled: !!linkId && !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_menu_links")
        .select("id,label,url,organization_id,open_mode")
        .eq("id", linkId as string)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  const openMode = (link?.open_mode as CustomMenuLinkOpenMode | undefined) ?? "new_tab";
  const allowed =
    !!link &&
    link.organization_id === organizationId &&
    openMode === "in_frame";

  if (!linkId || !organizationId) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        Unable to load this link.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  if (isError || !link || !allowed) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center space-y-4">
        <p className="font-medium text-foreground">This link is not available</p>
        <p className="text-sm text-muted-foreground">
          It may have been removed, or it may open in a new tab instead of inside AgentFlow.
        </p>
        <Button variant="outline" asChild>
          <Link to="/dashboard" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 -m-4 lg:-m-6 min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <h1 className="text-lg font-semibold text-foreground truncate pr-2">{link.label}</h1>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open in new tab
          <ExternalLink className="h-4 w-4 shrink-0" />
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        Embedded view. Some carrier or tool sites block embedding; if the area below is blank, use &quot;Open in new tab.&quot;
      </p>
      <iframe
        src={link.url}
        title={link.label}
        className="w-full flex-1 min-h-[calc(100dvh-12rem)] rounded-lg border border-border bg-background"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
};

export default AppLinkEmbedPage;
