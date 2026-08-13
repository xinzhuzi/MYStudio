// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, test, expect } from "vitest";
import {
  studioTransformDeleteNovelChapters,
  scriptTransformDeleteEpisodes,
  editingTransformDeleteProjects,
  ttsTransformCleanupVoiceLines,
  directorTransformCleanupContinuity,
  mediaTransformFilterByOwnership,
  remotionTransformRemoveChapterRecords,
} from "./store-transforms";
import type { NovelChapter } from "@/types/studio";
import type { Episode, ScriptScene } from "@/types/script";
import type { EditingProjectV1 } from "@/types/editing";
import type { SceneVoiceLine } from "@/types/tts";
import type { StoryboardItem, MediaFile } from "@/types/media";
import type { RemotionChapterManifestV1 } from "@/types/remotion-workspace";

const testChapter = (id: string, title: string, sourceText: string) => ({
  id, index: Number(id) || 1, title, sourceText, importedAt: 0,
} as unknown as NovelChapter);
const testEpisode = (id: string, index: number, sceneIds: string[]) => ({
  id, index, title: `Episode ${index}`, sceneIds,
} as Episode);
const testVoiceLine = (sceneId: number, text: string, status: SceneVoiceLine["status"] = "idle") => ({
  sceneId, text, status, speakerId: "narrator", engine: "qwen", updatedAt: 0,
} as SceneVoiceLine);
const testStoryboard = (id: string, episodeId?: string) => ({
  id, episodeId, index: 1, trackKey: id, trackId: id, duration: 1,
  prompt: "", videoDesc: "", assetIds: [], state: "pending",
} as unknown as StoryboardItem);
const testMedia = (id: string, relativePath: string) => ({
  id, relativePath, name: id, type: "image",
} as MediaFile);

describe("Store Transforms - Slice 6", () => {
  // ============================================================================
  // 1. Novel Chapters Transform Tests
  // ============================================================================
  describe("studioTransformDeleteNovelChapters", () => {
    test("deletes specified chapters while preserving immutable structure", () => {
      const chapters: NovelChapter[] = [
        testChapter("1", "Chapter 1", "A"),
        testChapter("2", "Chapter 2", "B"),
        testChapter("3", "Chapter 3", "C"),
      ];

      const snapshot = { novelChapters: chapters };
      const idsToDelete = new Set(["2"]);

      const result = studioTransformDeleteNovelChapters(snapshot, idsToDelete);

      expect(result.novelChapters).toHaveLength(2);
      expect(result.novelChapters.map(c => c.id)).toEqual(["1", "3"]);

      // CRITICAL: Input must NOT be mutated
      expect(chapters).toHaveLength(3);
      expect(chapters[1]).toBeDefined();
    });

    test("returns empty array when all deleted", () => {
      const chapters: NovelChapter[] = [testChapter("1", "X", "")];
      const result = studioTransformDeleteNovelChapters(
        { novelChapters: chapters },
        new Set(["1"])
      );
      expect(result.novelChapters).toHaveLength(0);
    });

    test("returns unchanged when no matches", () => {
      const chapters: NovelChapter[] = [testChapter("1", "X", "")];
      const result = studioTransformDeleteNovelChapters(
        { novelChapters: chapters },
        new Set(["999"])
      );
      expect(result.novelChapters).toHaveLength(1);
    });
  });

  // ============================================================================
  // 2. Script Episodes Transform Tests
  // ============================================================================
  describe("scriptTransformDeleteEpisodes", () => {
    test("reindexes episodes to contiguous 1-based indices", () => {
      const project = {
        scriptData: {
          episodes: [
            testEpisode("e1", 1, ["s1", "s2"]),
            testEpisode("e2", 2, ["s3", "s4"]),
            testEpisode("e3", 3, ["s5", "s6"]),
          ],
          scenes: [
            { id: "s1", name: "Scene 1" },
            { id: "s2", name: "Scene 2" },
            { id: "s3", name: "Scene 3" },
            { id: "s4", name: "Scene 4" },
            { id: "s5", name: "Scene 5" },
            { id: "s6", name: "Scene 6" },
          ] as ScriptScene[],
        },
        shots: [
          { sceneRefId: "s1" },
          { sceneRefId: "s2" },
          { sceneRefId: "s3" },
        ],
        episodeRawScripts: [
          { episodeIndex: 1, title: "第 1 集" },
          { episodeIndex: 2, title: "第 2 集" },
          { episodeIndex: 3, title: "第 3 集" },
        ],
      };

      const snapshot = {
        projects: { "proj-1": project },
      };

      const result = scriptTransformDeleteEpisodes(snapshot, "proj-1", [2]);

      const retainedEpisodes = result.projects["proj-1"]?.scriptData?.episodes || [];
      expect(retainedEpisodes).toHaveLength(2);
      expect(retainedEpisodes[0].index).toBe(1);
      expect(retainedEpisodes[1].index).toBe(2);

      // Verify raw scripts reindexed too
      const retainedRaw = result.projects["proj-1"]?.episodeRawScripts || [];
      expect(retainedRaw[0].episodeIndex).toBe(1);
      expect(retainedRaw[0].title).toBe("第 1 集");
      expect(retainedRaw[1].episodeIndex).toBe(2);
      expect(retainedRaw[1].title).toBe("第 2 集");

      // Verify scenes filtered by deleted episode
      const retainedScenes = result.projects["proj-1"]?.scriptData?.scenes || [];
      expect(retainedScenes).toHaveLength(4); // Removed s5, s6
    });

    test("does not mutate original input", () => {
      const original: Episode[] = [
        testEpisode("e1", 1, []),
        testEpisode("e2", 2, []),
      ];

      const snapshot = {
        projects: {
          "proj-1": {
            scriptData: { episodes: original, scenes: [] },
            shots: [],
            episodeRawScripts: [],
          },
        },
      };

      scriptTransformDeleteEpisodes(snapshot, "proj-1", [1]);

      // Original must remain unchanged
      expect(original).toHaveLength(2);
      expect(original[0].index).toBe(1);
      expect(original[1].index).toBe(2);
    });
  });

  // ============================================================================
  // 3. Editing Projects Transform Tests
  // ============================================================================
  describe("editingTransformDeleteProjects", () => {
    test("filters by projectId AND episodeId/chapterId", () => {
      const projects: Record<string, EditingProjectV1> = {
        "p1": { id: "p1", projectId: "proj-1", episodeId: "ep-1" } as any,
        "p2": { id: "p2", projectId: "proj-1", episodeId: "ep-2" } as any,
        "p3": { id: "p3", projectId: "proj-2", episodeId: "ep-1" } as any,
      };

      const snapshot = {
        editingProjects: projects,
        autoEditingRuns: {},
        timelineRenderRecordsByEditingProjectId: {},
        currentEditingProjectIdByEpisode: { "ep-1": "p1", "ep-2": "p2" },
        autoEditingRunIdsByEpisode: {},
      };

      const result = editingTransformDeleteProjects(snapshot, "proj-1", "ep-1");

      // p1 deleted (proj-1 + ep-1), p2 and p3 retained
      expect(Object.keys(result.editingProjects)).toHaveLength(2);
      expect(result.editingProjects.p3).toBeDefined();
      expect(result.editingProjects.p2).toBeDefined();
      expect(result.editingProjects.p1).toBeUndefined();

      // Secondary index rebuilt - ep-1 now points to p3 (proj-2's project for ep-1)
      expect(result.currentEditingProjectIdByEpisode["ep-1"]).toBe("p3");
      expect(result.currentEditingProjectIdByEpisode["ep-2"]).toBe("p2");
    });
  });

  // ============================================================================
  // 4. TTS Voice Lines Transform Tests
  // ============================================================================
  describe("ttsTransformCleanupVoiceLines", () => {
    test("adds projectId/chapterId normalization at persistence boundary", () => {
      const lines: Record<string, SceneVoiceLine> = {
        "1": testVoiceLine(1, "Hello", "idle"),
        "2": testVoiceLine(2, "World", "completed"),
      };

      const snapshot = { voiceLines: lines };
      const chapterId = "chap-1";

      const result = ttsTransformCleanupVoiceLines(snapshot, [1], undefined, chapterId);

      // Should normalize ownership to chapterId
      expect(result.voiceLines[chapterId]).toBeDefined();
    });

    test("migrates legacy numeric sceneId only if uniquely resolvable", () => {
      const lines: Record<string, SceneVoiceLine> = {
        "100": testVoiceLine(100, "Only one numeric ID"),
      };

      const snapshot = { voiceLines: lines };

      const result = ttsTransformCleanupVoiceLines(
        snapshot,
        [100],
        "episode-1",
        "chapter-1"
      );

      // Ambiguous ownership (both episodeId and chapterId provided) should block
      expect(result.voiceLines).toEqual(lines);
    });

    test("blocks ambiguous ownership without guessing", () => {
      const lines: Record<string, SceneVoiceLine> = { "1": testVoiceLine(1, "Test") };
      const snapshot = { voiceLines: lines };

      // No scopeId provided at all
      const result = ttsTransformCleanupVoiceLines(snapshot, []);
      expect(result.voiceLines).toEqual(lines);
    });
  });

  // ============================================================================
  // 7. Director Continuity Transform Tests
  // ============================================================================
  describe("directorTransformCleanupContinuity", () => {
    test("filters storyboardItems by episodeIdsInChapter", () => {
      const storyboards: StoryboardItem[] = [
        testStoryboard("s1", "ep-1"),
        testStoryboard("s2", "ep-2"),
        testStoryboard("s3"), // No episodeId - keep
      ];

      const snapshot = {
        storyboardItems: storyboards,
        continuityBibleVersions: [],
      };

      // Delete ep-1 only (assume it belongs to chap-1)
      const result = directorTransformCleanupContinuity(
        snapshot,
        "chap-1",
        new Set(["ep-1"])
      );

      expect(result.storyboardItems).toHaveLength(2); // s2 and s3 kept
      expect(result.storyboardItems.map(s => s.id)).toContain("s2");
      expect(result.storyboardItems.map(s => s.id)).toContain("s3");
    });

    test("removes chapter-only continuity bible versions", () => {
      const versions = [
        { chapterId: "chap-1" },
        { episodeId: "ep-1" }, // Cross-chapter - keep
        { chapterId: "chap-2", episodeId: "ep-1" }, // Has episodeId - keep
        { chapterId: "chap-3" }, // Chapter-only - delete
      ];

      const snapshot = {
        storyboardItems: [],
        continuityBibleVersions: versions,
      };

      const result = directorTransformCleanupContinuity(snapshot, "chap-1");

      const retained = result.continuityBibleVersions;
      expect(retained.length).toBe(3); // All except chap-1 version
      expect(retained.some(v => v.episodeId === "ep-1")).toBe(true);
    });
  });

  // ============================================================================
  // 8. Media Files Transform Tests
  // ============================================================================
  describe("mediaTransformFilterByOwnership", () => {
    test("only removes files under chapter-specific paths", () => {
      const files: MediaFile[] = [
        testMedia("f1", "chapter-1/scene1.jpg"),
        testMedia("f2", "project-level/assets/img.png"),
        testMedia("f3", "chapter-1/video.mp4"),
      ];

      const snapshot = { mediaFiles: files };

      const result = mediaTransformFilterByOwnership(snapshot, "/root", "chapter-1");

      expect(result.mediaFiles).toHaveLength(1);
      expect(result.mediaFiles[0].relativePath).toBe("project-level/assets/img.png");
    });

    test("preserves chapterId root (not subdir)", () => {
      const files: MediaFile[] = [
        testMedia("f1", "chapter-1"),
        testMedia("f2", "chapter-1/file.jpg"),
      ];

      const snapshot = { mediaFiles: files };

      const result = mediaTransformFilterByOwnership(snapshot, "/root", "chapter-1");

      // chapter-1 at root level is NOT a subdirectory - should be kept
      expect(result.mediaFiles).toHaveLength(1);
      expect(result.mediaFiles[0].relativePath).toBe("chapter-1");
    });

    test("protects cross-chapter shared assets", () => {
      const files: MediaFile[] = [
        testMedia("f1", "shared/logo.png"),
      ];

      const snapshot = { mediaFiles: files };

      const result = mediaTransformFilterByOwnership(snapshot, "/root", "chapter-1");

      // Shared assets protected
      expect(result.mediaFiles).toHaveLength(1);
    });
  });

  describe("directorTransformCleanupContinuity", () => {
    test("filters storyboardItems by episodeIdsInChapter", () => {
      const storyboards: StoryboardItem[] = [
        testStoryboard("s1", "ep-1"),
        testStoryboard("s2", "ep-2"),
        testStoryboard("s3"), // No episodeId - keep
      ];

      const snapshot = {
        storyboardItems: storyboards,
        continuityBibleVersions: [],
      };

      // Delete ep-1 only
      const result = directorTransformCleanupContinuity(
        snapshot,
        "chap-1",
        new Set(["ep-1"])
      );

      expect(result.storyboardItems).toHaveLength(2); // s2 and s3 kept
      expect(result.storyboardItems.map(s => s.id)).toContain("s2");
      expect(result.storyboardItems.map(s => s.id)).toContain("s3");
    });

    test("removes chapter-only continuity bible versions", () => {
      const versions = [
        { chapterId: "chap-1" },
        { episodeId: "ep-1" }, // Cross-chapter - keep
        { chapterId: "chap-2", episodeId: "ep-1" }, // Has episodeId - keep
        { chapterId: "chap-3" }, // Chapter-only - delete
      ];

      const snapshot = {
        storyboardItems: [],
        continuityBibleVersions: versions,
      };

      const result = directorTransformCleanupContinuity(snapshot, "chap-1");

      const retained = result.continuityBibleVersions;
      expect(retained.length).toBe(3); // All except chap-1 version
      expect(retained.some(v => v.episodeId === "ep-1")).toBe(true);
    });
  });

  // ============================================================================
  // 9. Remotion Chapter Records Transform Tests
  // ============================================================================
  describe("remotionTransformRemoveChapterRecords", () => {
    test("matches by chapterId ONLY (never episodeId in Remotion!)", () => {
      const manifests: RemotionChapterManifestV1[] = [
        ({ schemaVersion: 1, projectId: "p1", chapterId: "chap-1", revision: 1, sourceSnapshotHash: "abc", requiredShotIds: [], sharedAudioTracks: [], shots: [], renderSettings: { frameRate: 30, quality: "high" }, createdAt: 0, updatedAt: 0 } as unknown as RemotionChapterManifestV1),
        ({ schemaVersion: 1, projectId: "p1", chapterId: "chap-2", revision: 1, sourceSnapshotHash: "abc", requiredShotIds: [], sharedAudioTracks: [], shots: [], renderSettings: { frameRate: 30, quality: "high" }, createdAt: 0, updatedAt: 0 } as unknown as RemotionChapterManifestV1),
      ];

      const snapshot = { manifests };

      const result = remotionTransformRemoveChapterRecords(snapshot, "chap-1");

      expect(result.manifests).toHaveLength(1);
      expect(result.manifests[0].chapterId).toBe("chap-2");
    });

    test("preserves immutability - input unchanged", () => {
      const manifest = {
        schemaVersion: 1,
        projectId: "p1",
        chapterId: "chap-1",
        revision: 1,
        sourceSnapshotHash: "hash",
        requiredShotIds: [],
        sharedAudioTracks: [],
        shots: [],
        renderSettings: { frameRate: 30, quality: "high" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as unknown as RemotionChapterManifestV1;

      const snapshot = { manifests: [manifest] };
      const originalLength = snapshot.manifests.length;

      remotionTransformRemoveChapterRecords(snapshot, "chap-1");

      // Input must NOT be mutated
      expect(snapshot.manifests).toHaveLength(originalLength);
    });
  });
});
