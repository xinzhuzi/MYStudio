// 漫影模块内容策略测试(09-12 模块分离):直取引擎侧真源
// manying_module_policy.js——纯函数零 ComfyUI 依赖,以 data URL 动态 import
// 实跑「随引擎分发的同一份代码」(非 app 侧复制品)。另附 manying.js 接线
// 源断言:侧栏过滤/树过滤必须消费策略单源,禁止自带副本。

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const policySource = readFileSync(
  path.resolve(process.cwd(), "backend/engines/comfyui/manying_nodes/web/manying_module_policy.js"),
  "utf8",
);
const manyingSource = readFileSync(
  path.resolve(process.cwd(), "backend/engines/comfyui/manying_nodes/web/manying.js"),
  "utf8",
);

/** 策略模块为 ESM(引擎以 ES module 加载),data URL 动态 import 原字节直跑 */
async function loadPolicy() {
  const url = `data:text/javascript;base64,${Buffer.from(policySource, "utf8").toString("base64")}`;
  return import(/* @vite-ignore */ url) as Promise<{
    STORYBOARD_WORKFLOW_PREFIX: string;
    filterWorkflowsForScope: (items: unknown, scope: string | null | undefined) => unknown;
    filterUserDataWorkflowEntries: (entries: unknown) => unknown;
    isUserDataWorkflowListUrl: (url: string) => boolean;
  }>;
}

const storyboardMainline = { id: "漫影/1_图片/分镜/0_工作流主线/分镜工作流 · 第一章.json", name: "分镜工作流 · 第一章" };
const storyboardOverview = { id: "漫影/1_图片/分镜/1_总览/分镜总览.json", name: "分镜总览" };
const storyboardShot = { id: "漫影/1_图片/分镜/2_单镜图/S01.json", name: "S01" };
const k2Workflow = { id: "漫影/1_图片/K2图像/1_文生图/t2i.json", name: "t2i" };
const h3Workflow = { id: "漫影/2_视频/H3视频/1_漫影自研/clip.json", name: "clip" };
const musicWorkflow = { id: "漫影/3_声音/音乐/cur.json", name: "cur" };
const referenceWorkflow = { id: "漫影/4_参考_提示词工程/prompts.json", name: "prompts" };
const library = [storyboardMainline, storyboardOverview, storyboardShot, k2Workflow, h3Workflow, musicWorkflow, referenceWorkflow];

describe("filterWorkflowsForScope(漫影侧栏库按模块过滤)", () => {
  it("models 域:分镜产线三类写入位全剔除,本地模型域内容(K2/H3/音乐/参考)全保留", async () => {
    const { filterWorkflowsForScope } = await loadPolicy();
    const visible = filterWorkflowsForScope(library, "models") as typeof library;
    expect(visible).toEqual([k2Workflow, h3Workflow, musicWorkflow, referenceWorkflow]);
  });

  it("workflow 域与外部直访:原数组直通(同引用,零改动)", async () => {
    const { filterWorkflowsForScope } = await loadPolicy();
    expect(filterWorkflowsForScope(library, "workflow")).toBe(library);
    expect(filterWorkflowsForScope(library, null)).toBe(library);
    expect(filterWorkflowsForScope(library, undefined)).toBe(library);
  });

  it("条目取值宽容:id 缺失回落 path;非数组直通", async () => {
    const { filterWorkflowsForScope } = await loadPolicy();
    expect(
      filterWorkflowsForScope([{ path: "漫影/1_图片/分镜/0_工作流主线/x.json" }, { path: "漫影/2_视频/y.json" }], "models"),
    ).toEqual([{ path: "漫影/2_视频/y.json" }]);
    expect(filterWorkflowsForScope(null, "models")).toBe(null);
  });
});

describe("filterUserDataWorkflowEntries(userdata 工作流树条目过滤)", () => {
  it("v2 形态(带 workflows/ 前缀,含目录条目):分镜文件+分镜内子目录+分镜文件夹本体全剔除", async () => {
    const { filterUserDataWorkflowEntries } = await loadPolicy();
    const entries = [
      { path: "workflows/漫影/1_图片/分镜", type: "directory" },
      { path: "workflows/漫影/1_图片/分镜/0_工作流主线", type: "directory" },
      { path: "workflows/漫影/1_图片/分镜/0_工作流主线/分镜工作流 · 第一章.json", type: "file", size: 1 },
      { path: "workflows/漫影/1_图片/K2图像/1_文生图/t2i.json", type: "file", size: 2 },
      { path: "comfy.settings.json", type: "file", size: 3 },
    ];
    expect(filterUserDataWorkflowEntries(entries)).toEqual([
      { path: "workflows/漫影/1_图片/K2图像/1_文生图/t2i.json", type: "file", size: 2 },
      { path: "comfy.settings.json", type: "file", size: 3 },
    ]);
  });

  it("v1 形态(相对 workflows 无前缀,含纯字符串条目)与非数组直通", async () => {
    const { filterUserDataWorkflowEntries } = await loadPolicy();
    expect(
      filterUserDataWorkflowEntries(["漫影/1_图片/分镜/1_总览/x.json", "漫影/2_视频/y.json"]),
    ).toEqual(["漫影/2_视频/y.json"]);
    expect(filterUserDataWorkflowEntries([{ path: "漫影/1_图片/K2图像/z.json" }])).toEqual([
      { path: "漫影/1_图片/K2图像/z.json" },
    ]);
    expect(filterUserDataWorkflowEntries(undefined)).toBe(undefined);
  });
});

describe("isUserDataWorkflowListUrl(树「列表」端点判定;单文件/写操作直通)", () => {
  it("命中:v1 dir=workflows 与 v2 根/workflows/子树,相对与带 origin 均可", async () => {
    const { isUserDataWorkflowListUrl } = await loadPolicy();
    expect(isUserDataWorkflowListUrl("/userdata?dir=workflows&recurse=true&split=false&full_info=true")).toBe(true);
    expect(isUserDataWorkflowListUrl("http://127.0.0.1:17001/userdata?dir=workflows&recurse=true")).toBe(true);
    expect(isUserDataWorkflowListUrl("/v2/userdata")).toBe(true);
    expect(isUserDataWorkflowListUrl("/v2/userdata?path=workflows")).toBe(true);
    expect(isUserDataWorkflowListUrl("/v2/userdata?path=workflows/%E6%BC%AB%E5%BD%B1")).toBe(true);
  });

  it("放行:单文件读取/其他 dir/其他路径/空值——顶签恢复与写操作不受影响", async () => {
    const { isUserDataWorkflowListUrl } = await loadPolicy();
    expect(isUserDataWorkflowListUrl("/userdata/workflows/%E6%BC%AB%E5%BD%B1/x.json")).toBe(false);
    expect(isUserDataWorkflowListUrl("/userdata?dir=keybindings&recurse=true")).toBe(false);
    expect(isUserDataWorkflowListUrl("/v2/userdata?path=keybindings")).toBe(false);
    expect(isUserDataWorkflowListUrl("/api/workflow_templates")).toBe(false);
    expect(isUserDataWorkflowListUrl("")).toBe(false);
    expect(isUserDataWorkflowListUrl("http://127.0.0.1:17001/system_stats")).toBe(false);
  });
});

describe("manying.js 接线(消费策略单源,scope 判断不散落)", () => {
  it("导入策略模块;侧栏库与 userdata 树过滤均走单源;树过滤装 models 门+幂等守卫", () => {
    expect(manyingSource).toContain('from "./manying_module_policy.js"');
    expect(manyingSource).toContain("filterWorkflowsForScope(");
    expect(manyingSource).toContain("filterUserDataWorkflowEntries(");
    expect(manyingSource).toContain("isUserDataWorkflowListUrl(");
    // 统一 scope 过滤器:幂等守卫在案;models 门命中才走树过滤
    expect(manyingSource).toContain("installTemplateScopeFilter");
    expect(manyingSource).toContain("__manyingTplScope");
    expect(manyingSource).toContain('scope === "models" && isUserDataWorkflowListUrl(url)');
    // v2 树的 {items:[…]} 包裹形态也被处理(不是只有裸数组)
    expect(manyingSource).toContain("Array.isArray(body.items)");
  });
});
