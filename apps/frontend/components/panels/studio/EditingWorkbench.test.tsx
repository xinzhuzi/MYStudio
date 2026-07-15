// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditingProjectV1 } from "@/types/editing";
import { EditingWorkbench } from "./EditingWorkbench";

afterEach(cleanup);

describe("EditingWorkbench", () => {
  it("shows the draft call to action before a timeline exists", () => {
    const onCreateDraft = vi.fn();
    renderWorkbench({ project: undefined, onCreateDraft });

    expect(screen.getByRole("heading", { name: "还没有可编辑时间线" })).toBeTruthy();
    const draftButtons = screen.getAllByRole("button", { name: "一键剪辑" });
    fireEvent.click(draftButtons[draftButtons.length - 1]!);
    expect(onCreateDraft).toHaveBeenCalledOnce();
  });

  it("renders four zones and emits selection, trim, split, undo and redo actions", () => {
    const onExecuteCommand = vi.fn(() => true);
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderWorkbench({ project: editingProject(), onExecuteCommand, onUndo, onRedo });

    expect(screen.getByLabelText("素材区")).toBeTruthy();
    expect(screen.getByLabelText("预览区")).toBeTruthy();
    expect(screen.getByLabelText("属性区")).toBeTruthy();
    expect(screen.getByLabelText("时间线区")).toBeTruthy();
    expect(screen.getByText("人工保护")).toBeTruthy();
    expect(screen.getByText("上游已变化")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "选择片段 旁白 1" }));
    expect(screen.getByLabelText("旁白 1 音频预览")).toBeTruthy();
    expect(screen.getByLabelText("旁白 1 波形")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("开始（秒）"), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText("时长（秒）"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("源偏移（秒）"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "应用裁切" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "clip.trim",
      clipId: "voice-1",
      startUs: 1_250_000,
      durationUs: 2_500_000,
      trimStartUs: 500_000,
    }));

    fireEvent.change(screen.getByLabelText("音量"), { target: { value: "0.8" } });
    fireEvent.click(screen.getByLabelText("静音"));
    fireEvent.change(screen.getByLabelText("淡入（秒）"), { target: { value: "0.12" } });
    fireEvent.change(screen.getByLabelText("淡出（秒）"), { target: { value: "0.4" } });
    fireEvent.change(screen.getByLabelText("包络（秒:增益，逗号分隔）"), { target: { value: "0:0.5, 1:1" } });
    fireEvent.click(screen.getByRole("button", { name: "应用音频" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "clip.updateAudio",
      clipId: "voice-1",
      volume: 0.8,
      muted: true,
      fadeInUs: 120_000,
      fadeOutUs: 400_000,
      envelope: [{ timeUs: 0, gain: 0.5 }, { timeUs: 1_000_000, gain: 1 }],
    }));

    fireEvent.click(screen.getByRole("button", { name: "中点切分" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "clip.split",
      clipId: "voice-1",
      splitAtUs: 2_000_000,
    }));

    fireEvent.click(screen.getByRole("button", { name: "选择片段 字幕 1" }));
    fireEvent.change(screen.getByLabelText("字幕文本"), { target: { value: "人工字幕" } });
    fireEvent.click(screen.getByRole("button", { name: "应用字幕文本" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "clip.updateText",
      clipId: "subtitle-1",
      text: "人工字幕",
    }));

    fireEvent.click(screen.getByRole("button", { name: "撤销上一次剪辑" }));
    fireEvent.click(screen.getByRole("button", { name: "重做下一次剪辑" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("routes subtitle import and export through typed callbacks", () => {
    const onImportSubtitles = vi.fn(async () => undefined);
    const onExportSubtitles = vi.fn(async () => undefined);
    renderWorkbench({ onImportSubtitles, onExportSubtitles });
    const file = new File(["1\n00:00:00,000 --> 00:00:01,000\n字幕\n"], "chapter.srt", { type: "text/plain" });

    fireEvent.change(screen.getByLabelText("导入字幕文件"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "导出 SRT" }));

    expect(onImportSubtitles).toHaveBeenCalledWith(file);
    expect(onExportSubtitles).toHaveBeenCalledOnce();
  });

  it("shows proposal evidence and emits typed modify, accept, batch, reject and disable commands", () => {
    const project = editingProject();
    project.proposals = [
      {
        id: "proposal-pending",
        effectId: "glow",
        targetClipId: "visual-1",
        startUs: 0,
        durationUs: 1_000_000,
        params: { intensity: 0.4 },
        reason: "增强高光",
        confidence: 0.8,
        sourceEvidence: { storyboardId: "sb-1", sourceRunId: "run-1" },
        status: "pending",
      },
      {
        id: "proposal-accepted",
        effectId: "blur",
        targetClipId: "visual-1",
        startUs: 1_000_000,
        durationUs: 1_000_000,
        params: { radius: 4 },
        reason: "聚焦主体",
        confidence: 0.7,
        sourceEvidence: { storyboardId: "sb-1" },
        status: "accepted",
      },
    ];
    project.effects = [{
      id: "effect-from-proposal-proposal-accepted",
      effectId: "blur",
      targetClipId: "visual-1",
      startUs: 1_000_000,
      durationUs: 1_000_000,
      params: { radius: 4 },
      enabled: true,
      proposalId: "proposal-accepted",
    }];
    const onExecuteCommand = vi.fn(() => true);
    renderWorkbench({ project, onExecuteCommand });

    expect(screen.getByLabelText("AI 剪辑建议")).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getAllByText(/storyboardId=sb-1/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("建议 proposal-pending 效果"), { target: { value: "blur" } });
    fireEvent.change(screen.getByLabelText("建议 proposal-pending 参数 radius"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("建议 proposal-pending 理由"), { target: { value: "人工聚焦" } });
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "proposal.modify",
      proposalId: "proposal-pending",
      patch: expect.objectContaining({ effectId: "blur", params: { radius: 8 }, reason: "人工聚焦" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "接受 proposal-pending" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "proposal.accept", proposalIds: ["proposal-pending"] }));
    fireEvent.click(screen.getByRole("button", { name: "批量接受 1" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "proposal.accept", proposalIds: ["proposal-pending"] }));
    fireEvent.click(screen.getByRole("button", { name: "拒绝 proposal-pending" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "proposal.reject", proposalId: "proposal-pending" }));
    fireEvent.click(screen.getByRole("button", { name: "禁用 proposal-accepted" }));
    expect(onExecuteCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "proposal.disable", proposalId: "proposal-accepted" }));
  });

  it("applies enabled effects to browser preview and labels approximate output", () => {
    const project = editingProject();
    project.effects = [
      { id: "blur-1", effectId: "blur", targetClipId: "visual-1", startUs: 0, durationUs: 1_000_000, params: { radius: 4 }, enabled: true },
      { id: "glitch-1", effectId: "glitch", targetClipId: "visual-1", startUs: 1_000_000, durationUs: 1_000_000, params: { intensity: 0.4 }, enabled: true },
    ];
    renderWorkbench({ project });

    const preview = screen.getByAltText("分镜 1 预览") as HTMLImageElement;
    expect(preview.style.filter).toContain("blur(4px)");
    expect(preview.style.filter).toContain("contrast(1.12)");
    expect(screen.getByText("近似预览，最终效果以 FFmpeg 成片为准")).toBeTruthy();
  });
});

function renderWorkbench(overrides: Partial<React.ComponentProps<typeof EditingWorkbench>> = {}) {
  const props: React.ComponentProps<typeof EditingWorkbench> = {
    project: editingProject(),
    drafting: false,
    rendering: false,
    canUndo: true,
    canRedo: true,
    onCreateDraft: vi.fn(),
    onRender: vi.fn(),
    onCancelRender: vi.fn(),
    onExecuteCommand: vi.fn(() => true),
    onImportSubtitles: vi.fn(async () => undefined),
    onExportSubtitles: vi.fn(async () => undefined),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
  return render(<EditingWorkbench {...props} />);
}

function editingProject(): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-1",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "第一章人工版本",
    revision: 3,
    sourceSnapshotHash: "snapshot-1",
    createdBy: "manual",
    manuallyEdited: true,
    stale: true,
    staleReason: "source snapshot changed",
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    },
    tracks: [
      { id: "visual", kind: "video", name: "主画面", order: 0, clipIds: ["visual-1"], muted: false, locked: false },
      { id: "voice", kind: "voice", name: "旁白", order: 1, clipIds: ["voice-1"], muted: false, locked: false },
      { id: "subtitle", kind: "text", name: "字幕", order: 2, clipIds: ["subtitle-1"], muted: false, locked: false },
    ],
    clips: [
      {
        id: "visual-1",
        trackId: "visual",
        name: "分镜 1",
        source: { kind: "storyboardImage", path: "/tmp/shot.png", evidence: { storyboardId: "sb-1" } },
        startUs: 0,
        durationUs: 4_000_000,
        trimStartUs: 0,
        speed: 1,
        volume: 0,
        muted: true,
      },
      {
        id: "voice-1",
        trackId: "voice",
        name: "旁白 1",
        source: { kind: "audio", path: "/tmp/voice.wav", evidence: { storyboardId: "sb-1" } },
        startUs: 0,
        durationUs: 4_000_000,
        trimStartUs: 0,
        speed: 1,
        volume: 1,
        muted: false,
      },
      {
        id: "subtitle-1",
        trackId: "subtitle",
        name: "字幕 1",
        source: { kind: "text", text: "原字幕", evidence: { storyboardId: "sb-1" } },
        startUs: 0,
        durationUs: 4_000_000,
        trimStartUs: 0,
        speed: 1,
        volume: 1,
        muted: false,
        subtitle: { sourceFormat: "generated" },
      },
    ],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 3,
  };
}
