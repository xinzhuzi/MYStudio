// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 1115 fire F2③⑥:H3 落账共用真身测试——与 comfy-bridge-writeback-consumer
// defaultApplyVideoToStoryboard(:99-136)逐字段同构断言 + 存量回流域配对纯函数
// (1:1 升序/前缀映射/条数不等拒配/policy 交叉核对)+ 挂载执行器(幂等零二次写)。
import { beforeEach, describe, expect, it } from "vitest";

import {
  landFireArchiveH3Videos,
  landH3ShotVideo,
  pairFireArchiveH3Videos,
  probeH3VideoDurationUs,
  type FireArchiveMediaEntryInput,
} from "@/lib/assist/image-studio/h3-shot-landing";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

function shot(partial: Partial<StoryboardItem> & { id: string; index: number }): StoryboardItem {
  return {
    episodeId: "chapter-001",
    trackKey: `track-${partial.index}`,
    trackId: `track-${partial.index}`,
    duration: 6,
    prompt: "剑修立于竹林。",
    videoDesc: "剑修立于竹林。",
    lines: partial.lines ?? "独孤剑尘：台词。",
    state: "ready",
    ...partial,
  } as StoryboardItem;
}

const SHOTS = [
  shot({ id: "sb-1", index: 1, mediaRef: { kind: "image", path: "p1" } }),
  shot({ id: "sb-2", index: 2, mediaRef: { kind: "image", path: "p2" }, lines: "旁白行无冒号。" }),
  shot({ id: "sb-3", index: 3, mediaRef: { kind: "video", path: "old.mp4" } }),
];

beforeEach(() => {
  useStudioStore.setState({ storyboards: [...SHOTS], videoCandidates: [] } as never, false);
});

describe("landH3ShotVideo(落账正门,与消费器 defaultApplyVideoToStoryboard 同构)", () => {
  it("mediaRef=video+outputVersion+1+h3DurationUs 守卫+h3AudioPolicy+full未设混音→h3-baked+候选台账", () => {
    const candidateId = landH3ShotVideo({
      storyboardId: "sb-1",
      url: "project-file://p1/media/ai-video/2026-11/a.mp4",
      policy: "full",
      h3DurationUs: 5_166_666,
      bridgeItemId: 91,
      originProjectId: "p1",
    });
    expect(candidateId).toBe("h3-sb-1-1");
    const shot1 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1");
    expect(shot1?.mediaRef).toEqual({ kind: "video", path: "project-file://p1/media/ai-video/2026-11/a.mp4" });
    expect(shot1?.outputVersion).toBe(1);
    expect(shot1?.h3DurationUs).toBe(5_166_666);
    expect(shot1?.h3AudioPolicy).toBe("full");
    expect(shot1?.audioMix).toBe("h3-baked"); // Q6:full 且未显式设混音
    const candidate = useStudioStore.getState().videoCandidates[0];
    expect(candidate).toMatchObject({
      id: "h3-sb-1-1",
      trackId: "track-1",
      provider: "h3-comfyui",
      filePath: "project-file://p1/media/ai-video/2026-11/a.mp4",
      state: "ready",
      meta: { policy: "full", bridgeItemId: 91, originProjectId: "p1", storyboardId: "sb-1" },
    });
  });

  it("ambient 不写 audioMix;用户已设混音不覆写;候选 id 对存量重数防撞", () => {
    useStudioStore.setState({
      storyboards: [SHOTS[0]!, shot({ id: "sb-2", index: 2, audioMix: "tts-stack", lines: "旁白行无冒号。" }), SHOTS[2]!],
      videoCandidates: [{
        id: "h3-sb-2-1", trackId: "track-2", provider: "h3-comfyui",
        filePath: "project-file://p1/old.mp4", state: "ready",
        meta: { policy: "full", storyboardId: "sb-2" }, createdAt: 1,
      }],
    } as never, false);
    const idAmbient = landH3ShotVideo({
      storyboardId: "sb-1", url: "project-file://p1/a2.mp4", policy: "ambient", bridgeItemId: "backfill:sb-1",
    });
    expect(idAmbient).toBe("h3-sb-1-1");
    expect(useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")?.audioMix).toBeUndefined();
    const idSecond = landH3ShotVideo({
      storyboardId: "sb-2", url: "project-file://p1/a3.mp4", policy: "full", bridgeItemId: 92,
    });
    expect(idSecond).toBe("h3-sb-2-2"); // 存量 1 条 → 重数 2 防撞
    expect(useStudioStore.getState().storyboards.find((item) => item.id === "sb-2")?.audioMix).toBe("tts-stack"); // 不覆写
  });

  it.each([0, -1, 5.5, Number.NaN, undefined])("假 probe %p → h3DurationUs 拒写且旧值清空", (probeResult) => {
    useStudioStore.setState({
      storyboards: [shot({ id: "sb-1", index: 1, h3DurationUs: 4_000_000 }), ...SHOTS.slice(1)],
    } as never, false);
    landH3ShotVideo({
      storyboardId: "sb-1", url: "project-file://p1/a.mp4", policy: "ambient",
      h3DurationUs: probeResult, bridgeItemId: 1,
    });
    expect(useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")?.h3DurationUs).toBeUndefined();
  });

  it("分镜不在 store=返回 null 零写", () => {
    expect(landH3ShotVideo({ storyboardId: "sb-x", url: "u", policy: "full", bridgeItemId: 1 })).toBeNull();
    expect(useStudioStore.getState().videoCandidates).toHaveLength(0);
  });
});

describe("probeH3VideoDurationUs(主进程探测降级)", () => {
  it("桥不可用(jsdom 无 studioRenderer)→null 不抛错", async () => {
    await expect(probeH3VideoDurationUs("project-file://p1/a.mp4")).resolves.toBeNull();
  });
});

describe("pairFireArchiveH3Videos(存量回流域配对纯函数,F2⑥)", () => {
  const media = (name: string, seq: number): FireArchiveMediaEntryInput => ({
    name,
    url: `project-file://p1/media/ai-video/2026-11/comfy_video_${seq}.mp4`,
  });

  it("镜 index 升序 ↔ 媒体名尾时间戳升序 1:1;policy=名前缀且与 dialogueAudioPolicy 交叉核对", () => {
    // 乱序输入:配对按升序对齐(时序流里第 12/16/19 位是 ambient 片,与 1115 实盘同构)
    const isAmbientPosition = (position1: number) => position1 === 12 || position1 === 16 || position1 === 19;
    const shots = Array.from({ length: 19 }, (_, i) => {
      const index = 19 - i; // 逆序喂入:纯函数须按 index 排齐
      return shot({
        id: `sb-${index}`,
        index,
        lines: isAmbientPosition(index) ? "旁白,无冒号。" : "独孤剑尘：台词。",
      });
    });
    // 时间戳随产线时序递增(i 即入库序),前缀随之分流——逆序喂入由纯函数排齐
    const entries = Array.from({ length: 19 }, (_, i) => {
      const ts = 1_794_720_000 + i * 10_000;
      return media(`${isAmbientPosition(i + 1) ? "ambient" : "full"}_00001__mp4_${ts}`, i + 1);
    }).reverse();
    const pairing = pairFireArchiveH3Videos(shots, entries);
    expect(pairing.countMismatch).toBe(false);
    expect(pairing.mismatchCount).toBe(0);
    expect(pairing.pairs).toHaveLength(19);
    expect(pairing.pairs.map((pair) => pair.shotIndex)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    for (const pair of pairing.pairs) {
      const expectAmbient = pair.shotIndex === 12 || pair.shotIndex === 16 || pair.shotIndex === 19;
      expect(pair.policy).toBe(expectAmbient ? "ambient" : "full");
      expect(pair.policyMismatch).toBe(false);
    }
  });

  it("条数不等=证据链断,恒空对禁盲配(宁缺勿错)", () => {
    const pairing = pairFireArchiveH3Videos(SHOTS, [media("full_00001__mp4_1", 1)]);
    expect(pairing.countMismatch).toBe(true);
    expect(pairing.pairs).toEqual([]);
    expect(pairFireArchiveH3Videos([], []).pairs).toEqual([]);
  });

  it("名前缀与台词政策错位=policyMismatch 标记,不静默采用", () => {
    const pairing = pairFireArchiveH3Videos(
      [shot({ id: "sb-1", index: 1, lines: "独孤剑尘：台词。" })],
      [media("ambient_00001__mp4_1", 1)],
    );
    expect(pairing.pairs[0]?.policyMismatch).toBe(true);
    expect(pairing.mismatchCount).toBe(1);
    // 名前缀不可解析(非 full/ambient)同样标记,不猜
    const weird = pairFireArchiveH3Videos(
      [shot({ id: "sb-1", index: 1, lines: "独孤剑尘：台词。" })],
      [media("clip_00001__mp4_1", 1)],
    );
    expect(weird.pairs[0]?.policyMismatch).toBe(true);
  });
});

describe("landFireArchiveH3Videos(存量挂载执行器,走正门+幂等)", () => {
  it("逐对走 landH3ShotVideo 正门;已 video 镜幂等跳过;mismatch 对不挂载", async () => {
    const pairing = pairFireArchiveH3Videos(
      [SHOTS[0]!, SHOTS[1]!, SHOTS[2]!],
      [
        { name: "full_00001__mp4_1", url: "project-file://p1/media/ai-video/2026-11/v1.mp4" },
        { name: "ambient_00001__mp4_2", url: "project-file://p1/media/ai-video/2026-11/v2.mp4" }, // sb-2=ambient 旁白镜 OK
        { name: "full_00001__mp4_3", url: "project-file://p1/media/ai-video/2026-11/v3.mp4" },
      ],
    );
    expect(pairing.countMismatch).toBe(false);
    const probe = async (url: string) => (url.endsWith("v1.mp4") ? 7_000_000 : null);
    const first = await landFireArchiveH3Videos(pairing.pairs, { probeDurationUs: probe });
    expect(first.landed).toBe(2); // sb-3 已 video 幂等跳过
    expect(first.report.map(({ shotId, status }) => [shotId, status])).toEqual([
      ["sb-1", "landed"],
      ["sb-2", "landed"],
      ["sb-3", "already-video"],
    ]);
    const shot1 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1");
    expect(shot1?.mediaRef).toEqual({ kind: "video", path: "project-file://p1/media/ai-video/2026-11/v1.mp4" });
    expect(shot1?.h3DurationUs).toBe(7_000_000);
    expect(shot1?.h3AudioPolicy).toBe("full");
    expect(shot1?.audioMix).toBe("h3-baked");
    const shot2 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-2");
    expect(shot2?.h3AudioPolicy).toBe("ambient");
    expect(shot2?.h3DurationUs).toBeUndefined(); // 探测失败 null→清空旧值(守卫)
    const candidate1 = useStudioStore.getState().videoCandidates.find((entry) => entry.meta?.storyboardId === "sb-1");
    expect(candidate1?.meta).toMatchObject({ bridgeItemId: "backfill:sb-1", originProjectId: "p1", storyboardId: "sb-1" });

    // 二次跑:全部 already-video,零新增候选零写(幂等)
    const baselineCandidates = useStudioStore.getState().videoCandidates.length;
    const second = await landFireArchiveH3Videos(pairing.pairs, { probeDurationUs: probe });
    expect(second.landed).toBe(0);
    expect(second.report.every((entry) => entry.status === "already-video")).toBe(true);
    expect(useStudioStore.getState().videoCandidates).toHaveLength(baselineCandidates);
  });

  it("policyMismatch 对跳过挂载(宁缺勿错);镜不在册=missing", async () => {
    const mismatchPair = pairFireArchiveH3Videos(
      [shot({ id: "sb-1", index: 1, lines: "独孤剑尘：台词。" })],
      [{ name: "ambient_00001__mp4_1", url: "project-file://p1/media/ai-video/2026-11/v1.mp4" }],
    ).pairs[0]!;
    const report = await landFireArchiveH3Videos([mismatchPair, { ...mismatchPair, shotId: "sb-gone", shotIndex: 9 }]);
    expect(report.landed).toBe(0);
    expect(report.report.map(({ shotId, status }) => [shotId, status])).toEqual([
      ["sb-1", "policy-mismatch"],
      ["sb-gone", "missing"],
    ]);
    expect(useStudioStore.getState().videoCandidates).toHaveLength(0);
  });
});
