// @vitest-environment jsdom
/**
 * 批0a 回归网:云端图片 URL 已返回、保存段抛错时,资产生成动作(handleGenerateSingle)
 * 必须给用户可见失败(toast.error 带原因),禁静默——1010 道具装机实弹:生成完成后
 * 保存段静默死(无落盘/无 DB 行/无失败日志),用户端零提示。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useScriptAssetGenerationActions } from "./useScriptAssetGenerationActions";
import type { AssetRow } from "./script-asset-generation-model";

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    // 模拟凡人 gpt-image-2 回落链终点:生成完成,云端 URL 已到手
    image: vi.fn().mockResolvedValue({ imageUrl: "https://cdn.fanren.example/task_UorM.png" }),
  },
}));

vi.mock("@/lib/ai/prompt-polisher", () => ({
  batchPolishAssetPrompts: vi.fn(),
  selectDaojiePaletteSchemeForAsset: vi.fn().mockResolvedValue(null),
  sanitizeExtendedManualPrompt: vi.fn((text: string) => text),
  polishAssetPrompt: vi.fn().mockResolvedValue({
    status: "success",
    prompt: "polished prop prompt",
    negativePrompt: "",
  }),
}));

vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: vi.fn().mockResolvedValue("local-image://props/prop.png"),
  getAbsoluteImagePath: vi.fn().mockResolvedValue(null),
  resolveImagePath: vi.fn((path: string) => path),
}));

const PROP_ROW: AssetRow = {
  type: "prop",
  id: "prop-suolinglian",
  name: "锁灵链",
  note: "缚灵古链",
  asset: {
    id: "prop-suolinglian",
    name: "锁灵链",
    description: "缚灵古链",
    imageUrl: "",
    folderId: null,
    projectId: "proj-1",
    createdAt: 1,
  },
};

function renderActionsHook() {
  return renderHook(() =>
    useScriptAssetGenerationActions({
      activeType: "prop",
      visualManualId: "ink",
      currentRows: [PROP_ROW],
      activeProjectId: "proj-1",
      productionEpisodeId: "ep-1",
    }),
  );
}

describe("useScriptAssetGenerationActions.handleGenerateSingle 保存失败可见性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as any).projectFiles;
    delete (window as any).studioAssets;
    (usePropsLibraryStore as any).persist?.setOptions({
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    usePropsLibraryStore.setState({
      items: [PROP_ROW.asset as never],
      folders: [],
      selectedFolderId: "all",
    });
  });

  it("云端 URL 返回后保存抛错→toast.error 带保存失败原因,不伪成功", async () => {
    // 保存段实弹病灶形态:projectFiles.saveImage IPC 落盘时抛错
    (window as any).projectFiles = {
      saveImage: vi.fn().mockRejectedValue(new Error("项目磁盘写入失败")),
    };

    const { result } = renderActionsHook();
    act(() => {
      result.current.setNotFoundAsset(PROP_ROW);
    });
    act(() => {
      result.current.handleGenerateSingle();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    const message = vi.mocked(toast.error).mock.calls[0][0];
    expect(message).toContain("锁灵链");
    expect(message).toContain("图片保存失败");
    expect(message).toContain("项目磁盘写入失败");
    // 禁静默的另一面:绝不伪成功
    expect(toast.success).not.toHaveBeenCalled();
    // 道具行不得被写入任何图片地址(盘上没有文件)
    const prop = usePropsLibraryStore.getState().getPropById("prop-suolinglian");
    expect(prop?.imageUrl).toBe("");
    expect(aiManager.image).toHaveBeenCalledOnce();
  });

  it("保存成功链保持成功 toast(回归护栏,确保新失败路径不误伤正常链)", async () => {
    (window as any).projectFiles = {
      saveImage: vi.fn().mockResolvedValue({
        success: true,
        url: "project-file://proj-1/workflow-images/assets/prop/prop-suolinglian-1.png",
      }),
    };

    const { result } = renderActionsHook();
    act(() => {
      result.current.setNotFoundAsset(PROP_ROW);
    });
    act(() => {
      result.current.handleGenerateSingle();
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "「锁灵链」资产生成成功",
        expect.objectContaining({ id: expect.stringContaining("script-asset-generate") }),
      );
    });
    expect(toast.error).not.toHaveBeenCalled();
    const prop = usePropsLibraryStore.getState().getPropById("prop-suolinglian");
    expect(prop?.imageUrl).toBe(
      "project-file://proj-1/workflow-images/assets/prop/prop-suolinglian-1.png",
    );
  });
});
