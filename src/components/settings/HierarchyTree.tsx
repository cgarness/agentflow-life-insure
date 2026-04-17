import React, { useEffect, useCallback, useMemo, useState } from "react";
import { Crown, Shield, User, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { buildProfileOrgForest } from "@/lib/profile-org-tree";

interface ProfileNode {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string | null;
  upline_id: string | null;
  hierarchy_path: string | null;
  avatar_url: string | null;
  children: ProfileNode[];
}

function initials(node: ProfileNode): string {
  const a = (node.first_name || "").trim().charAt(0);
  const b = (node.last_name || "").trim().charAt(0);
  if (a && b) return `${a}${b}`.toUpperCase();
  if (a) return a.toUpperCase();
  const e = (node.email || "?").charAt(0).toUpperCase();
  return e || "?";
}

function displayName(node: ProfileNode): string {
  const n = [node.first_name, node.last_name].filter(Boolean).join(" ").trim();
  return n || node.email || "Unknown";
}

const MemberAvatar: React.FC<{ node: ProfileNode; className?: string }> = ({ node, className = "" }) => {
  const ini = initials(node);
  const url = (node.avatar_url || "").trim();
  const label = displayName(node);
  return (
    <div
      className={`relative mx-auto flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-primary/70 text-sm font-bold text-primary-foreground shadow-inner ring-2 ring-primary/30 ${className}`}
    >
      {url ? (
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{ini}</span>
      )}
    </div>
  );
};

const RoleBadge: React.FC<{ role: string | null }> = ({ role }) => {
  const r = (role || "Agent").toLowerCase();
  if (r === "admin") {
    return (
      <Badge className="mt-2 border border-sky-400/40 bg-sky-500/15 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.25)] gap-1 font-medium tracking-wide">
        <Crown className="h-3 w-3" />
        {role}
      </Badge>
    );
  }
  if (r === "team leader") {
    return (
      <Badge className="mt-2 border border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)] gap-1 font-medium tracking-wide">
        <Shield className="h-3 w-3" />
        {role}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="mt-2 border border-border/60 bg-muted/40 gap-1 font-medium">
      <User className="h-3 w-3" />
      {role || "Agent"}
    </Badge>
  );
};

/** Top-down org node: vertical stem, optional horizontal rail, child subtrees. */
const VisualOrgNode: React.FC<{ node: ProfileNode }> = ({ node }) => {
  const n = node.children.length;
  const hasChildren = n > 0;
  const name = displayName(node);

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div
          className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-br from-primary/35 via-cyan-500/15 to-violet-500/20 opacity-70 blur-md"
          aria-hidden
        />
        <div className="relative rounded-2xl border border-primary/20 bg-card/90 px-5 py-4 text-center shadow-lg shadow-primary/5 backdrop-blur-sm min-w-[168px] max-w-[220px]">
          <MemberAvatar node={node} />
          <p className="mt-2.5 truncate text-sm font-semibold tracking-tight text-foreground" title={name}>
            {name}
          </p>
          <RoleBadge role={node.role} />
        </div>
      </div>

      {hasChildren && (
        <div className="relative mt-0 flex w-full flex-col items-center">
          <div
            className="h-8 w-0.5 shrink-0 rounded-full bg-gradient-to-b from-primary via-primary/80 to-primary/45"
            aria-hidden
          />

          <div
            className="relative grid w-full max-w-full items-start justify-items-center gap-x-10 gap-y-14 pt-2"
            style={{
              gridTemplateColumns: n === 1 ? "minmax(140px,1fr)" : `repeat(${n}, minmax(140px, auto))`,
            }}
          >
            {n > 1 && (
              <div
                className="pointer-events-none absolute left-0 right-0 top-0 mx-auto h-0.5 rounded-full bg-primary/75 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                style={{
                  left: `${100 / (2 * n)}%`,
                  width: `${(100 * (n - 1)) / n}%`,
                  maxWidth: "100%",
                }}
                aria-hidden
              />
            )}

            {node.children.map((child) => (
              <div key={child.id} className="relative flex flex-col items-center pt-6">
                <div
                  className="absolute left-1/2 top-0 h-6 w-0.5 -translate-x-1/2 rounded-full bg-gradient-to-b from-primary/90 to-primary/50"
                  aria-hidden
                />
                <VisualOrgNode node={child} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Same people you can load for User Management: RLS decides rows (no SQL organization_id filter).
 * Then keep everyone in the current org **plus** anyone linked as upline/downline so managers
 * with NULL or legacy org_id still appear (fixes missing middle nodes in the tree).
 */
function profilesForOrgTree(rows: { id: string; organization_id?: string | null; upline_id?: string | null }[], organizationId: string | null): typeof rows {
  if (!organizationId) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const relevant = new Set<string>();
  for (const r of rows) {
    if (r.organization_id === organizationId) relevant.add(r.id);
  }
  let grew = true;
  let guard = 0;
  while (grew && guard++ < rows.length + 8) {
    grew = false;
    for (const r of rows) {
      if (relevant.has(r.id)) continue;
      const up = r.upline_id;
      if (up && relevant.has(up)) {
        relevant.add(r.id);
        grew = true;
      }
    }
  }
  for (const id of [...relevant]) {
    let cur: string | null | undefined = byId.get(id)?.upline_id;
    let hops = 0;
    while (cur && hops++ < 64) {
      if (relevant.has(cur)) break;
      const row = byId.get(cur);
      if (!row) break;
      relevant.add(cur);
      cur = row.upline_id ?? null;
    }
  }
  return rows.filter((r) => relevant.has(r.id));
}

const HierarchyTree: React.FC = () => {
  const { toast } = useToast();
  const { organizationId, isSuperAdmin } = useOrganization();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProfiles = useCallback(async () => {
    if (!organizationId && !isSuperAdmin) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, first_name, last_name, email, role, status, organization_id, upline_id, hierarchy_path, avatar_url",
        )
        .neq("status", "Deleted")
        .order("created_at", { ascending: true });
      if (error) throw error;
      setProfiles(data || []);
    } catch (e: any) {
      toast({ title: "Failed to load team", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [organizationId, isSuperAdmin, toast]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const displayProfiles = useMemo(
    () => profilesForOrgTree(profiles, organizationId),
    [profiles, organizationId],
  );

  const tree = useMemo(() => {
    return buildProfileOrgForest(displayProfiles) as ProfileNode[];
  }, [displayProfiles]);

  const uniqueProfileCount = useMemo(
    () => new Set(displayProfiles.map((p) => p?.id).filter(Boolean) as string[]).size,
    [displayProfiles],
  );
  const duplicateRows = displayProfiles.length > uniqueProfileCount;

  return (
    <div className="relative overflow-x-auto rounded-2xl border border-primary/10 bg-gradient-to-b from-muted/30 via-card to-card p-6 shadow-xl shadow-black/[0.03] dark:shadow-black/20">
      <div
        className="pointer-events-none absolute inset-0 z-0 rounded-2xl opacity-[0.35] dark:opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 0%, hsl(var(--primary) / 0.12), transparent 45%), radial-gradient(circle at 80% 100%, hsl(280 60% 50% / 0.08), transparent 40%)",
        }}
        aria-hidden
      />

      <div className="relative z-10 mb-6 flex flex-col gap-1 border-b border-border/40 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-foreground">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
            <h4 className="text-lg font-semibold tracking-tight">Team structure</h4>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            How your agency is organized today. Reporting lines follow each person&apos;s manager in the system.
          </p>
        </div>
        <div className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <p>
            {uniqueProfileCount} member{uniqueProfileCount !== 1 ? "s" : ""}
            {duplicateRows ? ` (${profiles.length} rows)` : ""}
          </p>
          {duplicateRows && (
            <p className="mt-1 max-w-xs text-[10px] font-normal normal-case text-amber-600 dark:text-amber-400">
              Duplicate profile rows for the same user id; chart shows one card per person.
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="relative z-10 flex min-h-[200px] items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary/60" aria-label="Loading" />
        </div>
      ) : tree.length === 0 ? (
        <div className="relative z-10 py-16 text-center text-sm text-muted-foreground">
          No team members in this organization yet.
        </div>
      ) : (
        <div className="relative z-10 space-y-4">
          {tree.length > 1 && (
            <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
              More than one top-level person usually means someone&apos;s manager is not on this chart (outside your access) or
              upline was cleared — those people still appear here at the top.
            </p>
          )}
          <div className="flex flex-row flex-wrap justify-center gap-16 pb-4 pt-2">
            {tree.map((root) => (
              <VisualOrgNode key={root.id} node={root} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HierarchyTree;
