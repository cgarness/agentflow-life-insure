import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Link, MemoryRouter, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useUnsavedNavigationGuard } from "../useUnsavedNavigationGuard";

function Harness({ active }: { active: boolean }) {
  const guard = useUnsavedNavigationGuard(active);
  const navigate = useNavigate();
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  return (
    <div>
      <span data-testid="where">{location.pathname + location.search}</span>
      <span data-testid="blocked">{String(guard.blocked)}</span>
      <button onClick={() => navigate("/dashboard")}>navigate</button>
      <button onClick={() => setSearchParams({ section: "my-profile" })}>section</button>
      <Link to="/resources">sidebar link</Link>
      <button onClick={guard.confirm}>leave</button>
      <button onClick={guard.cancel}>stay</button>
    </div>
  );
}

const where = () => screen.getByTestId("where").textContent;
const blocked = () => screen.getByTestId("blocked").textContent;
const renderAt = (active: boolean) =>
  render(
    <MemoryRouter initialEntries={["/settings?section=commission-grids"]}>
      <Harness active={active} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("useUnsavedNavigationGuard", () => {
  it("holds in-app navigation until the person chooses Leave", () => {
    renderAt(true);
    fireEvent.click(screen.getByText("navigate"));
    expect(where()).toBe("/settings?section=commission-grids");
    expect(blocked()).toBe("true");
    fireEvent.click(screen.getByText("stay"));
    expect(blocked()).toBe("false");
    expect(where()).toBe("/settings?section=commission-grids");
    fireEvent.click(screen.getByText("navigate"));
    fireEvent.click(screen.getByText("leave"));
    expect(where()).toBe("/dashboard");
  });

  it("holds settings-section changes and sidebar links", () => {
    renderAt(true);
    fireEvent.click(screen.getByText("section"));
    expect(where()).toBe("/settings?section=commission-grids");
    fireEvent.click(screen.getByText("leave"));
    expect(where()).toBe("/settings?section=my-profile");
    cleanup();
    renderAt(true);
    fireEvent.click(screen.getByText("sidebar link"));
    expect(blocked()).toBe("true");
    fireEvent.click(screen.getByText("leave"));
    expect(where()).toBe("/resources");
  });

  it("does nothing while there are no unsaved changes", () => {
    renderAt(false);
    fireEvent.click(screen.getByText("navigate"));
    expect(where()).toBe("/dashboard");
    expect(blocked()).toBe("false");
  });

  it("asks the browser to confirm reload or close only while active", () => {
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    renderAt(true);
    expect(unload()).toBe(true);
    cleanup();
    renderAt(false);
    expect(unload()).toBe(false);
  });

  it("returns the browser to the editor on Back and only leaves after Leave", async () => {
    window.history.replaceState(null, "", "/start");
    const { rerender } = render(
      <BrowserRouter>
        <Harness active={false} />
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByText("sidebar link")); // /resources becomes the "editor" entry
    expect(where()).toBe("/resources");
    rerender(
      <BrowserRouter>
        <Harness active />
      </BrowserRouter>,
    );
    act(() => window.history.back());
    await waitFor(() => expect(blocked()).toBe("true"));
    await waitFor(() => expect(window.location.pathname).toBe("/resources"));
    expect(where()).toBe("/resources");
    fireEvent.click(screen.getByText("leave"));
    await waitFor(() => expect(where()).toBe("/start"));
  });
});
