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
    const guard = gate.indexOf("canConvertTeamOpenLead(lockMode, teamOpenMaster.status)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(gate.indexOf("validateBeforeSave()"));
    expect(guard).toBeLessThan(gate.indexOf("setPendingConversionAction(action)"));
    expect(guard).toBeLessThan(gate.indexOf("setConvertModalOpen(true)"));
    expect(gate).toContain("TEAM_OPEN_CONVERT_BLOCKED_MESSAGE");
  });

  it("the conversion modal receives the authorized master's custom_fields in Team/Open", () => {
    expect(src).toMatch(/lead=\{currentLead \? mapDialerLeadToContactLead\(lockMode \? withTeamOpenMasterLead\(currentLead, teamOpenMaster\.master\) : currentLead\) : null\}/);
  });

  it("Personal keeps full reveal; Team/Open reveal is delegated to the pure gate", () => {
    const memo = body("const callStatus = useMemo<CallStatus>", "}, [lockMode, currentLead, twilioCallState");
    expect(memo).toMatch(/if \(!lockMode\) return "connected";/);
    expect(memo).toContain("computeTeamOpenCallStatus(");
    expect(memo).toContain("confirmedLockLeadId");
    expect(memo).toContain("isInboundActivity(");
  });

  it("the dial session follows the dialled campaign lead and is dropped on any lock change", () => {
    expect(src).toContain("setTeamOpenDialSession(dialSessionOnDialing(lastDialCampaignLeadIdRef.current))");
    expect(src).toContain("setTeamOpenDialSession((prev) => dialSessionOnLockChange(prev, confirmedLockLeadId))");
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
