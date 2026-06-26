import {
  DEFAULT_DEEPGRAM_LLM,
  isAllowedDeepgramLlmSelection,
  normalizeDeepgramLlmSelection,
  parseDeepgramLlmSelection,
} from "@/lib/aiTestingDeepgramModels";

describe("aiTestingDeepgramModels", () => {
  it("parses legacy raw OpenAI model ids", () => {
    expect(parseDeepgramLlmSelection("gpt-4o-mini")).toEqual({
      provider: "open_ai",
      model: "gpt-4o-mini",
      tier: "Standard",
    });
    expect(parseDeepgramLlmSelection("gpt-4o")).toEqual({
      provider: "open_ai",
      model: "gpt-4o",
      tier: "Advanced",
    });
  });

  it("parses exact composite provider:model ids", () => {
    expect(parseDeepgramLlmSelection("anthropic:claude-4-5-haiku")).toEqual({
      provider: "anthropic",
      model: "claude-4-5-haiku",
      tier: "Standard",
    });
    expect(parseDeepgramLlmSelection("google:gemini-2.5-flash")).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
      tier: "Standard",
    });
  });

  it("falls back for unknown providers", () => {
    expect(parseDeepgramLlmSelection("nvidia:nemotron")).toEqual({
      provider: "open_ai",
      model: "gpt-4o-mini",
      tier: "Standard",
    });
  });

  it("falls back for known provider with unknown model", () => {
    expect(parseDeepgramLlmSelection("anthropic:bad-model")).toEqual({
      provider: "open_ai",
      model: "gpt-4o-mini",
      tier: "Standard",
    });
    expect(parseDeepgramLlmSelection("google:bad-model")).toEqual({
      provider: "open_ai",
      model: "gpt-4o-mini",
      tier: "Standard",
    });
    expect(parseDeepgramLlmSelection("open_ai:bad-model")).toEqual({
      provider: "open_ai",
      model: "gpt-4o-mini",
      tier: "Standard",
    });
  });

  it("normalizes legacy values to composite catalog ids", () => {
    expect(normalizeDeepgramLlmSelection("gpt-4o")).toBe("open_ai:gpt-4o");
    expect(normalizeDeepgramLlmSelection("open_ai:gpt-4o-mini")).toBe(DEFAULT_DEEPGRAM_LLM);
  });

  it("allows catalog composites and legacy OpenAI raw ids", () => {
    expect(isAllowedDeepgramLlmSelection("anthropic:claude-sonnet-4-6")).toBe(true);
    expect(isAllowedDeepgramLlmSelection("gpt-4o-mini")).toBe(true);
    expect(isAllowedDeepgramLlmSelection("groq:llama")).toBe(false);
    expect(isAllowedDeepgramLlmSelection("anthropic:bad-model")).toBe(false);
  });
});
