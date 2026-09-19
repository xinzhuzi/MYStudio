// 漫影模块内容策略测试(09-12 模块分离):直取引擎侧真源
// my_module_policy.js——纯函数零 ComfyUI 依赖,以 data URL 动态 import
// 实跑「随引擎分发的同一份代码」(非 app 侧复制品)。另附接线源断言:
// 侧栏过滤/树过滤必须消费策略单源,禁止自带副本。
// 09-13 模块拆分后 monolith manying.js 退役——接线断言改读拆分双模块
// (sidebar.js=侧栏库过滤;compat-guard.js=模板/userdata 树过滤)拼接。

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webDir = path.resolve(process.cwd(), "backend/engines/comfyui/my_nodes/web");
const policySource = readFileSync(path.join(webDir, "my_module_policy.js"), "utf8");
const wiringSource = [
  readFileSync(path.join(webDir, "sidebar.js"), "utf8"),
  readFileSync(path.join(webDir, "compat-guard.js"), "utf8"),
].join("\n");

/** 策略模块为 ESM(引擎以 ES module 加载),data URL 动态 import 原字节直跑 */
async function loadPolicy() {
  const url = `data:text/javascript;base64,${Buffer.from(policySource, "utf8").toString("base64")}`;
  return import(/* @vite-ignore */ url) as Promise<{
    STORYBOARD_WORKFLOW_PREFIX: string;
    filterWorkflowsForScope: (items: unknown, scope: string | null | undefined) => unknown;
    filterUserDataWorkflowEntries: (entries: unknown) => unknown;
    filterUserDataWorkflowEntriesFlattenMy: (entries: unknown) => unknown;
    isUserDataWorkflowListUrl: (url: string) => boolean;
  }>;
}

// 09-14 晚二次裁定后世界:引擎家动态流=「分镜/」根;静态自研=repo: 仓库真源;
// 「漫影/」旧根条目=装机旧代码回写期防回流兜底(与新根同判)。
const storyboardMainline = { id: "分镜/0_工作流主线/MY-分镜工作流 · 第一章.json", name: "分镜工作流 · 第一章" };
const storyboardOverview = { id: "分镜/1_总览/MY-分镜总览.json", name: "分镜总览" };
const storyboardShot = { id: "分镜/2_单镜图/MY-S01.json", name: "S01" };
const storyboardVideo = { id: "分镜/3_单镜视频/MY-单镜视频 · chapter-001 · S01.json", name: "单镜视频" };
const legacyMainline = { id: "漫影/1_图片/分镜/0_工作流主线/分镜工作流.json", name: "旧根主线" };
const k2Workflow = { id: "repo:1_图片/K2图像/1_文生图/K2-文生图.json", name: "K2-文生图" };
const h3Workflow = { id: "repo:2_视频/H3视频/2_固定线/MY-x.json", name: "x" };
const yue2Workflow = { id: "repo:3_声音/Yue2/yue2-整曲-官方版.json", name: "yue2-整曲-官方版" };
const referenceWorkflow = { id: "漫影/4_参考_提示词工程/prompts.json", name: "prompts(旧根防回流)" };
const library = [storyboardMainline, storyboardOverview, storyboardShot, storyboardVideo, legacyMainline, k2Workflow, h3Workflow, yue2Workflow, referenceWorkflow];

describe("filterWorkflowsForScope(漫影侧栏库按模块过滤)", () => {
  it("models 域:分镜产线四类写入位(含单镜视频)全剔除;旧根防回流同剔;repo: 静态自研保留", async () => {
    const { filterWorkflowsForScope } = await loadPolicy();
    const visible = filterWorkflowsForScope(library, "models") as typeof library;
    expect(visible).toEqual([k2Workflow, h3Workflow, yue2Workflow]);
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
      filterWorkflowsForScope([{ path: "分镜/0_工作流主线/x.json" }, { path: "repo:2_视频/y.json" }], "models"),
    ).toEqual([{ path: "repo:2_视频/y.json" }]);
    expect(filterWorkflowsForScope(null, "models")).toBe(null);
  });
});

describe("filterUserDataWorkflowEntries(userdata 工作流树条目过滤)", () => {
  it("v2 形态(带 workflows/ 前缀,含目录条目):新根「分镜/」与旧根防回流同剔除", async () => {
    const { filterUserDataWorkflowEntries } = await loadPolicy();
    const entries = [
      { path: "workflows/分镜", type: "directory" },
      { path: "workflows/分镜/0_工作流主线", type: "directory" },
      { path: "workflows/分镜/0_工作流主线/MY-分镜工作流.json", type: "file", size: 1 },
      { path: "workflows/漫影/1_图片/分镜/0_工作流主线/legacy.json", type: "file", size: 4 },
      { path: "workflows/用户自存/x.json", type: "file", size: 2 },
      { path: "comfy.settings.json", type: "file", size: 3 },
    ];
    expect(filterUserDataWorkflowEntries(entries)).toEqual([
      { path: "workflows/用户自存/x.json", type: "file", size: 2 },
      { path: "comfy.settings.json", type: "file", size: 3 },
    ]);
  });

  it("v1 形态(相对 workflows 无前缀,含纯字符串条目)与非数组直通", async () => {
    const { filterUserDataWorkflowEntries } = await loadPolicy();
    expect(
      filterUserDataWorkflowEntries(["分镜/1_总览/x.json", "用户自存/y.json"]),
    ).toEqual(["用户自存/y.json"]);
    expect(filterUserDataWorkflowEntries([{ path: "repo:1_图片/K2图像/z.json" }])).toEqual([
      { path: "repo:1_图片/K2图像/z.json" },
    ]);
    expect(filterUserDataWorkflowEntries(undefined)).toBe(undefined);
  });
});

describe("filterUserDataWorkflowEntriesFlattenMy(09-15 用户终裁:只折叠「漫影/分镜」根名,子内容原样展平)", () => {
  it("漫影/分镜根文件夹条目不展示;子条目剥根展平保留;用户自存与非数组直通", async () => {
    const { filterUserDataWorkflowEntriesFlattenMy } = await loadPolicy();
    const entries = [
      { path: "workflows/漫影", type: "directory" },
      { path: "workflows/漫影/2_视频/H3视频/b.json", type: "file" },
      { path: "workflows/分镜/0_工作流主线/a.json", type: "file" },
      "漫影/1_图片/分镜/c.json",
      { path: "workflows/用户自存/d.json", type: "file" },
    ];
    expect(filterUserDataWorkflowEntriesFlattenMy(entries)).toEqual([
      { path: "workflows/2_视频/H3视频/b.json", type: "file" },
      { path: "workflows/0_工作流主线/a.json", type: "file" },
      "1_图片/分镜/c.json",
      { path: "workflows/用户自存/d.json", type: "file" },
    ]);
    expect(filterUserDataWorkflowEntriesFlattenMy("not-array")).toBe("not-array");
  });
});

describe("isUserDataWorkflowListUrl(树「列表」端点判定;单文件/写操作直通)", () => {
  it("命中:v1 dir=workflows 与 v2 根/workflows/子树;真实流量形状=带 /api 前缀(09-13 实弹网络日志锚定),根路径形状同收", async () => {
    const { isUserDataWorkflowListUrl } = await loadPolicy();
    // 实弹锚:树浏览器实发(引擎 17000 网络日志逐字)
    expect(isUserDataWorkflowListUrl("/api/userdata?dir=workflows&recurse=true&split=false&full_info=true")).toBe(true);
    expect(isUserDataWorkflowListUrl("http://127.0.0.1:17000/api/userdata?dir=workflows&recurse=true&split=false&full_info=true")).toBe(true);
    // 根路径形状(服务器路由双挂,防御性同收)
    expect(isUserDataWorkflowListUrl("/userdata?dir=workflows&recurse=true&split=false&full_info=true")).toBe(true);
    expect(isUserDataWorkflowListUrl("http://127.0.0.1:17001/userdata?dir=workflows&recurse=true")).toBe(true);
    expect(isUserDataWorkflowListUrl("/v2/userdata")).toBe(true);
    expect(isUserDataWorkflowListUrl("/api/v2/userdata?path=workflows")).toBe(true);
    expect(isUserDataWorkflowListUrl("/v2/userdata?path=workflows")).toBe(true);
    expect(isUserDataWorkflowListUrl("/v2/userdata?path=workflows/%E6%BC%AB%E5%BD%B1")).toBe(true);
  });

  it("放行:单文件读取/其他 dir/其他路径/空值——顶签恢复与写操作不受影响(实弹锚:书签索引单文件 404 直通)", async () => {
    const { isUserDataWorkflowListUrl } = await loadPolicy();
    expect(isUserDataWorkflowListUrl("/api/userdata/workflows%2F.index.json")).toBe(false);
    expect(isUserDataWorkflowListUrl("/api/userdata/user.css")).toBe(false);
    expect(isUserDataWorkflowListUrl("/userdata/workflows/%E6%BC%AB%E5%BD%B1/x.json")).toBe(false);
    expect(isUserDataWorkflowListUrl("/api/userdata?dir=subgraphs&recurse=true&split=false&full_info=true")).toBe(false);
    expect(isUserDataWorkflowListUrl("/userdata?dir=keybindings&recurse=true")).toBe(false);
    expect(isUserDataWorkflowListUrl("/v2/userdata?path=keybindings")).toBe(false);
    expect(isUserDataWorkflowListUrl("/api/workflow_templates")).toBe(false);
    expect(isUserDataWorkflowListUrl("")).toBe(false);
    expect(isUserDataWorkflowListUrl("http://127.0.0.1:17001/system_stats")).toBe(false);
  });
});

describe("接线(09-15 原生功能恢复裁定后:过滤接线退役,策略模块单源休眠)", () => {
  it("sidebar+compat-guard 均不消费策略模块;树/模板过滤全撤(原生功能恢复);保留件=VueNodes 渲染守卫", () => {
    // 09-15 用户裁定(f3c937e ComfyUI 原生三恢复):模板面板清单与 userdata
    // 工作流树不再做任何过滤/置空——fetch 补丁/模板置空/树过滤接线全撤,
    // 策略模块转纯函数休眠单源;消费方仍禁止自带副本(下述符号不得回流)。
    expect(wiringSource).not.toContain('from "./my_module_policy.js"');
    expect(wiringSource).not.toContain("filterWorkflowsForScope(");
    expect(wiringSource).not.toContain("filterUserDataWorkflowEntriesFlattenMy(");
    expect(wiringSource).not.toContain("isUserDataWorkflowListUrl(");
    expect(wiringSource).not.toContain("installTemplateScopeFilter");
    expect(wiringSource).not.toContain("__myTplScope");
    // 登录遮蔽 my_login_cloak 与 VueNodes 渲染守卫保留(与原生功能无关)
    expect(wiringSource).toContain("my.render.compat");
  });
});
