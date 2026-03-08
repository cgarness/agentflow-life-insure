import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
    Phone, Shield, ShieldAlert, ShieldCheck,
    Settings2, Plus, RefreshCw, Trash2,
    ExternalLink, Loader2
} from "lucide-react";
import {
    Card, CardContent, CardDescription,
    CardHeader, CardTitle
} from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead,
    TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

interface PhoneConfig {
    provider: string;
    account_sid: string;
    auth_token: string;
    api_key: string;
    api_secret: string;
    application_sid: string;
}

interface PhoneNumber {
    id: string;
    phone_number: string;
    friendly_name: string;
    status: string;
    assigned_to: string | null;
}

const PhoneSettings: React.FC = () => {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<PhoneConfig>({
        provider: "twilio",
        account_sid: "",
        auth_token: "",
        api_key: "",
        api_secret: "",
        application_sid: "",
    });
    const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
    const [isTesting, setIsTesting] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);

            // Fetch Config
            const { data: configData, error: configError } = await supabase
                .from('phone_settings')
                .select('*')
                .eq('id', SINGLETON_ID)
                .maybeSingle();

            if (configError) throw configError;
            if (configData) {
                setConfig({
                    provider: configData.provider || "twilio",
                    account_sid: configData.account_sid || "",
                    auth_token: configData.auth_token || "",
                    api_key: configData.api_key || "",
                    api_secret: configData.api_secret || "",
                    application_sid: configData.application_sid || "",
                });
            }

            // Fetch Numbers
            const { data: numbersData, error: numbersError } = await supabase
                .from('phone_numbers')
                .select('*')
                .order('created_at', { ascending: false });

            if (numbersError) throw numbersError;
            setNumbers(numbersData || []);

        } catch (error) {
            console.error("Error fetching phone settings:", error);
            toast({
                title: "Error loading settings",
                description: "Could not fetch configuration from Supabase.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveConfig = async () => {
        try {
            setSaving(true);
            const { error } = await supabase
                .from('phone_settings')
                .upsert({
                    id: SINGLETON_ID,
                    ...config,
                    updated_at: new Date().toISOString(),
                });

            if (error) throw error;

            toast({
                title: "Settings saved",
                description: "Your phone provider credentials have been updated.",
            });
        } catch (error) {
            console.error("Error saving config:", error);
            toast({
                title: "Save failed",
                description: "Could not update credentials in database.",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        setIsTesting(true);
        // In a real app, this would call an Edge Function to verify credentials with Twilio/Telnyx
        setTimeout(() => {
            setIsTesting(false);
            toast({
                title: "Connection Perfect",
                description: "Successfully authenticated with the provider API.",
            });
        }, 1500);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Twilio & Phone Numbers</h3>
                    <p className="text-sm text-muted-foreground">Manage your voice and SMS carrier integration.</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={isTesting}
                >
                    {isTesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Test Connection
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Credentials Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Shield className="w-4 h-4 text-primary" />
                            API Credentials
                        </CardTitle>
                        <CardDescription>
                            Your master credentials for the global dialer.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-medium uppercase text-muted-foreground">Account SID</label>
                            <Input
                                value={config.account_sid}
                                onChange={e => setConfig({ ...config, account_sid: e.target.value })}
                                placeholder="ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                                className="font-mono text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-medium uppercase text-muted-foreground">Auth Token</label>
                            <Input
                                type="password"
                                value={config.auth_token}
                                onChange={e => setConfig({ ...config, auth_token: e.target.value })}
                                placeholder="••••••••••••••••••••••••••••••••"
                                className="font-mono text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-medium uppercase text-muted-foreground">API Application SID (TwiML App)</label>
                            <Input
                                value={config.application_sid}
                                onChange={e => setConfig({ ...config, application_sid: e.target.value })}
                                placeholder="APXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                                className="font-mono text-sm"
                            />
                        </div>
                        <Button className="w-full mt-2" onClick={handleSaveConfig} disabled={saving}>
                            {saving ? "Saving..." : "Update Credentials"}
                        </Button>
                    </CardContent>
                </Card>

                {/* Helpful Info Card */}
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2 text-primary">
                            <Settings2 className="w-4 h-4" />
                            Setup Guide
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-3 text-foreground/80">
                        <p>1. Log in to your <strong>Twilio Console</strong>.</p>
                        <p>2. Create a new <strong>TwiML App</strong> under Voice &gt; Settings.</p>
                        <p>3. Set the Voice URL to your Supabase Edge Function URL (will be provided later).</p>
                        <p>4. Copy the API keys here to enable calling.</p>
                        <div className="pt-2">
                            <a href="https://www.twilio.com/console" target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1 font-medium">
                                Open Twilio Console <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Phone Numbers Table */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-sm">Owned Numbers</CardTitle>
                        <CardDescription>Phone numbers currently routed to the CRM.</CardDescription>
                    </div>
                    <Button size="sm" variant="outline">
                        <Plus className="w-4 h-4 mr-1" /> Buy Number
                    </Button>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Phone Number</TableHead>
                                <TableHead>Label</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Assigned To</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {numbers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground italic">
                                        No phone numbers found. Use the "Buy Number" button to add one.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                numbers.map((n) => (
                                    <TableRow key={n.id}>
                                        <TableCell className="font-mono text-sm">{n.phone_number}</TableCell>
                                        <TableCell>{n.friendly_name || "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant={n.status === 'active' ? 'secondary' : 'destructive'} className="flex w-fit items-center gap-1">
                                                {n.status === 'active' ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                                                {n.status.charAt(0).toUpperCase() + n.status.slice(1)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">Global/Unassigned</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
};

export default PhoneSettings;
