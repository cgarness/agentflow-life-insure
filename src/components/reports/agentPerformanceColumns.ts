// Agent table columns (D6 §4.6): KPI ids per column and the panel each comes from, in screen order.
export const AGENT_COLUMNS = [
  { id: 2, panel: "summary" }, { id: 1, panel: "summary" }, { id: 5, panel: "summary" }, { id: 6, panel: "summary" },
  { id: 8, panel: "summary" }, { id: 9, panel: "summary" }, { id: 12, panel: "salesAppointments" }, { id: 38, panel: "journey" },
  { id: 24, panel: "summary" },
] as const;
export type AgentColumnPanel = (typeof AGENT_COLUMNS)[number]["panel"];
