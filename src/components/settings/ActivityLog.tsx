import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useBranding } from "@/contexts/BrandingContext";

interface ActivityLogItem {
    id: string;
    action: string;
    user_name: string;
    createdAt: Date;
}

const ActivityLog: React.FC = () => {
    const { formatDateTime } = useBranding();
    const [logs, setLogs] = useState<ActivityLogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        fetchLogs();
    }, []);

    const fetchLogs = async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const { data, error } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            const formatted: ActivityLogItem[] = (data || []).map(d => ({
                id: d.id,
                action: d.action,
                user_name: d.user_name || "System",
                createdAt: new Date(d.created_at),
            }));
            setLogs(formatted);
            if (isRefresh) {
                toast({ title: "Logs refreshed", className: "bg-success text-success-foreground border-success pt-2 pb-2 pl-4 pr-4" });
            }
        } catch (error) {
            console.error("Error fetching logs:", error);
            toast({ title: "Error loading logs", variant: "destructive" });
        } finally {
            if (isRefresh) setRefreshing(false);
            else setLoading(false);
        }
    };

    const exportCSV = () => {
        toast({ title: "Export started", description: "Your CSV is being generated and will download shortly." });
        setTimeout(() => {
            // Mock CSV download behavior for now
            const csvContent = "data:text/csv;charset=utf-8,"
                + "Action,User,Date\n"
                + logs.map(l => `"${l.action}","${l.user_name}","${l.createdAt.toISOString()}"`).join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "activity_logs.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast({ title: "Export complete", className: "bg-success text-success-foreground border-success" });
        }, 1500);
    };

    const getInitials = (name: string) => {
        if (!name || name === "System") return "SY";
        return name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Activity Log</h3>
                    <p className="text-sm text-muted-foreground">View recent system actions and user activity</p>
                </div>
                <div className="flex items-center gap-2">
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

            <div className="bg-card rounded-xl border divide-y overflow-hidden relative">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground border-dashed">
                        <Clock className="w-12 h-12 mb-4 opacity-50" />
                        <p className="text-foreground font-medium text-lg">No activity yet</p>
                        <p className="text-sm">When users take actions within the system, they will appear here.</p>
                    </div>
                ) : (
                    <div className="max-h-[600px] overflow-y-auto min-h-[400px]">
                        {logs.map((log) => (
                            <div key={log.id} className="flex items-center justify-between px-5 py-4 hover:bg-accent/30 sidebar-transition">
                                <div className="flex items-start gap-4">
                                    <div className="w-9 h-9 mt-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                                        {getInitials(log.user_name)}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-foreground">{log.action}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">{log.user_name}</p>
                                    </div>
                                </div>
                                <div className="text-xs text-muted-foreground font-medium shrink-0 ml-4 flex items-center gap-1.5 whitespace-nowrap">
                                    <Clock className="w-3.5 h-3.5" />
                                    {formatDateTime(log.createdAt)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ActivityLog;
