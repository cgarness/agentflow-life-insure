import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";

type NotificationInsert = TablesInsert<"notifications">;

/**
 * Create a notification for a specific user.
 * This inserts directly into the Supabase `notifications` table.
 * The NotificationContext Realtime subscription will pick it up automatically.
 */
export async function createNotification(
    data: Omit<NotificationInsert, "id" | "created_at" | "read">,
    organizationId: string | null = null
) {
    const { error } = await supabase.from("notifications").insert({
        ...data,
        read: false,
        organization_id: organizationId,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    if (error) {
        console.error("Failed to create notification:", error);
        throw error;
    }
}

/**
 * Helper to build common notification payloads.
 */
export const notificationBuilders = {
    win(userId: string, agentName: string, contactName: string, policyType: string) {
        return createNotification({
            user_id: userId,
            type: "win",
            title: "Policy Sold! 🎉",
            body: `${agentName} sold a ${policyType} policy to ${contactName}!`,
            action_label: "View Contact",
        });
    },

    missedCall(userId: string, callerName: string, callerPhone: string, contactId?: string) {
        return createNotification({
            user_id: userId,
            type: "missed_call",
            title: "Missed Call",
            body: `Missed call from ${callerName} (${callerPhone})`,
            action_url: contactId ? `/contacts?id=${contactId}` : undefined,
            action_label: contactId ? "View Contact" : undefined,
            metadata: { contact_id: contactId, phone: callerPhone },
        });
    },

    leadAssigned(userId: string, leadName: string, leadSource: string, leadId: string) {
        return createNotification({
            user_id: userId,
            type: "lead_claimed",
            title: "New Lead Assigned",
            body: `New lead assigned: ${leadName} from ${leadSource}`,
            action_url: `/contacts?id=${leadId}`,
            action_label: "View Contact",
            metadata: { lead_id: leadId },
        });
    },

    appointmentReminder(userId: string, contactName: string, time: string, appointmentId: string) {
        return createNotification({
            user_id: userId,
            type: "appointment_reminder",
            title: "Appointment Reminder",
            body: `Upcoming appointment with ${contactName} at ${time}`,
            action_url: `/calendar`,
            action_label: "View Calendar",
            metadata: { appointment_id: appointmentId },
        });
    },

    anniversary(userId: string, contactName: string, policyType: string, daysUntil: number, clientId: string) {
        return createNotification({
            user_id: userId,
            type: "anniversary",
            title: "Policy Anniversary",
            body: `${contactName}'s ${policyType} policy renews in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`,
            action_url: `/contacts?id=${clientId}`,
            action_label: "View Contact",
            metadata: { client_id: clientId },
        });
    },

    inboundSms(userId: string, contactName: string, messagePreview: string, contactId: string, orgId: string) {
        const trimmed = (messagePreview || "").trim();
        const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
        return createNotification(
            {
                user_id: userId,
                type: "inbound_sms",
                title: "New Text Message",
                body: `${contactName}: ${preview}`,
                action_url: `/contacts?id=${contactId}`,
                action_label: "View Contact",
                metadata: { contact_id: contactId },
            },
            orgId,
        );
    },

    inboundEmail(userId: string, contactName: string, subject: string, contactId: string, orgId: string) {
        const trimmedSubject = (subject || "").trim();
        const suffix = trimmedSubject.length > 80 ? `${trimmedSubject.slice(0, 80)}…` : trimmedSubject || "(no subject)";
        return createNotification(
            {
                user_id: userId,
                type: "inbound_email",
                title: "New Email",
                body: `${contactName}: ${suffix}`,
                action_url: `/contacts?id=${contactId}`,
                action_label: "View Contact",
                metadata: { contact_id: contactId },
            },
            orgId,
        );
    },

    system(userId: string, title: string, body: string, actionUrl?: string) {
        return createNotification({
            user_id: userId,
            type: "system",
            title,
            body,
            action_url: actionUrl,
            action_label: actionUrl ? "View Details" : undefined,
        });
    },
};
