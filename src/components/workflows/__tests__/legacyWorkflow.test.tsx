import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import LegacyWorkflow from "../LegacyWorkflow";

const fixture = vi.hoisted(() => {
  const requests: {table: string; filters: Record<string,unknown>}[] = [];
  const rows = {
    workflow_nodes: [{id:"preserved-trigger",type:"trigger",action_type:null,position_x:0,position_y:0,label:"Disposition",config:{trigger_type:"disposition"}},
      {id:"preserved-custom",type:"action",action_type:"legacy_custom",position_x:0,position_y:200,label:"Legacy custom action",config:{opaque_field:"preserved"}}],
    workflow_edges: [{id:"preserved-edge",source_node_id:"preserved-trigger",target_node_id:"preserved-custom",condition_branch:null}],
    workflow_executions: [], workflow_execution_steps: [],
  };
  return {requests, rows};
});
vi.mock("@/integrations/supabase/client", () => ({supabase: {
  from: (table: keyof typeof fixture.rows) => {
    const request = {table, filters: {}};
    fixture.requests.push(request);
    const builder = { select: () => builder, eq: (key: string,v: string) => {request.filters[key] = v; return builder;},
      order: () => builder, limit: () => builder, range: () => builder,
      then: (fn: (result: unknown) => void) => Promise.resolve({data:fixture.rows[table],error:null}).then(fn),
    };
    return builder;
  },
}}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("reopens an opaque graph and its execution history as scoped reads", async () => {
  vi.stubGlobal("ResizeObserver",class {observe() {} unobserve() {} disconnect() {}});
  render(<QueryClientProvider client={new QueryClient()}><LegacyWorkflow org="agency-one" id="existing-id"/></QueryClientProvider>);
  expect((await screen.findAllByText("Legacy custom action")).length).toBeGreaterThan(0);
  expect(screen.getByText(/"opaque_field": "preserved"/)).toBeInTheDocument();
  expect(screen.queryByText("Save draft")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Execution history"}));
  expect(await screen.findByText(/no executions/i)).toBeInTheDocument();
  expect(fixture.requests.map(r => r.table)).toEqual(["workflow_nodes","workflow_edges","workflow_executions"]);
  for (const request of fixture.requests) expect(request.filters).toEqual({organization_id:"agency-one",workflow_id:"existing-id"});
});
