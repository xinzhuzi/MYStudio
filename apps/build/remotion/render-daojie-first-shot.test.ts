// @vitest-environment node

import { describe, expect, it } from "vitest";
import { validateStoryboardShotCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import {
  buildFirstShotCompositionProps,
  loadFirstShotSource,
} from "./render-daojie-first-shot";

const CAPABILITY = "http://127.0.0.1:43123/";
const TOKEN = "a".repeat(64);

describe("Daojie chapter-001 first-shot preview", () => {
  it("loads the exact persisted first-shot identity and source fields", async () => {
    const source = await loadFirstShotSource();
    expect(source).toMatchObject({
      projectId: "49dce4c1-64b1-42de-85c2-9f266698aec0",
      chapterId: "chapter-001",
      shotId: "sb-chapter-001-001",
      index: 1,
      imagePath: "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0/exports/chapter-001/toonflow_frames/shot-001.png",
      audioPath: "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0/exports/chapter-001/toonflow_audio/shot-001.wav",
      imageSha256: "7426dbd16d47a6e60b799ed6c99b444da2ce7af9b62f9f65ce53b25928f7d0b8",
      audioSha256: "da6b78dc0941e347771eb2fbb2b15ecc2b0c15dd6e3aecb68c6055bbc86a1840",
      subtitle: "傍晚，金水河码头被太一宗火印压醒。",
      prompt: "赤练蛇皮鞭撕开河雾，青盐水挂在鞭梢，朱红火印压在藤筐侧面。",
      durationTarget: 4.2,
      state: "ready",
      stale: true,
      staleReason: "连续性结构已更新，必须重新生成并审核",
    });
    expect(source.visualReview).toMatchObject({ status: "pending" });
  });

  it("builds props accepted by the StoryboardShot validator", async () => {
    const source = await loadFirstShotSource();
    const props = buildFirstShotCompositionProps(source, {
      visual: `${CAPABILITY}${TOKEN}/visual`,
      voice: `${CAPABILITY}${TOKEN}/voice`,
    });
    const validation = validateStoryboardShotCompositionProps(props);
    expect(validation).toEqual({ success: true, value: props });
    expect(props).toMatchObject({
      target: "shot",
      projectId: source.projectId,
      chapterId: source.chapterId,
      shotId: source.shotId,
      durationInFrames: 126,
      subtitles: [{ text: source.subtitle, from: 0, durationInFrames: 126 }],
    });
    expect(props.audioClips).toHaveLength(1);
    expect(props.audioClips[0]).toMatchObject({ kind: "voice", renderScope: "shot", durationInFrames: 126 });
  });
});
