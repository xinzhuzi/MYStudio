import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import type { StoryboardItem } from "@/types/studio";
import type { VoiceProfile } from "@/types/tts";
import {
  buildChapterLedger,
  computeBindingFingerprint,
  computeManifestFingerprint,
  computeVoiceImportFingerprint,
  matchVoiceProfileForShot,
  parseCliArgs,
  parseVoiceBindingId,
  renderTtsLedgerMarkdown,
  type TtsLedgerIo,
  type VoiceProfileCandidate,
} from "./tts-ledger-export";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const PROJECT_ID = "proj-test";
const CHAPTER_ID = "chapter-001";
const REFERENCE_SHA = sha256("reference-audio-bytes");

function makeProfile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "voice-profile-a",
    name: "音色A",
    type: "reference",
    language: "zh",
    defaultEngine: "qwen",
    defaultModelSize: "1.7B",
    referenceAudioPath: "asset-file://audio/ref-a.wav",
    referenceText: "参考文本",
    instruct: "中年",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as VoiceProfile;
}

function candidate(profile: VoiceProfile, referenceAudioSha256: string | null): VoiceProfileCandidate {
  return { profile, referenceAudioSha256 };
}

function makeStoryboard(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-chapter-001-001",
    index: 0,
    outputVersion: 4,
    speaker: "管事",
    speakerId: "speaker-guanshi",
    emotion: "沉稳",
    voiceStyle: null,
    ttsSpokenText: "这是第一镜的口播文本。",
    line: "管事沉声道。",
    ttsJob: null,
    ...overrides,
  } as StoryboardItem;
}

async function makeSealedBinding(shotId: string, overrides: Record<string, unknown> = {}) {
  const audioSha = sha256("fake-audio-001");
  // ttsInputFingerprint 用配音室导入链真公式封印(与 bind-voice-audio.ts 同口径),
  // 使 buildChapterLedger 的来源链对拍可验证
  const ttsInputFingerprint = await computeVoiceImportFingerprint({
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    shotId,
    audioContentSha256: audioSha,
  });
  const binding = {
    schemaVersion: 2,
    bindingId: "",
    bindingFingerprint: "",
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    source: {
      kind: "project-file",
      projectId: PROJECT_ID,
      relativePath: `remotion/audio/${CHAPTER_ID}/shots/${shotId}/voice/${audioSha}.wav`,
      contentSha256: audioSha,
    },
    sourceFingerprint: audioSha,
    sourceDurationUs: 4720000,
    sourceStartUs: 0,
    durationUs: 4720000,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    envelope: [{ gain: 1, timeUs: 0 }],
    renderScope: "shot",
    shotId,
    shotRevision: 4,
    role: "voice",
    shotStartUs: 0,
    ttsInputFingerprint,
  } as Record<string, unknown>;
  binding.bindingId = `voice:${shotId}:${binding.ttsInputFingerprint}`;
  // 先封印基线,再落 overrides —— overrides 模拟「封印之后被篡改」
  binding.bindingFingerprint = await computeBindingFingerprint(binding);
  return { ...binding, ...overrides } as Record<string, unknown>;
}

async function makeSealedManifest(shots: Record<string, unknown>[]) {
  const manifest = {
    schemaVersion: 2,
    manifestFingerprint: "",
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    revision: 67,
    sourceSnapshotHash: "a".repeat(64),
    requiredShotIds: shots.map((shot) => shot.shotId),
    sharedAudioBindings: [],
    shots,
    renderSettings: { fps: 30 },
    createdAt: 1,
    updatedAt: 2,
  } as Record<string, unknown>;
  manifest.manifestFingerprint = await computeManifestFingerprint(manifest);
  return manifest;
}

function makeIo(files: Record<string, string>): TtsLedgerIo {
  return {
    readProjectBytes(relativePath) {
      const content = files[relativePath];
      return content === undefined ? null : Buffer.from(content, "utf8");
    },
    listProjectDir(relativePath) {
      const prefix = `${relativePath}/`;
      return Object.keys(files)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
  };
}

async function buildFixture(options: {
  storyboard?: StoryboardItem;
  bindingOverrides?: Record<string, unknown>;
  files?: Record<string, string>;
  candidates?: VoiceProfileCandidate[];
} = {}) {
  const storyboard = options.storyboard ?? makeStoryboard();
  const binding = await makeSealedBinding("sb-chapter-001-001", options.bindingOverrides ?? {});
  const manifest = await makeSealedManifest([
    {
      shotId: "sb-chapter-001-001",
      storyboardId: "sb-chapter-001-001",
      revision: 4,
      index: 1,
      durationUs: 5120000,
      audioBindings: [binding],
    },
  ]);
  const audioSha = sha256("fake-audio-001");
  const files: Record<string, string> = options.files ?? {
    [`remotion/audio/${CHAPTER_ID}/shots/sb-chapter-001-001/voice/${audioSha}.wav`]: "fake-audio-001",
  };
  const candidates = options.candidates ?? [
    candidate(makeProfile(), REFERENCE_SHA),
    candidate(makeProfile({ id: "voice-profile-b", name: "音色B", instruct: "少年" }), sha256("reference-b")),
  ];
  const ledger = await buildChapterLedger({
    manifest,
    storyboardsById: new Map([[storyboard.id, storyboard]]),
    profileCandidates: candidates,
    projectRoot: "/projects/test",
    generatedAt: "2026-08-26T00:00:00.000Z",
    io: makeIo(files),
  });
  return { ledger, manifest, binding, storyboard };
}

describe("parseVoiceBindingId", () => {
  it("解析合法三段 bindingId", () => {
    const fp = "a".repeat(64);
    expect(parseVoiceBindingId(`voice:sb-001:${fp}`)).toEqual({
      shotId: "sb-001",
      ttsInputFingerprint: fp,
    });
  });

  it("拒绝非 voice 前缀/非 64 位十六进制/缺段", () => {
    expect(parseVoiceBindingId("sfx:sb-001:" + "a".repeat(64))).toBeNull();
    expect(parseVoiceBindingId("voice:sb-001:short")).toBeNull();
    expect(parseVoiceBindingId(null)).toBeNull();
  });
});

describe("computeBindingFingerprint / computeManifestFingerprint", () => {
  it("与 lib 原函数逐字节一致(去字段后 canonical SHA-256)", async () => {
    const binding = { bindingFingerprint: "x", volume: 1, role: "voice" };
    const expected = await sha256CanonicalJson({ volume: 1, role: "voice" });
    expect(await computeBindingFingerprint(binding)).toBe(expected);
    const manifest = { manifestFingerprint: "y", revision: 3 };
    expect(await computeManifestFingerprint(manifest)).toBe(
      await sha256CanonicalJson({ revision: 3 }),
    );
  });
});

describe("matchVoiceProfileForShot", () => {
  it("命中唯一档案:文本+档案+seed+封印 revision 全链复现指纹", async () => {
    const storyboard = makeStoryboard();
    const profileA = makeProfile();
    const sealed = await import("@/lib/studio/storyboard-tts-runner")
      .then(({ createStoryboardTtsInputFingerprint }) => createStoryboardTtsInputFingerprint({
        projectId: PROJECT_ID,
        chapterId: CHAPTER_ID,
        storyboard,
        profile: profileA,
        referenceAudioSha256: REFERENCE_SHA,
      }));
    const result = await matchVoiceProfileForShot({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      storyboard,
      shotRevision: 4,
      sealedTtsInputFingerprint: sealed,
      candidates: [
        candidate(profileA, REFERENCE_SHA),
        candidate(makeProfile({ id: "voice-profile-b", instruct: "少年" }), sha256("reference-b")),
      ],
    });
    expect(result.matched).toBe(true);
    expect(result.profileIds).toEqual(["voice-profile-a"]);
  });

  it("revision 以封印为准:分镜 outputVersion 前进后仍能命中", async () => {
    const generationTime = makeStoryboard({ outputVersion: 4 });
    const profileA = makeProfile();
    const { createStoryboardTtsInputFingerprint } = await import("@/lib/studio/storyboard-tts-runner");
    const sealed = await createStoryboardTtsInputFingerprint({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      storyboard: generationTime,
      profile: profileA,
      referenceAudioSha256: REFERENCE_SHA,
    });
    const drifted = makeStoryboard({ outputVersion: 9 });
    const result = await matchVoiceProfileForShot({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      storyboard: drifted,
      shotRevision: 4,
      sealedTtsInputFingerprint: sealed,
      candidates: [candidate(profileA, REFERENCE_SHA)],
    });
    expect(result.matched).toBe(true);
  });

  it("文本漂移后不再命中,且给出人话线索", async () => {
    const sealed = "b".repeat(64);
    const result = await matchVoiceProfileForShot({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      storyboard: makeStoryboard(),
      shotRevision: 4,
      sealedTtsInputFingerprint: sealed,
      candidates: [candidate(makeProfile(), REFERENCE_SHA)],
    });
    expect(result.matched).toBe(false);
    expect(result.hints.join(";")).toContain("漂移");
  });
});

describe("buildChapterLedger", () => {
  it("封印/音频/孤儿代次/共享音频全链绿", async () => {
    const orphanSha = sha256("orphan-generation");
    const audioSha = sha256("fake-audio-001");
    const { ledger } = await buildFixture({
      files: {
        [`remotion/audio/${CHAPTER_ID}/shots/sb-chapter-001-001/voice/${audioSha}.wav`]: "fake-audio-001",
        [`remotion/audio/${CHAPTER_ID}/shots/sb-chapter-001-001/voice/${orphanSha}.wav`]: "orphan-generation",
      },
    });
    expect(ledger.chapter.manifestSealCheck).toBe("pass");
    expect(ledger.summary.bindingSealFail).toBe(0);
    expect(ledger.summary.audioMissing).toBe(0);
    expect(ledger.summary.audioSha256Mismatch).toBe(0);
    expect(ledger.summary.allChecksPass).toBe(true);
    const shot = ledger.shots[0]!;
    expect(shot.checks.bindingIdConsistent).toBe(true);
    expect(shot.audio?.sha256).toBe(audioSha);
    expect(shot.orphanGenerations).toHaveLength(1);
    expect(shot.orphanGenerations[0]!.fileName).toBe(`${orphanSha}.wav`);
    expect(shot.storyboardRevisionAligned).toBe(true);
    // 来源链:导入链公式复现封印指纹
    expect(shot.provenance.chain).toBe("voice-import");
    expect(shot.provenance.verified).toBe(true);
    expect(ledger.summary.provenance).toEqual({ ttsGenerated: 0, voiceImport: 1, unresolved: 0 });
  });

  it("manifest 封印被篡改 → fail 且 allChecksPass=false", async () => {
    const { manifest } = await buildFixture();
    manifest.revision = 68;
    const ledger = await buildChapterLedger({
      manifest,
      storyboardsById: new Map([["sb-chapter-001-001", makeStoryboard()]]),
      profileCandidates: [candidate(makeProfile(), REFERENCE_SHA)],
      projectRoot: "/projects/test",
      io: makeIo({ [`remotion/audio/${CHAPTER_ID}/shots/sb-chapter-001-001/voice/${sha256("fake-audio-001")}.wav`]: "fake-audio-001" }),
    });
    expect(ledger.chapter.manifestSealCheck).toBe("fail");
    expect(ledger.summary.allChecksPass).toBe(false);
  });

  it("binding 字段被改 → bindingSeal=false", async () => {
    const { ledger } = await buildFixture({ bindingOverrides: { volume: 0.5 } });
    expect(ledger.shots[0]!.checks.bindingSeal).toBe(false);
    expect(ledger.summary.bindingSealFail).toBe(1);
  });

  it("音频字节被替换 → audioSha256Match=false", async () => {
    const audioSha = sha256("fake-audio-001");
    const { ledger } = await buildFixture({
      files: { [`remotion/audio/${CHAPTER_ID}/shots/sb-chapter-001-001/voice/${audioSha}.wav`]: "tampered-bytes" },
    });
    expect(ledger.shots[0]!.checks.audioPresent).toBe(true);
    expect(ledger.shots[0]!.checks.audioSha256Match).toBe(false);
    expect(ledger.summary.audioSha256Mismatch).toBe(1);
  });

  it("音频文件缺失 → audioMissing=1", async () => {
    const { ledger } = await buildFixture({ files: {} });
    expect(ledger.shots[0]!.checks.audioPresent).toBe(false);
    expect(ledger.summary.audioMissing).toBe(1);
    expect(ledger.summary.allChecksPass).toBe(false);
  });

  it("store 无该分镜 → storyboardFound=false(来源链用封印身份仍可验证)", async () => {
    const binding = await makeSealedBinding("sb-chapter-001-001");
    const manifest = await makeSealedManifest([
      { shotId: "sb-chapter-001-001", revision: 4, audioBindings: [binding] },
    ]);
    const ledger = await buildChapterLedger({
      manifest,
      storyboardsById: new Map(),
      profileCandidates: [],
      projectRoot: "/projects/test",
      io: makeIo({}),
    });
    expect(ledger.shots[0]!.storyboardFound).toBe(false);
    expect(ledger.shots[0]!.provenance.chain).toBe("voice-import");
    expect(ledger.shots[0]!.provenance.verified).toBe(true);
  });

  it("两条链都不中 → unresolved 并带漂移线索", async () => {
    const binding = await makeSealedBinding("sb-chapter-001-001", { ttsInputFingerprint: "d".repeat(64) });
    const manifest = await makeSealedManifest([
      { shotId: "sb-chapter-001-001", revision: 4, audioBindings: [binding] },
    ]);
    const storyboard = makeStoryboard();
    const ledger = await buildChapterLedger({
      manifest,
      storyboardsById: new Map([[storyboard.id, storyboard]]),
      profileCandidates: [candidate(makeProfile(), REFERENCE_SHA)],
      projectRoot: "/projects/test",
      io: makeIo({}),
    });
    expect(ledger.shots[0]!.provenance.chain).toBe("unresolved");
    expect(ledger.shots[0]!.provenance.verified).toBe(false);
    expect(ledger.shots[0]!.provenance.hints.join(";")).toContain("不一致");
  });
});

describe("renderTtsLedgerMarkdown", () => {
  it("渲染摘要/逐镜表/指纹附录,失败项落异常明细", async () => {
    const { ledger } = await buildFixture({ bindingOverrides: { volume: 0.5 } });
    const markdown = renderTtsLedgerMarkdown(ledger);
    expect(markdown).toContain("# TTS 台账 · chapter-001");
    expect(markdown).toContain("manifest revision **67**");
    expect(markdown).toContain("## 逐镜");
    expect(markdown).toContain("sb-chapter-001-001");
    expect(markdown).toContain("这是第一镜的口播文本");
    expect(markdown).toContain("## 异常明细");
    expect(markdown).toContain("binding 封印不符");
    expect(markdown).toContain("## 附录:指纹全文对照");
  });
});

describe("parseCliArgs", () => {
  it("解析 --project/--chapter/--check", () => {
    expect(parseCliArgs(["--project", "/tmp/p", "--chapter", "chapter-001", "--check"])).toEqual({
      projectDir: "/tmp/p",
      chapter: "chapter-001",
      check: true,
    });
  });

  it("未知参数报错", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow("未知参数");
  });
});
