import { describe, expect, it } from "vitest";
import { resolveProductAutoFill } from "./product-autofill";

const sourceA = {
  description: "产品 A 的描述",
  topics: "#漫剧 #剧情解说",
  utmBaseUrl: "https://a.example.com",
};

const sourceB = {
  description: "产品 B 的描述",
  topics: "",
  utmBaseUrl: "https://b.example.com",
};

describe("resolveProductAutoFill (A7/A8 不丢稿填充)", () => {
  it("fills empty fields from the selected product", () => {
    const { values, applied } = resolveProductAutoFill({
      source: sourceA,
      current: { description: "", topics: "", utmBaseUrl: "" },
      lastApplied: {},
    });
    expect(values).toEqual({ description: sourceA.description, topics: sourceA.topics, utmBaseUrl: sourceA.utmBaseUrl });
    expect(applied).toEqual(values);
  });

  it("keeps user-written content untouched and does not claim it", () => {
    const { values, applied } = resolveProductAutoFill({
      source: sourceA,
      current: { description: "我自己写的稿", topics: "#自带话题", utmBaseUrl: "https://mine.example.com" },
      lastApplied: {},
    });
    expect(values).toEqual({});
    expect(applied).toEqual({});
  });

  it("replaces a field that still equals the previous auto-filled value", () => {
    const { values, applied } = resolveProductAutoFill({
      source: sourceB,
      current: { description: sourceA.description, topics: sourceA.topics, utmBaseUrl: sourceA.utmBaseUrl },
      lastApplied: { description: sourceA.description, topics: sourceA.topics, utmBaseUrl: sourceA.utmBaseUrl },
    });
    expect(values).toEqual({ description: sourceB.description, topics: "", utmBaseUrl: sourceB.utmBaseUrl });
    expect(applied).toEqual(values);
  });

  it("clears a stale auto-filled topics string when the new product has no default tags (A8 残留修复)", () => {
    const { values } = resolveProductAutoFill({
      source: sourceB,
      current: { description: "用户改过的描述", topics: sourceA.topics },
      lastApplied: { topics: sourceA.topics },
    });
    expect(values).toEqual({ topics: "" });
  });

  it("only replaces the edited-away fields when switching products after manual edits", () => {
    // 用户改了描述,但话题仍是上次自动填入的
    const { values, applied } = resolveProductAutoFill({
      source: sourceB,
      current: { description: "先手写的描述", topics: sourceA.topics, utmBaseUrl: "" },
      lastApplied: { description: sourceA.description, topics: sourceA.topics, utmBaseUrl: sourceA.utmBaseUrl },
    });
    expect(values).toEqual({ topics: sourceB.topics, utmBaseUrl: sourceB.utmBaseUrl });
    expect(values.description).toBeUndefined();
    // 未写入字段的自动填入记录保持不变
    expect(applied.description).toBe(sourceA.description);
    expect(applied.topics).toBe(sourceB.topics);
  });

  it("clears only still-auto-filled fields when association is removed (取消关联)", () => {
    const { values, applied } = resolveProductAutoFill({
      source: null,
      current: { description: sourceA.description, topics: "用户改过的话题", utmBaseUrl: sourceA.utmBaseUrl },
      lastApplied: { description: sourceA.description, topics: sourceA.topics, utmBaseUrl: sourceA.utmBaseUrl },
    });
    expect(values).toEqual({ description: "", utmBaseUrl: "" });
    expect(values.topics).toBeUndefined();
    expect(applied).toEqual({ description: "", topics: sourceA.topics, utmBaseUrl: "" });
  });

  it("refills a cleared field on the next product selection after un-association", () => {
    const cleared = resolveProductAutoFill({
      source: null,
      current: { description: sourceA.description, topics: sourceA.topics, utmBaseUrl: sourceA.utmBaseUrl },
      lastApplied: { description: sourceA.description, topics: sourceA.topics, utmBaseUrl: sourceA.utmBaseUrl },
    });
    const refilled = resolveProductAutoFill({
      source: sourceB,
      current: { description: cleared.values.description, topics: cleared.values.topics, utmBaseUrl: cleared.values.utmBaseUrl },
      lastApplied: cleared.applied,
    });
    expect(refilled.values).toEqual({ description: sourceB.description, topics: sourceB.topics, utmBaseUrl: sourceB.utmBaseUrl });
  });

  it("treats whitespace-only fields as empty", () => {
    const { values } = resolveProductAutoFill({
      source: sourceA,
      current: { description: "   " },
      lastApplied: {},
    });
    expect(values).toEqual({ description: sourceA.description });
  });

  it("processes only the fields present in current (批量页不含落地页)", () => {
    const { values, applied } = resolveProductAutoFill({
      source: sourceA,
      current: { topics: "" },
      lastApplied: {},
    });
    expect(values).toEqual({ topics: sourceA.topics });
    expect(Object.keys(applied)).toEqual(["topics"]);
  });
});
