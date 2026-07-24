import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanArray,
  cleanJsonString,
  extractJson,
  normalizeIds,
  safeParseJson,
} from "./json-cleaner";

describe("json cleaner helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts fenced objects and arrays from surrounding text", () => {
    expect(cleanJsonString('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
    expect(cleanJsonString('prefix\n[{"id":1}]\nsuffix')).toBe('[{"id":1}]');
    expect(cleanJsonString("")).toBe("{}");
  });

  it("parses cleaned JSON and returns the fallback on malformed input", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(safeParseJson<{ ok: boolean }>('```json\n{"ok":true}\n```', { ok: false })).toEqual({
      ok: true,
    });
    expect(safeParseJson("not json", { ok: false })).toEqual({ ok: false });
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("normalizes present numeric ids while preserving the empty fallback for missing and zero ids", () => {
    expect(normalizeIds([{ id: 12, name: "scene" }, { id: 0 }, { name: "missing" }])).toEqual([
      { id: "12", name: "scene" },
      { id: "" },
      { id: "", name: "missing" },
    ]);
  });

  it("cleans arrays with optional item validation", () => {
    const isNamed = (value: unknown): value is { name: string } =>
      typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string";

    expect(cleanArray([{ name: "a" }, { id: 1 }], isNamed)).toEqual([{ name: "a" }]);
    expect(cleanArray([{ name: "a" }])).toEqual([{ name: "a" }]);
    expect(cleanArray("not-array")).toEqual([]);
  });

  it("extracts the first JSON-looking object or array and returns null otherwise", () => {
    expect(extractJson("before {\"id\":1} after")).toBe('{"id":1}');
    expect(extractJson("before [1,2] after")).toBe("[1,2]");
    expect(extractJson("no structured payload")).toBeNull();
  });
});
