// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUtmUrl, copyUtmToClipboard } from "./utm";

describe("buildUtmUrl", () => {
  it("appends source/medium/campaign to a bare base URL", () => {
    const url = buildUtmUrl("https://example.com/", { source: "xhs", medium: "social", campaign: "launch" });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://example.com");
    expect(parsed.searchParams.get("utm_source")).toBe("xhs");
    expect(parsed.searchParams.get("utm_medium")).toBe("social");
    expect(parsed.searchParams.get("utm_campaign")).toBe("launch");
  });

  it("percent-encodes non-ASCII and reserved characters (转义)", () => {
    const url = buildUtmUrl("https://example.com/promo", {
      source: "小红书",
      medium: "social",
      campaign: "双11 大促&首发",
      content: "标题 中的空格",
    });
    // 输出里不允许出现裸中文/裸 & /裸空格
    expect(url).not.toMatch(/[\u4e00-\u9fff]/);
    expect(url.split("?")[1]).not.toContain(" ");

    const parsed = new URL(url);
    expect(parsed.searchParams.get("utm_source")).toBe("小红书");
    expect(parsed.searchParams.get("utm_campaign")).toBe("双11 大促&首发");
    expect(parsed.searchParams.get("utm_content")).toBe("标题 中的空格");
  });

  it("round-trips an exact encoded form for a CJK source", () => {
    expect(buildUtmUrl("https://example.com/", { source: "小红书", medium: "social", campaign: "launch" })).toBe(
      "https://example.com/?utm_source=%E5%B0%8F%E7%BA%A2%E4%B9%A6&utm_medium=social&utm_campaign=launch",
    );
  });

  it("keeps existing non-utm query params and the hash, and overrides same-name utm params", () => {
    const url = buildUtmUrl("https://example.com/p?utm_source=old&keep=1#section", {
      source: "new",
      medium: "social",
      campaign: "launch",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("utm_source")).toBe("new");
    expect(parsed.searchParams.get("keep")).toBe("1");
    expect(parsed.hash).toBe("#section");
    expect(parsed.pathname).toBe("/p");
  });

  it("omits utm_content when it is missing or empty (空值)", () => {
    const without = buildUtmUrl("https://example.com/", { source: "xhs", medium: "social", campaign: "launch" });
    expect(new URL(without).searchParams.has("utm_content")).toBe(false);

    const empty = buildUtmUrl("https://example.com/", { source: "xhs", medium: "social", campaign: "launch", content: "" });
    expect(new URL(empty).searchParams.has("utm_content")).toBe(false);
  });

  it("returns an invalid base URL unchanged instead of throwing", () => {
    for (const bad of ["", "not-a-url", "/relative/path"]) {
      expect(buildUtmUrl(bad, { source: "xhs", medium: "social", campaign: "launch" })).toBe(bad);
    }
  });
});

describe("copyUtmToClipboard", () => {
  beforeEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
    document.body.innerHTML = "";
  });

  it("uses the Clipboard API first and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await expect(copyUtmToClipboard("https://example.com/?utm_source=xhs")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.com/?utm_source=xhs");
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

    await expect(copyUtmToClipboard("https://example.com/?utm_source=xhs")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    // 降级路径用完即清,不在 body 里留 textarea
    expect(document.body.querySelector("textarea")).toBeNull();
  });

  it("returns false when neither clipboard nor execCommand exists (jsdom 裸环境)", async () => {
    await expect(copyUtmToClipboard("https://example.com/")).resolves.toBe(false);
  });
});
