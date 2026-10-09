/**
 * CampaignColumnsMenu — the Columns popover on the Campaigns management table.
 *
 * Pins: the trigger is disabled until preferences have settled; opening (when editable) starts
 * an edit session; Campaign and Actions are locked; every configurable column has a
 * "Show <label>" checkbox and Move up/down controls; toggles and moves send the expected layout
 * through setDraft; only Save/Reset persist (and close only on success); Cancel discards; a busy
 * editor is disabled and cannot be dismissed; a failed load offers Retry → reload.
 *
 * The harness implements the ColumnsMenuPrefs contract with React state and STABLE callback
 * references (AGENT_RULES: fresh references per render fabricate render loops).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React, { useMemo, useState } from "react";
import CampaignColumnsMenu, { type ColumnsMenuPrefs } from "../CampaignColumnsMenu";
import {
  COLUMN_DEFS,
  DEFAULT_COLUMN_LAYOUT,
  normalizeColumnLayout,
  type ColumnLayout,
} from "@/lib/campaigns-table/columns";

// jsdom shims Radix needs (scoped to this file, not the global setup)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(window as any).ResizeObserver = (window as any).ResizeObserver || RO;
(Element.prototype as any).hasPointerCapture = (Element.prototype as any).hasPointerCapture || (() => false);
(Element.prototype as any).setPointerCapture = (Element.prototype as any).setPointerCapture || (() => {});
(Element.prototype as any).releasePointerCapture = (Element.prototype as any).releasePointerCapture || (() => {});
(Element.prototype as any).scrollIntoView = (Element.prototype as any).scrollIntoView || (() => {});
// jsdom has no PointerEvent; MouseEvent carries the button/coords semantics Radix checks
(window as any).PointerEvent = (window as any).PointerEvent || MouseEvent;

type Status = ColumnsMenuPrefs["status"];
interface HarnessState {
  saved: ColumnLayout;
  draft: ColumnLayout | null;
  status: Status;
  error: string | null;
  busy: boolean;
}

/** Spies the harness forwards to; `save`/`reset` decide the persisted outcome per test. */
const spy = {
  beginEdit: vi.fn(),
  cancel: vi.fn(),
  setDraft: vi.fn<(layout: ColumnLayout) => void>(),
  save: vi.fn<() => Promise<boolean>>(),
  reset: vi.fn<() => Promise<boolean>>(),
  reload: vi.fn(),
};
/** Lets a test drive the harness state from outside (e.g. finish a reload). */
const control: { set: React.Dispatch<React.SetStateAction<HarnessState>> | null } = { set: null };

const SAVE_ERROR = "Couldn't save columns. Try again.";

function Harness({ initial }: { initial: Partial<HarnessState> }) {
  const [state, setState] = useState<HarnessState>(() => ({
    saved: normalizeColumnLayout(null),
    draft: null,
    status: "ready",
    error: null,
    busy: false,
    ...initial,
  }));
  control.set = setState;

  const api = useMemo(() => {
    const persist = async (action: () => Promise<boolean>, layoutOnSuccess: (draft: ColumnLayout) => ColumnLayout) => {
      setState((p) => ({ ...p, busy: true, error: null }));
      const ok = await action();
      setState((p) => (ok
        ? { ...p, saved: layoutOnSuccess(p.draft ?? p.saved), draft: null, busy: false, error: null }
        : { ...p, busy: false, error: SAVE_ERROR }));
      return ok;
    };
    return {
      beginEdit: () => {
        spy.beginEdit();
        setState((p) => ({ ...p, draft: normalizeColumnLayout(p.saved), error: null }));
      },
      cancel: () => {
        spy.cancel();
        setState((p) => ({ ...p, draft: null, error: null }));
      },
      setDraft: (layout: ColumnLayout) => {
        spy.setDraft(layout);
        setState((p) => (p.draft ? { ...p, draft: normalizeColumnLayout(layout), error: null } : p));
      },
      save: () => persist(spy.save, (d) => d),
      reset: () => persist(spy.reset, () => normalizeColumnLayout(null)),
      reload: () => spy.reload(),
    };
  }, []);

  const prefs: ColumnsMenuPrefs = {
    layout: state.draft ?? state.saved,
    draft: state.draft,
    status: state.status,
    error: state.error,
    busy: state.busy,
    canEdit: state.status === "ready" && !state.busy,
    ...api,
  };
  return <CampaignColumnsMenu prefs={prefs} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const trigger = () => screen.getByRole("button", { name: "Columns" });
const editor = () => screen.getByRole("dialog", { name: "Customize columns" });
const queryEditor = () => screen.queryByRole("dialog", { name: "Customize columns" });

function openMenu() {
  fireEvent.click(trigger());
}

beforeEach(() => {
  for (const fn of Object.values(spy)) fn.mockReset();
  spy.save.mockResolvedValue(true);
  spy.reset.mockResolvedValue(true);
  control.set = null;
});

describe("CampaignColumnsMenu — trigger", () => {
  it.each<Status>(["loading", "idle"])("is disabled while preferences are %s and cannot open", (status) => {
    render(<Harness initial={{ status }} />);
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(queryEditor()).not.toBeInTheDocument();
    expect(spy.beginEdit).not.toHaveBeenCalled();
  });

  it("is enabled when ready, and opening starts an edit session", () => {
    render(<Harness initial={{ status: "ready" }} />);
    expect(trigger()).toBeEnabled();
    openMenu();
    expect(editor()).toBeInTheDocument();
    expect(spy.beginEdit).toHaveBeenCalledTimes(1);
    expect(spy.setDraft).not.toHaveBeenCalled();
    expect(spy.save).not.toHaveBeenCalled();
    expect(spy.reset).not.toHaveBeenCalled();
  });
});

describe("CampaignColumnsMenu — editor contents", () => {
  it("lists Campaign first and Actions last as locked, with every configurable column between", () => {
    render(<Harness initial={{}} />);
    openMenu();
    const items = within(editor()).getAllByRole("listitem");
    expect(items).toHaveLength(DEFAULT_COLUMN_LAYOUT.order.length + 2);

    const first = items[0];
    const last = items[items.length - 1];
    expect(first).toHaveTextContent("Campaign");
    expect(first).toHaveTextContent("(always shown)");
    expect(last).toHaveTextContent("Actions");
    expect(last).toHaveTextContent("(always shown)");
    // Locked rows have no controls at all.
    expect(within(first).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(first).queryByRole("button")).not.toBeInTheDocument();
    expect(within(last).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(last).queryByRole("button")).not.toBeInTheDocument();
    // Campaign / Actions are never offered as configurable.
    expect(within(editor()).queryByRole("checkbox", { name: "Show Campaign" })).not.toBeInTheDocument();
    expect(within(editor()).queryByRole("checkbox", { name: "Show Actions" })).not.toBeInTheDocument();

    const middle = items.slice(1, -1).map((li) => li.getAttribute("data-column-option"));
    expect(middle).toEqual(DEFAULT_COLUMN_LAYOUT.order);
  });

  it("gives every configurable column a Show checkbox reflecting visibility and Move up/down buttons", () => {
    render(<Harness initial={{}} />);
    openMenu();
    const order = DEFAULT_COLUMN_LAYOUT.order;
    const hidden = new Set(DEFAULT_COLUMN_LAYOUT.hidden);
    order.forEach((id, index) => {
      const label = COLUMN_DEFS[id].label;
      const box = within(editor()).getByRole("checkbox", { name: `Show ${label}` });
      expect(box).toHaveAttribute("aria-checked", hidden.has(id) ? "false" : "true");
      const up = within(editor()).getByRole("button", { name: `Move ${label} up` });
      const down = within(editor()).getByRole("button", { name: `Move ${label} down` });
      if (index === 0) expect(up).toBeDisabled();
      else expect(up).toBeEnabled();
      if (index === order.length - 1) expect(down).toBeDisabled();
      else expect(down).toBeEnabled();
    });
    expect(within(editor()).getAllByRole("checkbox")).toHaveLength(order.length);
  });

  it("renders the saved (non-default) layout's order and visibility", () => {
    const saved = normalizeColumnLayout({
      order: ["agents", "status", "progress", "converted", "contacted", "created", "tags", "last_dialed"],
      hidden: ["status", "tags"],
    });
    render(<Harness initial={{ saved }} />);
    openMenu();
    const middle = within(editor()).getAllByRole("listitem").slice(1, -1).map((li) => li.getAttribute("data-column-option"));
    expect(middle).toEqual(saved.order);
    expect(within(editor()).getByRole("checkbox", { name: "Show Status" })).toHaveAttribute("aria-checked", "false");
    expect(within(editor()).getByRole("checkbox", { name: "Show Tags" })).toHaveAttribute("aria-checked", "false");
    expect(within(editor()).getByRole("checkbox", { name: "Show Contacted" })).toHaveAttribute("aria-checked", "true");
    expect(within(editor()).getByRole("button", { name: "Move Agents up" })).toBeDisabled();
    expect(within(editor()).getByRole("button", { name: "Move Last dialed down" })).toBeDisabled();
  });
});

describe("CampaignColumnsMenu — draft edits", () => {
  it("toggling a visible column hides it and toggling a hidden one shows it (via setDraft)", () => {
    render(<Harness initial={{}} />);
    openMenu();
    const base = DEFAULT_COLUMN_LAYOUT;

    fireEvent.click(within(editor()).getByRole("checkbox", { name: "Show Status" }));
    expect(spy.setDraft).toHaveBeenLastCalledWith({ order: base.order, hidden: [...base.hidden, "status"] });
    expect(within(editor()).getByRole("checkbox", { name: "Show Status" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(within(editor()).getByRole("checkbox", { name: "Show Contacted" }));
    const afterStatus = normalizeColumnLayout({ order: base.order, hidden: [...base.hidden, "status"] });
    expect(spy.setDraft).toHaveBeenLastCalledWith({
      order: afterStatus.order,
      hidden: afterStatus.hidden.filter((h) => h !== "contacted"),
    });
    expect(within(editor()).getByRole("checkbox", { name: "Show Contacted" })).toHaveAttribute("aria-checked", "true");

    expect(spy.setDraft).toHaveBeenCalledTimes(2);
    expect(spy.save).not.toHaveBeenCalled();
  });

  it("Move up / Move down swap neighbours and send the reordered layout", () => {
    render(<Harness initial={{}} />);
    openMenu();
    const [c0, c1, c2] = DEFAULT_COLUMN_LAYOUT.order;
    const rest = DEFAULT_COLUMN_LAYOUT.order.slice(3);

    fireEvent.click(within(editor()).getByRole("button", { name: `Move ${COLUMN_DEFS[c1].label} up` }));
    expect(spy.setDraft).toHaveBeenLastCalledWith({ order: [c1, c0, c2, ...rest], hidden: DEFAULT_COLUMN_LAYOUT.hidden });
    let middle = within(editor()).getAllByRole("listitem").slice(1, -1).map((li) => li.getAttribute("data-column-option"));
    expect(middle).toEqual([c1, c0, c2, ...rest]);
    // The new first column cannot move up; the old first one now can.
    expect(within(editor()).getByRole("button", { name: `Move ${COLUMN_DEFS[c1].label} up` })).toBeDisabled();
    expect(within(editor()).getByRole("button", { name: `Move ${COLUMN_DEFS[c0].label} up` })).toBeEnabled();

    fireEvent.click(within(editor()).getByRole("button", { name: `Move ${COLUMN_DEFS[c0].label} down` }));
    expect(spy.setDraft).toHaveBeenLastCalledWith({ order: [c1, c2, c0, ...rest], hidden: DEFAULT_COLUMN_LAYOUT.hidden });
    middle = within(editor()).getAllByRole("listitem").slice(1, -1).map((li) => li.getAttribute("data-column-option"));
    expect(middle).toEqual([c1, c2, c0, ...rest]);
    expect(spy.save).not.toHaveBeenCalled();
  });
});

describe("CampaignColumnsMenu — Save / Cancel / Reset", () => {
  it("Save persists and closes on success", async () => {
    render(<Harness initial={{}} />);
    openMenu();
    fireEvent.click(within(editor()).getByRole("checkbox", { name: "Show Tags" }));
    await act(async () => {
      fireEvent.click(within(editor()).getByRole("button", { name: "Save" }));
    });
    expect(spy.save).toHaveBeenCalledTimes(1);
    expect(spy.cancel).not.toHaveBeenCalled();
    expect(queryEditor()).not.toBeInTheDocument();
  });

  it("Save stays open with the error when persisting fails", async () => {
    spy.save.mockResolvedValue(false);
    render(<Harness initial={{}} />);
    openMenu();
    fireEvent.click(within(editor()).getByRole("checkbox", { name: "Show Tags" }));
    await act(async () => {
      fireEvent.click(within(editor()).getByRole("button", { name: "Save" }));
    });
    expect(spy.save).toHaveBeenCalledTimes(1);
    expect(editor()).toBeInTheDocument();
    expect(within(editor()).getByRole("alert")).toHaveTextContent(SAVE_ERROR);
    // The unsaved draft is still shown and the editor is usable again.
    expect(within(editor()).getByRole("checkbox", { name: "Show Tags" })).toHaveAttribute("aria-checked", "true");
    expect(within(editor()).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(spy.cancel).not.toHaveBeenCalled();
  });

  it("Cancel discards the draft, closes, and never persists", () => {
    render(<Harness initial={{}} />);
    openMenu();
    fireEvent.click(within(editor()).getByRole("checkbox", { name: "Show Status" }));
    fireEvent.click(within(editor()).getByRole("button", { name: "Cancel" }));
    expect(spy.cancel).toHaveBeenCalledTimes(1);
    expect(queryEditor()).not.toBeInTheDocument();
    expect(spy.save).not.toHaveBeenCalled();
    expect(spy.reset).not.toHaveBeenCalled();

    // Re-opening starts a fresh session from the saved layout.
    openMenu();
    expect(spy.beginEdit).toHaveBeenCalledTimes(2);
    expect(within(editor()).getByRole("checkbox", { name: "Show Status" })).toHaveAttribute("aria-checked", "true");
  });

  it("Escape (not busy) closes through cancel", () => {
    render(<Harness initial={{}} />);
    openMenu();
    fireEvent.keyDown(editor(), { key: "Escape" });
    expect(spy.cancel).toHaveBeenCalledTimes(1);
    expect(queryEditor()).not.toBeInTheDocument();
  });

  it("Reset calls reset (not save) and closes on success", async () => {
    render(<Harness initial={{ saved: normalizeColumnLayout({ order: ["tags"], hidden: [] }) }} />);
    openMenu();
    await act(async () => {
      fireEvent.click(within(editor()).getByRole("button", { name: "Reset" }));
    });
    expect(spy.reset).toHaveBeenCalledTimes(1);
    expect(spy.save).not.toHaveBeenCalled();
    expect(queryEditor()).not.toBeInTheDocument();
  });

  it("Reset stays open with the error when it fails", async () => {
    spy.reset.mockResolvedValue(false);
    render(<Harness initial={{}} />);
    openMenu();
    await act(async () => {
      fireEvent.click(within(editor()).getByRole("button", { name: "Reset" }));
    });
    expect(spy.reset).toHaveBeenCalledTimes(1);
    expect(within(editor()).getByRole("alert")).toHaveTextContent(SAVE_ERROR);
  });
});

describe("CampaignColumnsMenu — busy", () => {
  it("disables the whole fieldset, shows Saving…, and blocks Escape / Cancel until the save settles", async () => {
    const pending = deferred<boolean>();
    spy.save.mockImplementation(() => pending.promise);
    render(<Harness initial={{}} />);
    openMenu();
    fireEvent.click(within(editor()).getByRole("button", { name: "Save" }));

    const group = within(editor()).getByRole("group");
    expect(group).toBeDisabled();
    expect(group).toHaveAttribute("aria-busy", "true");
    expect(within(editor()).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(within(editor()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(editor()).getByRole("button", { name: "Reset" })).toBeDisabled();
    for (const box of within(editor()).getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(within(editor()).getByRole("button", { name: "Move Status down" })).toBeDisabled();

    fireEvent.keyDown(editor(), { key: "Escape" });
    fireEvent.click(within(editor()).getByRole("button", { name: "Cancel" }));
    expect(editor()).toBeInTheDocument();
    expect(spy.cancel).not.toHaveBeenCalled();
    // (A second Save click is prevented by the disabled fieldset in real browsers; jsdom still
    // dispatches clicks to fieldset-disabled buttons, so that is pinned via toBeDisabled above.)

    await act(async () => { pending.resolve(true); });
    expect(queryEditor()).not.toBeInTheDocument();
    expect(spy.save).toHaveBeenCalledTimes(1);
  });
});

describe("CampaignColumnsMenu — load error", () => {
  it("shows the error message and a Retry that calls reload (no edit session, no write)", () => {
    render(<Harness initial={{ status: "error", error: "Couldn't load saved columns." }} />);
    expect(trigger()).toBeEnabled();
    openMenu();
    expect(within(editor()).getByRole("alert")).toHaveTextContent("Couldn't load saved columns.");
    expect(within(editor()).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(spy.beginEdit).not.toHaveBeenCalled();

    fireEvent.click(within(editor()).getByRole("button", { name: "Retry" }));
    expect(spy.reload).toHaveBeenCalledTimes(1);
    expect(spy.save).not.toHaveBeenCalled();
    expect(spy.reset).not.toHaveBeenCalled();
    expect(spy.setDraft).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the error text is missing", () => {
    render(<Harness initial={{ status: "error", error: null }} />);
    openMenu();
    expect(within(editor()).getByRole("alert")).toHaveTextContent("Couldn't load saved columns.");
  });

  // Regression: after Retry succeeds while the popover is open, editing starts without reopening.
  it("after a successful Retry the open editor becomes usable without closing and reopening", () => {
    render(<Harness initial={{ status: "error", error: "Couldn't load saved columns." }} />);
    openMenu();
    spy.reload.mockImplementation(() => control.set?.((p) => ({ ...p, status: "loading", error: null })));
    fireEvent.click(within(editor()).getByRole("button", { name: "Retry" }));
    act(() => control.set?.((p) => ({ ...p, status: "ready" })));
    expect(within(editor()).queryByText("Loading…")).not.toBeInTheDocument();
    expect(within(editor()).getByRole("checkbox", { name: "Show Status" })).toBeInTheDocument();
  });
});
