import { describe, expect, it } from "vitest";
import type { SeriesMeta } from "@/types/script";
import {
  buildOverviewFillMessages,
  mergeFillIntoMeta,
  parseOverviewFillResponse,
  runOverviewMetaFill,
} from "./overview-meta-fill";

const META: SeriesMeta = {
  title: "道劫",
  characters: [],
  logline: "",
  genre: "仙侠",
  themes: [],
};

describe("buildOverviewFillMessages", () => {
  it("embeds context, question intent and field states", () => {
    const messages = buildOverviewFillMessages({
      context: "晏燎是剑修。道口镇血祭。",
      currentMeta: META,
      questions: { tone: "忠实原著", focus: ["世界观"], detailLevel: "标准（百字）" },
    });
    expect(messages.system).toContain("JSON 对象");
    expect(messages.system).toContain("characters 角色列表不在你的输出范围");
    expect(messages.user).toContain("晏燎是剑修");
    expect(messages.user).toContain("改编基调：忠实原著");
    expect(messages.user).toContain("侧重维度：世界观");
    expect(messages.user).toContain("已填");
    expect(messages.user).toContain("类型=仙侠");
    expect(messages.user).toContain("一句话概括");
  });

  it("omits the intent block when no questions answered", () => {
    const messages = buildOverviewFillMessages({ context: "素材", currentMeta: META });
    expect(messages.user).not.toContain("改编意图");
  });
});

describe("parseOverviewFillResponse", () => {
  it("accepts whitelist fields with coercion", () => {
    const result = parseOverviewFillResponse(
      '前置噪音{"logline":"少年逆袭","themes":["复仇"," 权谋 ","x"],"keyItems":[{"name":"断剑","desc":"旧物"},{"name":""}],"factions":[{"name":"万劫圣宗","members":["玄清子",42]}],"unknown":"drop"}后置噪音',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.logline).toBe("少年逆袭");
    expect(result.fields.themes).toEqual(["复仇", "权谋", "x"]);
    expect(result.fields.keyItems).toEqual([{ name: "断剑", desc: "旧物" }]);
    expect(result.fields.factions).toEqual([{ name: "万劫圣宗", members: ["玄清子"] }]);
    expect(result.fields.unknown).toBeUndefined();
  });

  it("rejects responses without a parsable object", () => {
    expect(parseOverviewFillResponse("没有任何 JSON").ok).toBe(false);
    expect(parseOverviewFillResponse("[1,2,3]").ok).toBe(false);
    expect(parseOverviewFillResponse('{"era":42}').ok).toBe(false);
  });
});

describe("mergeFillIntoMeta", () => {
  const proposal = { logline: "新概括", genre: "武侠", themes: ["复仇"] };

  it("fills only empty fields by default (手填保护)", () => {
    const updates = mergeFillIntoMeta(META, proposal);
    expect(updates.logline).toBe("新概括");
    expect(updates.themes).toEqual(["复仇"]);
    expect(updates.genre).toBeUndefined(); // genre 已有「仙侠」,默认不覆盖
  });

  it("overwrites existing values when overwrite is set", () => {
    const updates = mergeFillIntoMeta(META, proposal, { overwrite: true });
    expect(updates.genre).toBe("武侠");
  });
});

describe("runOverviewMetaFill", () => {
  it("round-trips messages through callText and parses fields", async () => {
    const result = await runOverviewMetaFill({
      context: "素材",
      currentMeta: META,
      callText: async (messages) => {
        expect(messages.user).toContain("素材");
        return '{"logline":"一句话"}';
      },
    });
    expect(result.ok).toBe(true);
    expect(result.fields?.logline).toBe("一句话");
  });

  it("surfaces callText failures without throwing", async () => {
    const result = await runOverviewMetaFill({
      context: "素材",
      currentMeta: META,
      callText: async () => {
        throw new Error("接口不可用");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("接口不可用");
  });
});
