import { describe, expect, it } from "vitest";
import { CINEMATIC_LUTS } from "./cinematic-luts";

// 08-28 两套色彩系统衔接:32 张 cn-* 逐一确定性标注温感(人工按 description 复核,
// 禁 NLP 猜词);film-* legacy 不标(undefined 视作 neutral)。此测试守护闭集纪律。
describe("CINEMATIC_LUTS temperature 标注(08-28)", () => {
  const cnLuts = CINEMATIC_LUTS.filter((l) => l.lutId.startsWith("cn-"));
  const filmLuts = CINEMATIC_LUTS.filter((l) => l.lutId.startsWith("film-"));

  it("32 张 cn-* 全部显式标注温感,值域合法", () => {
    expect(cnLuts).toHaveLength(32);
    for (const lut of cnLuts) {
      expect(["warm", "cool", "neutral"]).toContain(lut.temperature);
    }
  });

  it("film-* 8 张 legacy 不标温感", () => {
    expect(filmLuts).toHaveLength(8);
    for (const lut of filmLuts) {
      expect(lut.temperature).toBeUndefined();
    }
  });

  it("温感分布与 08-28 人工复核裁定一致:cool 13 / warm 14 / neutral 5", () => {
    const count = (temperature: string) => cnLuts.filter((l) => l.temperature === temperature).length;
    expect(count("cool")).toBe(13);
    expect(count("warm")).toBe(14);
    expect(count("neutral")).toBe(5);
  });

  it("抽查代表卡:黛青=cool / 藤黄=warm / 水墨=neutral / 暮山紫=cool / 紫檀=warm", () => {
    const byId = new Map(CINEMATIC_LUTS.map((l) => [l.lutId, l.temperature]));
    expect(byId.get("cn-daiqing")).toBe("cool");
    expect(byId.get("cn-tenghuang")).toBe("warm");
    expect(byId.get("cn-shuimo")).toBe("neutral");
    expect(byId.get("cn-mushanzi")).toBe("cool");
    expect(byId.get("cn-ziitan")).toBe("warm");
  });
});
