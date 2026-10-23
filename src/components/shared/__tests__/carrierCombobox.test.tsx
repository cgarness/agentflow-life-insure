import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CarrierCombobox } from "../CarrierCombobox";
import type { OrganizationCarriers } from "@/hooks/useOrganizationCarriers";
import { installComboboxDomStubs } from "@/test/carrierComboboxTestUtils";

const ready = (carriers: string[]): OrganizationCarriers => ({ status: "ready", carriers, retry: vi.fn() });

function Harness({ list, initial = "", preserved, disabled, allowClear, onChange }: {
  list: OrganizationCarriers; initial?: string; preserved?: string; disabled?: boolean; allowClear?: boolean; onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return <form onSubmit={(e) => { e.preventDefault(); throw new Error("the picker must never submit the form"); }}>
    <label htmlFor="carrier">Carrier</label>
    <CarrierCombobox id="carrier" value={value} onChange={(v) => { setValue(v); onChange?.(v); }} list={list}
      preserved={preserved} disabled={disabled} allowClear={allowClear} />
  </form>;
}
const trigger = () => screen.getByLabelText("Carrier");
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

beforeEach(installComboboxDomStubs);
afterEach(cleanup);

describe("CarrierCombobox", () => {
  it("shows a placeholder and never auto-selects, even with one carrier", () => {
    const onChange = vi.fn();
    render(<Harness list={ready(["Only Carrier"])} onChange={onChange} />);
    expect(trigger()).toHaveTextContent("Select carrier…");
    expect(trigger()).toHaveAttribute("type", "button");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists carriers in order, filters by typed text, selects with the keyboard and offers no create option", async () => {
    render(<Harness list={ready(["Aetna", "Banner Life", "Mutual of Omaha"])} />);
    fireEvent.click(trigger());
    expect(await screen.findAllByRole("option")).toHaveLength(3);
    expect(options()).toEqual(["Aetna", "Banner Life", "Mutual of Omaha"]);
    const search = screen.getByPlaceholderText("Search carriers…");
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "OMA" } });
    await waitFor(() => expect(options()).toEqual(["Mutual of Omaha"]));
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("option")).not.toBeInTheDocument());
    expect(trigger()).toHaveTextContent("Mutual of Omaha");

    fireEvent.click(trigger());
    fireEvent.change(await screen.findByPlaceholderText("Search carriers…"), { target: { value: "Brand New Carrier" } });
    await waitFor(() => expect(options()).toEqual([]));
    expect(screen.getByText("No matching carrier.")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByPlaceholderText("Search carriers…"), { key: "Enter" });
    expect(trigger()).toHaveTextContent("Mutual of Omaha");
  });

  it("moves through options with the arrow keys", async () => {
    render(<Harness list={ready(["Aetna", "Banner Life"])} />);
    fireEvent.click(trigger());
    const search = await screen.findByPlaceholderText("Search carriers…");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(trigger()).toHaveTextContent("Banner Life"));
  });

  it("keeps the preserved value, labelled only when it is not in Settings", async () => {
    render(<Harness list={ready(["Aetna"])} initial="Retired Co" preserved="Retired Co" />);
    expect(trigger()).toHaveTextContent(/^Retired Co$/);
    expect(trigger()).toHaveAttribute("title", "Retired Co");
    expect(trigger()).toHaveAccessibleDescription(/^\(not in Settings\)/);
    fireEvent.click(trigger());
    expect(await screen.findByText("Saved on this client")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Aetna" }));
    expect(trigger()).toHaveTextContent(/^Aetna$/);
    expect(screen.queryByText(/Kept as saved/)).not.toBeInTheDocument();
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole("option", { name: /^Retired Co/ }));
    expect(trigger()).toHaveAccessibleDescription(/^\(not in Settings\)/);
  });

  it("offers no saved option for a value that is only search text or an arbitrary selection", async () => {
    render(<Harness list={ready(["Aetna"])} initial="Typed Name" />);
    fireEvent.click(trigger());
    await screen.findByRole("option", { name: "Aetna" });
    expect(screen.queryByText("Saved on this client")).not.toBeInTheDocument();
    expect(options()).toEqual(["Aetna"]);
  });

  it("shows loading, then keeps a preserved value visible while the list is unavailable", () => {
    render(<Harness list={{ status: "loading", carriers: null, retry: vi.fn() }} />);
    expect(trigger()).toHaveTextContent("Loading carriers…");
    expect(trigger()).toBeDisabled();
    cleanup();
    render(<Harness list={{ status: "loading", carriers: null, retry: vi.fn() }} initial="Retired Co" preserved="Retired Co" />);
    expect(trigger()).toHaveTextContent(/^Retired Co$/);
  });

  it("explains an empty list with a Settings link and a refresh", () => {
    const list = ready([]);
    render(<Harness list={list} />);
    expect(trigger()).toBeDisabled();
    const link = screen.getByRole("link", { name: "Settings → Carriers" });
    expect(link).toHaveAttribute("href", "/settings?section=carriers");
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    expect(list.retry).toHaveBeenCalledTimes(1);
  });

  it("shows a failed load with a Retry button that does not submit the form", () => {
    const list: OrganizationCarriers = { status: "error", carriers: null, retry: vi.fn() };
    render(<Harness list={list} />);
    expect(screen.getByText("Couldn't load carriers.")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toHaveAttribute("type", "button");
    fireEvent.click(retry);
    expect(list.retry).toHaveBeenCalledTimes(1);
  });

  it("closes and ignores selection when disabled", async () => {
    const onChange = vi.fn();
    const list = ready(["Aetna"]);
    const { rerender } = render(<Harness list={list} onChange={onChange} />);
    fireEvent.click(trigger());
    const option = await screen.findByRole("option", { name: "Aetna" });
    rerender(<Harness list={list} onChange={onChange} disabled />);
    await waitFor(() => expect(screen.queryByRole("option", { name: "Aetna" })).not.toBeInTheDocument());
    fireEvent.click(option);
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    rerender(<Harness list={list} onChange={onChange} />);
    expect(trigger()).toBeEnabled();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("can clear a value only where allowed", async () => {
    render(<Harness list={ready(["Aetna"])} initial="Aetna" allowClear />);
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole("option", { name: "No carrier" }));
    expect(trigger()).toHaveTextContent("Select carrier…");
    cleanup();
    render(<Harness list={ready(["Aetna"])} initial="Aetna" />);
    fireEvent.click(trigger());
    await screen.findByRole("option", { name: "Aetna" });
    expect(screen.queryByRole("option", { name: "No carrier" })).not.toBeInTheDocument();
  });
});
