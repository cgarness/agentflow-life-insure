import { User, UserProfile, OnboardingItem, Lead, Client, Recruit, ContactNote, ContactActivity, Appointment, Campaign, Call, Notification, WinFeedItem } from "./types";

const uid = (prefix = "") => prefix + Math.random().toString(36).slice(2, 10);

const defaultOnboarding = (): OnboardingItem[] => [
  { key: "license", label: "License Verified", completed: false, completedAt: null },
  { key: "carriers", label: "Carrier Appointments Set Up", completed: false, completedAt: null },
  { key: "twilio", label: "Twilio Number Assigned", completed: false, completedAt: null },
  { key: "training", label: "Training Completed", completed: false, completedAt: null },
  { key: "first_call", label: "First Call Made", completed: false, completedAt: null },
];

const completedOnboarding = (): OnboardingItem[] =>
  defaultOnboarding().map(i => ({ ...i, completed: true, completedAt: "2024-06-01T10:00:00Z" }));

export const mockUsers: User[] = [
  { id: "u1", email: "chris@agentflow.com", firstName: "Chris", lastName: "Garcia", role: "Admin", phone: "(555) 000-0001", status: "Active", availabilityStatus: "Available", themePreference: "light", lastLoginAt: new Date().toISOString(), createdAt: "2024-01-01T00:00:00Z" },
  { id: "u2", email: "sarah@agentflow.com", firstName: "Sarah", lastName: "Johnson", role: "Agent", phone: "(555) 000-0002", status: "Active", availabilityStatus: "Available", themePreference: "light", lastLoginAt: new Date().toISOString(), createdAt: "2024-02-15T00:00:00Z" },
  { id: "u3", email: "mike@agentflow.com", firstName: "Mike", lastName: "Thompson", role: "Agent", phone: "(555) 000-0003", status: "Active", availabilityStatus: "On Break", themePreference: "dark", lastLoginAt: new Date().toISOString(), createdAt: "2024-03-01T00:00:00Z" },
  { id: "u4", email: "lisa@agentflow.com", firstName: "Lisa", lastName: "Roberts", role: "Team Leader", phone: "(555) 000-0004", status: "Active", availabilityStatus: "Available", themePreference: "light", lastLoginAt: new Date().toISOString(), createdAt: "2024-01-20T00:00:00Z" },
  { id: "u5", email: "james@agentflow.com", firstName: "James", lastName: "Wilson", role: "Agent", status: "Inactive", availabilityStatus: "Offline", themePreference: "light", lastLoginAt: "2025-01-10T00:00:00Z", createdAt: "2024-04-10T00:00:00Z" },
  { id: "u6", email: "pending@agentflow.com", firstName: "New", lastName: "Agent", role: "Agent", status: "Pending", availabilityStatus: "Offline", themePreference: "light", lastLoginAt: null, createdAt: "2025-02-20T00:00:00Z" },
];

export const mockProfiles: UserProfile[] = [
  { userId: "u1", licensedStates: ["FL", "TX", "CA"], commissionLevel: "80%", onboardingComplete: true, monthlyCallGoal: 150, monthlySalesGoal: 20, weeklyAppointmentGoal: 25, monthlyTalkTimeGoalHours: 40, onboardingItems: completedOnboarding() },
  { userId: "u2", licensedStates: ["TX", "NY"], commissionLevel: "75%", onboardingComplete: true, monthlyCallGoal: 140, monthlySalesGoal: 18, weeklyAppointmentGoal: 20, monthlyTalkTimeGoalHours: 35, onboardingItems: completedOnboarding() },
  { userId: "u3", licensedStates: ["CA", "WA", "OR"], commissionLevel: "70%", onboardingComplete: true, monthlyCallGoal: 130, monthlySalesGoal: 15, weeklyAppointmentGoal: 18, monthlyTalkTimeGoalHours: 30, onboardingItems: completedOnboarding() },
  { userId: "u4", licensedStates: ["NY", "NJ", "CT"], commissionLevel: "65%", onboardingComplete: true, monthlyCallGoal: 120, monthlySalesGoal: 15, weeklyAppointmentGoal: 15, monthlyTalkTimeGoalHours: 28, onboardingItems: completedOnboarding() },
  { userId: "u5", licensedStates: ["OH", "PA"], commissionLevel: "60%", onboardingComplete: false, monthlyCallGoal: 100, monthlySalesGoal: 10, weeklyAppointmentGoal: 10, monthlyTalkTimeGoalHours: 20, onboardingItems: [
    { key: "license", label: "License Verified", completed: true, completedAt: "2024-05-01T10:00:00Z" },
    { key: "carriers", label: "Carrier Appointments Set Up", completed: true, completedAt: "2024-05-05T10:00:00Z" },
    { key: "twilio", label: "Twilio Number Assigned", completed: false, completedAt: null },
    { key: "training", label: "Training Completed", completed: false, completedAt: null },
    { key: "first_call", label: "First Call Made", completed: false, completedAt: null },
  ]},
  { userId: "u6", licensedStates: [], commissionLevel: "50%", onboardingComplete: false, monthlyCallGoal: 80, monthlySalesGoal: 5, weeklyAppointmentGoal: 8, monthlyTalkTimeGoalHours: 15, onboardingItems: defaultOnboarding() },
];

export const mockLeads: Lead[] = [
  { id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567", email: "john.m@email.com", state: "FL", status: "Hot", leadSource: "Facebook Ads", leadScore: 9, age: 42, assignedAgentId: "u1", lastContactedAt: new Date().toISOString(), createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l2", firstName: "Sarah", lastName: "Williams", phone: "(555) 234-5678", email: "sarah.w@email.com", state: "TX", status: "Interested", leadSource: "Google Ads", leadScore: 7, age: 35, assignedAgentId: "u2", lastContactedAt: new Date(Date.now() - 86400000).toISOString(), createdAt: "2025-01-18T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l3", firstName: "Mike", lastName: "Johnson", phone: "(555) 345-6789", email: "mike.j@email.com", state: "CA", status: "New", leadSource: "Direct Mail", leadScore: 5, age: 50, assignedAgentId: "u3", lastContactedAt: new Date().toISOString(), createdAt: "2025-02-01T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l4", firstName: "Lisa", lastName: "Park", phone: "(555) 456-7890", email: "lisa.p@email.com", state: "NY", status: "Follow Up", leadSource: "Referral", leadScore: 8, age: 38, assignedAgentId: "u1", lastContactedAt: new Date(Date.now() - 5 * 86400000).toISOString(), createdAt: "2025-01-10T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l5", firstName: "Tom", lastName: "Harris", phone: "(555) 567-8901", email: "tom.h@email.com", state: "OH", status: "Contacted", leadSource: "Webinar", leadScore: 6, age: 45, assignedAgentId: "u4", lastContactedAt: new Date(Date.now() - 4 * 86400000).toISOString(), createdAt: "2025-01-20T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l6", firstName: "Amy", lastName: "Zhang", phone: "(555) 678-9012", email: "amy.z@email.com", state: "WA", status: "Closed Won", leadSource: "Facebook Ads", leadScore: 10, age: 30, assignedAgentId: "u5", lastContactedAt: new Date().toISOString(), createdAt: "2025-01-05T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l7", firstName: "David", lastName: "Brown", phone: "(555) 789-0123", email: "david.b@email.com", state: "FL", status: "Not Interested", leadSource: "Google Ads", leadScore: 3, age: 55, assignedAgentId: "u2", lastContactedAt: new Date(Date.now() - 7 * 86400000).toISOString(), createdAt: "2025-01-12T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l8", firstName: "Maria", lastName: "Lopez", phone: "(555) 890-1234", email: "maria.l@email.com", state: "AZ", status: "Hot", leadSource: "Referral", leadScore: 9, age: 40, assignedAgentId: "u3", lastContactedAt: new Date().toISOString(), createdAt: "2025-02-05T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l9", firstName: "Robert", lastName: "Taylor", phone: "(555) 901-2345", email: "robert.t@email.com", state: "GA", status: "New", leadSource: "Direct Mail", leadScore: 4, age: 48, assignedAgentId: "u1", lastContactedAt: undefined, createdAt: "2025-02-20T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "l10", firstName: "Jennifer", lastName: "Davis", phone: "(555) 012-3456", email: "jennifer.d@email.com", state: "NC", status: "Interested", leadSource: "Webinar", leadScore: 7, age: 33, assignedAgentId: "u2", lastContactedAt: new Date(Date.now() - 2 * 86400000).toISOString(), createdAt: "2025-02-10T10:00:00Z", updatedAt: new Date().toISOString() },
];

export const mockClients: Client[] = [
  { id: "c1", firstName: "Robert", lastName: "Chen", phone: "(555) 111-2222", email: "robert.c@email.com", policyType: "Term", carrier: "Mutual of Omaha", policyNumber: "MOO-2024-001", faceAmount: "$500,000", premiumAmount: "$42/mo", issueDate: "2024-01-15", assignedAgentId: "u1", createdAt: "2024-01-15T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "c2", firstName: "Jennifer", lastName: "Wu", phone: "(555) 222-3333", email: "jennifer.w@email.com", policyType: "Whole Life", carrier: "Transamerica", policyNumber: "TA-2023-045", faceAmount: "$250,000", premiumAmount: "$125/mo", issueDate: "2023-08-20", assignedAgentId: "u2", createdAt: "2023-08-20T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "c3", firstName: "Mark", lastName: "Stevens", phone: "(555) 333-4444", email: "mark.s@email.com", policyType: "IUL", carrier: "Prudential", policyNumber: "PRU-2024-012", faceAmount: "$750,000", premiumAmount: "$200/mo", issueDate: "2024-03-10", assignedAgentId: "u1", createdAt: "2024-03-10T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "c4", firstName: "Karen", lastName: "White", phone: "(555) 444-5555", email: "karen.w@email.com", policyType: "Term", carrier: "John Hancock", policyNumber: "JH-2023-089", faceAmount: "$400,000", premiumAmount: "$35/mo", issueDate: "2023-11-05", assignedAgentId: "u3", createdAt: "2023-11-05T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "c5", firstName: "James", lastName: "Rodriguez", phone: "(555) 555-6666", email: "james.r@email.com", policyType: "Whole Life", carrier: "Mutual of Omaha", policyNumber: "MOO-2024-034", faceAmount: "$300,000", premiumAmount: "$95/mo", issueDate: "2024-05-22", assignedAgentId: "u4", createdAt: "2024-05-22T10:00:00Z", updatedAt: new Date().toISOString() },
];

export const mockRecruits: Recruit[] = [
  { id: "r1", firstName: "Alex", lastName: "Turner", phone: "(555) 700-0001", email: "alex.t@email.com", status: "Prospect", assignedAgentId: "u1", createdAt: "2025-02-01T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "r2", firstName: "Emma", lastName: "Clark", phone: "(555) 700-0002", email: "emma.c@email.com", status: "Interview", assignedAgentId: "u4", createdAt: "2025-01-20T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "r3", firstName: "Ryan", lastName: "Mitchell", phone: "(555) 700-0003", email: "ryan.m@email.com", status: "Licensed", assignedAgentId: "u1", createdAt: "2025-01-10T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "r4", firstName: "Sophia", lastName: "Lee", phone: "(555) 700-0004", email: "sophia.l@email.com", status: "Contacted", assignedAgentId: "u4", createdAt: "2025-02-10T10:00:00Z", updatedAt: new Date().toISOString() },
];

export const mockNotes: ContactNote[] = [
  { id: "n1", contactId: "l1", contactType: "lead", note: "Very interested in term life. Wants $500K coverage. Wife expecting second child.", pinned: true, agentId: "u1", agentName: "Chris G.", createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "n2", contactId: "l1", contactType: "lead", note: "Called back, discussed premium options. Prefers monthly payments.", pinned: false, agentId: "u1", agentName: "Chris G.", createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: "n3", contactId: "l4", contactType: "lead", note: "Requested info on whole life vs term. Send comparison sheet.", pinned: true, agentId: "u1", agentName: "Chris G.", createdAt: new Date(Date.now() - 86400000).toISOString() },
];

export const mockActivities: ContactActivity[] = [
  { id: "a1", contactId: "l1", contactType: "lead", type: "call", description: "Outbound call - 4:23 duration. Discussed term life options.", agentId: "u1", agentName: "Chris G.", createdAt: new Date(Date.now() - 600000).toISOString() },
  { id: "a2", contactId: "l1", contactType: "lead", type: "note", description: "Added note about coverage preferences.", agentId: "u1", agentName: "Chris G.", createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "a3", contactId: "l1", contactType: "lead", type: "status", description: "Status changed from Interested to Hot.", agentId: "u1", agentName: "Chris G.", createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: "a4", contactId: "l2", contactType: "lead", type: "call", description: "Outbound call - 2:15 duration. Left voicemail.", agentId: "u2", agentName: "Sarah J.", createdAt: new Date(Date.now() - 86400000).toISOString() },
];

export const mockAppointments: Appointment[] = [
  { id: "ap1", contactId: "l1", contactType: "lead", contactName: "John Martinez", contactPhone: "(555) 123-4567", agentId: "u1", date: new Date().toISOString().split("T")[0], time: "10:00", endTime: "10:30", type: "Sales Call", status: "Scheduled", reminderSent: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "ap2", contactId: "l2", contactType: "lead", contactName: "Sarah Williams", contactPhone: "(555) 234-5678", agentId: "u1", date: new Date().toISOString().split("T")[0], time: "13:30", endTime: "14:00", type: "Follow Up", status: "Scheduled", reminderSent: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "ap3", contactId: "c1", contactType: "client", contactName: "Robert Chen", contactPhone: "(555) 111-2222", agentId: "u1", date: new Date().toISOString().split("T")[0], time: "15:00", endTime: "15:30", type: "Policy Review", status: "Scheduled", reminderSent: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "ap4", contactId: "l4", contactType: "lead", contactName: "Lisa Park", contactPhone: "(555) 456-7890", agentId: "u1", date: new Date(Date.now() + 86400000).toISOString().split("T")[0], time: "09:00", type: "Sales Call", status: "Scheduled", reminderSent: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

export const mockCampaigns: Campaign[] = [
  { id: "cmp1", name: "Q1 Facebook Leads", type: "Open Pool", status: "Active", assignedAgentIds: ["u1", "u2", "u3", "u4"], createdBy: "u1", dialMode: "Power", totalLeads: 200, availableLeads: 153, claimedLeads: 47, calledLeads: 89, createdAt: "2025-01-01T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "cmp2", name: "My Direct Mail Leads", type: "Personal", status: "Active", assignedAgentIds: ["u1"], createdBy: "u1", dialMode: "Preview", totalLeads: 50, availableLeads: 38, claimedLeads: 12, calledLeads: 12, createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString() },
  { id: "cmp3", name: "Medicare Supplement Push", type: "Team", status: "Paused", assignedAgentIds: ["u1", "u2"], createdBy: "u1", dialMode: "Power", totalLeads: 150, availableLeads: 95, claimedLeads: 55, calledLeads: 67, createdAt: "2025-01-20T10:00:00Z", updatedAt: new Date().toISOString() },
];

export const mockCalls: Call[] = [
  { id: "call1", contactId: "l1", contactType: "lead", contactName: "John Martinez", agentId: "u1", agentName: "Chris G.", direction: "outbound", duration: 263, disposition: "Interested", createdAt: new Date(Date.now() - 600000).toISOString() },
  { id: "call2", contactId: "l6", contactType: "lead", contactName: "Amy Zhang", agentId: "u2", agentName: "Sarah J.", direction: "outbound", duration: 412, disposition: "Appointment Set", outcome: "Policy Sold", createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: "call3", contactId: "l8", contactType: "lead", contactName: "Maria Lopez", agentId: "u3", agentName: "Mike T.", direction: "outbound", duration: 180, disposition: "Call Back Later", createdAt: new Date(Date.now() - 10800000).toISOString() },
  { id: "call4", contactId: "l5", contactType: "lead", contactName: "Tom Harris", agentId: "u5", agentName: "James W.", direction: "outbound", duration: 45, disposition: "Left Voicemail", createdAt: new Date(Date.now() - 18000000).toISOString() },
];

export const mockNotifications: Notification[] = [
  { id: "notif1", type: "win", text: "🎉 Chris G. sold a Term Life policy to John M.!", time: "2 min ago", read: false },
  { id: "notif2", type: "missed_call", text: "Missed call from Sarah Williams (FL)", time: "15 min ago", read: false, actionLabel: "Call Back" },
  { id: "notif3", type: "lead_claimed", text: "New lead assigned: Mike Johnson from Facebook Ads", time: "1 hr ago", read: false },
  { id: "notif4", type: "system", text: "Campaign 'Q1 Facebook Leads' reached 50% completion", time: "3 hrs ago", read: true },
  { id: "notif5", type: "anniversary", text: "Policy anniversary: Robert Chen's Term Life renews in 7 days", time: "5 hrs ago", read: true },
];

export const mockWins: WinFeedItem[] = [
  { id: "w1", agentName: "Chris G.", agentAvatar: "CG", contactName: "John M.", contactState: "FL", policyType: "Term", time: "2 hrs ago" },
  { id: "w2", agentName: "Sarah J.", agentAvatar: "SJ", contactName: "Amy L.", contactState: "WA", policyType: "Whole Life", time: "4 hrs ago" },
  { id: "w3", agentName: "Mike T.", agentAvatar: "MT", contactName: "Robert C.", contactState: "CA", policyType: "IUL", time: "Yesterday" },
  { id: "w4", agentName: "Lisa R.", agentAvatar: "LR", contactName: "David B.", contactState: "NY", policyType: "Term", time: "Yesterday" },
  { id: "w5", agentName: "James W.", agentAvatar: "JW", contactName: "Maria G.", contactState: "AZ", policyType: "Term", time: "2 days ago" },
];

export function getAgentName(userId: string): string {
  const u = mockUsers.find(u => u.id === userId);
  return u ? `${u.firstName} ${u.lastName[0]}.` : "Unknown";
}

export function getAgentInitials(userId: string): string {
  const u = mockUsers.find(u => u.id === userId);
  return u ? `${u.firstName[0]}${u.lastName[0]}` : "??";
}

export function calcAging(lastContactedAt?: string): number {
  if (!lastContactedAt) return 999;
  return Math.floor((Date.now() - new Date(lastContactedAt).getTime()) / 86400000);
}
