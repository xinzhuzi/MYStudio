// @vitest-environment node

import fs from "node:fs";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mergeSelectedShotDefinitions,
  selectPlanIssuesForShotIds,
  selectShotIdsForRun,
  runRemotionShotSlots,
} from "./render-shot-slots";

const gateFixture = vi.hoisted(() => ({
  extraShot: false,
  durations: undefined as number[] | undefined,
  source: 'real source',
  director: 'Daojie_xianxia',
  h3DurationUs: undefined as number | undefined,
  chapterIssue: false,
  invalidProjection: false,
  writeCas: vi.fn(),
  listen: vi.fn(async () => { throw new Error('offline render boundary'); }),
}));
afterEach(() => {
  expect(ensureBrowser).not.toHaveBeenCalled();
  expect(selectComposition).not.toHaveBeenCalled();
  expect(renderMedia).not.toHaveBeenCalled();
  vi.unstubAllEnvs(); vi.restoreAllMocks();
  Object.assign(gateFixture, { extraShot: false, durations: undefined, source: 'real source',
    director: 'Daojie_xianxia', h3DurationUs: undefined, chapterIssue: false, invalidProjection: false });
  gateFixture.writeCas.mockClear(); gateFixture.listen.mockClear();
});

vi.mock('@/lib/studio/remotion/remotion-shot-plan-builder', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/studio/remotion/remotion-shot-plan-builder')>(),
  buildRemotionShotPlans: async () => {
    const { makeChapterManifestV2 } = await import('@/lib/studio/remotion/remotion-workspace-test-fixtures');
    const manifest = await makeChapterManifestV2();
    return { success: !gateFixture.chapterIssue, sourceSnapshotHash: manifest.sourceSnapshotHash,
      blockedShotIds: [], issues: gateFixture.chapterIssue ? [{ path: '$.chapter', message: 'chapter invalid' }] : [],
      plans: (gateFixture.durations ?? []).map((duration, index) => ({
        schemaVersion: 1, target: 'shot', projectId: 'p', chapterId: 'chapter-001', chapterRevision: 2,
        sourceSnapshotHash: manifest.sourceSnapshotHash, inputHash: 'a'.repeat(64),
        renderSettings: { ...manifest.renderSettings, fps: 30,
          width: gateFixture.invalidProjection ? 0 : manifest.renderSettings.width },
        visualKind: gateFixture.h3DurationUs === undefined ? 'image' : 'video',
        h3DurationUs: gateFixture.h3DurationUs,
        shot: { ...manifest.shots[0], shotId: `s${index}`, durationUs: Math.round(duration * 1e6), audioBindings: [] },
      })),
    };
  },
}));
vi.mock('@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service', () => ({
  RemotionChapterManifestService: class {
    async read() {
      const { makeChapterManifestV2 } = await import('@/lib/studio/remotion/remotion-workspace-test-fixtures');
      const manifest = await makeChapterManifestV2();
      return { ...manifest, shots: (gateFixture.durations ?? []).map((_, index) => ({ ...manifest.shots[0], shotId: `s${index}` })) };
    }
    writeCas = gateFixture.writeCas;
  },
}));
vi.mock('@rendering/plugins/remotion/media-bridge/media-bridge-server', () => ({
  MediaBridgeServer: class { listen = gateFixture.listen; },
}));
vi.mock('@remotion/renderer', () => ({ ensureBrowser: vi.fn(), renderMedia: vi.fn(), selectComposition: vi.fn() }));

vi.mock("../timeline/storage-paths", async importOriginal => ({
  ...await importOriginal<typeof import('../timeline/storage-paths')>(),
  resolveProjectDir: () => '/tmp/strict195-unit-project',
  resolveTimelineSourcePath: ({ sourcePath }: { sourcePath: string }) => sourcePath,
  deriveStorageRoots: () => ({ projectId: 'p', dataRoot: '/tmp', mediaRoot: '/tmp' }),
  readStudioWorkflowStoreState: () => ({ state: {
    workflowConfig: { directorManualId: gateFixture.director },
    novelChapters: [{ id: 'chapter-001', sourceText: gateFixture.source }],
    storyboards: gateFixture.durations ? gateFixture.durations.map((duration, index) => ({
      id: `s${index}`, episodeId: 'chapter-001', index, duration,
      mediaRef: { kind: 'image', path: '/tmp/strict195-unit-project/images/a.png', contentSha256: 'a'.repeat(64) },
    })) : [{ id: 's', episodeId: 'chapter-001', duration: 195.000001 },
      ...(gateFixture.extraShot ? [{ id: 't', episodeId: 'chapter-001', duration: 1 }] : [])],
  } }),
}));

it('rejects strict195 overflow at the real entrypoint before any mkdir or rendering', async () => {
  const mkdir = vi.spyOn(fs.promises, 'mkdir');
  try {
    await expect(runRemotionShotSlots()).rejects.toThrow('strict Daojie');
    expect(mkdir).not.toHaveBeenCalled();
  } finally { mkdir.mockRestore(); }
});

it.each(['', '   '])('rejects empty shot selection %j before media access or writes', async raw => {
  vi.stubEnv('MYSTUDIO_SHOT_IDS', raw);
  await expect(runRemotionShotSlots()).rejects.toThrow('非空 shot ID');
});

it.each(['s', ' s '])('applies strict195 to explicit whole-chapter selection %j', async raw => {
  vi.stubEnv('MYSTUDIO_SHOT_IDS', raw);
  const mkdir = vi.spyOn(fs.promises, 'mkdir');
  try {
    await expect(runRemotionShotSlots()).rejects.toThrow('strict Daojie');
    expect(mkdir).not.toHaveBeenCalled();
  } finally { mkdir.mockRestore(); }
});

it('keeps proper-subset repair available for an over-budget chapter', async () => {
  gateFixture.extraShot = true;
  vi.stubEnv('MYSTUDIO_SHOT_IDS', 's');
  // Passing the duration gate reaches the independent missing-media validation.
  await expect(runRemotionShotSlots()).rejects.toThrow('分镜媒体引用为空');
});

const SHOT_IDS = [
  "sb-chapter-001-001",
  "sb-chapter-001-002",
  "sb-chapter-001-003",
];

describe("selectShotIdsForRun", () => {
  it("keeps the complete chapter when no allowlist is provided", () => {
    expect(selectShotIdsForRun(SHOT_IDS, undefined)).toEqual(SHOT_IDS);
  });

  it("returns requested shots in chapter order", () => {
    expect(selectShotIdsForRun(
      SHOT_IDS,
      "sb-chapter-001-002,sb-chapter-001-001",
    )).toEqual([
      "sb-chapter-001-001",
      "sb-chapter-001-002",
    ]);
  });

  it("fails closed for empty, duplicate, or unknown shot IDs", () => {
    expect(() => selectShotIdsForRun(SHOT_IDS, "")).toThrow("非空 shot ID");
    expect(() => selectShotIdsForRun(
      SHOT_IDS,
      "sb-chapter-001-001,sb-chapter-001-001",
    )).toThrow("重复 shot ID");
    expect(() => selectShotIdsForRun(SHOT_IDS, "sb-chapter-001-099"))
      .toThrow("当前章节不存在");
  });
});

describe("mergeSelectedShotDefinitions", () => {
  it("replaces selected shots while preserving every unselected manifest entry", () => {
    expect(mergeSelectedShotDefinitions({
      availableShotIds: SHOT_IDS,
      selectedShots: [{ shotId: SHOT_IDS[0], revision: 2 }],
      currentShots: SHOT_IDS.map((shotId) => ({ shotId, revision: 1 })),
      scoped: true,
    })).toEqual([
      { shotId: SHOT_IDS[0], revision: 2 },
      { shotId: SHOT_IDS[1], revision: 1 },
      { shotId: SHOT_IDS[2], revision: 1 },
    ]);
  });

  it("fails closed when an unselected manifest entry is missing", () => {
    expect(() => mergeSelectedShotDefinitions({
      availableShotIds: SHOT_IDS,
      selectedShots: [{ shotId: SHOT_IDS[0], revision: 2 }],
      currentShots: [{ shotId: SHOT_IDS[1], revision: 1 }],
      scoped: true,
    })).toThrow("缺少未选镜头");
  });
});

describe("selectPlanIssuesForShotIds", () => {
  it("keeps selected-shot and chapter-level issues while hiding unselected-shot noise", () => {
    const issues = [
      { path: "shots.sb-chapter-001-001.$.storyboard.visualReview", message: "selected" },
      { path: "shots.sb-chapter-001-003.$.storyboard.visualReview", message: "unselected" },
      { path: "$.chapter", message: "chapter" },
    ];

    expect(selectPlanIssuesForShotIds(issues, ["sb-chapter-001-001"])).toEqual([
      issues[0],
      issues[2],
    ]);
  });
});


// Exercise the real CLI entrypoint and real composition projector, stopping at
// a mocked bridge boundary; no browser, renderer, media, or project writes.
describe('full chapter projection and manifest publication', () => {
  function offlineIo() {
    const mkdir = vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
    const writeFile = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      schemaVersion: 2, templateId: 'mystudio-remotion-v1', templateVersion: '1.0.0',
      remotionVersion: '4.0.534', compositionId: 'DaojieTimeline',
      compositionIds: ['StoryboardShot', 'ChapterVideo', 'DaojieTimeline'], contentHash: 'a'.repeat(64),
    }));
    vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
    return { mkdir, writeFile };
  }
  it.each([undefined, Array.from({ length: 19 }, (_, i) => `s${i}`).join(',')])(
    'rejects raw exact195 with rounded frame overflow before writes/render (%s)', async selection => {
      gateFixture.durations = [...Array<number>(18).fill(10.02), 14.64];
      if (selection !== undefined) vi.stubEnv('MYSTUDIO_SHOT_IDS', selection);
      const io = offlineIo();
      await expect(runRemotionShotSlots()).rejects.toThrow('strict Daojie');
      expect(io.mkdir).not.toHaveBeenCalled(); expect(io.writeFile).not.toHaveBeenCalled();
      expect(gateFixture.writeCas).not.toHaveBeenCalled(); expect(gateFixture.listen).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, 's1,s0'])('publishes full manifest at exact cap (%s)', async selection => {
    gateFixture.durations = [100, 95];
    if (selection !== undefined) vi.stubEnv('MYSTUDIO_SHOT_IDS', selection);
    offlineIo();
    await expect(runRemotionShotSlots()).rejects.toThrow('offline render boundary');
    expect(gateFixture.writeCas).toHaveBeenCalledOnce();
    expect(gateFixture.writeCas.mock.calls[0]?.[0].manifest.shots.map((shot: { shotId: string }) => shot.shotId)).toEqual(['s0', 's1']);
  });
  it('keeps subset independent of unselected duration and chapter issues without CAS', async () => {
    gateFixture.durations = [10, 200]; gateFixture.chapterIssue = true;
    vi.stubEnv('MYSTUDIO_SHOT_IDS', 's0'); offlineIo();
    await expect(runRemotionShotSlots()).rejects.toThrow('offline render boundary');
    expect(gateFixture.writeCas).not.toHaveBeenCalled();
  });
  it('rejects H3 override overflow before writes', async () => {
    gateFixture.durations = [195]; gateFixture.h3DurationUs = 195_000_001;
    const io = offlineIo();
    await expect(runRemotionShotSlots()).rejects.toThrow('strict Daojie');
    expect(io.mkdir).not.toHaveBeenCalled(); expect(gateFixture.writeCas).not.toHaveBeenCalled();
  });
  it.each(['generic', 'blank source'])('preserves %s duration selection', async control => {
    gateFixture.durations = [...Array<number>(18).fill(10.02), 14.64];
    if (control === 'generic') gateFixture.director = 'other'; else gateFixture.source = '  ';
    offlineIo();
    await expect(runRemotionShotSlots()).rejects.toThrow('offline render boundary');
    expect(gateFixture.writeCas).toHaveBeenCalledOnce();
  });
  it.each([undefined, 's0'])('rejects chapter plan issues for all-shot selection (%s)', async selection => {
    gateFixture.durations = [10]; gateFixture.chapterIssue = true;
    if (selection !== undefined) vi.stubEnv('MYSTUDIO_SHOT_IDS', selection);
    const io = offlineIo();
    await expect(runRemotionShotSlots()).rejects.toThrow('chapter invalid');
    expect(io.mkdir).not.toHaveBeenCalled(); expect(gateFixture.writeCas).not.toHaveBeenCalled();
  });
  it('rejects invalid projected props before writes', async () => {
    gateFixture.durations = [10]; gateFixture.invalidProjection = true;
    const io = offlineIo();
    await expect(runRemotionShotSlots()).rejects.toThrow();
    expect(io.mkdir).not.toHaveBeenCalled(); expect(gateFixture.writeCas).not.toHaveBeenCalled();
  });
});
