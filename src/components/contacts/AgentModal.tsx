import React, { useState, useEffect } from "react";
import { X, Phone, Mail, Calendar, Clock, FileText, RefreshCw, MessageSquare, ChevronDown } from "lucide-react";
import { User, UserProfile, ContactActivity } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { activitiesSupabaseApi } from "@/lib/supabase-activities";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const roleBadge: Record<string, string> = { Admin: "bg-blue-500 text-white", "Team Leader": "bg-purple-500 text-white", Agent: "bg-green-500 text-white" };
const availabilityStatuses = ["Available", "On Break", "Do Not Disturb", "Offline"];
const availabilityColors: Record<string, string> = { Available: "bg-green-500", "On Break": "bg-yellow-500", "Do Not Disturb": "bg-red-500", Offline: "bg-gray-400" };
const availabilityBadge: Record<string, string> = { Available: "bg-green-500 text-white", "On Break": "bg-yellow-500 text-white", "Do Not Disturb": "bg-red-500 text-white", Offline: "bg-gray-400 text-white" };

function timeAgo(dateStr: string) { const diff = Date.now() - new Date(dateStr).getTime(); const mins = Math.floor(diff / 60000); if (mins < 1) return "just now"; if (mins < 60) return `${mins} min ago`; const hrs = Math.floor(mins / 60); if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""}ago`; const days = Math.floor(hrs / 24); return `${days} day${days > 1 ? "s" : ""}ago`; }

function generateMockActivities(agent: User): ContactActivity[] {
    return [
        { id: `ag1-${agent.id}`, contactId: agent.id, contactType: "agent", type: "call", description: "Made 12 outbound calls today", agentId: agent.id, agentName: `${agent.firstName} ${agent.lastName}`, createdAt: new Date(Date.now() - 3600000).toISOString() },
        { id: `ag2-${agent.id}`, contactId: agent.id, contactType: "agent", type: "appointment", description: "Completed 2 policy reviews", agentId: agent.id, agentName: `${agent.firstName} ${agent.lastName}`, createdAt: new Date(Date.now() - 7200000).toISOString() },
        { id: `ag3-${agent.id}`, contactId: agent.id, contactType: "agent", type: "status", description: `Availability set to ${agent.availabilityStatus}`, agentId: agent.id, agentName: `${agent.firstName} ${agent.lastName}`, createdAt: new Date(Date.now() - 86400000).toISOString() },
    ];
}

const activityDotColor = (type: string) => ({ call: "bg-blue-500", note: "bg-gray-500", status: "bg-blue-500", appointment: "bg-purple-500", import: "bg-green-500" }[type] || "bg-blue-500");

interface AgentModalProps { agent: User | null; onClose: () => void; }

const AgentModal: React.FC<AgentModalProps> = ({ agent, onClose }) => {
    const [activeTab, setActiveTab] = useState<"Overview" | "Notes" | "History">("Overview");
    const [activities, setActivities] = useState<ContactActivity[]>([]);
    const [lastUpdated, setLastUpdated] = useState(new Date().toISOString());
    const [availDropdownOpen, setAvailDropdownOpen] = useState(false);
    const [localAvail, setLocalAvail] = useState(agent?.availabilityStatus ?? "Available");
    const [newNote, setNewNote] = useState("");
    const [localNotes, setLocalNotes] = useState<{ id: string; text: string; ts: string }[]>([]);

    useEffect(() => {
        async function loadData() {
            if (!agent) return;
            setLocalAvail(agent.availabilityStatus);

            const [fetchedNotes, fetchedActivities] = await Promise.all([
                notesSupabaseApi.getByContact(agent.id),
                activitiesSupabaseApi.getByContact(agent.id)
            ]);

            setLocalNotes(fetchedNotes.map((n: any) => ({ id: n.id, text: n.note, ts: n.createdAt }))); // eslint-disable-line @typescript-eslint/no-explicit-any
            setActivities(fetchedActivities);
            setActiveTab("Overview"); setAvailDropdownOpen(false); setNewNote(""); setLastUpdated(new Date().toISOString());
        }
        loadData();
    }, [agent]);

    const [profile, setProfile] = useState<UserProfile | undefined>(undefined);

    useEffect(() => {
        if (!agent) return;
        supabase.from("profiles").select("*").eq("id", agent.id).single().then(({ data: rawData }) => {
            if (!rawData) return;
            const data = rawData as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            setProfile({
                userId: data.id,
                licensedStates: data.licensed_states || [],
                carriers: data.carriers || [],
                residentState: data.resident_state,
                commissionLevel: data.commission_level || "0%",
                uplineId: data.upline_id,
                onboardingComplete: data.onboarding_complete || false,
                monthlyCallGoal: data.monthly_call_goal || 0,
                monthlySalesGoal: data.monthly_sales_goal || 0,
                weeklyAppointmentGoal: data.weekly_appointment_goal || 0,
                monthlyTalkTimeGoalHours: data.monthly_talk_time_goal_hours || 0,
                npn: data.npn || "",
                timezone: data.timezone || "Eastern Time (US & Canada)",
                winSoundEnabled: data.win_sound_enabled ?? true,
                emailNotificationsEnabled: data.email_notifications_enabled ?? true,
                smsNotificationsEnabled: data.sms_notifications_enabled ?? false,
                pushNotificationsEnabled: data.push_notifications_enabled ?? true,
                onboardingItems: data.onboarding_items || [],
            });
        });
    }, [agent]);

    if (!agent) return null;

    const handleAvailChange = async (status: string) => { setAvailDropdownOpen(false); setLocalAvail(status as typeof localAvail); await activitiesSupabaseApi.add({ contactId: agent.id, contactType: "agent", type: "status", description: `Availability changed to ${status}`, agentId: "u1" }); setLastUpdated(new Date().toISOString()); toast.success(`Availability updated to ${status}`); };

    const handleAddNote = async () => { if (!newNote.trim()) return; try { const addedNote = await notesSupabaseApi.add(agent.id, "agent", newNote.trim(), "u1"); setLocalNotes(prev => [{ id: addedNote.id, text: addedNote.note, ts: addedNote.createdAt }, ...prev]); setNewNote(""); await activitiesSupabaseApi.add({ contactId: agent.id, contactType: "agent", type: "note", description: `Note added on Agent`, agentId: "u1" }); toast.success("Note added"); } catch (e: any) { toast.error(e.message); } }; // eslint-disable-line @typescript-eslint/no-explicit-any

    const inp = "w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150";

    return (<TooltipProvider>
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
            <div className="fixed inset-0 bg-black/60" />
            <div className="relative bg-background border border-border rounded-lg shadow-2xl flex flex-col animate-in fade-in duration-150" style={{ width: "90vw", maxWidth: 1100, height: "90vh" }} onClick={e => e.stopPropagation()}>
                {/* HERO */}
                <div className="px-6 py-4 border-b border-border flex items-center gap-4 shrink-0">
                    {/* Avatar + Name */}
                    <div className="flex items-center gap-3 shrink-0">
                        <div className="relative shrink-0">
                            <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold">{agent.firstName[0]}{agent.lastName[0]}</div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background ${availabilityColors[localAvail] || "bg-gray-400"}`} />
                        </div>
                        <h2 className="text-2xl font-bold text-foreground">{agent.firstName} {agent.lastName}</h2>
                    </div>
                    {/* Role badge + Availability — centered */}
                    <div className="flex-1 flex items-center justify-center gap-3">
                        <span className={`text-sm px-3 py-1 rounded-full font-semibold ${roleBadge[agent.role] || "bg-muted text-muted-foreground"}`}>{agent.role}</span>
                        <div className="relative">
                            <button onClick={() => setAvailDropdownOpen(!availDropdownOpen)} className={`text-xs px-3 py-1 rounded-full font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 ${availabilityBadge[localAvail] || "bg-muted text-muted-foreground"}`}>
                                {localAvail}<ChevronDown className="w-3 h-3" />
                            </button>
                            {availDropdownOpen && <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-lg shadow-md py-1 min-w-[180px]">
                                {availabilityStatuses.map(s => <button key={s} onClick={() => handleAvailChange(s)} className={`w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2 transition-all duration-150 ${localAvail === s ? "font-semibold" : ""}`}><span className={`w-2.5 h-2.5 rounded-full shrink-0 ${availabilityColors[s] || "bg-gray-400"}`} />{s}</button>)}
                            </div>}
                        </div>
                    </div>
                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                        <Button className="px-4 py-2.5 text-sm bg-blue-500 hover:bg-blue-600 text-white" onClick={() => toast.info("Dialer opening...")}><Phone className="size-4 mr-1" />Call</Button>
                        <Tooltip><TooltipTrigger asChild><span><Button variant="outline" className="px-4 py-2.5 text-sm" disabled><Mail className="size-4 mr-1" />Email</Button></span></TooltipTrigger><TooltipContent>Configure SMTP in Settings</TooltipContent></Tooltip>
                        <Button variant="ghost" className="px-4 py-2.5 text-sm" onClick={onClose}><X className="size-4" /></Button>
                    </div>
                </div>

                {/* TWO COLUMNS */}
                <div className="flex flex-1 min-h-0">
                    <div className="w-[65%] flex flex-col border-r border-border min-h-0">
                        <div className="flex border-b border-border px-6 shrink-0">
                            {(["Overview", "Notes", "History"] as const).map(t => <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2.5 text-sm font-medium transition-all duration-150 ${activeTab === t ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>)}
                        </div>
                        <div className="flex-1 overflow-y-auto p-6">
                            {activeTab === "Overview" && <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">First Name</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{agent.firstName}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Last Name</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{agent.lastName}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Email</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{agent.email}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Phone</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{agent.phone || "—"}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Role</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{agent.role}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Status</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{agent.status}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Licensed States</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{profile?.licensedStates?.map((s: any) => typeof s === 'string' ? s : s.state).join(", ") || "—"}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Resident State</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{profile?.residentState || "—"}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Commission Level</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{profile?.commissionLevel || "—"}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Monthly Call Goal</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{profile?.monthlyCallGoal || "—"}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Monthly Sales Goal</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{profile?.monthlySalesGoal || "—"}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Weekly Appt. Goal</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{profile?.weeklyAppointmentGoal || "—"}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Last Login</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{agent.lastLoginAt ? new Date(agent.lastLoginAt).toLocaleDateString() : "Never"}</p></div>
                                    <div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Member Since</label><p className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{new Date(agent.createdAt).toLocaleDateString()}</p></div>
                                </div>
                                {profile && <div>
                                    <label className="text-xs font-semibold text-muted-foreground block mb-2">Onboarding Progress</label>
                                    <div className="space-y-1.5">{profile.onboardingItems.map(item => <div key={item.key} className="flex items-center gap-2"><div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${item.completed ? "bg-green-500" : "bg-gray-200"}`}>{item.completed && <span className="text-white text-[10px] font-bold">✓</span>}</div><span className={`text-sm ${item.completed ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>{item.completed && item.completedAt && <span className="text-xs text-muted-foreground ml-auto">{new Date(item.completedAt).toLocaleDateString()}</span>}</div>)}</div>
                                </div>}
                            </div>}

                            {activeTab === "Notes" && <div className="space-y-4">
                                <div className="space-y-2">
                                    <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note about this agent..." rows={3} className={`${inp} min-h-[72px] py-2`} />
                                    <div className="flex justify-end"><Button size="sm" onClick={handleAddNote}>Add Note</Button></div>
                                </div>
                                {localNotes.length === 0 ? <div className="text-center py-8"><FileText className="w-10 h-10 text-muted-foreground mx-auto mb-2" /><p className="text-sm text-muted-foreground">No notes yet.</p></div> :
                                    <div className="space-y-3">{localNotes.map(n => <div key={n.id} className="rounded-lg border border-border p-3 bg-card"><p className="text-sm text-foreground">{n.text}</p><p className="text-xs text-muted-foreground mt-1">{timeAgo(n.ts)}</p></div>)}</div>}
                            </div>}

                            {activeTab === "History" && <div>
                                {activities.length === 0 ? <div className="text-center py-12"><Clock className="w-10 h-10 text-muted-foreground mx-auto mb-2" /><p className="text-sm text-muted-foreground">No history yet</p></div> :
                                    <div>{activities.map(item => <div key={item.id} className="flex items-start gap-3 py-3 border-b border-border last:border-0"><div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${activityDotColor(item.type)}`} /><div className="flex-1 min-w-0"><p className="text-sm text-foreground">{item.description}</p></div><span className="text-xs text-muted-foreground shrink-0">{timeAgo(item.createdAt)}</span></div>)}</div>}
                            </div>}
                        </div>
                    </div>

                    <div className="w-[35%] flex flex-col min-h-0">
                        <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0"><h3 className="text-sm font-semibold text-foreground">Activity Timeline</h3><button className="text-muted-foreground hover:text-foreground"><RefreshCw className="w-4 h-4" /></button></div>
                        <p className="text-xs text-muted-foreground px-4 pt-2">Last updated {timeAgo(lastUpdated)}</p>
                        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                            {activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((a, i) => <div key={a.id} className={`flex items-start gap-2 ${i === 0 ? "animate-fade-in" : ""}`}><div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${activityDotColor(a.type)}`} /><div><p className="text-xs text-foreground leading-tight">{a.description}</p><p className="text-[11px] text-muted-foreground">{timeAgo(a.createdAt)}</p></div></div>)}
                            {activities.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No activity yet</p>}
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="px-6 py-3 border-t border-border flex items-center justify-end shrink-0">
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-muted-foreground">Member since: {new Date(agent.createdAt).toLocaleDateString()}</span>
                        <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
                    </div>
                </div>
            </div>
        </div>
    </TooltipProvider>);
};

export default AgentModal;
