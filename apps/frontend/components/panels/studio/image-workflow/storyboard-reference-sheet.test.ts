// @vitest-environment jsdom
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageWorkflowGraph } from "@/types/studio";
import { buildStoryboardReferenceSheet } from "./storyboard-reference-sheet";
import { IMAGE_ASPECT_RATIOS } from "@/lib/ai/image-size-presets";
import { prepareReferenceImageForTransfer } from "@/lib/ai/image-transfer";

const drawImage = vi.fn();
const fillText = vi.fn();
let decoded: string[];
let sourceWidth = 600;
let failDecode = false;
function input(count = 3) {
  const nodes = [
    { id: "hero", type: "reference", title: "独孤剑尘", source: { kind: "asset", assetType: "character" }, imageUrl: "hero" },
    { id: "scene", type: "reference", title: "码头", source: { kind: "asset", assetType: "scene" }, imageUrl: "scene" },
    { id: "prop", type: "reference", title: "铁剑", source: { kind: "asset", assetType: "prop" }, imageUrl: "prop" },
  ];
  return {
    graph: { id: "wf", nodes, edges: nodes.map((node) => ({ source: node.id, target: "gen" })) } as unknown as ImageWorkflowGraph,
    targetNodeId: "gen",
    referenceImages: ["scene", "hero", "prop"].slice(0, count),
    preparedReferenceImages: ["prepared-scene", "prepared-hero", "prepared-prop"].slice(0, count),
  };
}

describe("storyboard reference sheet transport", () => {
  beforeEach(() => {
    vi.clearAllMocks(); decoded = []; sourceWidth = 600; failDecode = false;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(), drawImage, fillText, measureText: (text: string) => ({ width: Array.from(text).length * 22 }),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,sheet");
    vi.stubGlobal("Image", class {
      naturalWidth = sourceWidth; naturalHeight = 800;
      onload?: () => void; onerror?: () => void;
      set src(value: string) {
        decoded.push(value);
        queueMicrotask(() => failDecode ? this.onerror?.() : this.onload?.());
      }
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([1, 2, 3, 9])("%i 参考的目标画布为16:9，完整容纳且不改来源顺序", async (count) => {
    const value = input(Math.min(count, 3));
    if (count === 9) {
      value.referenceImages = Array.from({ length: 9 }, (_, i) => ["scene", "hero", "prop"][i % 3]);
      value.preparedReferenceImages = value.referenceImages.map((url) => `prepared-${url}`);
    }
    const frozen = JSON.stringify(value);
    const result = await buildStoryboardReferenceSheet({ ...value, aspectRatio: "16:9" } as Parameters<typeof buildStoryboardReferenceSheet>[0]);
    const canvas = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.instances[0] as HTMLCanvasElement;
    expect(canvas.width * 9).toBe(canvas.height * 16);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(2304 * 2304);
    expect(decoded).toEqual(value.preparedReferenceImages);
    expect(result.mappings).toEqual(value.referenceImages.map((imageUrl, i) => ({ order: i + 1, imageUrl })));
    for (const args of drawImage.mock.calls) {
      expect(args).toHaveLength(5);
      const [, x, y, width, height] = args;
      expect(width / height).toBeCloseTo(600 / 800);
      expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(canvas.width);
      expect(y + height).toBeLessThanOrEqual(canvas.height);
    }
    expect(JSON.stringify(value)).toBe(frozen);
    if (count === 1) {
      expect(fillText).not.toHaveBeenCalled();
      expect(result.prompt).not.toMatch(/拼板|多视图|第1格/);
      expect(result.prompt).toContain("一张完整连续的剧情画面");
    }
  });

  it.each(["2:1", "999999999:1", "0:0", "16/9", ""])('拒绝不支持的比例 %s，未分配/解码', async (aspectRatio) => {
    await expect(buildStoryboardReferenceSheet({ ...input(), aspectRatio } as Parameters<typeof buildStoryboardReferenceSheet>[0]))
      .rejects.toThrow("画幅");
    expect(decoded).toEqual([]);
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
  });

  it.each(IMAGE_ASPECT_RATIOS)("已知画幅 %s 保持精确比例及画布预算", async (aspectRatio) => {
    await buildStoryboardReferenceSheet({ ...input(), aspectRatio });
    const canvas = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.instances[0] as HTMLCanvasElement;
    const [w, h] = aspectRatio.split(":").map(Number);
    expect(canvas.width * h).toBe(canvas.height * w);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(2304 * 2304);
  });

  it.each(IMAGE_ASPECT_RATIOS)("最终上传缩略 %s 保持画幅至像素舍入且小于1MB", async (aspectRatio) => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue("data:image/png;base64,YQ==");
    const result = await buildStoryboardReferenceSheet({ ...input(), aspectRatio });
    const sheet = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.instances[0] as HTMLCanvasElement;
    vi.stubGlobal("Image", class {
      naturalWidth = sheet.width; naturalHeight = sheet.height; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue("data:image/jpeg;base64,YQ==");
    expect(await prepareReferenceImageForTransfer(result.imageUrl)).toBe("data:image/jpeg;base64,YQ==");
    const transfer = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.instances[1] as HTMLCanvasElement;
    const scale = 768 / Math.max(sheet.width, sheet.height);
    expect(transfer.width).toBe(Math.round(sheet.width * scale));
    expect(transfer.height).toBe(Math.round(sheet.height * scale));
    expect(Math.max(transfer.width, transfer.height)).toBe(768);
  });

  it("生产拼板映射通过风格转换路径的真实否定式门禁，输出单张连续剧情画面", async () => {
    const result = await buildStoryboardReferenceSheet(input());
    // 与 MyQi21PromptAssembly 的 i2i 入口相同参数；只加载纯 Python 门禁，零模型/网络。
    const gate = spawnSync("python3", ["-I", "-B", "-c", [
      "import runpy, sys",
      "gate = runpy.run_path(sys.argv[1])",
      "gate['assert_prompt_gates'](sys.stdin.read(), is_subject=True, negation_only=True, context='[指令·道劫美术风格转换]')",
    ].join("\n"), resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../backend/comfyui/my_nodes/nodes/_gongbi_gate.py")], {
      input: result.prompt, encoding: "utf8", timeout: 10000,
    });
    expect(gate.error).toBeUndefined();
    expect(gate.status, gate.stderr).toBe(0);
    expect(result.prompt).toContain("一张完整连续的剧情画面");
    expect(result.prompt).toContain("场景、角色和道具");
  });

  it("完整绘制全部准备后参考，顺序与请求一致；格内零标注文字(烧字防线)由 prompt 句承担映射", async () => {
    const result = await buildStoryboardReferenceSheet(input());
    expect(decoded).toEqual(["prepared-scene", "prepared-hero", "prepared-prop"]);
    expect(drawImage).toHaveBeenCalledTimes(3);
    // 1115 第六病理修:「图N｜角色」标签画进参考图会被模型抄进成图(分镜-11 烧字
    // 实证)——格内只画参考图本体,fillText 恒零调用
    expect(fillText).not.toHaveBeenCalled();
    expect(result.prompt).toContain("图3对应拼板第3格：铁剑（道具）");
    expect(result.prompt).toContain("同名角色在画面中仅出现一次");
    expect(result.prompt).toContain("不重现参考图的版式、多视角、背景与任何文字标注");
    expect(result.mappings).toEqual([
      { order: 1, imageUrl: "scene" }, { order: 2, imageUrl: "hero" }, { order: 3, imageUrl: "prop" },
    ]);
    const canvas = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.instances[0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1536, 1536]);
    // 竖幅参考(600×800)零裁切,四参数目标矩形按等比完整容纳。
    expect(drawImage.mock.calls[0].slice(1)).toEqual([156, 16, 456, 608]);
  });

  it("超过9张时拒绝，未解码和未静默丢图", async () => {
    const value = input(); value.referenceImages = Array(10).fill("hero"); value.preparedReferenceImages = Array(10).fill("prepared");
    await expect(buildStoryboardReferenceSheet(value)).rejects.toThrow("2–9");
    expect(decoded).toEqual([]);
  });

  it("准备后参考数量变化时拒绝", async () => {
    const value = input(); value.preparedReferenceImages = ["only-one"];
    await expect(buildStoryboardReferenceSheet(value)).rejects.toThrow("数量不一致");
  });

  it("URL不能回查真实节点时拒绝而不猜测资产身份", async () => {
    const value = input(); value.referenceImages[1] = "missing";
    await expect(buildStoryboardReferenceSheet(value)).rejects.toThrow("图2参考 URL");
    expect(decoded).toEqual([]);
  });

  it("generated 参考没有审核状态，只标注上游成图", async () => {
    const value = input(2);
    value.graph.nodes.push({ id: "upstream", type: "generated", title: "上一镜", resultUrl: "upstream" } as never);
    value.graph.edges.push({ source: "upstream", target: "gen" } as never);
    value.referenceImages[1] = "upstream";
    const result = await buildStoryboardReferenceSheet(value);
    expect(result.prompt).toContain("上一镜（上游成图）");
    expect(result.prompt).not.toContain("已审");
    // 标签不画格内(烧字防线),映射由 prompt 句承担
    expect(fillText).not.toHaveBeenCalled();
  });

  it("解码失败明确报错，不导出缺格拼板", async () => {
    failDecode = true;
    await expect(buildStoryboardReferenceSheet(input())).rejects.toThrow("图1参考图无法解码");
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
  });

  // === 1115 第六病理修(参考图种类错配):横幅设定卡单视图裁切 ===

  /** 横幅五视图卡合成像素:奶油底(245,240,228),内容块占 10%–35% 列带。 */
  function landscapeCardPixels(width: number, height: number, contentFrom = 0.1, contentTo = 0.35): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const content = x >= Math.floor(width * contentFrom) && x <= Math.floor(width * contentTo);
        if (content) { data[at] = 92; data[at + 1] = 61; data[at + 2] = 43; }
        else { data[at] = 245; data[at + 1] = 240; data[at + 2] = 228; }
        data[at + 3] = 255;
      }
    }
    return data;
  }

  function stubAnalysisContext(pixelsFor: (w: number, h: number) => Uint8ClampedArray) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage,
      fillText,
      measureText: (text: string) => ({ width: Array.from(text).length * 22 }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: pixelsFor(w, h) }),
    } as never);
  }

  it("横幅多视图卡角色参考 → 裁最左单姿(9 参源矩形),整卡禁入格", async () => {
    stubAnalysisContext((w, h) => landscapeCardPixels(w, h));
    vi.stubGlobal("Image", class {
      naturalWidth = 600; naturalHeight = 800;
      onload?: () => void; onerror?: () => void;
      set src(value: string) {
        if (value === "prepared-hero") { // 赵四五视图卡实测画幅 1248×832
          this.naturalWidth = 1248; this.naturalHeight = 832;
        }
        queueMicrotask(() => this.onload?.());
      }
    });
    const value = input(); // [scene(600×800), hero(角色,1248×832 卡), prop(600×800)]
    const result = await buildStoryboardReferenceSheet(value);
    expect(result.imageUrl).toBe("data:image/png;base64,sheet");
    // 9 参源矩形只落在第2格(角色卡);场景/竖幅道具保持 5 参整图(分析画布的
    // (0,0) 缩放绘制不计入主绘制)
    const nineArg = drawImage.mock.calls.filter((args) => args.length === 9);
    expect(nineArg).toHaveLength(1);
    const [, sx, , sw] = nineArg[0]!;
    // 内容块 10%–35% + 两侧 2% 余量 → sx∈[90,160], sw∈[290,370]
    expect(sx).toBeGreaterThanOrEqual(90); expect(sx).toBeLessThanOrEqual(160);
    expect(sw).toBeGreaterThanOrEqual(290); expect(sw).toBeLessThanOrEqual(370);
    expect(drawImage.mock.calls.filter((args) => args.length === 5 && !(args[1] === 0 && args[2] === 0))).toHaveLength(2);
  });

  it("横幅场景参考合法(16:9 场景图)恒不裁切", async () => {
    stubAnalysisContext((w, h) => landscapeCardPixels(w, h));
    vi.stubGlobal("Image", class {
      naturalWidth = 600; naturalHeight = 800;
      onload?: () => void; onerror?: () => void;
      set src(value: string) {
        if (value === "prepared-scene") { this.naturalWidth = 1536; this.naturalHeight = 864; }
        queueMicrotask(() => this.onload?.());
      }
    });
    await buildStoryboardReferenceSheet(input()); // 第1格=场景(1536×864 横幅)
    expect(drawImage.mock.calls.filter((args) => args.length === 9)).toHaveLength(0);
    expect(drawImage.mock.calls.every((args) => args.length === 5)).toBe(true);
  });

  it("列占用检测不可用(无 getImageData)→ 退整图,绝不阻断生图", async () => {
    // beforeEach 的 getContext 替身本就无 getImageData:横幅角色卡在此形态下
    // 必须安全退化为既有整图行为(守卫句仍在线)
    vi.stubGlobal("Image", class {
      naturalWidth = 1248; naturalHeight = 832;
      onload?: () => void; onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const result = await buildStoryboardReferenceSheet(input());
    expect(result.imageUrl).toBe("data:image/png;base64,sheet");
    expect(drawImage.mock.calls.filter((args) => args.length === 9)).toHaveLength(0);
    expect(drawImage.mock.calls.every((args) => args.length === 5)).toBe(true);
  });

  it("输入单边超过8192px时拒绝，不缩小后掩盖超限", async () => {
    sourceWidth = 8193;
    await expect(buildStoryboardReferenceSheet(input())).rejects.toThrow("8192px / 32MP");
    expect(drawImage).not.toHaveBeenCalled();
  });
});
