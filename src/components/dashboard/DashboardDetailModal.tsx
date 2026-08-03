import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Phone,
  Calendar,
  ShieldCheck,
  TrendingUp,
  PhoneMissed,
  Gift,
  ExternalLink,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { dispatchQuickCall } from "@/lib/quick-call";
import {
  type ContactType,
  contactsTabFor,
  isValidContactType,
  resolveContactId as resolveContactIdShared,
  resolveContactType as resolveContactTypeShared,
  resolveContactTypesByIds,
} from "@/lib/dashboard-contact-identity";
import { fetchCallbackPage, type NormalizedCallbackRow } from "@/lib/dashboard-callbacks";
import { periodBoundsIso } from "@/lib/dashboard-period-bounds";
import { toast } from "sonner";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/webrtcInboundCaller";
import { formatBirthdayShort } from "@/utils/dobUtils";

export type ModalType =
  | "callbacks"
  | "appointments"
  | "calls_today"
  | "policies_sold"
  | "missed_calls"
  | "anniversaries"
  | "premium_sold";

interface DashboardDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: ModalType | null;
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  timeRange?: "day" | "week" | "month" | "year";
}

const BATCH_SIZE = 20;

/**
 * Row -> contact identity, delegating to the shared exported helpers in
 * `@/lib/dashboard-contact-identity` so the runtime and the tests use ONE
 * implementation. These previously lived here as module-private copies, which is why
 * the tests had to re-declare them and therefore pinned nothing.
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

/**
 * Row -> contact type, or `null` when it cannot be resolved.
 *
 * `lookedUp` comes from the batched lookup against the real visible contact tables.
 * There is deliberately NO "default to lead" branch: an unresolved type disables the
 * action rather than sending an unknown row — or any recruit — to the Leads tab.
 */
function rowContactType(item: any, lookedUp?: ContactType | null): ContactType | null {
  return resolveContactTypeShared(
    {
      explicitType: item?.contact_type,
      sourceMarker: isValidContactType(item?.__contactType) ? item.__contactType : null,
    },
    lookedUp,
  );
}

const DashboardDetailModal: React.FC<DashboardDetailModalProps> = ({
  isOpen,
  onClose,
  type,
  userId,
  role,
  adminToggle,
  timeRange,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  /** Initial-load failure — distinct from loading and from a valid empty result. */
  const [loadError, setLoadError] = useState(false);
  /** Pagination failure — rows already loaded stay, but we say more failed to load. */
  const [pageError, setPageError] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /**
   * Request generation. Incremented by every NEW initial request and by effect cleanup,
   * so an older in-flight request can be recognised as stale and forbidden from writing
   * state. Pagination inherits the current generation without incrementing it, so a page
   * result belongs to the initial load it was requested under.
   */
  const requestGenerationRef = useRef(0);
  /**
   * Pagination in-flight lock, keyed by the generation that owns it.
   *
   * React state is NOT a synchronous lock: two scroll events in the same tick can both
   * observe `isFetchingNextPage === false` before a rerender, and both fire the same next
   * page. `isFetchingNextPage` remains the rendered UI state, but this ref is the actual
   * concurrency guard. `null` means no pagination request is in flight.
   */
  const paginationLockRef = useRef<{ generation: number; page: number } | null>(null);
  const { profile, user } = useAuth();

  const isFiltered = role !== "Admin" || adminToggle === "my";

  const getTitle = () => {
    const rangeSuffix = timeRange ? ` (${timeRange})` : "";
    switch (type) {
      case "callbacks":
        return "Callbacks Detail";
      case "appointments":
        return `Appointments Detail${rangeSuffix}`;
      case "calls_today":
        return `Calls Made${rangeSuffix}`;
      case "policies_sold":
        return `Policies Sold${rangeSuffix}`;
      case "missed_calls":
        return "Missed Calls (Recent)";
      case "anniversaries":
        return "Upcoming Anniversaries & Birthdays";
      case "premium_sold":
        return `Annual Premium Sold Analysis${rangeSuffix}`;
      default:
        return "Details";
    }
  };

  /**
   * Header subtitle.
   *
   * This replaced "Real-time Intelligence Feed", which was misleading: there is no
   * `supabase.channel(...)` subscription anywhere on the Dashboard, so nothing here
   * streams. The list is fetched once per open and paginated on scroll.
   */
  const getSubtitle = () => {
    switch (type) {
      case "missed_calls":
        return "Last 24 hours";
      case "anniversaries":
        return "Upcoming 90 days";
      case "callbacks":
        return "Scheduled callbacks";
      default:
        return timeRange ? `Selected period: ${timeRange}` : "Selected period";
    }
  };

  const getIcon = () => {
    switch (type) {
      case "callbacks":
        return <Phone className="w-5 h-5 text-blue-500" />;
      case "appointments":
        return <Calendar className="w-5 h-5 text-violet-500" />;
      case "calls_today":
        return <Phone className="w-5 h-5 text-blue-500" />;
      case "policies_sold":
        return <ShieldCheck className="w-5 h-5 text-emerald-500" />;
      case "missed_calls":
        return <PhoneMissed className="w-5 h-5 text-red-500" />;
      case "anniversaries":
        return <Gift className="w-5 h-5 text-pink-500" />;
      case "premium_sold":
        return <TrendingUp className="w-5 h-5 text-amber-500" />;
      default:
        return null;
    }
  };

  const fetchData = useCallback(async (pageNum: number, isInitial: boolean = false) => {
    if (!type || !userId || userId === "") return;

    if (isInitial) {
      // A new initial request invalidates every older request, initial or paginated, and
      // releases any pagination lock held by the previous generation.
      requestGenerationRef.current += 1;
      paginationLockRef.current = null;
    }

    const generation = requestGenerationRef.current;
    /** True once a newer request (or cleanup) has taken over. */
    const isStale = () => requestGenerationRef.current !== generation;

    if (isInitial) {
      // Clear the previous error whenever a new initial request begins.
      setLoadError(false);
      setPageError(false);
      setLoading(true);
      setData([]);
    } else {
      // Ref-based serialization: at most one pagination request per generation.
      if (paginationLockRef.current !== null) return;
      paginationLockRef.current = { generation, page: pageNum };
      setPageError(false);
      setIsFetchingNextPage(true);
    }

    /** Only the request that acquired the lock, in the owning generation, may release it. */
    const releasePaginationLock = () => {
      const lock = paginationLockRef.current;
      if (!isInitial && lock && lock.generation === generation && lock.page === pageNum) {
        paginationLockRef.current = null;
      }
    };

    try {
      // Half-open [start, end) from the SHARED bounds module, so the tests assert the
      // shipped logic rather than a copy. Calendar-constructed, so boundaries stay at
      // local midnight across DST.
      //
      // NOTE: still BROWSER-local. Agency-timezone derivation is Build 2, not claimed here.
      const { startIso: startStr, endIso: endStr } = periodBoundsIso(
        new Date(),
        timeRange || "month",
      );
      const from = pageNum * BATCH_SIZE;
      const to = (pageNum + 1) * BATCH_SIZE - 1;

      let resultData: any[] = [];

      // Callbacks: one shared contract with CallbacksWidget (dual-source, bounded,
      // globally ordered, per-source ownership). Paged globally after the merge.
      if (type === "callbacks") {
        const rows = await fetchCallbackPage({
          isFiltered,
          userId,
          pageSize: BATCH_SIZE,
          offset: pageNum * BATCH_SIZE,
        });
        if (isStale()) return;
        const mapped = rows.map((row: NormalizedCallbackRow) => ({
          __callback: true,
          // Dedicated RENDER identity, kept separate from contact identity. `row.key` is
          // source-qualified ("campaign:<id>" / "appointment:<id>"), so two callbacks for
          // the SAME contact still get distinct React keys. Using `contactId` here — as
          // this code previously did via the shared `id` field — collided them.
          __rowKey: row.key,
          __idIsContact: row.contactId !== null,
          __contactType: row.contactType,
          __canAct: row.canAct,
          __blockedReason: row.blockedReason,
          id: row.contactId ?? row.key,   // never the source row id as a contact identity
          contact_id: row.contactId,
          contact_type: row.contactType,
          contact_name: row.contactName,
          phone: row.phone,
          start_time: row.dueAt,
          notes: row.note,
          type: row.source === "campaign" ? "Campaign callback" : "Callback",
        }));
        if (mapped.length < BATCH_SIZE) setHasMore(false);
        if (isInitial) setData(mapped);
        else setData((prev) => [...prev, ...mapped]);
        return;
      }

      // Strategic Anniversary Logic: 90-day Policies / 14-day Birthdays
      if (type === "anniversaries") {
        if (pageNum > 0) {
          if (isStale()) return;
          setHasMore(false);
          setIsFetchingNextPage(false);
          return;
        }

        // Fetch Both Birthdays and Renewals independently of dashboard perspective
        // Respect adminToggle for team viewing, while RLS remains the primary security layer
        let leadsQ = supabase
          .from("leads")
          .select("id, first_name, last_name, date_of_birth, phone")
          .not("date_of_birth", "is", null);
        
        let clientsQ = supabase
          .from("clients")
          .select("id, first_name, last_name, effective_date, policy_type, phone, assigned_agent_id")
          .not("effective_date", "is", null);

        if (isFiltered) {
          leadsQ = leadsQ.eq("assigned_agent_id", userId);
          clientsQ = clientsQ.eq("assigned_agent_id", userId);
        }

        const [birthdaysRes, policiesRes] = await Promise.all([leadsQ, clientsQ]);

        const birthdays: any[] = [];
        const renewals: any[] = [];
        const todayNow = new Date();
        todayNow.setHours(0, 0, 0, 0);
        
        (birthdaysRes.data || []).forEach(l => {
          const dob = new Date(l.date_of_birth);
          const nextBday = new Date(todayNow.getFullYear(), dob.getMonth(), dob.getDate());
          if (nextBday < todayNow) nextBday.setFullYear(todayNow.getFullYear() + 1);
          
          const diffTime = nextBday.getTime() - todayNow.getTime();
          const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Strategic Window: 14 Days for Birthdays
          if (days >= 0 && days <= 14) {
            birthdays.push({ 
              __idIsContact: true,
              __contactType: 'lead',
              id: l.id, 
              contact_name: `${l.first_name} ${l.last_name}`, 
              phone: l.phone,
              type: 'Birthday', 
              date: l.date_of_birth, 
              daysUntil: days,
              isBirthday: true
            });
          }
        });

        (policiesRes.data || []).forEach(c => {
          const eff = new Date(c.effective_date);
          const nextAnniv = new Date(todayNow.getFullYear(), eff.getMonth(), eff.getDate());
          if (nextAnniv < todayNow) nextAnniv.setFullYear(todayNow.getFullYear() + 1);
          
          const diffTime = nextAnniv.getTime() - todayNow.getTime();
          const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Strategic Window: 90 Days for Policy Renewals
          if (days >= 0 && days <= 90) {
            renewals.push({ 
              __idIsContact: true,
              __contactType: 'client',
              id: c.id, 
              contact_name: `${c.first_name} ${c.last_name}`, 
              phone: c.phone,
              type: 'Policy Anniversary', 
              date: c.effective_date, 
              policy_type: c.policy_type, 
              daysUntil: days,
              isRenewal: true
            });
          }
        });

        // Grouping: Renewals first, then Birthdays, then sorted within groups
        const sortedRenewals = renewals.sort((a, b) => a.daysUntil - b.daysUntil);
        const sortedBirthdays = birthdays.sort((a, b) => a.daysUntil - b.daysUntil);
        
        // We add a 'sectionHeader' property to the first item of each group for rendering
        if (sortedRenewals.length > 0) sortedRenewals[0].sectionHeader = "Upcoming Renewals (90 Days)";
        if (sortedBirthdays.length > 0) sortedBirthdays[0].sectionHeader = "Upcoming Birthdays (14 Days)";

        resultData = [...sortedRenewals, ...sortedBirthdays];
        setHasMore(false);
      } else {
        let query: any;
        switch (type) {
          case "callbacks":
            // Callbacks come from the SHARED dual-source contract, so the widget rows,
            // the widget total and these detail rows describe the same bounded set:
            // same calendar window, same compatibility-timestamp rule, same
            // per-source ownership field, same ordering and identity rules.
            // Handled outside this switch — see the `callbacks` branch above.
            break;
          case "appointments":
            query = supabase.from("appointments").select("id, contact_name, contact_id, start_time, status, type, title").gte("start_time", startStr).lt("start_time", endStr).order("start_time", { ascending: true }).order("id", { ascending: true });
            if (isFiltered) query = query.eq("user_id", userId);
            break;
          case "calls_today":
            query = supabase
              .from("calls")
              .select("id, contact_name, contact_id, contact_type, contact_phone, created_at, disposition_name, duration, status, direction")
              .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
              .gte("created_at", startStr)
              .lt("created_at", endStr)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false });
            if (isFiltered) query = query.eq("agent_id", userId);
            break;
          case "policies_sold":
            query = supabase.from("clients").select("id, first_name, last_name, created_at, policy_type, premium").gte("created_at", startStr).lt("created_at", endStr).order("created_at", { ascending: false }).order("id", { ascending: false });
            if (isFiltered) query = query.eq("assigned_agent_id", userId);
            break;
          case "missed_calls": {
            const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            query = supabase.from("calls").select("id, contact_name, contact_id, contact_type, contact_phone, created_at, disposition_name, direction").eq("direction", "inbound").eq("is_missed", true).gte("created_at", since24h).order("created_at", { ascending: false }).order("id", { ascending: false });
            if (isFiltered) query = query.eq("agent_id", userId);
            break;
          }
          case "premium_sold":
            query = supabase.from("clients").select("id, first_name, last_name, created_at, policy_type, premium").gte("created_at", startStr).lt("created_at", endStr).order("created_at", { ascending: false }).order("id", { ascending: false });
            if (isFiltered) query = query.eq("assigned_agent_id", userId);
            break;
        }

        if (query) {
          const { data: result, error } = await query.range(from, to);
          if (error) throw error;
          
          if (type === "premium_sold" || type === "policies_sold") {
            // Both KPI drill-downs read `clients`, so the row's own id IS the contact
            // and the type is known — they must navigate to Clients, never Leads.
            resultData = (result || []).map((row: any) => ({
              ...row,
              __idIsContact: true,
              __contactType: "client" as const,
              contact_name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
              ...(type === "premium_sold" ? { premium_amount: row.premium } : {}),
            }));
          } else {
            resultData = result || [];
          }
          
          // `calls.contact_type` is NULL on most real rows, so resolve the unknowns
          // against the actual VISIBLE leads/clients/recruits rows. Ambiguous or absent
          // ids stay unresolved (null) — they are never assumed to be leads.
          if (type === "calls_today" || type === "missed_calls") {
            const unknownIds = resultData
              .filter((row: any) => !isValidContactType(row.contact_type))
              .map((row: any) => row.contact_id)
              .filter((id: any): id is string => typeof id === "string" && id.length > 0);
            if (unknownIds.length > 0) {
              const resolvedTypes = await resolveContactTypesByIds(unknownIds);
              resultData = resultData.map((row: any) =>
                isValidContactType(row.contact_type)
                  ? row
                  : { ...row, __contactType: resolvedTypes.get(row.contact_id) ?? null },
              );
            }
          }

          if (resultData.length < BATCH_SIZE) setHasMore(false);
        }
      }

      if (isStale()) return;
      if (isInitial) {
        setData(resultData);
      } else {
        setData(prev => [...prev, ...resultData]);
      }
    } catch (err) {
      // A returned query error is a FAILURE, not a valid empty result. An initial failure
      // must render the failure state, never "No intelligence found in this range". A
      // pagination failure keeps the rows already on screen but says more failed to load.
      // Raw Supabase detail goes to the console only.
      console.error("Error loading detail modal feed:", err);
      // A stale request must never write a failure over a newer result.
      if (isStale()) return;
      if (isInitial) {
        setData([]);
        setLoadError(true);
      } else {
        setPageError(true);
        setHasMore(false);
      }
    } finally {
      // The lock release is owner-scoped, so a stale request cannot free a newer one's lock.
      releasePaginationLock();
      // A stale finally must NOT clear loading state that belongs to a newer request.
      if (!isStale()) {
        if (isInitial) setLoading(false);
        setIsFetchingNextPage(false);
      }
    }
  }, [type, userId, isFiltered, timeRange]);

  useEffect(() => {
    if (isOpen) {
      setPage(0);
      setHasMore(true);
      fetchData(0, true);
    }
    // Invalidate any in-flight work when the modal closes or when type / range / scope
    // changes, so a resolution from the previous view cannot write state into this one.
    return () => {
      requestGenerationRef.current += 1;
      paginationLockRef.current = null;
    };
  }, [isOpen, type, timeRange, adminToggle, fetchData]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const nearBottom = scrollHeight - scrollTop <= clientHeight * 1.5;
    // `paginationLockRef` is the actual concurrency guard: two scroll events in the same
    // tick both observe the stale `isFetchingNextPage === false`, so state alone cannot
    // serialize them. `fetchData` re-checks the lock before acquiring it.
    if (nearBottom && hasMore && !loading && paginationLockRef.current === null) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchData(nextPage);
    }
  };

  const handleRowClick = (item: any) => {
    // Appointments are calendar entities, not contacts.
    if (type === "appointments") {
      onClose();
      navigate("/calendar");
      return;
    }

    // Everything else navigates to a CONTACT. Resolve identity AND type first; an
    // unresolved row must not navigate at all rather than guess the Leads tab.
    const contactId = rowContactId(item);
    const contactType = rowContactType(item, item?.__contactType ?? null);
    const tab = contactsTabFor(contactType);

    if (!contactId || !tab) {
      toast.error(
        item?.__blockedReason ??
          "This row has no resolvable contact record, so it cannot be opened.",
      );
      return;
    }

    onClose();
    navigate(`/contacts?contact=${contactId}&tab=${tab}`);
  };

  const handleStartCall = (e: React.MouseEvent, item: any) => {
    e.stopPropagation(); // keep the action inside the button — no row navigation

    if (!user) {
      toast.error("You must be logged in to make calls.");
      return;
    }

    const contactId = rowContactId(item);
    const contactType = rowContactType(item, item?.__contactType ?? null);

    // An unresolved identity or type must not dispatch a call.
    if (!contactId || !contactType) {
      toast.error(
        item?.__blockedReason ??
          "This row has no resolvable contact record, so it cannot be dialed.",
      );
      return;
    }

    // Route through the ONE canonical path. The previous call passed `item.id` (a
    // string) into makeCall's third parameter, which is a `MakeCallOptions` object,
    // never awaited the promise, and toasted success unconditionally.
    const started = dispatchQuickCall({
      contactId,
      name: item.contact_name || "Unknown",
      phone: item.phone ?? item.contact_phone ?? "",
      type: contactType,
    });

    // Only report what actually happened; the dialer surfaces its own progress.
    if (!started) {
      toast.error(`No phone number on file for ${item.contact_name || "this contact"}.`);
    }
  };

  const renderItemDetails = (item: any) => {
    switch (type) {
      case "callbacks":
      case "appointments":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || item.title || "Scheduled Event"}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {item.type && ` • ${item.type}`}
            </span>
          </div>
        );
      case "calls_today":
      case "missed_calls": {
        const direction = item.direction === 'inbound' ? 'Inbound' : 'Outbound';
        const phoneLabel = item.contact_name || item.contact_phone || "Caller";
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{phoneLabel}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="w-3 h-3" />
              <span className={`font-bold ${item.direction === 'inbound' ? 'text-blue-500' : 'text-indigo-500'}`}>{direction}</span>
              {` • `}{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {item.duration ? ` • ${Math.floor(item.duration / 60)}m ${item.duration % 60}s` : ""}
              {item.disposition_name && ` • ${item.disposition_name}`}
            </span>
          </div>
        );
      }
      case "policies_sold":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || `${item.first_name} ${item.last_name}`}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              {item.policy_type || "Life Insurance"}
              {item.premium && ` • $${item.premium.toLocaleString()} (Mo)`}
            </span>
          </div>
        );
      case "anniversaries":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Gift className="w-3 h-3 text-pink-500" />
              {item.type}: {item.isBirthday ? formatBirthdayShort(item.date) : new Date(item.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
              {item.policy_type && ` (${item.policy_type})`}
              <span className="ml-2 font-bold text-pink-500">
                {item.daysUntil === 0 ? "Today!" : `in ${item.daysUntil} days`}
              </span>
            </span>
          </div>
        );
      case "premium_sold": {
        const isWin = !!item.policy_type;
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || "Activity"}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {isWin ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <Phone className="w-3 h-3" />}
              {isWin ? `Closed: ${item.policy_type} • $${((item.premium_amount || 0) * 12).toLocaleString()} (Annual)` : `Call: ${item.disposition_name || 'Completed'}`}
            </span>
          </div>
        );
      }
      default:
        return (
          <div className="flex flex-col">
            <span className="font-semibold text-foreground">{item.contact_name || "Record"}</span>
            <span className="text-xs text-muted-foreground">{new Date(item.created_at || item.start_time).toLocaleString()}</span>
          </div>
        );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
            className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col bg-card border border-border rounded-[2rem] shadow-[0_0_60px_-15px_rgba(0,0,0,0.4)] dark:shadow-[0_0_60px_-15px_rgba(0,0,0,0.7)]"
          >
            {/* Header */}
            <div className="relative p-8 border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
              <div className="absolute top-6 right-6">
                <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-muted text-muted-foreground hover:text-foreground h-10 w-10 transition-all">
                  <X className="w-5 h-5" />
                </Button>
              </div>

              <div className="flex items-center gap-6">
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-2xl border border-white/10 ${
                  type === 'calls_today' || type === 'callbacks' ? 'from-blue-500 to-indigo-600' :
                  type === 'policies_sold' ? 'from-emerald-500 to-teal-600' :
                  type === 'appointments' ? 'from-violet-500 to-purple-600' :
                  'from-primary to-primary/80'
                }`}>
                  <div className="text-white scale-110 drop-shadow-lg">
                    {getIcon()}
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-foreground tracking-tight uppercase">{getTitle()}</h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <p className="text-xs font-bold text-muted-foreground tracking-[0.15em] uppercase opacity-80">{getSubtitle()}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Content Area with Scroll Handler */}
            <div 
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-gradient-to-b from-transparent to-muted/20"
            >
              <div className="mb-6 flex items-center justify-between">
                <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] opacity-50">Records</span>
                {data.length > 0 && (
                  <span className="text-[9px] font-black text-primary px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 tracking-wider">
                    {data.length} RECORDS LOADED {hasMore && "• SCROLL FOR MORE"}
                  </span>
                )}
              </div>
              
              {loading && page === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                  <p className="text-sm font-medium text-muted-foreground animate-pulse uppercase tracking-[0.2em]">Synchronizing Intelligence...</p>
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-10">
                  <AlertTriangle className="w-10 h-10 mb-4 text-amber-500" />
                  <p className="text-lg font-bold text-foreground">Couldn't load these records</p>
                  <p className="text-sm mt-2 text-muted-foreground">
                    Something went wrong. Close and reopen to try again.
                  </p>
                </div>
              ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-10 text-muted-foreground">
                  <Loader2 className="w-10 h-10 mb-4 opacity-20" />
                  <p className="text-lg font-bold opacity-80">No intelligence found in this range</p>
                  <p className="text-sm mt-2">Activity will appear here as records are processed.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 py-2">
                  {data.map((item, idx) => (
                    <React.Fragment key={item.__rowKey ?? item.id ?? idx}>
                      {item.sectionHeader && (
                        <div className="mt-4 mb-2 first:mt-0">
                          <h4 className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-[0.2em] ml-2">
                            {item.sectionHeader}
                          </h4>
                        </div>
                      )}
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: Math.min(idx, 8) * 0.03 }}
                        whileHover={{ x: 3 }}
                        onClick={() => handleRowClick(item)}
                        className="group relative flex items-center justify-between p-4 rounded-2xl border border-border bg-card/50 transition-colors hover:bg-accent cursor-pointer overflow-hidden"
                      >
                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-gradient-to-b ${
                          type === 'calls_today' || type === 'callbacks' ? 'from-blue-400 to-indigo-500' :
                          type === 'policies_sold' ? 'from-emerald-400 to-teal-500' :
                          type === 'appointments' ? 'from-violet-400 to-purple-500' :
                          'from-primary to-primary/50'
                        }`} />

                        <div className="flex items-center gap-4 flex-1">
                          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-muted border border-border group-hover:scale-110 transition-all duration-300">
                            {item.isBirthday ? (
                              <Gift className="w-5 h-5 text-pink-500" />
                            ) : item.isRenewal ? (
                              <ShieldCheck className="w-5 h-5 text-emerald-500" />
                            ) : (
                              getIcon()
                            )}
                          </div>
                          {renderItemDetails(item)}
                        </div>

                        <div className="flex items-center gap-4">
                          {type === "anniversaries" && (
                            <Button
                              size="sm"
                              onClick={(e) => handleStartCall(e, item)}
                              className="bg-primary hover:bg-primary/90 text-white rounded-xl h-9 px-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Phone className="w-3 h-3" />
                              <span className="text-[10px] font-bold uppercase tracking-wider">Start Call</span>
                            </Button>
                          )}
                          {item.status && type !== "calls_today" && type !== "missed_calls" && (
                            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                              item.status === 'Scheduled' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                              item.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                              'bg-muted text-muted-foreground border border-border'
                            }`}>
                              {item.status}
                            </span>
                          )}
                          <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                        </div>
                      </motion.div>
                    </React.Fragment>
                  ))}
                  
                  {isFetchingNextPage && (
                    <div className="flex items-center justify-center py-6 gap-3">
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest animate-pulse">Loading next batch...</span>
                    </div>
                  )}
                  
                  {/* A pagination failure keeps the rows already loaded, but must say so
                      truthfully rather than presenting the list as complete. */}
                  {pageError && (
                    <div className="flex items-center justify-center gap-2 py-6 text-amber-500">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        Couldn't load more records
                      </span>
                    </div>
                  )}

                  {!pageError && !hasMore && data.length > BATCH_SIZE && (
                    <div className="text-center py-8 opacity-40">
                      <div className="w-8 h-1 bg-border mx-auto mb-3 rounded-full" />
                      <p className="text-[10px] font-black uppercase tracking-widest">End of list</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-8 py-5 border-t border-border bg-muted/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-black opacity-60">
                  AgentFlow Analytics Engine • Batch Size: {BATCH_SIZE}
                </span>
              </div>
              <button onClick={onClose} className="text-[10px] font-black text-foreground/50 hover:text-foreground transition-all uppercase tracking-[0.2em] border border-border px-4 py-2 rounded-xl hover:bg-muted bg-card/50">
                Dismiss View
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default DashboardDetailModal;
