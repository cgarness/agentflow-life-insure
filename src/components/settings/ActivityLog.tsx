import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useBranding } from "@/contexts/BrandingContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Clock,
    Download,
    Loader2,
    RefreshCw,
    Search,
    Users,
    UserPlus,
    Target,
    Phone,
    Settings,
    Database,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import type { Database as DB } from "@/integrations/supabase/types";

type ActivityRow = DB["public"]["Tables"]["activity_logs"]["Row"];
type CategoryKey = "user_management" | "contacts" | "campaigns" | "telephony" | "settings" | "system";
type DateRange = "today" | "7d" | "30d" | "all";
const PAGE_SIZE = 50;

const CATEGORY_META: Record<CategoryKey, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
    user_management: { icon: Users,    color: "text-blue-500 bg-blue-500/10",       label: "User Management" },
    contacts:        { icon: UserPlus, color: "text-emerald-500 bg-emerald-500/10", label: "Contacts" },
    campaigns:       { icon: Target,   color: "text-amber-500 bg-amber-500/10",     label: "Campaigns" },
    telephony:       { icon: Phone,    color: "text-purple-500 bg-purple-500/10",   label: "Telephony" },
    settings:        { icon: Settings, color: "text-gray-400 bg-gray-500/10",       label: "Settings" },
    system:          { icon: Database, color: "text-red-500 bg-red-500/10",         label: "System" },
};

const DATE_RANGES: { value: DateRange; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "7d",    label: "7 Days" },
    { value: "30d",   label: "30 Days" },
    { value: "all",   label: "All Time" },
];

function cutoffFor(range: DateRange): Date | null {
    if (range === "all") return null;
    const d = new Date();
    if (range === "today") { d.setHours(0, 0, 0, 0); return d; }
    if (range === "7d")    { d.setDate(d.getDate() - 7); return d; }
    if (range === "30d")   { d.setDate(d.getDate() - 30); return d; }
    return null;
}

function csvEscape(v: unknown): string {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
}

const ActivityLog: React.FC = () => {
    const { organizationId } = useOrganization();
    const { formatDateTime } = useBranding();

    const [logs, setLogs] = useState<ActivityRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [inputValue, setInputValue] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [dateRange, setDateRange] = useState<DateRange>("30d");
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setSearchQuery(inputValue), 300);
        return () => clearTimeout(t);
    }, [inputValue]);

    useEffect(() => { setPage(0); }, [categoryFilter, dateRange, searchQuery]);

    const buildQuery = useCallback((forExport: boolean) => {
        if (!organizationId) return null;
        let q = supabase
            .from("activity_logs")
            .select("*", { count: forExport ? undefined : "exact" })
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: false });
        if (categoryFilter !== "all") q = q.eq("category", categoryFilter);
        const cutoff = cutoffFor(dateRange);
        if (cutoff) q = q.gte("created_at", cutoff.toISOString());
        const term = searchQuery.trim();
        if (term) q = q.ilike("action", `%${term}%`);
        return q;
    }, [organizationId, categoryFilter, dateRange, searchQuery]);

    const fetchLogs = useCallback(async (isRefresh = false) => {
        if (!organizationId) return;
        if (isRefresh) setRefreshing(true); else setLoading(true);
        try {
            const q = buildQuery(false);
            if (!q) return;
            const { data, error, count } = await q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
            if (error) throw error;
            setLogs((data || []) as ActivityRow[]);
            setTotalCount(count || 0);
        } catch (e) {
            console.error("Error fetching logs:", e);
            toast({ title: "Error loading logs", variant: "destructive" });
        } finally {
            if (isRefresh) setRefreshing(false); else setLoading(false);
        }
    }, [organizationId, buildQuery, page]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    const exportCSV = async () => {
        try {
            toast({ title: "Preparing export...", description: "Building CSV." });
            const q = buildQuery(true);
            if (!q) return;
            const { data, error } = await q.limit(5000);
            if (error) throw error;
            const rows = (data || []) as ActivityRow[];
            if (rows.length === 0) {
                toast({ title: "No logs to export" });
                return;
            }
            const header = "Action,User,Category,Date";
            const body = rows.map(r => [
                csvEscape(r.action),
                csvEscape(r.user_name || "System"),
                csvEscape(CATEGORY_META[(r.category as CategoryKey) || "system"]?.label || r.category),
                csvEscape(new Date(r.created_at).toISOString()),
            ].join(",")).join("\n");
            const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `activity_log_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast({ title: "Export complete" });
        } catch (e) {
            console.error("CSV export failed:", e);
            toast({ title: "Export failed", variant: "destructive" });
        }
    };

    const pagination = useMemo(() => {
        const start = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
        const end = Math.min((page + 1) * PAGE_SIZE, totalCount);
        const hasPrev = page > 0;
        const hasNext = (page + 1) * PAGE_SIZE < totalCount;
        return { start, end, hasPrev, hasNext };
    }, [page, totalCount]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Activity Log</h3>
                    <p className="text-sm text-muted-foreground">View recent system actions and user activity</p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search actions..."
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        className="pl-8 w-64 bg-card"
                    />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-44 bg-card"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {(Object.keys(CATEGORY_META) as CategoryKey[]).map(key => (
                            <SelectItem key={key} value={key}>{CATEGORY_META[key].label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                    {DATE_RANGES.map(r => (
                        <button
                            key={r.value}
                            onClick={() => setDateRange(r.value)}
                            className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                                dateRange === r.value
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => fetchLogs(true)} disabled={refreshing} className="gap-2 bg-card">
                        <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                        <span className="hidden sm:inline">Refresh</span>
                    </Button>
                    <Button size="sm" onClick={exportCSV} className="gap-2">
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Export CSV</span>
                    </Button>
                </div>
            </div>

            <div className="bg-card rounded-xl border divide-y overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                        <Clock className="w-12 h-12 mb-4 opacity-50" />
                        <p className="text-foreground font-medium text-lg">No activity yet</p>
                        <p className="text-sm">Actions like inviting users, importing leads, and creating campaigns will appear here as they happen.</p>
                    </div>
                ) : (
                    logs.map(log => {
                        const key = (CATEGORY_META[log.category as CategoryKey] ? log.category : "system") as CategoryKey;
                        const meta = CATEGORY_META[key];
                        const Icon = meta.icon;
                        return (
                            <div key={log.id} className="flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors">
                                <div className="flex items-start gap-3">
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${meta.color}`}>
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-foreground">{log.action}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">{log.user_name || "System"}</p>
                                    </div>
                                </div>
                                <div className="text-xs text-muted-foreground font-medium shrink-0 ml-4 flex items-center gap-1.5 whitespace-nowrap">
                                    <Clock className="w-3.5 h-3.5" />
                                    {formatDateTime(new Date(log.created_at))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {totalCount > PAGE_SIZE && (
                <div className="flex justify-between items-center pt-3">
                    <span className="text-sm text-muted-foreground">
                        Showing {pagination.start}–{pagination.end} of {totalCount}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={!pagination.hasPrev} className="gap-1">
                            <ChevronLeft className="w-4 h-4" /> Previous
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext} className="gap-1">
                            Next <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ActivityLog;
