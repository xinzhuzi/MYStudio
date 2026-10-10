// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DIRECTOR_PREFERENCE_CATEGORIES,
  DIRECTOR_PREFERENCE_MAX_CHARS,
  DIRECTOR_PREFERENCE_STORAGE_KEY,
  DIRECTOR_PREFERENCE_TEMPLATE,
  formatDirectorPreferenceContext,
  readDirectorPreference,
} from "./director-preference";

describe("readDirectorPreference", () => {
  afterEach(() => {
    delete (window as unknown as { fileStorage?: unknown }).fileStorage;
  });

  it("无桥/异常/空值 → 空串（零注入零阻断）", async () => {
    expect(await readDirectorPreference()).toBe("");
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async () => {
        throw new Error("boom");
      },
    };
    expect(await readDirectorPreference()).toBe("");
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async () => null,
    };
    expect(await readDirectorPreference()).toBe("");
  });

  it("新键为空时回退读旧键（author-preference 时代一次性迁移）", async () => {
    const reads: string[] = [];
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async (key: string) => {
        reads.push(key);
        return key === "author-preference.md" ? "  旧卡内容  \n" : null;
      },
    };
    expect(await readDirectorPreference()).toBe("旧卡内容");
    expect(reads).toContain("director-preference.md");
    expect(reads).toContain("author-preference.md");
  });

  it("新键优先于旧键", async () => {
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async (key: string) => (key === "director-preference.md" ? "新卡" : "旧卡不应被读到"),
    };
    expect(await readDirectorPreference()).toBe("新卡");
  });

  it("经 file-storage 应用级键读取，读取时 trim", async () => {
    const getItem = async (key: string) =>
      key === DIRECTOR_PREFERENCE_STORAGE_KEY ? "  快节奏强爽感  \n" : null;
    expect(await readDirectorPreference({ getItem })).toBe("快节奏强爽感");
    expect(DIRECTOR_PREFERENCE_STORAGE_KEY).toBe("director-preference.md");
  });
});

describe("formatDirectorPreferenceContext", () => {
  it("剥模板 H1 换固定优先级头；空文本零注入", () => {
    expect(formatDirectorPreferenceContext("")).toBe("");
    expect(formatDirectorPreferenceContext("   ")).toBe("");
    const formatted = formatDirectorPreferenceContext("# 导演偏好\n\n## 改编口味\n快节奏\n");
    expect(formatted).toContain("# 导演偏好（导演决策原则·全项目生效·与正文冲突时事实以正文为准）");
    expect(formatted).toContain("## 改编口味");
    expect(formatted).not.toMatch(/^# 导演偏好\n/);
  });

  it("模板四分类齐全（md 式 H2 + `- ` 条目）且上限 2000", () => {
    expect(DIRECTOR_PREFERENCE_TEMPLATE).toContain("## 改编原则");
    expect(DIRECTOR_PREFERENCE_TEMPLATE).toContain("## 叙事手法");
    expect(DIRECTOR_PREFERENCE_TEMPLATE).toContain("## 视听语言");
    expect(DIRECTOR_PREFERENCE_TEMPLATE).toContain("## 创作红线");
    expect(DIRECTOR_PREFERENCE_TEMPLATE).toContain("\n- ");
    expect(DIRECTOR_PREFERENCE_CATEGORIES).toEqual(["改编原则", "叙事手法", "视听语言", "创作红线"]);
    expect(DIRECTOR_PREFERENCE_MAX_CHARS).toBe(2000);
  });
});
