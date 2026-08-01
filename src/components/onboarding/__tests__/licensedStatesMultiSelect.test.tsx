/**
 * Licensed-states multi-select — the replacement for the 50-checkbox scroll box.
 *
 * Covers the collapsed summary, search, Select all / Clear, toggle-without-close,
 * and — most importantly — that the emitted payload is still a `string[]` of full
 * US state names, exactly what `profiles.licensed_states` has always stored.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import LicensedStatesMultiSelect from "@/components/onboarding/LicensedStatesMultiSelect";
import {
  filterStates,
  summarizeLicensedStates,
  toggleState,
  visibleChips,
} from "@/components/onboarding/licensedStates";
import { US_STATE_NAMES } from "@/constants/us-geo";
import { installJsdomPolyfills } from "@/pages/__tests__/onboardingTestUtils";

installJsdomPolyfills();

const onChangeSpy = vi.fn();

const Harness: React.FC<{ initial?: string[] }> = ({ initial = [] }) => {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <LicensedStatesMultiSelect
      id="onboarding-licensed-states"
      value={value}
      onChange={(next) => {
        onChangeSpy(next);
        setValue(next);
      }}
    />
  );
};

// cmdk's search box is also a combobox once the popover is open, so the trigger
// is addressed by its stable id rather than by role.
const trigger = () => document.getElementById("onboarding-licensed-states") as HTMLElement;

const openPopover = async () => {
  fireEvent.click(trigger());
  await screen.findByPlaceholderText("Search states…");
};

afterEach(() => {
  cleanup();
  onChangeSpy.mockReset();
});

describe("licensedStates helpers", () => {
  it("summarizes the selection", () => {
    expect(summarizeLicensedStates([])).toBe("No states selected");
    expect(summarizeLicensedStates(["Texas"])).toBe("1 state selected");
    expect(summarizeLicensedStates(["Texas", "Ohio", "Utah", "Maine", "Iowa"])).toBe("5 states selected");
    expect(summarizeLicensedStates([...US_STATE_NAMES])).toBe("All states selected");
  });

  it("toggles a single state without disturbing the rest", () => {
    expect(toggleState(["Texas", "Ohio"], "Utah")).toEqual(["Texas", "Ohio", "Utah"]);
    expect(toggleState(["Texas", "Ohio"], "Texas")).toEqual(["Ohio"]);
  });

  it("filters case-insensitively by full state name", () => {
    expect(filterStates("")).toHaveLength(50);
    expect(filterStates("  ")).toHaveLength(50);
    expect(filterStates("texa")).toEqual(["Texas"]);
    expect(filterStates("new")).toEqual(["New Hampshire", "New Jersey", "New Mexico", "New York"]);
    expect(filterStates("zzz")).toEqual([]);
  });

  it("caps the chips at four and reports the overflow", () => {
    expect(visibleChips(["Texas", "Ohio"])).toEqual({ chips: ["Texas", "Ohio"], overflow: 0 });
    expect(visibleChips(["Texas", "Ohio", "Utah", "Maine", "Iowa", "Idaho"])).toEqual({
      chips: ["Texas", "Ohio", "Utah", "Maine"],
      overflow: 2,
    });
  });
});

describe("LicensedStatesMultiSelect", () => {
  it("renders the collapsed summary on an expandable combobox", () => {
    render(<Harness />);
    expect(screen.getByRole("combobox")).toBe(trigger());
    expect(trigger()).toHaveTextContent("No states selected");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("searches by state name", async () => {
    render(<Harness />);
    await openPopover();

    fireEvent.change(screen.getByPlaceholderText("Search states…"), { target: { value: "penn" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Pennsylvania" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "Texas" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search states…"), { target: { value: "zzz" } });
    expect(await screen.findByText("No state found.")).toBeInTheDocument();
  });

  it("emits a string array of full state names and keeps the popover open", async () => {
    render(<Harness />);
    await openPopover();

    fireEvent.click(screen.getByRole("option", { name: "Texas" }));
    expect(onChangeSpy).toHaveBeenLastCalledWith(["Texas"]);

    fireEvent.click(screen.getByRole("option", { name: "Ohio" }));
    expect(onChangeSpy).toHaveBeenLastCalledWith(["Texas", "Ohio"]);
    // Still open — multi-select must not close on every pick.
    expect(screen.getByPlaceholderText("Search states…")).toBeInTheDocument();
  });

  it("selects all fifty states", async () => {
    render(<Harness />);
    await openPopover();

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    const emitted = onChangeSpy.mock.calls.at(-1)?.[0] as string[];
    expect(emitted).toHaveLength(50);
    expect(emitted).toEqual([...US_STATE_NAMES]);
    expect(emitted.every((s) => typeof s === "string")).toBe(true);
    await waitFor(() => expect(trigger()).toHaveTextContent("All states selected"));
  });

  it("clears the selection", async () => {
    render(<Harness initial={["Texas", "Ohio", "Utah"]} />);
    expect(trigger()).toHaveTextContent("3 states selected");

    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChangeSpy).toHaveBeenLastCalledWith([]);
    await waitFor(() => expect(trigger()).toHaveTextContent("No states selected"));
  });

  it("shows at most four chips plus an overflow marker", () => {
    render(<Harness initial={["Texas", "Ohio", "Utah", "Maine", "Iowa", "Idaho"]} />);
    expect(screen.getByText("Texas")).toBeInTheDocument();
    expect(screen.getByText("Maine")).toBeInTheDocument();
    expect(screen.queryByText("Iowa")).not.toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("hides the supplementary chips on narrow mobile, keeping the count summary", () => {
    const { container } = render(<Harness initial={["Texas", "Ohio"]} />);
    const chipList = container.querySelector("ul");
    expect(chipList?.className).toContain("hidden");
    expect(chipList?.className).toContain("sm:flex");
    expect(trigger()).toHaveTextContent("2 states selected");
  });
});
