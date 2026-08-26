import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Logo from "./Logo";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

afterEach(cleanup);

const publicAsset = (file: string) =>
  readFileSync(path.resolve(__dirname, "../../../public", file), "utf8");

const viewBox = (svg: string) => {
  const raw = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!raw) throw new Error("no viewBox");
  const [, , w, h] = raw.trim().split(/\s+/).map(Number);
  return { w, h, aspect: w / h };
};

describe("Logo", () => {
  it("renders the full variant as the wordmark only", () => {
    const { container } = render(<Logo variant="full" themeOverride="light" />);

    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByAltText("AgentFlow")).toHaveAttribute("src", "/agentflow-wordmark.svg");
    expect(container.querySelector('img[src="/agentflow-icon.svg"]')).toBeNull();
  });

  it("renders the text variant as the wordmark only", () => {
    const { container } = render(<Logo variant="text" themeOverride="light" />);

    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByAltText("AgentFlow")).toHaveAttribute("src", "/agentflow-wordmark.svg");
  });

  it("renders the icon variant as the standalone mark only", () => {
    const { container } = render(<Logo variant="icon" />);

    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByAltText("AgentFlow")).toHaveAttribute("src", "/agentflow-icon.svg");
    expect(container.querySelector('img[src*="wordmark"]')).toBeNull();
  });

  it("uses the dark wordmark when the dark theme is forced", () => {
    render(<Logo variant="full" themeOverride="dark" />);

    expect(screen.getByAltText("AgentFlow")).toHaveAttribute(
      "src",
      "/agentflow-wordmark-on-dark.svg",
    );
  });

  it("does not cap the wordmark at a fixed pixel width", () => {
    // The approved wordmark is ~12.9:1. A fixed max-width (the old `max-w-[200px]`)
    // silently shrinks it below the intended cap height wherever it is rendered.
    render(<Logo variant="full" themeOverride="light" />);
    const className = screen.getByAltText("AgentFlow").className;

    expect(className).toContain("max-w-full");
    expect(className).not.toMatch(/max-w-\[\d+px\]/);
    expect(className).toContain("object-contain");
  });
});

describe("Logo artwork", () => {
  it("ships a wide boxy wordmark matching the approved proportions", () => {
    for (const file of ["agentflow-wordmark.svg", "agentflow-wordmark-on-dark.svg"]) {
      const svg = publicAsset(file);
      // Approved reference ink box is 775 x 60 -> 12.93:1. The narrow letterforms
      // this hotfix replaces measured 6.48:1.
      expect(viewBox(svg).aspect).toBeGreaterThan(12);
      expect(svg).not.toContain("<text");
      expect(svg).not.toContain("<image");
    }
  });

  it("splits AGENT and FLOW into the approved flat colours", () => {
    const light = publicAsset("agentflow-wordmark.svg");
    expect(light).toContain("#0B1220");
    expect(light).toContain("#3B82F6");

    const dark = publicAsset("agentflow-wordmark-on-dark.svg");
    expect(dark).toContain("#F8FAFC");
    expect(dark).toContain("#3B82F6");
    expect(dark).not.toContain("#0B1220");

    for (const svg of [light, dark]) {
      expect(svg).not.toContain("Gradient");
    }
  });

  it("ships the icon as the standalone blue A with no container", () => {
    const svg = publicAsset("agentflow-icon.svg");
    const box = viewBox(svg);

    expect(box.w).toBe(box.h); // square, for favicon / app-icon use
    expect(svg).toContain("#3B82F6");
    expect(svg.match(/<path/g)).toHaveLength(1); // the A, nothing else
    expect(svg).not.toContain("<rect");
    expect(svg).not.toContain("<circle");
    expect(svg).not.toMatch(/(background|fill)="#(0B1220|FFFFFF|fff)"/i);
  });
});
