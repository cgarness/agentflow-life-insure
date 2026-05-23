import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/lib/activityLogger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatPhoneNumber, normalizePhoneNumber } from "@/utils/phoneUtils";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { dncEntrySchema } from "@/components/settings/dnc/dncSchema";
import {
    Ban, Search, Plus, Trash2,
    Loader2, ShieldAlert, Info
} from "lucide-react";
import {
    Card, CardContent, CardDescription,
    CardHeader, CardTitle
} from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead,
    TableHeader, TableRow
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface DNCNumber {
    id: string;
    phone_number: string;
    reason: string | null;
    created_at: string;
}

const DNCSettings: React.FC = () => {
    const { organizationId } = useOrganization();
    const { user, profile } = useAuth();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [numbers, setNumbers] = useState<DNCNumber[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newNumber, setNewNumber] = useState("");
    const [newReason, setNewReason] = useState("");
    const [fieldErrors, setFieldErrors] = useState<{ phone?: string; reason?: string }>({});
    const [adding, setAdding] = useState(false);

    const isSuperAdmin = profile?.is_super_admin === true;
    const isAdmin = profile?.role === "Admin";
    const canManage = isSuperAdmin || isAdmin;

    const fetchDNCList = useCallback(async () => {
        if (!organizationId) {
            setNumbers([]);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('dnc_list')
                .select('id, phone_number, reason, created_at')
                .eq('organization_id', organizationId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setNumbers((data as DNCNumber[]) || []);
        } catch (error) {
            console.error("Error fetching DNC list:", error);
            toast({
                title: "Error loading DNC list",
                description: "Could not fetch numbers from Supabase.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }, [organizationId, toast]);

    useEffect(() => {
        fetchDNCList();
        if (!organizationId) return;

        const channel = supabase
            .channel(`dnc_changes_${organizationId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'dnc_list',
                    filter: `organization_id=eq.${organizationId}`,
                },
                () => { fetchDNCList(); }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [organizationId, fetchDNCList]);

    const handleAddNumber = async () => {
        if (!canManage) return;
        if (!organizationId) {
            toast({
                title: "No organization",
                description: "Cannot add DNC entries without an active organization.",
                variant: "destructive",
            });
            return;
        }

        const parsed = dncEntrySchema.safeParse({
            phone_number: newNumber,
            reason: newReason,
        });
        if (!parsed.success) {
            const errs: { phone?: string; reason?: string } = {};
            for (const issue of parsed.error.issues) {
                if (issue.path[0] === "phone_number") errs.phone = issue.message;
                if (issue.path[0] === "reason") errs.reason = issue.message;
            }
            setFieldErrors(errs);
            return;
        }
        setFieldErrors({});

        try {
            setAdding(true);
            const { error } = await supabase
                .from('dnc_list')
                .insert({
                    phone_number: parsed.data.phone_number,
                    reason: parsed.data.reason,
                    organization_id: organizationId,
                });

            if (error) {
                if (error.code === '23505') {
                    throw new Error("This number is already in the DNC list.");
                }
                throw error;
            }

            toast({
                title: "Number Added",
                description: `${formatPhoneNumber(parsed.data.phone_number)} has been added to the DNC list.`,
            });

            void logActivity({
                action: `Added ${formatPhoneNumber(parsed.data.phone_number)} to DNC list`,
                category: "contacts",
                organizationId,
                userId: user?.id,
                userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
                metadata: { phoneNumber: parsed.data.phone_number, reason: parsed.data.reason },
            });

            setNewNumber("");
            setNewReason("");
            setIsAddModalOpen(false);
            fetchDNCList();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Could not add number to database.";
            toast({
                title: "Failed to add",
                description: message,
                variant: "destructive",
            });
        } finally {
            setAdding(false);
        }
    };

    const handleRemoveNumber = async (id: string, phone: string) => {
        if (!canManage || !organizationId) return;
        try {
            const { error } = await supabase
                .from('dnc_list')
                .delete()
                .eq('id', id)
                .eq('organization_id', organizationId);

            if (error) throw error;

            toast({
                title: "Number Removed",
                description: `${formatPhoneNumber(phone)} is no longer on the DNC list.`,
            });

            void logActivity({
                action: `Removed ${formatPhoneNumber(phone)} from DNC list`,
                category: "contacts",
                organizationId,
                userId: user?.id,
                userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
                metadata: { phoneNumber: phone, dncEntryId: id },
            });

            fetchDNCList();
        } catch (error) {
            console.error("Error removing DNC entry:", error);
            toast({
                title: "Removal failed",
                description: "Could not remove number from database.",
                variant: "destructive",
            });
        }
    };

    const normalizedQuery = normalizePhoneNumber(searchQuery);
    const filteredNumbers = numbers.filter(n => {
        const q = searchQuery.toLowerCase();
        if (!searchQuery) return true;
        if (n.phone_number.includes(searchQuery)) return true;
        if (normalizedQuery && n.phone_number.includes(normalizedQuery)) return true;
        if (formatPhoneNumber(n.phone_number).toLowerCase().includes(q)) return true;
        if (n.reason && n.reason.toLowerCase().includes(q)) return true;
        return false;
    });

    if (loading && numbers.length === 0) {
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
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        Agency DNC List
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                            {numbers.length} numbers registered
                        </span>
                    </h3>
                    <p className="text-sm text-muted-foreground">Your agency's "Do Not Call" list. Numbers here are blocked from auto-dialing and trigger a warning for manual calls.</p>
                </div>
                {canManage && (
                    <div className="flex gap-2">
                        <Dialog
                            open={isAddModalOpen}
                            onOpenChange={(open) => {
                                setIsAddModalOpen(open);
                                if (!open) setFieldErrors({});
                            }}
                        >
                            <DialogTrigger asChild>
                                <Button size="sm" className="gap-2">
                                    <Plus className="w-4 h-4" /> Add Number
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Add to Agency DNC List</DialogTitle>
                                    <DialogDescription>
                                        Manually add a phone number to your agency's DNC list.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="phone">Phone Number</Label>
                                        <PhoneInput
                                            id="phone"
                                            placeholder="(555)000-0000"
                                            value={newNumber}
                                            onChange={(val) => setNewNumber(normalizePhoneNumber(val))}
                                        />
                                        {fieldErrors.phone && (
                                            <p className="text-xs text-destructive">{fieldErrors.phone}</p>
                                        )}
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="reason">Reason (Optional)</Label>
                                        <Input
                                            id="reason"
                                            placeholder="e.g. Litigation Threat, Explicit Request"
                                            value={newReason}
                                            onChange={(e) => setNewReason(e.target.value)}
                                            maxLength={200}
                                        />
                                        {fieldErrors.reason && (
                                            <p className="text-xs text-destructive">{fieldErrors.reason}</p>
                                        )}
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
                                    <Button onClick={handleAddNumber} disabled={adding}>
                                        {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                        Add to Agency DNC
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                )}
            </div>

            {!canManage && (
                <Card className="bg-muted/40 border-muted">
                    <CardContent className="py-3 text-sm text-muted-foreground flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Read-only view. Only Admins can add or remove numbers from the agency DNC list.
                    </CardContent>
                </Card>
            )}

            <div className="flex items-center gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by number or reason..."
                        className="pl-9"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Phone Number</TableHead>
                                <TableHead>Reason</TableHead>
                                <TableHead>Date Added</TableHead>
                                {canManage && <TableHead className="text-right">Actions</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredNumbers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={canManage ? 4 : 3} className="text-center py-12">
                                        <div className="flex flex-col items-center gap-2">
                                            <ShieldAlert className="w-8 h-8 text-muted-foreground/50" />
                                            <p className="text-sm text-muted-foreground italic">No matching DNC records found.</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredNumbers.map((n) => (
                                    <TableRow key={n.id}>
                                        <TableCell className="font-mono font-medium">
                                            <div className="flex items-center gap-2">
                                                <Ban className="w-3.5 h-3.5 text-destructive" />
                                                {formatPhoneNumber(n.phone_number)}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm text-muted-foreground italic">
                                                {n.reason || "No reason provided"}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {new Date(n.created_at).toLocaleDateString()}
                                        </TableCell>
                                        {canManage && (
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() => handleRemoveNumber(n.id, n.phone_number)}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card className="bg-destructive/5 border-destructive/20 mt-8">
                <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                        <Info className="w-4 h-4" />
                        Compliance Notice
                    </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-foreground/80">
                    Numbers on this list are hard-blocked from automated/predictive dialing and trigger a confirmation warning for manual click-to-call. Only Admins and Super Admins can override a manual DNC call; every override is recorded in the activity log.
                </CardContent>
            </Card>
        </div>
    );
};

export default DNCSettings;
