import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source contract for the Team / Open lead-details wiring in DialerPage (the page is too large to
 * mount in a unit test). Each assertion pins one approved rule so a later edit cannot silently undo it.
 */
const src = readFileSync(resolve(__dirname, "../DialerPage.tsx"), "utf8");
const body = (startMarker: string, endMarker: string) => {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a + startMarker.length);
  expect(a, startMarker).toBeGreaterThan(-1);
  expect(b, endMarker).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("DialerPage — Team/Open lead details wiring", () => {
  it("Sold/Convert fails closed for Team/Open before any pending state, validation or modal", () => {
    const gate = body("const openConversionGate = ", "const handleConversionSuccess");
    const guard = gate.indexOf("teamOpenConvertBlock(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(gate.indexOf("validateBeforeSave()"));
    expect(guard).toBeLessThan(gate.indexOf("setPendingConversionAction(action)"));
    expect(guard).toBeLessThan(gate.indexOf("setConvertModalOpen(true)"));
    expect(gate).toContain("teamOpenMaster.status");
    // The refusal must actually stop: an early return before validation / modal.
    expect(gate).toMatch(/if \(convertBlock\) \{[\s\S]*?toast\.error\(convertBlock\.message[\s\S]*?\);\s*return;\s*\}/);
    // Retry is one visit-bound read offered only where it can help; it never converts.
    expect(gate).toContain('convertBlock.offerRetry ? { label: "Retry loading record", onClick: () => void retryRead() } : undefined');
    expect(gate).toContain("const retryRead = teamOpenMaster.retry;");
    expect(gate.search(/if \(convertBlock\) \{/)).toBeLessThan(gate.indexOf("validateBeforeSave()"));
    // Only the lead this agent dialled under the CURRENT confirmed lock may be converted.
    expect(gate).toContain("confirmedLockLeadId === currentLead.id");
    expect(gate).toContain("teamOpenDialSession?.campaignLeadId === currentLead.id");
  });

  it("the conversion modal receives the authorized master's custom_fields in Team/Open", () => {
    expect(src).toMatch(/lead=\{currentLead \? mapDialerLeadToContactLead\(lockMode \? withTeamOpenMasterLead\(currentLead, teamOpenMaster\.master\) : currentLead\) : null\}/);
  });

  it("the Full View drawer input is unchanged (no master overlay that could make a lossy save succeed)", () => {
    expect(src).toContain("contact={mapDialerLeadToContactLead(currentLead)}");
  });

  it("the Admin DNC-override dial records the dialled lead for the reveal gate (fail closed otherwise)", () => {
    const dnc = body("// Team/Open reveal bookkeeping only (mirrors proceedWithCall)", "twilioMakeCall(dncLead.phone);");
    expect(dnc).toContain("dncLead?.id && dncLead.id === currentLead?.id ? dncLead.id : null");
  });

  it("leaving full reveal ends the Team/Open draft after a grace period (survives the hang-up → wrap-up gap)", () => {
    const eff = body('if (!lockMode || !isEditingContact || callStatus === "connected") return;', "}, [lockMode, isEditingContact, callStatus]);");
    expect(eff).toContain("window.setTimeout(() => teamOpenEdit.cancel(), 1500)");
    expect(eff).toContain("return () => window.clearTimeout(t);");
  });

  it("custom-field definitions keep the last good data after a failed refetch", () => {
    expect(src).toContain("definitions: teamOpenCustomFieldDefs ?? null");
    expect(src).toContain("definitionsUnavailable={teamOpenCustomFieldDefsFailed && !teamOpenCustomFieldDefs}");
  });

  it("Personal keeps full reveal; Team/Open reveal is delegated to the pure gate", () => {
    const memo = body("const callStatus = useMemo<CallStatus>", "}, [lockMode, currentLead, twilioCallState");
    expect(memo).toMatch(/if \(!lockMode\) return "connected";/);
    expect(memo).toContain("computeTeamOpenCallStatus(");
    expect(memo).toContain("confirmedLockLeadId");
    expect(memo).toContain("isInboundActivity(");
  });

  it("the dial session is the attempt-scoped hook bound to the dialled lead and the confirmed lock", () => {
    const blk = body("const teamOpenDialSession = useTeamOpenDialSession({", "});");
    expect(blk).toContain("enabled: lockMode");
    expect(blk).toContain("currentCall: twilioCurrentCall as TwilioCall | null");
    expect(blk).toContain("dialledCampaignLeadIdRef: lastDialCampaignLeadIdRef");
    expect(blk).toContain("confirmedLockLeadId");
  });

  it("master and edit hooks share the visit context; ids are passed explicitly, never parsed", () => {
    expect(src).toContain("viewerId: user?.id ?? null");
    expect(src).toContain("context: teamOpenMaster.context");
    expect(src).toContain("teamOpenMaster.adopt(context, master);");
    expect(src).not.toMatch(/identityKey\.split\(/);
    expect(src).toContain("isEditing={isEditingContact && teamOpenEdit.active}");
  });

  it("the loader only ADDS the RLS-governed master row; the lock / claim calls are unchanged", () => {
    const loader = body("const loadLockModeLead = useCallback(", "const fetchLeadsBatch = useCallback(");
    expect(loader).toContain("master_lead: leadData ?? null");
    expect(loader).toContain("await getNextLead(selectedCampaignId, resolvedType, filters)");
    expect(loader).toContain("setConfirmedLockLeadId(lock.id);");
    expect(loader).toContain("startHeartbeat(lock.id, () => {");
  });

  it("Personal inline edit keeps its original handlers; Team/Open uses the scoped edit session", () => {
    expect(src).toContain("const saveInlineEdit = async () => {");
    expect(src).toContain("const startEditing = () => {");
    expect(src).toContain("onClick={lockMode ? teamOpenEdit.start : startEditing}");
    expect(src).toMatch(/onClick=\{lockMode \? \(\) => \{ if \(canEditTeamOpen\) void teamOpenEdit\.save\(\); \} : saveInlineEdit\}/);
    expect(src).toContain("disabled={lockMode && !canEditTeamOpen}");
    expect(src).toContain("{isEditingContact && !lockMode ? (");
  });

  it("the custom-field definition read is bounded, cached and scoped to the org + viewer, Team/Open only", () => {
    const q = body("const { data: teamOpenCustomFieldDefs", "const teamOpenLeadId");
    expect(q).toContain('queryKey: ["dialer-team-open-custom-fields", organizationId, user?.id]');
    expect(q).toContain("customFieldsSupabaseApi.getAll(organizationId)");
    expect(q).toContain("enabled: lockMode && !!organizationId && !!user?.id");
    expect(q).toContain("staleTime:");
  });

  it("LeadCard receives Team/Open details only in lockMode", () => {
    expect(src).toMatch(/teamOpenDetails=\{\s*lockMode \? \(/);
    expect(src).toMatch(/\) : undefined\s*\}/);
  });
});
