import type { PerformanceSummary } from "@/lib/performanceSummary";
import { usePermissions } from "@/hooks/usePermissions";
import React from "react";
import { Calendar, Phone, ShieldCheck, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { dispatchQuickCall } from "@/lib/quick-call";
import {
  type ContactType,
  contactsTabFor,
  isValidContactType,
  resolveContactId as resolveContactIdShared,
  resolveContactType as resolveContactTypeShared,
} from "@/lib/dashboard-contact-identity";
import { toast } from "sonner";
import { kpiScopeIsFiltered, listScopeIsFiltered, listScopeNote, type DashboardModalOrigin } from "@/lib/dashboard-scope";
import { useDashboardDetailFeed, type DetailFeedType } from "@/hooks/useDashboardDetailFeed";
import DashboardAttentionModal from "@/components/dashboard/DashboardAttentionModal";
import DashboardRecordsModal from "@/components/dashboard/DashboardRecordsModal";
import type { AttentionView } from "@/hooks/useAttentionDetailFeed";
import DashboardMilestonesModal from "@/components/dashboard/DashboardMilestonesModal";
import type { RecordType } from "@/components/dashboard/dashboardRecordText";
import type { DashboardTone } from "@/components/dashboard/ui/dashboardTones";

export type ModalType = "callbacks" | "appointments" | "calls_today" | "policies_sold" | "missed_calls" | "anniversaries" | "premium_sold";

interface DashboardDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: ModalType | null;
  /** Which surface opened it; that surface's scope rule applies (plan rev 1, §2A). Default: KPI card. */
  origin?: DashboardModalOrigin;
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  timeRange?: "day" | "week" | "month" | "year";
  performanceSnapshot?: PerformanceSummary | null;
  /** Callbacks / Missed Calls: open on the Active or the Cleared view. */
  initialView?: AttentionView;
}

/**
 * Row -> contact identity, delegating to the shared exported helpers in
 * `@/lib/dashboard-contact-identity` so the runtime and the tests use ONE
 * implementation.
 *
 * `calls_today` / `missed_calls` rows come from `calls`, where `item.id` is the CALL row
 * id — never a contact. Those queries select `contact_id`; that is the identity.
 */
function rowContactId(item: any): string | null {
  return resolveContactIdShared({
    contactId: item?.contact_id ?? null,
    ownId: item?.id ?? null,
    ownIdIsContact: item?.__idIsContact === true,
  });
}

/** Row -> contact type, or `null` when it cannot be resolved. Deliberately no "default to lead". */
function rowContactType(item: any): ContactType | null {
  return resolveContactTypeShared(
    { explicitType: item?.contact_type, sourceMarker: isValidContactType(item?.__contactType) ? item.__contactType : null },
    item?.__contactType ?? null,
  );
}

const RECORD_META: Record<RecordType, { tone: DashboardTone; icon: React.ElementType }> = {
  calls_today: { tone: "blue", icon: Phone },
  appointments: { tone: "purple", icon: Calendar },
  policies_sold: { tone: "green", icon: ShieldCheck },
  premium_sold: { tone: "gold", icon: TrendingUp },
};

const DashboardDetailModal: React.FC<DashboardDetailModalProps> = ({
  isOpen, onClose, type, origin = "kpi", userId, role, adminToggle, timeRange, performanceSnapshot, initialView = "active",
}) => {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const { getDataScope } = usePermissions();
  const isFiltered = origin === "widget"
    ? listScopeIsFiltered(role, adminToggle)
    : kpiScopeIsFiltered(getDataScope("reports"), adminToggle);

  const feed = useDashboardDetailFeed({
    type: type === "anniversaries" || type === "callbacks" || type === "missed_calls" ? null : (type as DetailFeedType | null),
    isOpen, userId, isFiltered, timeRange, adminToggle, performanceSnapshot,
    organizationId: profile?.organization_id ?? null,
  });

  const rangeSuffix = timeRange ? ` (${timeRange})` : "";
  const TITLES: Record<RecordType, string> = {
    appointments: `Scheduled Appointments${rangeSuffix}`,
    calls_today: `Calls Made${rangeSuffix}`,
    policies_sold: `Policies Sold${rangeSuffix}`,
    premium_sold: `Annual Premium${rangeSuffix}`,
  };

  const handleRowClick = (item: any) => {
    // Appointments are calendar entities, not contacts.
    if (type === "appointments") {
      onClose();
      navigate("/calendar");
      return;
    }
    // Resolve identity AND type first; an unresolved row must not navigate at all.
    const contactId = rowContactId(item);
    const tab = contactsTabFor(rowContactType(item));
    if (!contactId || !tab) {
      toast.error(item?.__blockedReason ?? "This row has no resolvable contact record, so it cannot be opened.");
      return;
    }
    onClose();
    navigate(`/contacts?contact=${contactId}&tab=${tab}`);
  };

  const handleStartCall = (item: any) => {
    if (!user) {
      toast.error("You must be logged in to make calls.");
      return;
    }
    const contactId = rowContactId(item);
    const contactType = rowContactType(item);
    // An unresolved identity or type must not dispatch a call.
    if (!contactId || !contactType) {
      toast.error(item?.__blockedReason ?? "This row has no resolvable contact record, so it cannot be dialed.");
      return;
    }
    // Route through the ONE canonical path; only report what actually happened.
    const started = dispatchQuickCall({
      contactId,
      name: item.contact_name || "Unknown",
      phone: item.phone ?? item.contact_phone ?? "",
      type: contactType,
    });
    if (!started) toast.error(`No phone number on file for ${item.contact_name || "this contact"}.`);
  };

  const items = type === "callbacks" ? "callbacks" : type === "missed_calls" ? "missed calls" : "records";
  const scopeNote = origin === "widget" ? listScopeNote(role, adminToggle, items) : null;

  if (type === "anniversaries") {
    return (
      <DashboardMilestonesModal open={isOpen} onClose={onClose} userId={userId} role={role} adminToggle={adminToggle}
        organizationId={profile?.organization_id ?? null} initialStatus={initialView === "cleared" ? "reviewed" : "pending"} />
    );
  }

  // Callbacks and Missed Calls: one feed over the same contract as their widgets, with Clear.
  if (type === "callbacks" || type === "missed_calls") {
    return (
      <DashboardAttentionModal open={isOpen} onClose={onClose} kind={type} userId={userId} isFiltered={isFiltered}
        scopeNote={scopeNote} initialView={initialView} />
    );
  }

  if (!type) return null;
  const description = feed.performanceSubtitle ?? (timeRange ? `Selected period: ${timeRange}` : "Selected period");

  return (
    <DashboardRecordsModal
      open={isOpen}
      onClose={onClose}
      type={type}
      tone={RECORD_META[type].tone}
      icon={RECORD_META[type].icon}
      title={TITLES[type]}
      description={description}
      scopeNote={scopeNote}
      rows={feed.data}
      loading={feed.loading}
      loadError={feed.loadError}
      pageError={feed.pageError}
      loadingMore={feed.isFetchingNextPage}
      hasMore={feed.hasMore}
      onScroll={feed.handleScroll}
      onRetry={feed.retry}
      onLoadMore={feed.loadMore}
      onView={handleRowClick}
      onCall={handleStartCall}
      canOpen={(item) => !!rowContactId(item) && !!contactsTabFor(rowContactType(item))}
      people={isFiltered ? null : feed.people}
    />
  );
};

export default DashboardDetailModal;
