import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import type { RemotionImportedAudioV2 } from "@/types/remotion-workspace";
import type { StoryboardItem } from "@/types/studio";
import {
  buildShotSfxBinding,
  normalizeSfxPrompt,
  parseCliArgs,
  planShotSfxBatch,
  sfxSeedForIndex,
} from "./batch-shot-sfx";

function storyboard(id: string, index: number, sound: string | null): StoryboardItem {
  return { id, index, sound } as unknown as StoryboardItem;
}

function imported(contentSha256: string, durationUs: number): RemotionImportedAudioV2 {
  return {
    source: {
      kind: "project-file",
      projectId: "proj-test",
      relativePath: `remotion/audio/chapter-001/shots/sb-001/sfx/${contentSha256}.wav`,
      contentSha256,
    },
    durationUs,
    streams: ["audio"],
    sizeBytes: 1000,
  } as unknown as RemotionImportedAudioV2;
}

describe("normalizeSfxPrompt", () => {
  it("去「音效:」/「音效：」前缀", () => {
    expect(normalizeSfxPrompt("音效：脚踩碎砂的轻响、灶房勺声")).toBe("脚踩碎砂的轻响、灶房勺声");
    expect(normalizeSfxPrompt("音效: 呼啸声")).toBe("呼啸声");
  });

  it("无前缀原样保留;空值返回 null", () => {
    expect(normalizeSfxPrompt("  呼啸声 ")).toBe("呼啸声");
    expect(normalizeSfxPrompt("")).toBeNull();
    expect(normalizeSfxPrompt(null)).toBeNull();
    expect(normalizeSfxPrompt(undefined)).toBeNull();
  });
});

describe("sfxSeedForIndex", () => {
  it("与 TTS 链同约定 41001+index", () => {
    expect(sfxSeedForIndex(0)).toBe(41001);
    expect(sfxSeedForIndex(41)).toBe(41042);
  });
});

describe("planShotSfxBatch", () => {
  const storyboards = new Map<string, StoryboardItem>([
    ["sb-1", storyboard("sb-1", 0, "音效：铁链声")],
    ["sb-2", storyboard("sb-2", 1, "音效：脚步声")],
    ["sb-4", storyboard("sb-4", 3, "")],
  ]);
  const manifestShots = [
    { shotId: "sb-1", revision: 1, audioBindings: [{ role: "voice" }] },
    { shotId: "sb-2", revision: 3, audioBindings: [{ role: "voice" }, { role: "sfx" }] },
    { shotId: "sb-3", revision: 1, audioBindings: [{ role: "voice" }] },
    { shotId: "sb-4", revision: 1, audioBindings: [] },
  ];

  it("三类跳过+目标计划(含 seed 与 revision 钳制)", () => {
    const plan = planShotSfxBatch({ manifestShots, storyboardsById: storyboards });
    expect(plan.targets).toEqual([
      { shotId: "sb-1", prompt: "铁链声", seed: 41001, shotRevision: 1 },
    ]);
    expect(plan.skipped).toEqual([
      { shotId: "sb-2", reason: "already-bound" },
      { shotId: "sb-3", reason: "storyboard-missing" },
      { shotId: "sb-4", reason: "sound-empty" },
    ]);
  });
});

describe("buildShotSfxBinding", () => {
  it("与 WorkbenchTab 同款字段+封印自洽", async () => {
    const sha = crypto.createHash("sha256").update("wav-bytes").digest("hex");
    const binding = await buildShotSfxBinding({
      projectId: "proj-test",
      chapterId: "chapter-001",
      shotId: "sb-1",
      shotRevision: 2,
      imported: imported(sha, 3_000_000),
    });
    expect(binding.bindingId).toBe(`sfx:sb-1:${sha.slice(0, 16)}`);
    expect(binding.role).toBe("sfx");
    expect(binding.shotRevision).toBe(2);
    expect(binding.durationUs).toBe(3_000_000);
    expect(binding.envelope).toEqual([
      { timeUs: 0, gain: 1 },
      { timeUs: 3_000_000, gain: 1 },
    ]);
    const { bindingFingerprint: _drop, ...rest } = binding;
    expect(binding.bindingFingerprint).toBe(await sha256CanonicalJson(rest));
  });
});

describe("parseCliArgs", () => {
  it("解析参数与默认值", () => {
    expect(parseCliArgs(["--project", "/tmp/p", "--seconds", "4"])).toEqual({
      projectDir: "/tmp/p",
      seconds: 4,
      dryRun: false,
    });
    expect(parseCliArgs(["--dry-run"])).toEqual({ seconds: 3, dryRun: true });
  });

  it("未知参数报错", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow("未知参数");
  });
});
