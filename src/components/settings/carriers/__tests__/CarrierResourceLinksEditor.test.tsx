import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CarrierResourceLinksEditor from "../CarrierResourceLinksEditor";
import type { CarrierResourceLink } from "@/lib/carrierResources";

const first: CarrierResourceLink = {
  id: "12345678-1234-4234-8234-123456789001", label: "Application", url: "https://carrier.example/apply", group: "quick_links",
};
const second: CarrierResourceLink = {
  id: "12345678-1234-4234-8234-123456789002", label: "Training", url: "https://carrier.example/learn", group: "guides_training",
};

function ControlledEditor({ initial = [] }: { initial?: CarrierResourceLink[] }) {
  const [links, setLinks] = useState(initial);
  return <CarrierResourceLinksEditor links={links} onChange={setLinks} />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Carrier resource links editor", () => {
  it("adds an empty link with a stable UUID and edits its label, URL, and group", () => {
    const uuid = "12345678-1234-4234-8234-123456789003";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
    render(<ControlledEditor />);
    expect(screen.getByText("Add application, guide, or training links.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    const label = screen.getByRole("textbox", { name: "Label" });
    const url = screen.getByRole("textbox", { name: "URL" });
    const group = screen.getByRole("combobox", { name: "Group" });
    expect(label).toHaveValue("");
    expect(url).toHaveValue("");
    expect(label.id).toBe(`carrier-resource-${uuid}-label`);
    expect(group).toHaveValue("quick_links");
    fireEvent.change(label, { target: { value: "Underwriting guide" } });
    fireEvent.change(url, { target: { value: "https://carrier.example/guide.pdf" } });
    fireEvent.change(group, { target: { value: "guides_training" } });
    expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Underwriting guide");
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue("https://carrier.example/guide.pdf");
    expect(screen.getByRole("combobox")).toHaveValue("guides_training");
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("reorders whole links without losing stable identities, then removes only the chosen link", () => {
    render(<ControlledEditor initial={[first, second]} />);
    expect(screen.getByRole("button", { name: "Move link 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move link 2 down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move link 1 down" }));
    const labels = screen.getAllByRole("textbox", { name: "Label" });
    expect(labels[0]).toHaveValue("Training");
    expect(labels[0].id).toBe(`carrier-resource-${second.id}-label`);
    expect(screen.getAllByRole("textbox", { name: "URL" })[0]).toHaveValue(second.url);
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("guides_training");
    fireEvent.click(screen.getByRole("button", { name: "Remove link 1" }));
    expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Application");
  });

  it("respects the controlled contract and never mutates the supplied links", () => {
    const onChange = vi.fn();
    const links = [{ ...first }];
    render(<CarrierResourceLinksEditor links={links} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), { target: { value: "New label" } });
    expect(onChange).toHaveBeenCalledWith([{ ...first, label: "New label" }]);
    expect(links[0].label).toBe("Application");
    expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Application");
  });

  it("disables editing and all mutation actions while a save is pending", () => {
    const onChange = vi.fn();
    render(<CarrierResourceLinksEditor links={[first, second]} onChange={onChange} disabled />);
    screen.getAllByRole("button").forEach((button) => expect(button).toBeDisabled());
    screen.getAllByRole("textbox").forEach((input) => expect(input).toBeDisabled());
    screen.getAllByRole("combobox").forEach((select) => expect(select).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove link 1" }));
    fireEvent.change(screen.getAllByRole("textbox", { name: "Label" })[0], { target: { value: "Cannot change" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blocks a 51st link while leaving existing entries editable", () => {
    const onChange = vi.fn();
    const links = Array.from({ length: 50 }, (_, index) => ({ ...first, id: `12345678-1234-4234-8234-${String(index).padStart(12, "0")}` }));
    render(<CarrierResourceLinksEditor links={links} onChange={onChange} />);
    const add = screen.getByText("Add link", { selector: "button" });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByDisplayValue("Application")[0]).toBeEnabled();
  });

  it("associates validation messages with the correct stable row and field", () => {
    render(<CarrierResourceLinksEditor links={[first, second]} onChange={vi.fn()} errors={{
      [second.id]: { label: "Enter a link label", url: "Enter a full http:// or https:// URL", group: "Select a group" },
    }} />);
    const labels = screen.getAllByRole("textbox", { name: "Label" });
    expect(labels[0]).toHaveAttribute("aria-invalid", "false");
    expect(labels[1]).toHaveAttribute("aria-invalid", "true");
    expect(labels[1]).toHaveAccessibleDescription("Enter a link label");
    expect(screen.getAllByRole("textbox", { name: "URL" })[1]).toHaveAccessibleDescription("Enter a full http:// or https:// URL");
    expect(screen.getAllByRole("combobox")[1]).toHaveAccessibleDescription("Select a group");
  });
});
