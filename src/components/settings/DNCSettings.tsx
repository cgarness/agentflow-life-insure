import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
    Ban, Search, Plus, Trash2, Upload,
    Loader2, ShieldAlert, Phone as PhoneIcon,
    X, Info
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
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [numbers, setNumbers] = useState<DNCNumber[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newNumber, setNewNumber] = useState("");
    const [newReason, setNewReason] = useState("");
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        fetchDNCList();

        // Subscribe to changes
        const channel = supabase
            .channel('dnc_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'dnc_list' }, () => {
                fetchDNCList();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchDNCList = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('dnc_list')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setNumbers(data || []);
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
    };

    const handleAddNumber = async () => {
        if (!newNumber.trim()) {
            toast({
                title: "Phone number required",
                description: "Please enter a valid phone number.",
                variant: "destructive",
            });
            return;
        }

        try {
            setAdding(true);
            const { error } = await supabase
                .from('dnc_list')
                .insert({
                    phone_number: newNumber.trim(),
                    reason: newReason.trim() || null,
                    organization_id: organizationId,
                } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

            if (error) {
                if (error.code === '23505') {
                    throw new Error("This number is already in the DNC list.");
                }
                throw error;
            }

            toast({
                title: "Number Added",
                description: `${newNumber} has been added to the DNC list.`,
            });

            setNewNumber("");
            setNewReason("");
            setIsAddModalOpen(false);
            fetchDNCList();
        } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            toast({
                title: "Failed to add",
                description: error.message || "Could not add number to database.",
                variant: "destructive",
            });
        } finally {
            setAdding(false);
        }
    };

    const handleRemoveNumber = async (id: string, phone: string) => {
        try {
            const { error } = await supabase
                .from('dnc_list')
                .delete()
                .eq('id', id);

            if (error) throw error;

            toast({
                title: "Number Removed",
                description: `${phone} is no longer on the DNC list.`,
            });
            fetchDNCList();
        } catch (error) {
            toast({
                title: "Removal failed",
                description: "Could not remove number from database.",
                variant: "destructive",
            });
        }
    };

    const filteredNumbers = numbers.filter(n =>
        n.phone_number.includes(searchQuery) ||
        (n.reason && n.reason.toLowerCase().includes(searchQuery.toLowerCase()))
    );

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
                        DNC List Manager
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                            {numbers.length} numbers registered
                        </span>
                    </h3>
                    <p className="text-sm text-muted-foreground">Global "Do Not Call" list to prevent agents from dialing restricted numbers.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-2">
                        <Upload className="w-4 h-4" /> Import CSV
                    </Button>

                    <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="gap-2">
                                <Plus className="w-4 h-4" /> Add Number
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add to DNC List</DialogTitle>
                                <DialogDescription>
                                    Manually add a phone number to the global DNC list.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="phone">Phone Number</Label>
                                    <Input
                                        id="phone"
                                        placeholder="(555) 000-0000"
                                        value={newNumber}
                                        onChange={(e) => setNewNumber(e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="reason">Reason (Optional)</Label>
                                    <Input
                                        id="reason"
                                        placeholder="e.g. Litigation Threat, Explicit Request"
                                        value={newReason}
                                        onChange={(e) => setNewReason(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
                                <Button onClick={handleAddNumber} disabled={adding}>
                                    {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                    Add to Global DNC
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

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
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredNumbers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-12">
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
                                                {n.phone_number}
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
                    Numbers on this list will be automatically blocked by the predictive dialer and manual agent calls.
                    Deleting a number from this list will immediately restore the ability for agents to contact them.
                </CardContent>
            </Card>
        </div>
    );
};

export default DNCSettings;
