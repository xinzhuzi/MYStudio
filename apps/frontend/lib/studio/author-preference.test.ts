// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTHOR_PREFERENCE_MAX_CHARS,
  AUTHOR_PREFERENCE_STORAGE_KEY,
  AUTHOR_PREFERENCE_TEMPLATE,
  formatAuthorPreferenceContext,
  readAuthorPreference,
} from "./author-preference";

describe("readAuthorPreference", () => {
  afterEach(() => {
    delete (window as unknown as { fileStorage?: unknown }).fileStorage;
  });

  it("无桥/异常/空值 → 空串（零注入零阻断）", async () => {
    expect(await readAuthorPreference()).toBe("");
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async () => {
        throw new Error("boom");
      },
    };
    expect(await readAuthorPreference()).toBe("");
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async () => null,
    };
    expect(await readAuthorPreference()).toBe("");
  });

  it("经 file-storage 应用级键读取，读取时 trim", async () => {
    const getItem = async (key: string) =>
      key === AUTHOR_PREFERENCE_STORAGE_KEY ? "  快节奏强爽感  \n" : null;
    expect(await readAuthorPreference({ getItem })).toBe("快节奏强爽感");
    expect(AUTHOR_PREFERENCE_STORAGE_KEY).toBe("author-preference.md");
  });
});

describe("formatAuthorPreferenceContext", () => {
  it("剥模板 H1 换固定优先级头；空文本零注入", () => {
    expect(formatAuthorPreferenceContext("")).toBe("");
    expect(formatAuthorPreferenceContext("   ")).toBe("");
    const formatted = formatAuthorPreferenceContext("# 作者偏好\n\n## 改编口味\n快节奏\n");
    expect(formatted).toContain("# 作者偏好（改编口味·全项目生效·与正文冲突时事实以正文为准）");
    expect(formatted).toContain("## 改编口味");
    expect(formatted).not.toMatch(/^# 作者偏好\n/);
  });

  it("模板三段齐全且上限 2000", () => {
    expect(AUTHOR_PREFERENCE_TEMPLATE).toContain("## 改编口味");
    expect(AUTHOR_PREFERENCE_TEMPLATE).toContain("## 叙事偏好");
    expect(AUTHOR_PREFERENCE_TEMPLATE).toContain("## 口味雷点");
    expect(AUTHOR_PREFERENCE_MAX_CHARS).toBe(2000);
  });
});
