import { mockLeads, mockClients, mockRecruits, mockUsers, mockProfiles, mockNotes, mockActivities, mockAppointments, mockCampaigns, mockCalls, mockNotifications, mockWins, mockDispositions, getAgentName, calcAging } from "./mock-data";
import { Lead, Client, Recruit, ContactNote, DashboardStats, LeaderboardEntry, User, UserProfile, OnboardingItem, UserRole, UserStatus, Disposition, PipelineStage, CustomField, LeadSource, HealthStatus } from "./types";

// Simulate network delay
const delay = (ms = 300) => new Promise(r => setTimeout(r, ms));

// ---- In-memory stores (mutable copies) ----
let leads = [...mockLeads];
let clients = [...mockClients];
let recruits = [...mockRecruits];
let notes = [...mockNotes];
let activities = [...mockActivities];
let notifications = [...mockNotifications];
let users = [...mockUsers];
let profiles = [...mockProfiles];
let dispositions = [...mockDispositions];

const uid = () => Math.random().toString(36).slice(2, 10);

// ---- AUTH ----
export const authApi = {
  async login(email: string, password: string) {
    await delay(500);
    const user = users.find(u => u.email === email);
    if (!user || password.length < 4) throw new Error("Invalid email or password");
    return { user, profile: profiles.find(p => p.userId === user.id)! };
  },
  async forgotPassword(email: string) {
    await delay(500);
    const exists = users.some(u => u.email === email);
    if (!exists) throw new Error("No account found with that email");
    return { message: "Reset link sent to your email" };
  },
  async resetPassword(_token: string, _newPassword: string) {
    await delay(500);
    return { message: "Password reset successful" };
  },
  async updateProfile(userId: string, data: Partial<{ firstName: string; lastName: string; email: string }>) {
    await delay(300);
    const user = users.find(u => u.id === userId);
    if (user) Object.assign(user, data);
    return user;
  },
};

// ---- USERS (Admin) ----
export const usersApi = {
  async getAll(filters?: { search?: string; role?: string; status?: string }): Promise<(User & { profile: UserProfile })[]> {
    await delay(200);
    let result = [...users];
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(u =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    }
    if (filters?.role && filters.role !== "All") result = result.filter(u => u.role === filters.role);
    if (filters?.status && filters.status !== "All") result = result.filter(u => u.status === filters.status);
    return result.map(u => ({ ...u, profile: profiles.find(p => p.userId === u.id)! }));
  },
  async getById(id: string): Promise<User & { profile: UserProfile }> {
    await delay(100);
    const user = users.find(u => u.id === id);
    if (!user) throw new Error("User not found");
    return { ...user, profile: profiles.find(p => p.userId === id)! };
  },
  async update(id: string, data: Partial<User>): Promise<User> {
    await delay(300);
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error("User not found");
    users[idx] = { ...users[idx], ...data };
    return users[idx];
  },
  async updateProfile(userId: string, data: Partial<UserProfile>): Promise<UserProfile> {
    await delay(300);
    const idx = profiles.findIndex(p => p.userId === userId);
    if (idx === -1) throw new Error("Profile not found");
    profiles[idx] = { ...profiles[idx], ...data };
    return profiles[idx];
  },
  async invite(data: { firstName: string; lastName: string; email: string; role: UserRole; licensedStates: string[]; commissionLevel: string }): Promise<User> {
    await delay(500);
    const exists = users.find(u => u.email === data.email);
    if (exists) throw new Error("A user with this email already exists");
    const newUser: User = {
      id: `u${uid()}`,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      status: "Pending",
      availabilityStatus: "Offline",
      themePreference: "light",
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    profiles.push({
      userId: newUser.id,
      licensedStates: data.licensedStates,
      commissionLevel: data.commissionLevel,
      onboardingComplete: false,
      monthlyCallGoal: 80,
      monthlySalesGoal: 5,
      weeklyAppointmentGoal: 8,
      monthlyTalkTimeGoalHours: 15,
      onboardingItems: [
        { key: "license", label: "License Verified", completed: false, completedAt: null },
        { key: "carriers", label: "Carrier Appointments Set Up", completed: false, completedAt: null },
        { key: "twilio", label: "Telnyx Number Assigned", completed: false, completedAt: null },
        { key: "training", label: "Training Completed", completed: false, completedAt: null },
        { key: "first_call", label: "First Call Made", completed: false, completedAt: null },
      ],
    });
    return newUser;
  },
  async deactivate(id: string): Promise<User> {
    await delay(300);
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error("User not found");
    users[idx].status = "Inactive";
    users[idx].availabilityStatus = "Offline";
    return users[idx];
  },
  async reactivate(id: string): Promise<User> {
    await delay(300);
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error("User not found");
    users[idx].status = "Active";
    return users[idx];
  },
  async resendInvite(id: string): Promise<void> {
    await delay(500);
    const user = users.find(u => u.id === id);
    if (!user) throw new Error("User not found");
  },
  async resetPassword(id: string): Promise<{ email: string }> {
    await delay(500);
    const user = users.find(u => u.id === id);
    if (!user) throw new Error("User not found");
    return { email: user.email };
  },
  async generateInviteLink(data: { firstName: string; lastName: string; email: string; role: UserRole }): Promise<string> {
    await delay(300);
    const token = Math.random().toString(36).slice(2, 14);
    return `${window.location.origin}/invite/${token}`;
  },
  async getPerformance(userId: string) {
    await delay(200);
    const userCalls = mockCalls.filter(c => c.agentId === userId);
    const policiesSold = userCalls.filter(c => c.outcome === "Policy Sold").length;
    return {
      callsMade: userCalls.length + Math.floor(Math.random() * 30),
      policiesSold: policiesSold + Math.floor(Math.random() * 5),
      appointmentsSet: Math.floor(Math.random() * 10) + 2,
      totalTalkTime: `${(Math.random() * 5 + 1).toFixed(1)} hrs`,
      conversionRate: `${(Math.random() * 15 + 3).toFixed(1)}%`,
      recentCalls: userCalls.slice(0, 5),
    };
  },
};

// ---- DASHBOARD ----
export const dashboardApi = {
  async getStats(): Promise<DashboardStats> {
    await delay(200);
    return {
      totalCallsToday: 47,
      callsTrend: "+12% vs yesterday",
      policiesSoldThisMonth: 23,
      policiesTrend: "+8% vs last month",
      appointmentsThisWeek: 8,
      appointmentsTrend: "Same as last week",
      activeCampaigns: mockCampaigns.filter(c => c.status === "Active").length,
    };
  },
  async getLeaderboard(period = "today"): Promise<LeaderboardEntry[]> {
    await delay(200);
    return [
      { rank: 1, userId: "u1", name: "Chris G.", avatar: "CG", calls: 47, policies: 5, appointments: 8, talkTime: "3.2hrs", conversionRate: "10.6%", goalProgress: 95 },
      { rank: 2, userId: "u2", name: "Sarah J.", avatar: "SJ", calls: 42, policies: 4, appointments: 6, talkTime: "2.8hrs", conversionRate: "9.5%", goalProgress: 88 },
      { rank: 3, userId: "u3", name: "Mike T.", avatar: "MT", calls: 38, policies: 3, appointments: 5, talkTime: "2.5hrs", conversionRate: "7.9%", goalProgress: 75 },
      { rank: 4, userId: "u4", name: "Lisa R.", avatar: "LR", calls: 35, policies: 3, appointments: 4, talkTime: "2.1hrs", conversionRate: "8.6%", goalProgress: 70 },
      { rank: 5, userId: "u5", name: "James W.", avatar: "JW", calls: 29, policies: 2, appointments: 3, talkTime: "1.6hrs", conversionRate: "6.9%", goalProgress: 58 },
    ];
  },
  async getFollowUps() {
    await delay(200);
    return leads
      .filter(l => ["Follow Up", "Hot", "Interested", "Contacted"].includes(l.status))
      .map(l => ({ ...l, aging: calcAging(l.lastContactedAt) }))
      .sort((a, b) => b.aging - a.aging)
      .slice(0, 10);
  },
  async getMissedCalls() {
    await delay(200);
    return [
      { id: "mc1", name: "Unknown (555) 987-6543", phone: "(555) 987-6543", time: "9:15 AM" },
      { id: "mc2", name: "Sarah Williams", phone: "(555) 234-5678", time: "8:42 AM" },
    ];
  },
  async getAnniversaries() {
    await delay(200);
    return clients.map(c => {
      const issue = new Date(c.issueDate);
      const now = new Date();
      const anniv = new Date(now.getFullYear(), issue.getMonth(), issue.getDate());
      if (anniv < now) anniv.setFullYear(anniv.getFullYear() + 1);
      const days = Math.ceil((anniv.getTime() - now.getTime()) / 86400000);
      return { ...c, daysUntilAnniversary: days };
    }).filter(c => c.daysUntilAnniversary <= 30).sort((a, b) => a.daysUntilAnniversary - b.daysUntilAnniversary);
  },
  async getWins() {
    await delay(200);
    return mockWins;
  },
  async getRecentActivity() {
    await delay(200);
    return [
      { id: "ra1", type: "call", desc: "Called John Martinez", agent: "Chris G.", time: "10 min ago" },
      { id: "ra2", type: "policy", desc: "Sold Term Life to Amy L.", agent: "Sarah J.", time: "2 hrs ago" },
      { id: "ra3", type: "lead", desc: "New lead assigned: Tom Harris", agent: "Mike T.", time: "3 hrs ago" },
      { id: "ra4", type: "appt", desc: "Appointment set with Lisa Park", agent: "Chris G.", time: "4 hrs ago" },
      { id: "ra5", type: "call", desc: "Left voicemail for David Brown", agent: "James W.", time: "5 hrs ago" },
      { id: "ra6", type: "sms", desc: "SMS sent to Maria Lopez", agent: "Lisa R.", time: "6 hrs ago" },
      { id: "ra7", type: "call", desc: "Called Robert Taylor", agent: "Chris G.", time: "7 hrs ago" },
      { id: "ra8", type: "lead", desc: "Lead Jennifer Davis marked Interested", agent: "Sarah J.", time: "8 hrs ago" },
    ];
  },
};

// ---- LEADS ----
export const leadsApi = {
  async getAll(filters?: { status?: string; source?: string; search?: string }): Promise<Lead[]> {
    await delay(200);
    let result = [...leads];
    if (filters?.status) result = result.filter(l => l.status === filters.status);
    if (filters?.source) result = result.filter(l => l.leadSource === filters.source);
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(l =>
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.email.toLowerCase().includes(q)
      );
    }
    return result;
  },
  async getById(id: string) {
    await delay(100);
    const lead = leads.find(l => l.id === id);
    if (!lead) throw new Error("Lead not found");
    const leadNotes = notes.filter(n => n.contactId === id);
    const leadActivities = activities.filter(a => a.contactId === id);
    const leadCalls = mockCalls.filter(c => c.contactId === id);
    return { lead, notes: leadNotes, activities: leadActivities, calls: leadCalls };
  },
  async create(data: Omit<Lead, "id" | "createdAt" | "updatedAt">): Promise<Lead> {
    await delay(300);
    // Duplicate check
    const dupe = leads.find(l => l.phone === data.phone || l.email === data.email);
    if (dupe) throw new Error(`Duplicate detected: ${dupe.firstName} ${dupe.lastName} (${dupe.phone})`);
    const newLead: Lead = { ...data, id: `l${uid()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    leads.unshift(newLead);
    return newLead;
  },
  async update(id: string, data: Partial<Lead>): Promise<Lead> {
    await delay(200);
    const idx = leads.findIndex(l => l.id === id);
    if (idx === -1) throw new Error("Lead not found");
    leads[idx] = { ...leads[idx], ...data, updatedAt: new Date().toISOString() };
    return leads[idx];
  },
  async delete(id: string): Promise<void> {
    await delay(200);
    leads = leads.filter(l => l.id !== id);
  },
  async import(data: Partial<Lead>[]): Promise<{ imported: number; duplicates: number; errors: number }> {
    await delay(500);
    let imported = 0, duplicates = 0, errors = 0;
    for (const row of data) {
      const dupe = leads.find(l => l.phone === row.phone || l.email === row.email);
      if (dupe) { duplicates++; continue; }
      try {
        leads.push({ ...row as Lead, id: `l${uid()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        imported++;
      } catch { errors++; }
    }
    return { imported, duplicates, errors };
  },
  bulkAdd(newLeads: Lead[]) {
    leads.unshift(...newLeads);
  },
  async getSourceStats() {
    await delay(200);
    const sources = ["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar"];
    return sources.map(source => {
      const srcLeads = leads.filter(l => l.leadSource === source);
      const contacted = srcLeads.filter(l => l.status !== "New").length;
      const won = srcLeads.filter(l => l.status === "Closed Won").length;
      return {
        source,
        leads: srcLeads.length,
        contacted: srcLeads.length ? `${Math.round(contacted / srcLeads.length * 100)}%` : "0%",
        conversion: srcLeads.length ? `${Math.round(won / srcLeads.length * 100)}%` : "0%",
        sold: won,
      };
    });
  },
};

// ---- CLIENTS ----
export const clientsApi = {
  async getAll(search?: string): Promise<Client[]> {
    await delay(200);
    if (!search) return [...clients];
    const q = search.toLowerCase();
    return clients.filter(c => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || c.phone.includes(q));
  },
  async create(data: Omit<Client, "id" | "createdAt" | "updatedAt">): Promise<Client> {
    await delay(300);
    const newClient: Client = { ...data, id: `c${uid()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    clients.unshift(newClient);
    return newClient;
  },
  async update(id: string, data: Partial<Client>): Promise<Client> {
    await delay(200);
    const idx = clients.findIndex(c => c.id === id);
    if (idx === -1) throw new Error("Client not found");
    clients[idx] = { ...clients[idx], ...data, updatedAt: new Date().toISOString() };
    return clients[idx];
  },
  async delete(id: string): Promise<void> {
    await delay(200);
    clients = clients.filter(c => c.id !== id);
  },
};

// ---- RECRUITS ----
export const recruitsApi = {
  async getAll(search?: string): Promise<Recruit[]> {
    await delay(200);
    if (!search) return [...recruits];
    const q = search.toLowerCase();
    return recruits.filter(r =>
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) ||
      r.phone.includes(q) ||
      r.email.toLowerCase().includes(q)
    );
  },
  async create(data: Omit<Recruit, "id" | "createdAt" | "updatedAt">): Promise<Recruit> {
    await delay(300);
    const r: Recruit = { ...data, id: `r${uid()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    recruits.unshift(r);
    return r;
  },
  async update(id: string, data: Partial<Recruit>): Promise<Recruit> {
    await delay(200);
    const idx = recruits.findIndex(r => r.id === id);
    if (idx === -1) throw new Error("Recruit not found");
    recruits[idx] = { ...recruits[idx], ...data, updatedAt: new Date().toISOString() };
    return recruits[idx];
  },
  async delete(id: string): Promise<void> {
    await delay(200);
    recruits = recruits.filter(r => r.id !== id);
  },
};

// ---- NOTES ----
export const notesApi = {
  async add(contactId: string, contactType: string, note: string, agentId: string): Promise<ContactNote> {
    await delay(200);
    const n: ContactNote = {
      id: `n${uid()}`, contactId, contactType: contactType as any, note,
      pinned: false, agentId, agentName: getAgentName(agentId),
      createdAt: new Date().toISOString(),
    };
    notes.unshift(n);
    return n;
  },
  async togglePin(id: string): Promise<ContactNote> {
    await delay(100);
    const n = notes.find(n => n.id === id);
    if (!n) throw new Error("Note not found");
    n.pinned = !n.pinned;
    return n;
  },
};

// ---- NOTIFICATIONS ----
export const notificationsApi = {
  async getAll() {
    await delay(100);
    return [...notifications];
  },
  async markAllRead() {
    await delay(100);
    notifications.forEach(n => n.read = true);
  },
  async markRead(id: string) {
    await delay(50);
    const n = notifications.find(n => n.id === id);
    if (n) n.read = true;
  },
  getUnreadCount() {
    return notifications.filter(n => !n.read).length;
  },
};

// ---- DISPOSITIONS ----
export const dispositionsApi = {
  async getAll(): Promise<Disposition[]> {
    await delay(200);
    return [...dispositions].sort((a, b) => a.order - b.order);
  },
  async create(data: Omit<Disposition, "id" | "createdAt" | "updatedAt" | "usageCount">): Promise<Disposition> {
    await delay(300);
    const exists = dispositions.find(d => d.name.toLowerCase() === data.name.toLowerCase());
    if (exists) throw new Error("A disposition with this name already exists");
    const d: Disposition = {
      ...data,
      id: `disp${uid()}`,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dispositions.push(d);
    return d;
  },
  async update(id: string, data: Partial<Disposition>): Promise<Disposition> {
    await delay(300);
    const idx = dispositions.findIndex(d => d.id === id);
    if (idx === -1) throw new Error("Disposition not found");
    const dupe = dispositions.find(d => d.id !== id && d.name.toLowerCase() === (data.name || "").toLowerCase());
    if (dupe) throw new Error("A disposition with this name already exists");
    dispositions[idx] = { ...dispositions[idx], ...data, updatedAt: new Date().toISOString() };
    return dispositions[idx];
  },
  async delete(id: string): Promise<void> {
    await delay(300);
    const d = dispositions.find(d => d.id === id);
    if (!d) throw new Error("Disposition not found");
    if (d.isDefault) throw new Error("Default dispositions cannot be deleted");
    dispositions = dispositions.filter(d => d.id !== id);
  },
  async reorder(orderedIds: string[]): Promise<Disposition[]> {
    await delay(200);
    orderedIds.forEach((id, i) => {
      const d = dispositions.find(d => d.id === id);
      if (d) d.order = i + 1;
    });
    return [...dispositions].sort((a, b) => a.order - b.order);
  },
  async getAnalytics(period: string): Promise<{
    totalDispositioned: number;
    mostUsed: string;
    positiveRate: string;
    callbackRate: string;
    breakdown: { id: string; name: string; color: string; count: number; percent: number; trend: number }[];
  }> {
    await delay(300);
    const sorted = [...dispositions].sort((a, b) => b.usageCount - a.usageCount);
    const total = sorted.reduce((s, d) => s + d.usageCount, 0);
    const positive = dispositions.filter(d => d.name.includes("Sold") || d.name.includes("Interested")).reduce((s, d) => s + d.usageCount, 0);
    const callbacks = dispositions.filter(d => d.callbackScheduler).reduce((s, d) => s + d.usageCount, 0);
    return {
      totalDispositioned: total,
      mostUsed: sorted[0]?.name || "N/A",
      positiveRate: total ? `${Math.round((positive / total) * 100)}%` : "0%",
      callbackRate: total ? `${Math.round((callbacks / total) * 100)}%` : "0%",
      breakdown: sorted.map(d => ({
        id: d.id,
        name: d.name,
        color: d.color,
        count: d.usageCount,
        percent: total ? Math.round((d.usageCount / total) * 100) : 0,
        trend: Math.floor(Math.random() * 20) - 10,
      })),
    };
  },
};

// ---- PIPELINE STAGES ----
let leadStages: PipelineStage[] = [
  { id: "ls1", name: "New", color: "#3B82F6", isPositive: false, isDefault: true, order: 1, pipelineType: "lead" },
  { id: "ls2", name: "Contacted", color: "#A855F7", isPositive: false, isDefault: true, order: 2, pipelineType: "lead" },
  { id: "ls3", name: "Interested", color: "#EAB308", isPositive: false, isDefault: true, order: 3, pipelineType: "lead" },
  { id: "ls4", name: "Hot", color: "#F97316", isPositive: false, isDefault: true, order: 4, pipelineType: "lead" },
  { id: "ls5", name: "Follow Up", color: "#14B8A6", isPositive: false, isDefault: true, order: 5, pipelineType: "lead" },
  { id: "ls6", name: "Closed Won", color: "#22C55E", isPositive: true, isDefault: true, order: 6, pipelineType: "lead" },
  { id: "ls7", name: "Closed Lost", color: "#EF4444", isPositive: false, isDefault: true, order: 7, pipelineType: "lead" },
];

let recruitStages: PipelineStage[] = [
  { id: "rs1", name: "Interested in Joining", color: "#3B82F6", isPositive: false, isDefault: true, order: 1, pipelineType: "recruit" },
  { id: "rs2", name: "Contacted", color: "#A855F7", isPositive: false, isDefault: true, order: 2, pipelineType: "recruit" },
  { id: "rs3", name: "In Interview Process", color: "#EAB308", isPositive: false, isDefault: true, order: 3, pipelineType: "recruit" },
  { id: "rs4", name: "Pending Licensing", color: "#F97316", isPositive: false, isDefault: true, order: 4, pipelineType: "recruit" },
  { id: "rs5", name: "Licensed & Onboarding", color: "#22C55E", isPositive: true, isDefault: true, order: 5, pipelineType: "recruit" },
  { id: "rs6", name: "Not Interested", color: "#EF4444", isPositive: false, isDefault: true, order: 6, pipelineType: "recruit" },
];

export const pipelineApi = {
  async getLeadStages(): Promise<PipelineStage[]> {
    await delay(200);
    return [...leadStages].sort((a, b) => a.order - b.order);
  },
  async getRecruitStages(): Promise<PipelineStage[]> {
    await delay(200);
    return [...recruitStages].sort((a, b) => a.order - b.order);
  },
  async createStage(data: Omit<PipelineStage, "id">): Promise<PipelineStage> {
    await delay(300);
    const list = data.pipelineType === "lead" ? leadStages : recruitStages;
    if (list.find(s => s.name.toLowerCase() === data.name.toLowerCase())) throw new Error("A stage with this name already exists");
    const s: PipelineStage = { ...data, id: `${data.pipelineType === "lead" ? "ls" : "rs"}${uid()}` };
    list.push(s);
    return s;
  },
  async updateStage(id: string, pipelineType: "lead" | "recruit", data: Partial<PipelineStage>): Promise<PipelineStage> {
    await delay(300);
    const list = pipelineType === "lead" ? leadStages : recruitStages;
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) throw new Error("Stage not found");
    const dupe = list.find(s => s.id !== id && s.name.toLowerCase() === (data.name || "").toLowerCase());
    if (dupe) throw new Error("A stage with this name already exists");
    list[idx] = { ...list[idx], ...data };
    return list[idx];
  },
  async deleteStage(id: string, pipelineType: "lead" | "recruit"): Promise<void> {
    await delay(300);
    if (pipelineType === "lead") {
      const s = leadStages.find(s => s.id === id);
      if (s?.isDefault) throw new Error("Default stages cannot be deleted");
      leadStages = leadStages.filter(s => s.id !== id);
    } else {
      const s = recruitStages.find(s => s.id === id);
      if (s?.isDefault) throw new Error("Default stages cannot be deleted");
      recruitStages = recruitStages.filter(s => s.id !== id);
    }
  },
  async reorderStages(ids: string[], pipelineType: "lead" | "recruit"): Promise<void> {
    await delay(200);
    const list = pipelineType === "lead" ? leadStages : recruitStages;
    ids.forEach((id, i) => { const s = list.find(s => s.id === id); if (s) s.order = i + 1; });
  },
};

// ---- CUSTOM FIELDS ----
let customFields: CustomField[] = [];

export const customFieldsApi = {
  async getAll(): Promise<CustomField[]> {
    await delay(200);
    return [...customFields];
  },
  async create(data: Omit<CustomField, "id" | "usageCount">): Promise<CustomField> {
    await delay(300);
    if (customFields.find(f => f.name.toLowerCase() === data.name.toLowerCase())) throw new Error("A field with this name already exists");
    const f: CustomField = { ...data, id: `cf${uid()}`, usageCount: 0 };
    customFields.unshift(f);
    return f;
  },
  async update(id: string, data: Partial<CustomField>): Promise<CustomField> {
    await delay(300);
    const idx = customFields.findIndex(f => f.id === id);
    if (idx === -1) throw new Error("Field not found");
    customFields[idx] = { ...customFields[idx], ...data };
    return customFields[idx];
  },
  async delete(id: string): Promise<void> {
    await delay(300);
    customFields = customFields.filter(f => f.id !== id);
  },
};

// ---- LEAD SOURCES ----
let leadSources: LeadSource[] = [
  { id: "src1", name: "Facebook Ad", color: "#3B82F6", active: true, usageCount: 47, order: 1 },
  { id: "src2", name: "Google Ad", color: "#22C55E", active: true, usageCount: 31, order: 2 },
  { id: "src3", name: "Direct Mail", color: "#F97316", active: true, usageCount: 89, order: 3 },
  { id: "src4", name: "Referral", color: "#EAB308", active: true, usageCount: 23, order: 4 },
  { id: "src5", name: "Aged Lead", color: "#6B7280", active: true, usageCount: 156, order: 5 },
  { id: "src6", name: "Cold Call", color: "#A855F7", active: true, usageCount: 12, order: 6 },
  { id: "src7", name: "Website", color: "#14B8A6", active: true, usageCount: 8, order: 7 },
  { id: "src8", name: "Live Transfer", color: "#EF4444", active: true, usageCount: 34, order: 8 },
  { id: "src9", name: "TV Ad", color: "#EC4899", active: true, usageCount: 5, order: 9 },
  { id: "src10", name: "Radio Ad", color: "#F97316", active: true, usageCount: 3, order: 10 },
  { id: "src11", name: "Door Knock", color: "#22C55E", active: true, usageCount: 7, order: 11 },
  { id: "src12", name: "Networking Event", color: "#3B82F6", active: true, usageCount: 2, order: 12 },
];

export const leadSourcesApi = {
  async getAll(): Promise<LeadSource[]> {
    await delay(200);
    return [...leadSources].sort((a, b) => a.order - b.order);
  },
  async create(data: Omit<LeadSource, "id" | "usageCount">): Promise<LeadSource> {
    await delay(300);
    if (leadSources.find(s => s.name.toLowerCase() === data.name.toLowerCase())) throw new Error("A source with this name already exists");
    const s: LeadSource = { ...data, id: `src${uid()}`, usageCount: 0 };
    leadSources.push(s);
    return s;
  },
  async update(id: string, data: Partial<LeadSource>): Promise<LeadSource> {
    await delay(300);
    const idx = leadSources.findIndex(s => s.id === id);
    if (idx === -1) throw new Error("Source not found");
    leadSources[idx] = { ...leadSources[idx], ...data };
    return leadSources[idx];
  },
  async delete(id: string): Promise<void> {
    await delay(300);
    leadSources = leadSources.filter(s => s.id !== id);
  },
  async reassignAndDelete(id: string, newSourceId: string): Promise<{ reassigned: number }> {
    await delay(500);
    const source = leadSources.find(s => s.id === id);
    const newSource = leadSources.find(s => s.id === newSourceId);
    if (!source || !newSource) throw new Error("Source not found");
    const count = source.usageCount;
    newSource.usageCount += count;
    leadSources = leadSources.filter(s => s.id !== id);
    return { reassigned: count };
  },
  async reorder(ids: string[]): Promise<void> {
    await delay(200);
    ids.forEach((id, i) => { const s = leadSources.find(s => s.id === id); if (s) s.order = i + 1; });
  },
};

// ---- HEALTH STATUSES ----
let healthStatuses: HealthStatus[] = [
  { id: "hs1", name: "Preferred Plus", color: "#22C55E", description: "Excellent health, no major conditions", isDefault: true, order: 1 },
  { id: "hs2", name: "Preferred", color: "#3B82F6", description: "Very good health, minor conditions only", isDefault: true, order: 2 },
  { id: "hs3", name: "Standard Plus", color: "#EAB308", description: "Good health, some controlled conditions", isDefault: true, order: 3 },
  { id: "hs4", name: "Standard", color: "#F97316", description: "Average health, manageable conditions", isDefault: true, order: 4 },
  { id: "hs5", name: "Substandard", color: "#EF4444", description: "Below average health, significant conditions", isDefault: true, order: 5 },
  { id: "hs6", name: "Tobacco User", color: "#6B7280", description: "Current or recent tobacco use", isDefault: true, order: 6 },
];

export const healthStatusesApi = {
  async getAll(): Promise<HealthStatus[]> {
    await delay(200);
    return [...healthStatuses].sort((a, b) => a.order - b.order);
  },
  async create(data: Omit<HealthStatus, "id">): Promise<HealthStatus> {
    await delay(300);
    if (healthStatuses.find(h => h.name.toLowerCase() === data.name.toLowerCase())) throw new Error("A status with this name already exists");
    const h: HealthStatus = { ...data, id: `hs${uid()}` };
    healthStatuses.push(h);
    return h;
  },
  async update(id: string, data: Partial<HealthStatus>): Promise<HealthStatus> {
    await delay(300);
    const idx = healthStatuses.findIndex(h => h.id === id);
    if (idx === -1) throw new Error("Status not found");
    healthStatuses[idx] = { ...healthStatuses[idx], ...data };
    return healthStatuses[idx];
  },
  async delete(id: string): Promise<void> {
    await delay(300);
    const h = healthStatuses.find(h => h.id === id);
    if (h?.isDefault) throw new Error("Default statuses cannot be deleted");
    healthStatuses = healthStatuses.filter(h => h.id !== id);
  },
  async reorder(ids: string[]): Promise<void> {
    await delay(200);
    ids.forEach((id, i) => { const h = healthStatuses.find(h => h.id === id); if (h) h.order = i + 1; });
  },
};
