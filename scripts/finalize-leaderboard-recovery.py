from pathlib import Path
import re
gate=Path('src/lib/leaderboard-request-gate.ts')
gate_text=gate.read_text()
assert gate_text.count('LeaderboardResponse<never>')==1
gate.write_text(gate_text.replace('LeaderboardResponse<never>','LeaderboardResponse<null>'))
p=Path('src/components/dashboard/__tests__/leaderboardWidget.test.tsx')
s=p.read_text()
def edit_test(title, edit):
    global s
    pattern=r'^  it\("'+re.escape(title)+r'", async \(\) => \{.*?^  \}\);'
    matches=list(re.finditer(pattern,s,re.M|re.S))
    assert len(matches)==1, title
    m=matches[0]; old=m.group(); new=edit(old)
    assert old!=new,title
    s=s[:m.start()]+new+s[m.end():]
def same_user_refresh(text):
    old='    rerender(<LeaderboardWidget userId={AG2} />);'
    assert text.count(old)==1
    return text.replace(old, '    gateNow += 31_000;\n    act(() => document.dispatchEvent(new Event("visibilitychange")));')
edit_test('keeps the stale note (with a working Retry) when a refresh fails over a zero-sales snapshot',same_user_refresh)
edit_test('keeps the last ranked snapshot behind the stale note when a refresh fails',same_user_refresh)
def advance_group(text):
    needle='    fireEvent.click(screen.getByRole("button", { name: "Group" }));'
    assert text.count(needle)==2
    return text.replace(needle,'    gateNow += 31_000;\n'+needle)
edit_test('falls back to org standings when the group RPC fails, and resets the toggle so Group can be retried',advance_group)
edit_test('hides group org names when a kept group snapshot is shown under My Agency after an org refresh fails',lambda text:text.replace('    orgFails = true;','    gateNow += 31_000;\n    orgFails = true;'))
s+='''

describe("Dashboard request resilience", () => {
  it("does not retain the previous identity's snapshot after an account change", async () => {
    const { rerender } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    h.autoResult = rpcFail();
    rerender(<LeaderboardWidget userId={AG2} />);
    await waitFor(() => expect(screen.getByText("Couldn't load standings")).toBeInTheDocument());
    expect(screen.queryByText("Avery Adams")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /top agents/i })).not.toBeInTheDocument();
  });

  it("does not turn repeated Retry clicks into repeated backend requests", async () => {
    h.autoResult = rpcFail();
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Couldn't load standings")).toBeInTheDocument());
    const count = h.rpcCalls.length;
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
      await flush();
    }
    expect(h.rpcCalls).toHaveLength(count);
  });

  it("reuses the valid agency snapshot when returning from a group failure within ten seconds", async () => {
    h.agencyGroup = GROUP;
    h.autoResult = byRpc(rpcOk(THREE_ROWS), rpcFail());
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await flush();
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    expect(callsTo("get_org_leaderboard_stats")).toHaveLength(1);
    expect(callsTo("get_agency_group_leaderboard")).toHaveLength(1);
  });
});
'''
p.write_text(s)
print('Same-account stale refreshes, cache expiry, retry cooldown, and account isolation remain explicitly covered.')
