import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
    Phone, Shield, ShieldAlert, ShieldCheck,
    Settings2, Plus, RefreshCw, Trash2,
    ExternalLink, Loader2, Info, Headphones, Search, ShoppingCart
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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

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
        provider: "telnyx",
        account_sid: "",
        auth_token: "",
        api_key: "",
        api_secret: "",
        application_sid: "",
    });
    const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
    const [isTesting, setIsTesting] = useState(false);

    // Search & Buy State
    const [isBuyingNumber, setIsBuyingNumber] = useState(false);
    const [searchAreaCode, setSearchAreaCode] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isProvisioning, setIsProvisioning] = useState<string | null>(null);

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
                    provider: configData.provider || "telnyx",
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
        if (!config.api_key) {
            toast({
                title: "Incomplete Setup",
                description: "Please enter an API Key first.",
                variant: "destructive",
            });
            return;
        }

        setIsTesting(true);
        try {
            const { data, error } = await supabase.functions.invoke('telnyx-check-connection', {
                body: { api_key: config.api_key },
            });

            if (error) throw error;

            if (data?.success) {
                toast({
                    title: "Connection Perfect",
                    description: "Successfully authenticated with the Telnyx API.",
                });
            } else {
                throw new Error(data?.error || "Connection failed");
            }
        } catch (error: any) {
            console.error("Connection test error:", error);
            toast({
                title: "Connection Failed",
                description: error.message || "Could not authenticate with Telnyx.",
                variant: "destructive",
            });
        } finally {
            setIsTesting(false);
        }
    };

    const handleSearchNumbers = async () => {
        if (!searchAreaCode || searchAreaCode.length < 3) {
            toast({ title: "Invalid Search", description: "Please enter a valid area code (e.g., 212).", variant: "destructive" });
            return;
        }

        setIsSearching(true);
        try {
            const { data, error } = await supabase.functions.invoke('telnyx-search-numbers', {
                body: { area_code: searchAreaCode, api_key: config.api_key },
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            setSearchResults(data?.numbers || []);
            if (data?.numbers?.length === 0) {
                toast({ title: "No numbers found", description: "Try a different area code." });
            }
        } catch (error: any) {
            console.error("Search error:", error);
            toast({ title: "Search Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsSearching(false);
        }
    };

    const handleBuyNumber = async (phoneNumber: string) => {
        setIsProvisioning(phoneNumber);
        try {
            const { data, error } = await supabase.functions.invoke('telnyx-buy-number', {
                body: { phone_number: phoneNumber, api_key: config.api_key },
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            toast({
                title: "Number Purchased & Configured!",
                description: "We automatically set up the webhooks, outbound profile, and SIP credentials."
            });

            setIsBuyingNumber(false);
            setSearchResults([]);
            setSearchAreaCode("");
            fetchData(); // Refresh the numbers list
        } catch (error: any) {
            console.error("Provisioning error:", error);
            toast({ title: "Purchase Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsProvisioning(null);
        }
    };

    const handleDeleteNumber = async (id: string) => {
        try {
            const { error } = await supabase
                .from('phone_numbers')
                .delete()
                .eq('id', id);

            if (error) throw error;

            toast({ title: "Number Removed" });
            fetchData();
        } catch (error: any) {
            toast({ title: "Delete failed", description: error.message, variant: "destructive" });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <TooltipProvider>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-foreground">Phone Systems (Telnyx)</h3>
                        <p className="text-sm text-muted-foreground">Manage your voice and SMS carrier integration.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => setIsBuyingNumber(true)}>
                            <ShoppingCart className="w-4 h-4 mr-2" /> Buy Number
                        </Button>
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
                                Your master credentials for the global Telnyx dialer.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <label className="text-xs font-medium uppercase text-muted-foreground">API Key</label>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p className="max-w-xs text-xs">Found in Telnyx Portal under <strong>Account Settings {">"} API Keys</strong>. Starts with 'KEY'.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                                <Input
                                    value={config.api_key}
                                    type="password"
                                    onChange={e => setConfig({ ...config, api_key: e.target.value })}
                                    placeholder="KEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                                    className="font-mono text-sm"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Helpful Info Card */}
                    <Card className="bg-primary/5 border-primary/20">
                        <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2 text-primary">
                                <Settings2 className="w-4 h-4" />
                                Quick Start Guide
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm space-y-4 text-foreground/80">
                            <ul className="space-y-2 list-none p-0">
                                <li className="flex gap-2">
                                    <span className="font-bold text-primary">1.</span>
                                    <span>Create a <strong>Telnyx Account</strong> and add a payment method.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="font-bold text-primary">2.</span>
                                    <span>Navigate to <strong>Account Settings {">"} API Keys</strong>.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="font-bold text-primary">3.</span>
                                    <span>Create an API Key and paste it into the credentials box on the left.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="font-bold text-primary">4.</span>
                                    <span>Save & Test the connection.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="font-bold text-primary">5.</span>
                                    <span>Click <strong>Buy Number</strong> at the top to search for and instantly provision a new line!</span>
                                </li>
                            </ul>
                            <div className="pt-2 flex flex-col gap-2">
                                <a href="https://portal.telnyx.com" target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1 font-medium bg-primary/10 w-fit px-3 py-1 rounded-md text-xs">
                                    Open Telnyx Portal <ExternalLink className="w-3 h-3" />
                                </a>
                                <p className="text-xs italic text-muted-foreground">Detailed step-by-step documentation is available in the Project Knowledge Base.</p>
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
                                            No phone numbers found. Use the "Buy Number" button to get started.
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
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() => handleDeleteNumber(n.id)}
                                                >
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

            <Dialog open={isBuyingNumber} onOpenChange={setIsBuyingNumber}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Search & Buy Numbers</DialogTitle>
                        <DialogDescription>
                            Find available numbers. When you buy, AgentFlow automatically configures the infrastructure so it's ready to dial instantly.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="flex gap-2">
                            <Input
                                placeholder="Enter Area Code (e.g., 212)"
                                value={searchAreaCode}
                                onChange={e => setSearchAreaCode(e.target.value)}
                                className="flex-1"
                                onKeyDown={(e) => e.key === 'Enter' && handleSearchNumbers()}
                            />
                            <Button onClick={handleSearchNumbers} disabled={isSearching || searchAreaCode.length < 3}>
                                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                                Search
                            </Button>
                        </div>

                        {searchResults.length > 0 && (
                            <div className="border rounded-md overflow-hidden flex flex-col max-h-[300px]">
                                <div className="bg-muted px-4 py-2 text-xs font-semibold grid grid-cols-2">
                                    <div>Number</div>
                                    <div className="text-right">Action</div>
                                </div>
                                <div className="overflow-y-auto">
                                    {searchResults.map((result) => (
                                        <div key={result.phone_number} className="flex items-center justify-between px-4 py-3 border-t hover:bg-muted/50 transition-colors">
                                            <div className="font-mono text-sm">{result.phone_number}</div>
                                            <Button
                                                size="sm"
                                                onClick={() => handleBuyNumber(result.phone_number)}
                                                disabled={isProvisioning !== null}
                                            >
                                                {isProvisioning === result.phone_number ? (
                                                    <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Provisioning...</>
                                                ) : (
                                                    "Buy Number ($1.00/mo)"
                                                )}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                    </div>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
};

export default PhoneSettings;
