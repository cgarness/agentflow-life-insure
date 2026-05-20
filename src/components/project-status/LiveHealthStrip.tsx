import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Users, PhoneCall, FileText, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface Snapshot {
  organizations: unknown[];
  total_users: number;
  total_leads: number;
  active_calls: number;
}

const LiveHealthStrip: React.FC = () => {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [provErrors, setProvErrors] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [snapRes, errRes] = await Promise.all([
        supabase.rpc("super_admin_dashboard_snapshot"),
        supabase.from("provisioning_errors").select("id", { count: "exact", head: true }),
      ]);
      if (cancelled) return;
      if (!snapRes.error && snapRes.data) {
        const d = snapRes.data as Snapshot;
        setSnap(d);
      }
      setProvErrors(errRes.count ?? 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading platform health…
      </div>
    );
  }

  const orgCount = snap?.organizations?.length ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <HealthCard icon={<Building2 className="w-4 h-4" />} label="Agencies" value={orgCount} />
      <HealthCard icon={<Users className="w-4 h-4" />} label="Users" value={snap?.total_users ?? "—"} />
      <HealthCard icon={<FileText className="w-4 h-4" />} label="Leads" value={snap?.total_leads ?? "—"} />
      <HealthCard icon={<PhoneCall className="w-4 h-4" />} label="Active calls" value={snap?.active_calls ?? 0} />
      <HealthCard
        icon={<AlertTriangle className="w-4 h-4" />}
        label="Prov. errors"
        value={provErrors ?? 0}
        warn={(provErrors ?? 0) > 0}
      />
      <div className="col-span-2 md:col-span-5 flex justify-end">
        <Link
          to="/super-admin"
          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
        >
          Open Agencies console <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
};

function HealthCard({
  icon, label, value, warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <Card className={warn ? "border-destructive/40" : "border-border/50"}>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        </div>
        <div className={warn ? "text-destructive" : "text-muted-foreground"}>{icon}</div>
      </CardContent>
    </Card>
  );
}

export default LiveHealthStrip;
