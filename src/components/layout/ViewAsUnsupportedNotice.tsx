/**
 * ViewAsUnsupportedNotice — what a route renders INSTEAD of its page while impersonating.
 *
 * This is not a styling concern. `AppLayout` renders this in place of `<Outlet />`, so the route's
 * element never mounts: no page component, no effects, no queries, no realtime subscriptions, no
 * mutation controls. The notice exists so the refusal is legible rather than a blank frame.
 *
 * The banner and its "Exit View As" control live outside this, in `AppLayout`, so the operator can
 * always get back out from a blocked route.
 */

import React from "react";
import { Link } from "react-router-dom";
import { Eye, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { VIEW_AS_LANDING_PATH } from "@/lib/viewAsSurfaces";

const ViewAsUnsupportedNotice: React.FC = () => {
  const { impersonatedUser, stopImpersonation } = useAuth();
  const viewedName = impersonatedUser
    ? `${impersonatedUser.first_name} ${impersonatedUser.last_name}`.trim()
    : "another user";

  return (
    <div className="flex items-start justify-center pt-10" data-testid="view-as-unsupported">
      <div className="bg-card rounded-xl border border-border p-10 text-center max-w-2xl">
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6 text-amber-500" />
        </div>
        <h3 className="font-semibold text-foreground mb-2">
          This page isn't available while viewing as another user
        </h3>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          "View As" is a <strong>read-only preview</strong>, and only Conversations and the
          Contacts page's Import History and Agents tabs have been verified to read as{" "}
          {viewedName} rather than as you. Every other page is withheld on purpose: it would show
          your own data under their name, and some of them can write. Stop viewing as this user to
          use the rest of the application.
        </p>
        <div className="flex items-center justify-center gap-3 mt-6">
          <Button asChild variant="outline" size="sm">
            <Link to={VIEW_AS_LANDING_PATH}>
              <Eye className="w-4 h-4 mr-2" />
              Go to a supported page
            </Link>
          </Button>
          <Button size="sm" onClick={stopImpersonation}>
            Exit View As
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ViewAsUnsupportedNotice;
