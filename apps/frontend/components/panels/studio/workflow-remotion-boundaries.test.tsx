// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RemotionShotPreview } from "./previews/remotion-shot-preview";
import { WorkbenchLanePreview } from "./previews/workbench-lane-preview";
import type { ProductionFlowNodeModel } from "./workflow-node-model";

// 本文件未启用 vitest globals,RTL 不会自动卸载 DOM;两用例同名文案叠加会误判重复匹配。
afterEach(cleanup);

describe("Remotion production UI boundaries", () => {
  it("keeps the production node scoped to independent StoryboardShot MP4 jobs", () => {
    const node = {
      id: "remotionProduction",
      label: "Remotion 单镜生产",
      description: "",
      status: "ready",
      metrics: [],
      previewTitle: "逐镜 Remotion 队列",
      previewLines: [],
      previewKind: "remotion-shots",
      targetStage: "workbench",
      remotionShots: [{
        shotId: "shot-1",
        index: 1,
        title: "雨夜码头",
        status: "succeeded",
        progress: 1,
        outputPath: "/tmp/shot-1.mp4",
        evidencePath: "/tmp/shot-1.json",
        revision: 3,
        ttsStatus: "ready",
        sfxStatus: "ready",
        shotAudioBindingCount: 2,
        ttsInputFingerprint: "tts-input-1234567890",
        bindingFingerprints: ["binding-abcdef123456"],
        chapterSharedAudioReferenced: true,
      }],
      remotionSummary: {
        total: 1,
        succeeded: 1,
        running: 0,
        queued: 0,
        failed: 0,
        blocked: 0,
        stale: 0,
        pending: 0,
        chapterReady: true,
      },
    } satisfies ProductionFlowNodeModel;

    render(<RemotionShotPreview node={node} />);

    const flow = screen.getByLabelText("Remotion 分镜生产链路").textContent ?? "";
    expect(flow.indexOf("单镜合成")).toBeGreaterThan(flow.indexOf("分镜物料"));
    expect(flow.indexOf("单镜 MP4")).toBeGreaterThan(flow.indexOf("单镜合成"));
    expect(flow).not.toContain("原生 Studio");
    expect(flow).not.toContain("ChapterVideo");
    expect(flow).not.toContain("章节 MP4");
    expect(screen.getByText("旁白配音 已就绪")).toBeTruthy();
    expect(screen.getByText("音效 已就绪")).toBeTruthy();
    expect(screen.getByText("背景 BGM 全章共用")).toBeTruthy();
    expect(screen.getByText("音轨 2 条")).toBeTruthy();
    // 指纹彻底不上界面:徽章悬浮提示只剩人话状态说明,不含任何哈希值
    const voiceChip = screen.getByText("旁白配音 已就绪").closest("span");
    expect(voiceChip?.getAttribute("title")).not.toContain("tts-input");
    expect(voiceChip?.getAttribute("title")).not.toContain("binding-");
    expect(screen.queryByText(/TTS 指纹/)).toBeNull();
    expect(screen.queryByText(/绑定指纹/)).toBeNull();
    expect(screen.queryByText(/指纹/)).toBeNull();
  });

  it("orders Studio before ChapterVideo and hides non-Remotion evidence", () => {
    const node = {
      id: "workbench",
      label: "Remotion 视频工作台",
      description: "",
      status: "pending",
      metrics: [],
      previewTitle: "原生 Remotion Studio",
      previewLines: [],
      previewKind: "workbench-lanes",
      targetStage: "workbench",
      workbenchTracks: [],
      rendererSummary: {
        requested: "remotion",
        actual: "ffmpeg",
        fallbackEffectIds: ["glitch"],
        outputPath: "/tmp/legacy-final.mp4",
      },
      remotionSummary: {
        total: 1,
        succeeded: 1,
        running: 0,
        queued: 0,
        failed: 0,
        blocked: 0,
        stale: 0,
        pending: 0,
        chapterReady: true,
      },
    } satisfies ProductionFlowNodeModel;

    render(<WorkbenchLanePreview node={node} />);

    const flow = screen.getByText("单镜 MP4").parentElement?.textContent ?? "";
    expect(flow.indexOf("原生 Remotion Studio")).toBeGreaterThan(
      flow.indexOf("单镜 MP4"),
    );
    expect(flow.indexOf("全章合成")).toBeGreaterThan(
      flow.indexOf("原生 Remotion Studio"),
    );
    expect(flow.indexOf("章节 MP4")).toBeGreaterThan(flow.indexOf("全章合成"));
    expect(screen.queryByText("Remotion → FFmpeg")).toBeNull();
    expect(screen.queryByText("/tmp/legacy-final.mp4")).toBeNull();
    expect(screen.getByText("尚未验证成片")).toBeTruthy();
  });
});
