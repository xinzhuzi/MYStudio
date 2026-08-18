import { describe, expect, it } from "vitest";
import { normalizeStoredJson, prettyJson } from "./pretty-json";

describe("prettyJson", () => {
  it("formats values as indent-2 multi-line JSON with trailing newline", () => {
    expect(prettyJson({ state: { a: 1 }, version: 2 })).toBe(
      '{\n  "state": {\n    "a": 1\n  },\n  "version": 2\n}\n',
    );
  });
});

describe("normalizeStoredJson", () => {
  it("pretty-prints compact JSON objects and arrays", () => {
    expect(normalizeStoredJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
    expect(normalizeStoredJson("[1]")).toBe("[\n  1\n]\n");
  });

  it("returns non-JSON text, scalars, and broken JSON verbatim", () => {
    expect(normalizeStoredJson("# README\n")).toBe("# README\n");
    expect(normalizeStoredJson("42")).toBe("42");
    expect(normalizeStoredJson('{"broken":')).toBe('{"broken":');
    expect(normalizeStoredJson("")).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeStoredJson('{"a":1}');
    expect(normalizeStoredJson(once)).toBe(once);
  });
});
