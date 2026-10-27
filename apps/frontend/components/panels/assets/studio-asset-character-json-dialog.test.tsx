// @vitest-environment jsdom
/**
 * 提示词真源 JSON 弹窗接线测试(10-26 用户令;10-27 store 位接线扩):
 * - 加载/保存/恢复走 vi.mock 的 asset-character-json 域函数(沿 prompt-inspect 范式);
 * - CodeMirror 换常驻替身(jsdom 不跑真编辑器,沿 artifact-detail 对 JsonViewer 的
 *   mock 范式)——本件只钉接线(载入展示/保存参数/恢复重载/错误条),不测编辑器本体;
 * - 桥面经 getProjectFilesBridge stub 控 editable(写路已迁项目库 store 位,10-27);
 * - source='store' 徽标=『项目真源』;store-only 无种子→恢复钮不渲染(条件渲染)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  projectWriteText: vi.fn(),
}));

vi.mock("@/lib/studio/asset-character-json", () => ({
  loadCharacterJsonText: mocks.load,
  saveCharacterJsonText: mocks.save,
  restoreCharacterJsonText: mocks.restore,
}));

vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({ readText: vi.fn(), writeText: mocks.projectWriteText }),
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange }: { value: string; onChange?: (next: string) => void }) => (
    <textarea
      aria-label="character-json-editor"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  EditorView: { theme: () => [] },
}));

import { StudioAssetCharacterJsonDialog } from "./studio-asset-character-json-dialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mocks.load.mockReset();
  mocks.save.mockReset();
  mocks.restore.mockReset();
  mocks.projectWriteText.mockReset().mockResolvedValue({ success: true });
});

describe("StudioAssetCharacterJsonDialog", () => {
  it("打开即载入并展示存储副本与相对路径", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "storage",
      text: '{"zh":"晏燎"}',
      relativePath: "art_skills/daojie_ink_guofeng/json/晏燎.json",
      seedAvailable: true,
    });
    render(
      <StudioAssetCharacterJsonDialog open characterName="晏燎" onOpenChange={() => {}} />,
    );

    expect(screen.getByText("角色提示词真源:晏燎")).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByLabelText("character-json-editor") as HTMLTextAreaElement).value).toBe('{"zh":"晏燎"}');
    });
    expect(screen.getByText("art_skills/daojie_ink_guofeng/json/晏燎.json")).toBeTruthy();
    expect(screen.getByText("存储副本")).toBeTruthy();
    expect(mocks.load).toHaveBeenCalledWith("晏燎", undefined);
  });

  it("store 位命中出『项目真源』徽标;标题随 type(场景)", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "store",
      text: '{"asset_type":"scene"}',
      relativePath: "store/assets/files/prompts/山门远景.json",
      seedAvailable: false,
    });
    render(
      <StudioAssetCharacterJsonDialog open characterName="山门远景" type="scene" onOpenChange={() => {}} />,
    );
    expect(screen.getByText("场景提示词真源:山门远景")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("项目真源")).toBeTruthy();
    });
    expect(mocks.load).toHaveBeenCalledWith("山门远景", "scene");
  });

  it("保存把编辑文本连同 type 原样交给域函数;成功后重载", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "storage",
      text: '{"a":1}',
      relativePath: "art_skills/daojie_ink_guofeng/json/晏燎.json",
      seedAvailable: true,
    });
    mocks.save.mockResolvedValue({ ok: true });
    render(
      <StudioAssetCharacterJsonDialog open characterName="晏燎" onOpenChange={() => {}} />,
    );
    await waitFor(() => {
      expect((screen.getByLabelText("character-json-editor") as HTMLTextAreaElement).value).toBe('{"a":1}');
    });

    fireEvent.change(screen.getByLabelText("character-json-editor"), { target: { value: '{"a":2}' } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith("晏燎", '{"a":2}', undefined);
    });
    // 成功后重载一次(load 被再次调用)
    await waitFor(() => {
      expect(mocks.load.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("保存失败展示错误条不重载", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "storage",
      text: "{}",
      relativePath: "art_skills/daojie_ink_guofeng/json/晏燎.json",
      seedAvailable: true,
    });
    mocks.save.mockResolvedValue({ ok: false, error: "JSON 格式无效:Unexpected token }" });
    render(
      <StudioAssetCharacterJsonDialog open characterName="晏燎" onOpenChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("character-json-editor")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      expect(screen.getByText(/JSON 格式无效:Unexpected token/)).toBeTruthy();
    });
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("有种子真源:恢复内置版本走域函数并重载", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "bundle",
      text: "{}",
      relativePath: "art_skills/daojie_ink_guofeng/json/晏燎.json",
      seedAvailable: true,
    });
    mocks.restore.mockResolvedValue({ ok: true });
    render(
      <StudioAssetCharacterJsonDialog open characterName="晏燎" onOpenChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByText("内置种子")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /恢复内置版本/ }));
    await waitFor(() => {
      expect(mocks.restore).toHaveBeenCalledWith("晏燎", undefined);
    });
    await waitFor(() => {
      expect(mocks.load.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("store-only 无种子:恢复钮不渲染(条件渲染替代仅禁用)", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "store",
      text: '{"asset_type":"role"}',
      relativePath: "store/assets/files/prompts/小杂役.json",
      seedAvailable: false,
    });
    render(
      <StudioAssetCharacterJsonDialog open characterName="小杂役" type="role" onOpenChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByText("项目真源")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /恢复内置版本/ })).toBeNull();
    expect((screen.getByRole("button", { name: /保存/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("无真源资产渲染缺位文案且保存禁用", async () => {
    mocks.load.mockResolvedValue({ status: "missing" });
    render(
      <StudioAssetCharacterJsonDialog open characterName="路人甲" onOpenChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByText("该资产没有提示词真源 JSON")).toBeTruthy();
    });
    expect((screen.getByRole("button", { name: /保存/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /恢复内置版本/ })).toBeNull();
  });

  it("editable 判定随 projectFiles 桥:桥面 writeText 在=可编辑(只读提示不出现)", async () => {
    const { getProjectFilesBridge } = await import("@/lib/bridge/project-files");
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "store",
      text: "{}",
      relativePath: "store/assets/files/prompts/小杂役.json",
      seedAvailable: false,
    });
    render(
      <StudioAssetCharacterJsonDialog open characterName="小杂役" type="role" onOpenChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("character-json-editor")).toBeTruthy();
    });
    expect(getProjectFilesBridge()?.writeText).toBeTruthy();
    expect(screen.queryByText("当前环境只读,请在桌面版中编辑")).toBeNull();
  });
});
