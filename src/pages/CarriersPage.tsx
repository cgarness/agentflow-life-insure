import { Link } from "react-router-dom";
import { Loader2, Settings, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCarrierDirectory } from "@/hooks/useCarrierDirectory";
import { Button } from "@/components/ui/button";
import CarrierDirectory from "@/components/carriers/CarrierDirectory";

export default function CarriersPage() {
  const { profile, isImpersonating } = useAuth();
  const { carriers, status, retry, scopeKey } = useCarrierDirectory();
  const canManage = status === "ready" && !isImpersonating &&
    (profile?.is_super_admin === true || profile?.role?.toLowerCase() === "admin");

  return (
    <section className="mx-auto w-full max-w-5xl space-y-5 pb-6" aria-labelledby="carriers-heading">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="carriers-heading" className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Shield className="h-6 w-6 text-primary" aria-hidden="true" />
          Carriers
        </h1>
        {canManage && (
          <Button asChild variant="outline" className="gap-2">
            <Link to="/settings?section=carriers">
              <Settings className="h-4 w-4" aria-hidden="true" />
              Manage carriers
            </Link>
          </Button>
        )}
      </header>

      {status === "loading" && (
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading carriers…
        </div>
      )}
      {status === "error" && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p role="alert" className="mb-3 text-sm">Could not load carriers.</p>
          <Button type="button" variant="outline" onClick={retry}>Try again</Button>
        </div>
      )}
      {status === "unavailable" && (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          Carrier resources are not available for this account.
        </p>
      )}
      {status === "ready" && <CarrierDirectory key={scopeKey} carriers={carriers} />}
    </section>
  );
}
