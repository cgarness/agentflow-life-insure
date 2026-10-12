/**
 * Training resource card meta line (Part B, B7-17).
 *
 * The card used to render `file_size || duration || "5 min"`. The app's own writers never set
 * either column, so every app-created card claimed a fabricated "5 min". The meta line now renders
 * only when a recorded value exists, and shows that value unchanged when it does.
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ResourceCard from "../ResourceCard";
import type { ResourceType, TrainingResource } from "@/types/training";

afterEach(cleanup);

const CATEGORY = "Synthetic Category";

const resource = (over: Partial<TrainingResource> & { type: ResourceType }): TrainingResource => ({
  id: "res-1",
  organization_id: "org-synthetic",
  category_name: CATEGORY,
  title: "Synthetic resource",
  description: "Synthetic description",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const renderCard = (r: TrainingResource) =>
  render(<ResourceCard resource={r} onClick={vi.fn()} isAdmin={false} />);

/** The meta line is the element rendered directly after the category badge. */
const metaLine = () => screen.getByText(CATEGORY).nextElementSibling;

describe("ResourceCard meta line", () => {
  it.each<ResourceType>(["video", "script", "document"])(
    "renders no meta line and no fabricated '5 min' for a %s with neither duration nor file size",
    (type) => {
      const { container } = renderCard(resource({ type }));

      expect(metaLine()).toBeNull();
      expect(screen.queryByText(/5 min/)).toBeNull();
      expect(container.textContent ?? "").not.toContain("5 min");
      // The rest of the card is unchanged.
      expect(screen.getByText("Synthetic resource")).toBeTruthy();
      expect(screen.getByText(type.toUpperCase())).toBeTruthy();
    },
  );

  it("shows the recorded file size when present", () => {
    renderCard(resource({ type: "document", file_size: "2.4 MB" }));

    expect(metaLine()?.textContent).toBe("2.4 MB");
    expect(screen.queryByText(/5 min/)).toBeNull();
  });

  it("shows the recorded duration when present", () => {
    renderCard(resource({ type: "video", duration: "12:30" }));

    expect(metaLine()?.textContent).toBe("12:30");
    expect(screen.queryByText(/5 min/)).toBeNull();
  });

  it("keeps preferring the file size over the duration when both are recorded", () => {
    renderCard(resource({ type: "document", file_size: "1.1 MB", duration: "3:00" }));

    expect(metaLine()?.textContent).toBe("1.1 MB");
  });
});
