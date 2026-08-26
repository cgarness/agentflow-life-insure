import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Logo from "./Logo";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

afterEach(cleanup);

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
});
