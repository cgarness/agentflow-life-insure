import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

/** jsdom lacks the layout APIs cmdk and Radix Popover call. Call once per test file (e.g. in beforeEach). */
export function installComboboxDomStubs() {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}

/** Open the carrier combobox labelled `label`, wait for its options, and pick `name`. */
export async function pickCarrier(name: string, label: string | RegExp = "Carrier") {
  const trigger = await screen.findByLabelText(label);
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }));
}
