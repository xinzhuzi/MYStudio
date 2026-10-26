// @vitest-environment jsdom
/**
 * 角色真源 JSON 弹窗接线测试(10-26 用户令):
 * - 加载/保存/恢复走 vi.mock 的 asset-character-json 域函数(沿 prompt-inspect 范式);
 * - CodeMirror 换常驻替身(jsdom 不跑真编辑器,沿 artifact-detail 对 JsonViewer 的
 *   mock 范式)——本件只钉接线(载入展示/保存参数/恢复重载/错误条),不测编辑器本体;
 * - 桥面经 getStudioSkillsBridge stub 控 editable(桌面=true 可编辑)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("@/lib/studio/asset-character-json", () => ({
  loadCharacterJsonText: mocks.load,
  saveCharacterJsonText: mocks.save,
  restoreCharacterJsonText: mocks.restore,
}));

vi.mock("@/lib/bridge/studio-skills", () => ({
  getStudioSkillsBridge: () => ({ readText: vi.fn(), writeText: vi.fn(), restoreText: vi.fn() }),
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
});

describe("StudioAssetCharacterJsonDialog", () => {
  it("打开即载入并展示存储副本与相对路径", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "storage",
      text: '{"zh":"晏燎"}',
      relativePath: "art_skills/daojie_ink_guofeng/json/晏燎.json",
    });
    render(
      <StudioAssetCharacterJsonDialog open characterName="晏燎" onOpenChange={() => {}} />,
    );

    expect(screen.getByText("角色真源 JSON:晏燎")).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByLabelText("character-json-editor") as HTMLTextAreaElement).value).toBe('{"zh":"晏燎"}');
    });
    expect(screen.getByText("art_skills/daojie_ink_guofeng/json/晏燎.json")).toBeTruthy();
    expect(screen.getByText("存储副本")).toBeTruthy();
  });

  it("保存把编辑文本原样交给域函数;成功后重载", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "storage",
      text: '{"a":1}',
      relativePath: "art_skills/daojie_ink_guofeng/json/晏燎.json",
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
      expect(mocks.save).toHaveBeenCalledWith("晏燎", '{"a":2}');
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

  it("恢复内置版本走域函数并重载", async () => {
    mocks.load.mockResolvedValue({
      status: "ready",
      source: "bundle",
      text: "{}",
      relativePath: "art_skills/daojie_ink_guofeng/json/晏燎.json",
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
      expect(mocks.restore).toHaveBeenCalledWith("晏燎");
    });
    await waitFor(() => {
      expect(mocks.load.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("无真源角色渲染缺位文案且保存/恢复禁用", async () => {
    mocks.load.mockResolvedValue({ status: "missing" });
    render(
      <StudioAssetCharacterJsonDialog open characterName="路人甲" onOpenChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByText("该角色没有真源 JSON")).toBeTruthy();
    });
    expect((screen.getByRole("button", { name: /保存/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /恢复内置版本/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
