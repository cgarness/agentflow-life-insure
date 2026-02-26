export type UserRole = "Admin" | "Agent" | "Team Leader";
export type AvailabilityStatus = "Available" | "On Break" | "Do Not Disturb" | "Offline";
export type LeadStatus = "New" | "Contacted" | "Interested" | "Follow Up" | "Hot" | "Not Interested" | "Closed Won" | "Closed Lost";
export type PolicyType = "Term" | "Whole Life" | "IUL" | "Final Expense";
export type ContactType = "lead" | "client" | "recruit" | "agent";
export type AppointmentType = "Sales Call" | "Follow Up" | "Recruit Interview" | "Policy Review" | "Policy Anniversary" | "Other";
export type CampaignType = "Open Pool" | "Personal" | "Team";
export type CampaignStatus = "Active" | "Paused" | "Draft" | "Completed";

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatar?: string;
  status: "Active" | "Inactive";
  availabilityStatus: AvailabilityStatus;
  themePreference: "light" | "dark";
  lastLoginAt: string;
  createdAt: string;
}

export interface UserProfile {
  userId: string;
  licensedStates: string[];
  commissionLevel: string;
  uplineId?: string;
  onboardingComplete: boolean;
  monthlyCallGoal: number;
  monthlySalesGoal: number;
  weeklyAppointmentGoal: number;
}

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  state: string;
  status: LeadStatus;
  leadSource: string;
  leadScore: number;
  age?: number;
  dateOfBirth?: string;
  healthStatus?: string;
  bestTimeToCall?: string;
  spouseInfo?: string;
  notes?: string;
  assignedAgentId: string;
  lastContactedAt?: string;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  policyType: PolicyType;
  carrier: string;
  policyNumber?: string;
  faceAmount: string;
  premiumAmount: string;
  issueDate: string;
  effectiveDate?: string;
  beneficiaryName?: string;
  beneficiaryRelationship?: string;
  beneficiaryPhone?: string;
  notes?: string;
  assignedAgentId: string;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Recruit {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  status: string;
  notes?: string;
  assignedAgentId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactNote {
  id: string;
  contactId: string;
  contactType: ContactType;
  note: string;
  pinned: boolean;
  agentId: string;
  agentName: string;
  createdAt: string;
}

export interface ContactActivity {
  id: string;
  contactId: string;
  contactType: ContactType;
  type: string;
  description: string;
  agentId: string;
  agentName: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Appointment {
  id: string;
  contactId: string;
  contactType: ContactType;
  contactName: string;
  contactPhone: string;
  agentId: string;
  date: string;
  time: string;
  endTime?: string;
  type: AppointmentType;
  status: "Scheduled" | "Completed" | "Cancelled" | "No Show";
  notes?: string;
  reminderSent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  description?: string;
  assignedAgentIds: string[];
  createdBy: string;
  scriptId?: string;
  voicemailDropId?: string;
  dialMode: string;
  totalLeads: number;
  availableLeads: number;
  claimedLeads: number;
  calledLeads: number;
  createdAt: string;
  updatedAt: string;
}

export interface Call {
  id: string;
  contactId: string;
  contactType: ContactType;
  contactName: string;
  agentId: string;
  agentName: string;
  campaignId?: string;
  direction: "outbound" | "inbound";
  duration: number;
  recordingUrl?: string;
  disposition?: string;
  notes?: string;
  outcome?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: "win" | "missed_call" | "lead_claimed" | "appointment_reminder" | "anniversary" | "system";
  text: string;
  time: string;
  read: boolean;
  actionLabel?: string;
  actionUrl?: string;
}

export interface DashboardStats {
  totalCallsToday: number;
  callsTrend: string;
  policiesSoldThisMonth: number;
  policiesTrend: string;
  appointmentsThisWeek: number;
  appointmentsTrend: string;
  activeCampaigns: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatar: string;
  calls: number;
  policies: number;
  appointments: number;
  talkTime: string;
  conversionRate: string;
  goalProgress: number;
  rankChange?: number;
}

export interface WinFeedItem {
  id: string;
  agentName: string;
  agentAvatar: string;
  contactName: string;
  contactState: string;
  policyType: PolicyType;
  time: string;
}
