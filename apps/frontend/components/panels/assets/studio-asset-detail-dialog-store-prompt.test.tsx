// @vitest-environment jsdom
/**
 * StudioAssetDetailDialog store 位提示词真源接线面测(10-27 应用侧接线):
 * - store-only 角色(小杂役,不在 repo glob):『提示词真源JSON』钮出现、主体句
 *   Textarea 仍渲染且 readOnly=false(subjectMirrorActive 仍 false)、派发主体句
 *   仍=DB draftPrompt(零变更)、无衣物定妆 gate 吃 JSON body_baseSubject
 *   (改 store JSON 后 gate 句随变);
 * - repo 角色(晏燎):行为与现状全同(store 命中时文本来自 store;人物提示词
 *   面板/镜像派发照旧)。
 * projectFiles 桥走 vi.mock readText 桩(store 位真源命中);桥面其余 mock 沿
 * studio-asset-detail-dialog-interaction.test.tsx 范式。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  generateAsset: vi.fn(),
  polishAssetPrompt: vi.fn(),
  typeShot: vi.fn(),
  expressionSheet: vi.fn(),
  saveImageToLibrary: vi.fn(),
  projectReadText: vi.fn(),
  projectWriteText: vi.fn(),
}));

vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => ({
    update: mocks.update,
    delete: mocks.delete,
    get: mocks.get,
    list: mocks.list,
  }),
}));

vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({
    readText: mocks.projectReadText,
    writeText: mocks.projectWriteText,
  }),
}));

vi.mock("@/lib/studio/asset-generation-orchestrator", () => ({
  generateAsset: mocks.generateAsset,
}));

vi.mock("@/lib/studio/asset-type-shot", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/studio/asset-type-shot")>();
  return { ...original, generateAssetTypeShot: mocks.typeShot };
});

vi.mock("@/lib/studio/asset-expression-sheet", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/studio/asset-expression-sheet")>();
  return { ...original, generateAssetExpressionSheet: mocks.expressionSheet };
});

vi.mock("./studio-asset-generation-persistence", () => ({
  persistGeneratedAssetPromptToLibrary: vi.fn().mockResolvedValue(true),
  saveGeneratedAssetImageToLibrary: mocks.saveImageToLibrary,
}));

vi.mock("@/components/ui/media-preview-modal", () => ({
  ImagePreviewModal: () => <div data-testid="asset-preview-modal" />,
}));

vi.mock("@/lib/ai/prompt-polisher", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/prompt-polisher")>();
  return { ...original, polishAssetPrompt: mocks.polishAssetPrompt };
});

import { StudioAssetDetailDialog } from "./StudioAssetDetailDialog";
// 防 vitest 模块跑器并发动态导入竞态(10-27 门禁红根因):源码 getStoreIoContext 内
// 两个动态 import(@/stores/project/project-store 与 @/lib/bridge/project-files)在
// 探测链并发首执行时,偶发解析到未 mock 真身(project-files 真身在 jsdom 无桥→
// 探测 null→loadCharacterJsonText 落 repo 种子文本→面板闪现种子文本,断言红)。
// 此处静态引用让两模块在本文件模块图求值期一次就绪,后续动态 import 全走
// 缓存/mock,并发首执行窗口归零。
import "@/lib/bridge/project-files";
import "@/stores/project/project-store";
import { invalidateAssetPromptInfoCache } from "@/lib/studio/asset-character-json";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import type { StudioAssetSummary } from "@/types/studio-assets";

const XIAOZAYI_PROMPT =
  "约十岁的男童,码头杂役,谨小慎微、眼神怯生,圆脸稚气未脱。土黄粗布短褐缀补丁,配旧布裤,腰束栗褐布绳。凌乱的及肩墨黑短发。";

function roleAsset(overrides: Partial<StudioAssetSummary> = {}): StudioAssetSummary {
  return {
    id: "role-xiaozayi",
    source: "manying-local",
    type: "role",
    name: "小杂役",
    description: "码头杂役",
    prompt: XIAOZAYI_PROMPT,
    ...overrides,
  };
}

/** store 位读桩:按 relativePath 查表;未登记路径 {success:false}。 */
function stubStoreFiles(files: Record<string, string>): void {
  mocks.projectReadText.mockImplementation(async (payload: { relativePath: string }) => {
    const text = files[payload.relativePath];
    return text === undefined ? { success: false, error: "not found" } : { success: true, text };
  });
}

function renderDialog(asset: StudioAssetSummary = roleAsset()) {
  return render(<StudioAssetDetailDialog asset={asset} open onOpenChange={vi.fn()} />);
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.update.mockReset().mockResolvedValue({ id: "role-xiaozayi" });
  mocks.delete.mockReset().mockResolvedValue(true);
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.list.mockReset().mockResolvedValue({ items: [] });
  mocks.generateAsset.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.polishAssetPrompt.mockReset().mockResolvedValue({ status: "success", prompt: "润色后的提示词" });
  mocks.typeShot.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.expressionSheet.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.saveImageToLibrary.mockReset().mockResolvedValue(true);
  mocks.projectReadText.mockReset().mockResolvedValue({ success: false, error: "not found" });
  mocks.projectWriteText.mockReset().mockResolvedValue({ success: true, filePath: "/tmp/x" });
  invalidateAssetPromptInfoCache();
  useStudioStore.setState({
    workflowConfig: { ...useStudioStore.getState().workflowConfig, visualManualId: undefined },
  });
  useTtsStore.setState({ activeProjectId: null, projects: {}, voiceProfiles: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("StudioAssetDetailDialog store 位提示词真源接线(store-only 角色)", () => {
  it("『提示词真源JSON』钮出现;主体句 Textarea 仍渲染且可编辑,值=DB draftPrompt", async () => {
    stubStoreFiles({
      "store/assets/files/prompts/小杂役.json": JSON.stringify({
        asset_type: "role",
        body_base: { 主体词: "store素体主体句甲" },
      }),
    });
    renderDialog();

    // 钮=store 探测命中才出现(小杂役不在 repo glob)
    const jsonButton = await screen.findByRole("button", { name: /提示词真源JSON/ });
    expect(jsonButton).toBeTruthy();

    // 主体句 Textarea 原样保留(store-only 不进 repo 目录面板;readOnly=false)
    const textarea = await screen.findByPlaceholderText("暂无出图提示词");
    expect((textarea as HTMLTextAreaElement).readOnly).toBe(false);
    // 派发零变更:值=DB draftPrompt(非 JSON 派生句)
    expect((textarea as HTMLTextAreaElement).value).toBe(XIAOZAYI_PROMPT);
  });

  it("store 未命中(无 JSON):钮不出现,主体句框照旧", async () => {
    renderDialog();
    // 等一个渲染周期后钮仍缺席
    await waitFor(() => expect(screen.getByPlaceholderText("暂无出图提示词")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /提示词真源JSON/ })).toBeNull();
  });

  /** 等真源文本链就位:store 探测(第1读)+load(第2读)都完成后 characterJsonText 才落。 */
  function storeReadCount(fileName: string): number {
    return mocks.projectReadText.mock.calls.filter(
      (call) => (call[0] as { relativePath: string }).relativePath.endsWith(fileName),
    ).length;
  }

  async function waitForStoreTextLoaded(fileName: string, baselineReads = 0): Promise<void> {
    await waitFor(() => {
      expect(storeReadCount(fileName)).toBeGreaterThanOrEqual(baselineReads + 2);
    });
  }

  it("无衣物定妆 gate 吃 JSON body_baseSubject;改 store JSON 后 gate 句随变", async () => {
    stubStoreFiles({
      "store/assets/files/prompts/小杂役.json": JSON.stringify({
        asset_type: "role",
        body_base: { 主体词: "store素体主体句甲" },
      }),
    });
    const view = renderDialog();
    await waitForStoreTextLoaded("小杂役.json");

    // 无衣物定妆=t2i 型(零图可点):节头钮派发,gate 主体句=JSON body_base
    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));
    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(1));
    expect(mocks.typeShot.mock.calls[0]?.[0]).toMatchObject({
      kind: "无衣物定妆",
      subjectText: "store素体主体句甲",
    });

    // 改 store JSON(body_base 换值)→重开弹窗→gate 句随变
    view.unmount();
    invalidateAssetPromptInfoCache();
    const baseline = storeReadCount("小杂役.json");
    stubStoreFiles({
      "store/assets/files/prompts/小杂役.json": JSON.stringify({
        asset_type: "role",
        body_base: { 主体词: "store素体主体句乙(用户已改)" },
      }),
    });
    renderDialog();
    await waitForStoreTextLoaded("小杂役.json", baseline);
    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));
    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(2));
    expect(mocks.typeShot.mock.calls[1]?.[0]).toMatchObject({
      subjectText: "store素体主体句乙(用户已改)",
    });
  });
});

describe("StudioAssetDetailDialog store 位提示词真源接线(repo 角色·晏燎)", () => {
  function yanliaoAsset(): StudioAssetSummary {
    return roleAsset({ id: "role-yanliao", name: "晏燎", prompt: "陈旧 DB 种子句" });
  }

  it("store 命中时文本来自 store:目录面板呈现 store 值,派发吃 store 素体句", async () => {
    stubStoreFiles({
      "store/assets/files/prompts/晏燎.json": JSON.stringify({
        body_base: { 主体词: "repo角色的store编辑素体句" },
      }),
    });
    renderDialog(yanliaoAsset());

    // repo 角色:人物提示词面板照旧(catalog 由文本驱动,文本来自 store)。
    // 值断言用 findByText 容一次瞬时兜底渲染:探测链偶发失利时首轮 load 落 repo
    // 种子文本,storePromptInfo 命中后重载即覆写为 store 文本(settled 态为本测语义)。
    expect(await screen.findByText("人物基底·素体")).toBeTruthy();
    expect(await screen.findByText(/repo角色的store编辑素体句/)).toBeTruthy();

    // 镜像派发吃 store 文本(无衣物定妆 gate→body_base=store 值)
    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));
    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(1));
    expect(mocks.typeShot.mock.calls[0]?.[0]).toMatchObject({
      kind: "无衣物定妆",
      subjectText: "repo角色的store编辑素体句",
    });
  });

  it("store 未命中→repo 链照旧(bundled 素体句可派发)", async () => {
    renderDialog(yanliaoAsset());
    expect(await screen.findByText("人物基底·素体")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));
    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(1));
    const subjectText = (mocks.typeShot.mock.calls[0]?.[0] as { subjectText: string }).subjectText;
    expect(subjectText).toContain("素体");
    expect(subjectText).not.toBe("陈旧 DB 种子句");
  });
});
