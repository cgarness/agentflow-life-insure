import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InsertFieldMenu from "../inspector/InsertFieldMenu";
import { mountInspector, step, trigger } from "./inspectorHarness";

const api = vi.hoisted(() => ({savedMessages: vi.fn(), dispositions: vi.fn(), campaigns: vi.fn(), sources: vi.fn()}));
const channels = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automation-api", () => ({automationApi: api}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions: channels}));

type TextControl = HTMLInputElement | HTMLTextAreaElement;
const SENDER = "00000000-0000-4000-8000-0000000000aa";
const FIRST = "{{first_name}}";

/** Put the cursor (or a selection) in a field the way typing or clicking would report it. */
function place(field: TextControl, start: number, end = start) {
  field.focus();
  field.setSelectionRange(start, end);
  fireEvent.keyUp(field);
}
/** Open the field's own Insert field menu and choose a field by its friendly name. */
async function insert(label: string, name: string) {
  const button = screen.getByRole("button", {name: "Insert field", description: label});
  button.focus();
  fireEvent.click(button);
  fireEvent.click(await within(await screen.findByRole("dialog", {name: "Insert field"})).findByRole("button", {name}));
  await waitFor(() => expect(screen.queryByRole("dialog", {name: "Insert field"})).toBeNull());
  // The menu hands focus back after it has left the page.
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
}

beforeEach(() => {
  api.savedMessages.mockResolvedValue({items: [], more: false});
  channels.mockResolvedValue({senders: [], moreSenders: false});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const cases = [
  {name: "SMS message", node: step("send_sms", {body: "Hello , welcome"}, {version: 2}), label: "Message", key: "body"},
  {name: "email subject", node: step("send_email", {subject: "Hello , welcome", body: "Body", sender_id: SENDER}), label: "Subject", key: "subject"},
  {name: "email message", node: step("send_email", {subject: "Subject", body: "Hello , welcome", sender_id: SENDER}), label: "Message", key: "body"},
  {name: "task title", node: step("create_task", {title: "Hello , welcome"}), label: "Task title", key: "title"},
  {name: "task notes", node: step("create_task", {title: "Call", notes: "Hello , welcome"}), label: "Notes", key: "notes"},
];

describe("Insert field", () => {
  it.each(cases.map((item, index) => ({...item, limit: [1600, 200, 20000, 200, 2000][index]})))(
    "lets the longest $name the rule allows be typed, even as emoji", ({node, label, limit}) => {
      mountInspector(node);
      // The rule counts characters and the browser counts UTF-16 units, where an emoji takes two.
      expect((screen.getByLabelText(label) as TextControl).maxLength).toBeGreaterThanOrEqual("😀".repeat(limit).length);
    });

  it("says that only an agency saved message keeps its consent type, as the server decides at publish", () => {
    mountInspector(cases[0].node);
    expect(screen.getByText(/^An agency saved message used unchanged keeps the consent type it was saved with\. Any other wording, a personal saved message included, needs the contact's marketing consent\./))
      .toBeVisible();
  });

  it.each(cases)("inserts at the cursor of the $name, keeps the text around it and returns focus", async ({node, label, key}) => {
    const view = mountInspector(node);
    const field = screen.getByLabelText(label) as TextControl;
    place(field, 6);
    await insert(label, "First name");
    expect(view.latest().config[key]).toBe("Hello " + FIRST + ", welcome");
    expect(field).toHaveValue("Hello " + FIRST + ", welcome");
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([6 + FIRST.length, 6 + FIRST.length]);
  });

  it.each(cases)("replaces the selection in the $name", async ({node, label, key}) => {
    const view = mountInspector(node);
    const field = screen.getByLabelText(label) as TextControl;
    place(field, 0, 5);
    await insert(label, "Last name");
    expect(view.latest().config[key]).toBe("{{last_name}} , welcome");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe("{{last_name}}".length);
  });

  it.each(cases)("inserts again and again in the $name, each time after the previous field", async ({node, label, key}) => {
    const view = mountInspector(node);
    const field = screen.getByLabelText(label) as TextControl;
    place(field, 6);
    await insert(label, "First name");
    await insert(label, "Last name");
    await insert(label, "Phone number");
    expect(view.latest().config[key]).toBe("Hello {{first_name}}{{last_name}}{{phone}}, welcome");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe("Hello {{first_name}}{{last_name}}{{phone}}".length);
  });

  it("adds the field at the end of a field the author has not been in", async () => {
    const view = mountInspector(step("send_sms", {body: "Hello"}, {version: 2}));
    await insert("Message", "Email address");
    expect(view.latest().config.body).toBe("Hello{{email}}");
    expect(document.activeElement).toBe(screen.getByLabelText("Message"));
  });

  it("uses the position the author moved to after typing more", async () => {
    const view = mountInspector(step("send_sms", {body: "Hello there"}, {version: 2}));
    const field = screen.getByLabelText("Message") as HTMLTextAreaElement;
    place(field, 5);
    fireEvent.change(field, {target: {value: "Hello again there"}});
    place(field, 11);
    await insert("Message", "First name");
    expect(view.latest().config.body).toBe("Hello again" + FIRST + " there");
  });

  it("offers friendly names, and appointment fields only after an appointment trigger", async () => {
    const lead = mountInspector(step("send_sms", {body: ""}, {version: 2}));
    fireEvent.click(screen.getByRole("button", {name: "Insert field", description: "Message"}));
    const menu = await screen.findByRole("dialog", {name: "Insert field"});
    for (const name of ["First name", "Last name", "Email address", "Phone number"]) {
      expect(within(within(menu).getByRole("group", {name: "Contact"})).getByRole("button", {name})).toBeVisible();
    }
    expect(within(menu).getAllByRole("button")).toHaveLength(4);
    expect(within(menu).queryByRole("button", {name: "Appointment date"})).toBeNull();
    expect(within(menu).queryByRole("group", {name: "Appointment"})).toBeNull();
    lead.unmount();

    const booked = mountInspector(step("send_sms", {body: ""}, {version: 2}), {start: trigger("appointment_booked")});
    fireEvent.click(screen.getByRole("button", {name: "Insert field", description: "Message"}));
    const appointmentMenu = await screen.findByRole("dialog", {name: "Insert field"});
    const group = within(appointmentMenu).getByRole("group", {name: "Appointment"});
    fireEvent.click(within(group).getByRole("button", {name: "Appointment time"}));
    await waitFor(() => expect(booked.latest().config.body).toBe("{{appointment_time}}"));
  });

  it("hands focus to the field after an insertion and back to its own button otherwise", async () => {
    const onInsert = vi.fn(), onInserted = vi.fn();
    render(<InsertFieldMenu trigger="lead_created" onInsert={onInsert} onInserted={onInserted}/>);
    const button = screen.getByRole("button", {name: "Insert field"});
    button.focus();
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", {name: "Phone number"}));
    await waitFor(() => expect(onInserted).toHaveBeenCalledTimes(1));
    expect(onInsert).toHaveBeenCalledWith("{{phone}}");
    // The menu did not pull focus back to its button, so the field can keep it.
    expect(document.activeElement).not.toBe(button);

    fireEvent.click(button);
    fireEvent.keyDown(await screen.findByRole("button", {name: "Phone number"}), {key: "Escape"});
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(onInserted).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("works from the keyboard: arrows move through the fields and Escape returns to the button", async () => {
    mountInspector(step("create_task", {title: ""}));
    const button = screen.getByRole("button", {name: "Insert field", description: "Task title"});
    button.focus();
    fireEvent.click(button);
    const menu = await screen.findByRole("dialog", {name: "Insert field"});
    const items = within(menu).getAllByRole("button");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0], {key: "ArrowDown"});
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], {key: "ArrowUp"});
    fireEvent.keyDown(items[0], {key: "ArrowUp"});
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, {key: "Escape"});
    await waitFor(() => expect(screen.queryByRole("dialog", {name: "Insert field"})).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
