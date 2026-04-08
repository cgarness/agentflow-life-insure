import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDialer, type Disposition } from "@/contexts/DialerContext";
import { getTodayStats } from "@/lib/supabase-dialer-stats";
import { getLeadHistory, getCampaignLeads } from "@/lib/dialer-api";
import { 
  sortQueue, 
  queueOrderChanged,
  type CampaignLead 
} from "@/lib/queue-manager";
import { getContactLocalTime, getContactTimezone } from "@/utils/contactLocalTime";
import { useDialerStateMachine } from "@/hooks/useDialerStateMachine";
import { checkCallingHours } from "@/utils/dialerUtils";

export const DialerStateObservers = () => {
  const {
    user, organizationId, selectedCampaignId, selectedCampaign,
    setCampaigns, setCampaignsLoading, setCampaignStats,
    leadQueue, setLeadQueue, currentLeadIndex, setCurrentLeadIndex, currentLead,
    setLoadingLeads, setHasMoreLeads, setCurrentOffset,
    telnyxCallState, telnyxStatus, telnyxCurrentCall, telnyxInitialize,
    amdEnabled, amdStatus, setAmdStatus,
    setHistory, setHistoryLeadId, setLoadingHistory,
    dialerStats, setDialerStats, setSessionStats, setSessionElapsed,
    circuitBreakerRef, ringTimeoutRef, sessionTimerRef, hasDialedOnce,
    setAutoDialEnabled,
    leadTransitionRef, historyEndRef,
    lockMode, autoDialEnabled, isPaused, showWrapUp,
    handleCall, handleSkip, handleHangUp, handleMachineDetectedAction,
    loadLockModeLead,
    setIsTransitioning, setAssignedAgentName,
    setContactLocalTimeDisplay,
    isTransitioning,
  } = useDialer();

  /* --- 1. Initial Stats & Campaigns Fetch --- */
  useEffect(() => {
    if (!user?.id || !organizationId) return;
    
    // Fetch today's stats
    getTodayStats(user.id).then(stats => setDialerStats(stats));

    // Fetch campaigns
    const fetchCampaigns = async () => {
      setCampaignsLoading(true);
      try {
        const { data: camps, error } = await supabase
          .from("campaigns")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });
        
        if (error) throw error;
        setCampaigns(camps || []);

        // Fetch stats per campaign (counts per state)
        const { data: statsData } = await (supabase as any).rpc("get_campaign_state_stats", { p_org_id: organizationId });
        const mapped = (statsData || []).reduce((acc: any, curr: any) => {
          if (!acc[curr.campaign_id]) acc[curr.campaign_id] = [];
          acc[curr.campaign_id].push({ state: curr.state, count: curr.count });
          return acc;
        }, {});
        setCampaignStats(mapped);
      } catch (err) {
        toast.error("Failed to load campaigns");
      } finally {
        setCampaignsLoading(false);
      }
    };

    fetchCampaigns();
  }, [user?.id, organizationId, setDialerStats, setCampaigns, setCampaignsLoading, setCampaignStats]);

  /* --- 2. Session Ticker --- */
  useEffect(() => {
    if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    if (!dialerStats?.session_started_at) {
      setSessionElapsed(0);
      return;
    }
    const startTime = new Date(dialerStats.session_started_at).getTime();
    const tick = () => setSessionElapsed(Math.floor((Date.now() - startTime) / 1000));
    tick();
    sessionTimerRef.current = setInterval(tick, 1000);
    return () => { if (sessionTimerRef.current) clearInterval(sessionTimerRef.current); };
  }, [dialerStats?.session_started_at, setSessionElapsed, sessionTimerRef]);

  /* --- 3. Lead Loading & Resume --- */
  useEffect(() => {
    if (!selectedCampaignId || !organizationId) return;
    
    const loadWithResume = async () => {
      setLoadingLeads(true);
      try {
        const BATCH_SIZE = 50;
        const leads = await getCampaignLeads(selectedCampaignId, organizationId, BATCH_SIZE, 0);
        setHasMoreLeads(leads.length >= BATCH_SIZE);
        
        let retryInterval = 24;
        const { data: campData } = await supabase.from('campaigns').select('retry_interval_hours').eq('id', selectedCampaignId).maybeSingle();
        if (campData?.retry_interval_hours != null) retryInterval = campData.retry_interval_hours;

        const now = new Date();
        const enriched = (leads as CampaignLead[]).map(lead => {
          if (lead.status === 'Called' && lead.last_called_at && retryInterval > 0) {
            const eligibleAt = new Date(new Date(lead.last_called_at).getTime() + retryInterval * 3600000);
            if (eligibleAt > now) return { ...lead, retry_eligible_at: eligibleAt.toISOString() };
          }
          if (lead.scheduled_callback_at) return { ...lead, callback_due_at: lead.scheduled_callback_at };
          return lead;
        });

        const sorted = sortQueue(enriched, now);
        setLeadQueue(sorted);
        setCurrentOffset(BATCH_SIZE);

        if (user?.id) {
          const { data: savedState } = await (supabase as any).from('dialer_queue_state').select('current_lead_id').eq('user_id', user.id).eq('campaign_id', selectedCampaignId).maybeSingle();
          if (savedState) {
            const idx = sorted.findIndex((l: any) => (l.lead_id || l.id) === savedState.current_lead_id);
            setCurrentLeadIndex(idx >= 0 ? idx : 0);
            if (idx >= 0) toast.success("Resuming where you left off");
          } else {
            setCurrentLeadIndex(0);
          }
        }
      } catch (err) {
        toast.error("Failed to load leads");
      } finally {
        setLoadingLeads(false);
      }
    };

    if (lockMode) loadLockModeLead(selectedCampaign?.type);
    else loadWithResume();
  }, [selectedCampaignId, organizationId, lockMode, user?.id, setLeadQueue, setCurrentLeadIndex, setLoadingLeads, setHasMoreLeads, setCurrentOffset, loadLockModeLead, selectedCampaign?.type]);

  /* --- 4. Auto-Dial Toggle & Sync --- */
  useEffect(() => {
    if (!selectedCampaign) return;
    const val = selectedCampaign.auto_dial_enabled;
    if (val != null) setAutoDialEnabled(val);
  }, [selectedCampaignId, selectedCampaign, setAutoDialEnabled]);

  /* --- 5. 60s Re-sort --- */
  useEffect(() => {
    if (!selectedCampaignId || lockMode) return;
    const interval = setInterval(() => {
      if (telnyxCallState === 'active' || telnyxCallState === 'dialing' || showWrapUp) return;
      const now = new Date();
      setLeadQueue(prev => {
        const head = prev.slice(0, currentLeadIndex + 1);
        const tail = prev.slice(currentLeadIndex + 1);
        const sortedTail = sortQueue(tail as CampaignLead[], now);
        const updated = [...head, ...sortedTail];
        if (queueOrderChanged(prev as CampaignLead[], updated as CampaignLead[])) {
          toast("Queue updated — new leads eligible");
          return updated;
        }
        return prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [selectedCampaignId, lockMode, telnyxCallState, showWrapUp, currentLeadIndex, setLeadQueue]);

  /* --- 6. Debounced Lead Transition --- */
  useEffect(() => {
    if (!currentLead) {
      setHistory([]);
      setHistoryLeadId(null);
      setAssignedAgentName(null);
      setIsTransitioning(false);
      return;
    }
    setIsTransitioning(true);
    if (leadTransitionRef.current) clearTimeout(leadTransitionRef.current);

    const controller = new AbortController();
    const leadId = currentLead.lead_id || currentLead.id;

    leadTransitionRef.current = setTimeout(async () => {
      setLoadingHistory(true);
      try {
        const data = await getLeadHistory(leadId, organizationId, controller.signal);
        if (!controller.signal.aborted) {
          setHistory(data);
          setHistoryLeadId(leadId);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') toast.error("Failed to load history");
      } finally {
        if (!controller.signal.aborted) {
          setLoadingHistory(false);
          setIsTransitioning(false);
        }
      }
    }, 150);

    return () => {
      controller.abort();
      if (leadTransitionRef.current) clearTimeout(leadTransitionRef.current);
    };
  }, [currentLead?.id, currentLead?.lead_id, organizationId, setHistory, setHistoryLeadId, setAssignedAgentName, setIsTransitioning, setLoadingHistory, leadTransitionRef]);

  /* --- 7. History Scroll --- */
  const prevHistoryLenRef = useRef(0);
  useEffect(() => {
    requestAnimationFrame(() => historyEndRef.current?.scrollIntoView({ behavior: 'instant' }));
  }, [leadQueue.length, currentLead?.id, isTransitioning, historyEndRef]);

  /* --- 8. Real-time AMD --- */
  useEffect(() => {
    if (!telnyxCurrentCall?.id || !amdEnabled) return;
    const channel = supabase.channel(`call-amd-${telnyxCurrentCall.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${telnyxCurrentCall.id}` }, (payload) => {
        if (payload.new.amd_result === 'machine' || payload.new.disposition_name === 'No Answer') handleMachineDetectedAction();
        else if (payload.new.amd_result === 'human') setAmdStatus('human');
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [telnyxCurrentCall?.id, amdEnabled, handleMachineDetectedAction, setAmdStatus]);

  /* --- 9. Ring Timeout --- */
  useEffect(() => {
    if (telnyxCallState !== "dialing") return;
    const timeout = setTimeout(() => {
      if (amdEnabled && amdStatus === 'human') return;
      toast.info("No answer — hanging up");
      handleHangUp();
    }, ringTimeoutRef.current * 1000);
    return () => clearTimeout(timeout);
  }, [telnyxCallState, amdEnabled, amdStatus, handleHangUp, ringTimeoutRef]);

  /* --- 10. Local Time Badge --- */
  useEffect(() => {
    const state = currentLead?.state;
    if (!state) { setContactLocalTimeDisplay(""); return; }
    const update = () => {
      const t = getContactLocalTime(state);
      const tz = getContactTimezone(state);
      setContactLocalTimeDisplay(t && tz ? `${t} ${tz}` : t);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [currentLead?.state, setContactLocalTimeDisplay]);

  /* --- 11. State Machine --- */
  const memoizedCheckHours = useCallback((state: string) => checkCallingHours(state, "09:00", "21:00"), []);
  useDialerStateMachine({
    isAutoDialEnabled: autoDialEnabled && !isPaused,
    telnyxCallState: telnyxCallState as any,
    telnyxStatus: telnyxStatus as any,
    currentLead,
    hasDialedOnce,
    showWrapUp,
    checkCallingHours: memoizedCheckHours,
    onCall: handleCall,
    onSkip: handleSkip,
  });

  return null;
};
