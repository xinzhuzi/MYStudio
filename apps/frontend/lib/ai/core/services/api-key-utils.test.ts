import { describe, expect, it } from "vitest";
import { getApiKeyCount, maskApiKey, parseApiKeys } from "./api-key-utils";

describe("parseApiKeys(多 key 切分)", () => {
  it("既有口径回归:半角/全角逗号顿号分号与换行均可切", () => {
    expect(parseApiKeys("k1,k2，k3、k4;k5；k6\nk7")).toEqual([
      "k1", "k2", "k3", "k4", "k5", "k6", "k7",
    ]);
  });

  it("空串/纯分隔符返回空数组", () => {
    expect(parseApiKeys("")).toEqual([]);
    expect(parseApiKeys(",,，、;; \t")).toEqual([]);
  });

  it("1021 修复锚:全角空格/空格/Tab 作分隔也切开(1013 只收编逗号族的补刀)", () => {
    // 病灶实录:sk-a␀sk-b(U+3000 全角空格)切不开→整串进 Bearer→Headers.set
    // 抛「非 ISO-8859-1」(fanren/mikoto/ikun 三渠道 4 行实弹失败根因)
    expect(parseApiKeys("sk-a\u3000sk-b")).toEqual(["sk-a", "sk-b"]);
    expect(parseApiKeys("sk-a sk-b\t sk-c")).toEqual(["sk-a", "sk-b", "sk-c"]);
  });

  it("零宽不可见字符整串剥离(隐形粘贴污染不当分隔,只做清除)", () => {
    expect(parseApiKeys("sk-\u200bx,k2")).toEqual(["sk-x", "k2"]);
    expect(parseApiKeys("sk-\ufeffx")).toEqual(["sk-x"]);
  });

  it("段内含非可打印 ASCII 的段=无效 key 剔除(1021 实弹反证后反转:带中文注记的段进 Bearer 必炸 Headers)", () => {
    // 实锤:1020-21 两轮装机实弹 totalKeys=2 每段皆炸——段内含中文/全角即垃圾段
    expect(parseApiKeys("sk-abc（备用）")).toEqual([]);
    expect(parseApiKeys("sk-good,sk-坏key")).toEqual(["sk-good"]);
    expect(parseApiKeys("sk-a\u3000sk-b")).toEqual(["sk-a", "sk-b"]); // 分隔位全角空格仍切
  });

  it("getApiKeyCount 与 parseApiKeys 同口径", () => {
    expect(getApiKeyCount("k1 k2\u3000k3")).toBe(3);
    expect(getApiKeyCount("")).toBe(0);
    expect(getApiKeyCount("sk-real,sk-abc（备用）")).toBe(1);
    expect(getApiKeyCount("sk-abc（备用）sk-real")).toBe(0); // 无分隔时含中文整段=垃圾段
  });
});

describe("maskApiKey", () => {
  it("短 key 前4+***,长 key 首8…尾4", () => {
    expect(maskApiKey("abcd")).toBe("abcd***");
    expect(maskApiKey("abcdefgh")).toBe("abcd***");
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-12345...cdef");
    expect(maskApiKey("")).toBe("未设置");
  });
});
