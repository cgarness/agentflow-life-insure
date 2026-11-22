import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AutomationBlockPicker from "../AutomationBlockPicker";
import { emptyGraph, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";

afterEach(cleanup);

function after(trigger: string): AutomationGraph {
  return {...emptyGraph(), nodes: [{id: "start", type: trigger, version: 1, config: {}}]};
}
function open(label: string, graph: AutomationGraph) {
  const onPick = vi.fn();
  render(<AutomationBlockPicker label={label} graph={graph} onPick={onPick}/>);
  fireEvent.click(screen.getByRole("button", {name: label}));
  return {picker: screen.getByRole("dialog", {name: label}), onPick};
}
const choices = (picker: HTMLElement) => within(picker).getAllByRole("button").map(button => button.getAttribute("aria-labelledby"))
  .map(id => document.getElementById(id!)!.textContent);
const sections = (picker: HTMLElement) => within(picker).getAllByRole("group")
  .map(group => document.getElementById(group.getAttribute("aria-labelledby")!)!.textContent);

describe("add-step picker", () => {
  it("offers only triggers on a blank canvas, under one Triggers heading", () => {
    const {picker} = open("Choose trigger", emptyGraph());
    expect(picker).toHaveAttribute("data-state", "open");
    expect(sections(picker)).toEqual(["Triggers"]);
    expect(choices(picker)).toEqual([
      "New lead created", "Lead added to campaign", "Disposition recorded", "Appointment booked",
      "Appointment outcome recorded", "Inbound call missed", "Sale recorded", "Policy issuance confirmed",
    ]);
    expect(within(picker).queryByRole("button", {name: "Send SMS"})).toBeNull();
    expect(within(picker).getByRole("searchbox", {name: "Search triggers"})).toBeVisible();
  });

  it("groups the steps a lead trigger supports as Actions, Timing, Conditions and names each choice by its label", () => {
    const {picker} = open("Add step", after("lead_created"));
    expect(sections(picker)).toEqual(["Actions", "Timing", "Conditions"]);
    expect(choices(picker)).toEqual(["Send SMS", "Send email", "Create task for assigned agent", "Wait", "Contact has email"]);
    // The accessible name is exactly the block label; the one-line description is its description.
    const sms = within(picker).getByRole("button", {name: "Send SMS"});
    expect(sms).toHaveAccessibleDescription("Texts the contact.");
    expect(within(picker).queryByRole("button", {name: "Wait until before appointment"})).toBeNull();
    expect(within(picker).queryByRole("button", {name: "New lead created"})).toBeNull();
  });

  it("shows only choices that are valid after the chosen trigger", () => {
    const booked = open("Add step", after("appointment_booked")).picker;
    expect(choices(booked)).toContain("Wait until before appointment");
    cleanup();
    const sale = open("Add step", after("sale_recorded")).picker;
    expect(sections(sale)).toEqual(["Actions", "Timing"]);
    expect(choices(sale)).toEqual(["Create task for assigned agent", "Wait"]);
    cleanup();
    const missed = open("Add step", after("inbound_call_missed")).picker;
    expect(choices(missed)).not.toContain("Send SMS");
    expect(choices(missed)).toContain("Create task for assigned agent");
  });

  it("searches labels, descriptions and keywords, and says when nothing matches", () => {
    const {picker} = open("Add step", after("appointment_booked"));
    const search = within(picker).getByRole("searchbox", {name: "Search steps"});
    fireEvent.change(search, {target: {value: "text"}});
    expect(choices(picker)).toEqual(["Send SMS"]);
    fireEvent.change(search, {target: {value: "verified agency sender"}});
    expect(choices(picker)).toEqual(["Send email"]);
    fireEvent.change(search, {target: {value: "REMINDER"}});
    expect(choices(picker)).toEqual(["Create task for assigned agent", "Wait until before appointment"]);
    expect(sections(picker)).toEqual(["Actions", "Timing"]);
    fireEvent.change(search, {target: {value: "fax"}});
    expect(within(picker).queryAllByRole("button")).toHaveLength(0);
    expect(within(picker).getByText("No matching steps")).toBeVisible();
  });

  it("picks with the keyboard, closes, and reports the block type", () => {
    const {picker, onPick} = open("Add step", after("lead_created"));
    const search = within(picker).getByRole("searchbox");
    fireEvent.keyDown(search, {key: "ArrowDown"});
    expect(within(picker).getByRole("button", {name: "Send SMS"})).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, {key: "ArrowDown"});
    expect(within(picker).getByRole("button", {name: "Send email"})).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, {key: "End"});
    expect(within(picker).getByRole("button", {name: "Contact has email"})).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, {key: "Home"});
    fireEvent.keyDown(document.activeElement!, {key: "ArrowUp"});
    expect(search).toHaveFocus();
    fireEvent.click(within(picker).getByRole("button", {name: "Wait"}));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("wait");
    expect(screen.queryByRole("dialog", {name: "Add step"})).toBeNull();
  });

  it("keeps the opener's label on the compact canvas button", () => {
    render(<AutomationBlockPicker compact label="Add step after Send SMS" graph={after("lead_created")} onPick={vi.fn()}/>);
    const opener = screen.getByRole("button", {name: "Add step after Send SMS"});
    expect(opener).not.toHaveTextContent("Add step");
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", {name: "Add step after Send SMS"})).toBeVisible();
  });
});
