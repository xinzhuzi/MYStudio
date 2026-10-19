import { describe, expect, it } from "vitest";
import {
  sanitizeAssetFolderName,
  sanitizeAssetFolderNameDetailed,
  usesAssetNameFolder,
} from "./assets-sqlite";

/** sanitizeAssetFolderName 单一真源契约(10-19-asset-name-folders design §2):
 * 1) trim;2) 非法字符 [/\\:*?"<>|]→_ 并去控制字符;3) 去首尾空格与点号;
 * 4) Windows 保留名(大小写不敏感)尾缀 _;5) 截断至 ≤80 字符且 UTF-8 ≤240 字节(逐码点回退);
 * 6) 空结果兜底「未命名」。truncated 供迁移/改名链路落 anomalies 台账(design §2 第5条)。 */

describe("sanitizeAssetFolderName(design §2 契约)", () => {
  it("常规中文名/字母数字名原样通过", () => {
    expect(sanitizeAssetFolderName("晏燎")).toBe("晏燎");
    expect(sanitizeAssetFolderName("道口镇_夜景")).toBe("道口镇_夜景");
    expect(sanitizeAssetFolderName("Hero-01")).toBe("Hero-01");
  });

  it("空串/纯空白/纯控制字符兜底「未命名」", () => {
    expect(sanitizeAssetFolderName("")).toBe("未命名");
    expect(sanitizeAssetFolderName("   ")).toBe("未命名");
    expect(sanitizeAssetFolderName("\u0001\u0002\u007f")).toBe("未命名");
  });

  it("纯非法字符全部替换为下划线(不落空)", () => {
    expect(sanitizeAssetFolderName("///")).toBe("___");
    // [/\\:*?"<>|] 共 9 个非法字符全替 _
    expect(sanitizeAssetFolderName('\\/:*?"<>|')).toBe("_________");
  });

  it("非法字符混合名逐字符替换", () => {
    expect(sanitizeAssetFolderName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("内嵌控制字符被去除而非替换", () => {
    expect(sanitizeAssetFolderName("晏\u0001燎")).toBe("晏燎");
    expect(sanitizeAssetFolderName("王也\u0007的剑")).toBe("王也的剑");
    expect(sanitizeAssetFolderName("a\tb\nc")).toBe("abc");
  });

  it("Windows 保留名(大小写不敏感)尾缀下划线;非精确保留名不动", () => {
    expect(sanitizeAssetFolderName("CON")).toBe("CON_");
    expect(sanitizeAssetFolderName("con")).toBe("con_");
    expect(sanitizeAssetFolderName("com1")).toBe("com1_");
    expect(sanitizeAssetFolderName("LPT9")).toBe("LPT9_");
    expect(sanitizeAssetFolderName("PRN")).toBe("PRN_");
    expect(sanitizeAssetFolderName("AUX")).toBe("AUX_");
    expect(sanitizeAssetFolderName("NUL")).toBe("NUL_");
    // 前缀命中但非精确保留名:不改
    expect(sanitizeAssetFolderName("CONSOLE")).toBe("CONSOLE");
    expect(sanitizeAssetFolderName("com10")).toBe("com10");
  });

  it("去首尾空格与点号(Windows 致命的尾点/尾空格形态)", () => {
    expect(sanitizeAssetFolderName(" 晏燎 ")).toBe("晏燎");
    expect(sanitizeAssetFolderName("晏燎.")).toBe("晏燎");
    expect(sanitizeAssetFolderName(".晏燎")).toBe("晏燎");
    expect(sanitizeAssetFolderName(" 晏燎 . ")).toBe("晏燎");
  });

  it("超长名截断至 80 字符并标记 truncated", () => {
    const long = "A".repeat(100);
    const result = sanitizeAssetFolderName(long);
    expect(result).toBe("A".repeat(80));
    expect(Array.from(result)).toHaveLength(80);
    expect(sanitizeAssetFolderNameDetailed(long).truncated).toBe(true);
  });

  it("UTF-8 超 240 字节按码点回退截断(与 80 字符上限独立生效)", () => {
    // 70 个 4 字节 emoji=280 字节(140 码元、70 码点≤80):字节上限先咬 → 60 个 emoji=240 字节
    const emoji = sanitizeAssetFolderName("😀".repeat(70));
    expect(Array.from(emoji)).toHaveLength(60);
    expect(Buffer.byteLength(emoji, "utf8")).toBe(240);
    expect(sanitizeAssetFolderNameDetailed("😀".repeat(70)).truncated).toBe(true);

    // 纯 CJK:80 字符=240 字节,双上限恰好同时满足,不截断
    const exact = "汉".repeat(80);
    expect(sanitizeAssetFolderName(exact)).toBe(exact);
    expect(sanitizeAssetFolderNameDetailed(exact).truncated).toBe(false);

    // 81 个 CJK=243 字节 → 截到 80
    expect(sanitizeAssetFolderName("汉".repeat(81))).toBe("汉".repeat(80));
  });

  it("未截断路径 truncated=false 且 folderName 与简式一致", () => {
    expect(sanitizeAssetFolderNameDetailed("晏燎")).toEqual({ folderName: "晏燎", truncated: false });
    expect(sanitizeAssetFolderNameDetailed("晏燎").folderName).toBe(sanitizeAssetFolderName("晏燎"));
  });

  it("null/undefined 输入兜底「未命名」(纯防御,生产 empty_name=0)", () => {
    expect(sanitizeAssetFolderName(null as unknown as string)).toBe("未命名");
    expect(sanitizeAssetFolderName(undefined as unknown as string)).toBe("未命名");
  });
});

describe("usesAssetNameFolder(R1 分夹域:role/scene/tool 走名夹,clip/audio 平铺)", () => {
  it("三类图片分夹;两类媒体平铺", () => {
    expect(usesAssetNameFolder("role")).toBe(true);
    expect(usesAssetNameFolder("scene")).toBe(true);
    expect(usesAssetNameFolder("tool")).toBe(true);
    expect(usesAssetNameFolder("clip")).toBe(false);
    expect(usesAssetNameFolder("audio")).toBe(false);
  });
});
