// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, test, expect } from "vitest";
import type { Episode, ScriptScene } from "@/types/script";
import {
  buildArtifactId,
  buildLegacyTtsSceneOwnership,
  projectAllFromStores,
  projectMediaFiles,
  projectTTSVoiceLines,
} from "./artifact-projection";
import { buildSingleChapterFixture } from "./__fixtures__/fixture-builders";

const scriptScene = (id: string): ScriptScene => ({
  id,
  location: "测试地点",
  time: "夜",
  atmosphere: "安静",
});

const episode = (id: string, sceneIds: string[], index = 1): Episode => ({
  id,
  index,
  title: `测试章节 ${index}`,
  sceneIds,
});

describe("artifact-projection", () => {
  describe("buildArtifactId", () => {
    test("generates unique IDs for novel chapters", () => {
      expect(buildArtifactId("novel", "novel-chapter", "chap-1")).toBe("novel:novel-chapter:chap-1");
      expect(buildArtifactId("novel", "novel-chapter", "chap-2")).toBe("novel:novel-chapter:chap-2");
    });

    test("generates unique IDs for storyboard items", () => {
      expect(buildArtifactId("storyboard", "storyboard-item", "sb-1")).toBe("storyboard:storyboard-item:sb-1");
      expect(buildArtifactId("script", "script-episode", "ep-1")).toBe("script:script-episode:ep-1");
    });

    test("ensures cross-stage uniqueness", () => {
      expect(buildArtifactId("novel", "novel-chapter", "id-1")).not.toBe(
        buildArtifactId("script", "script-episode", "id-1")
      );
    });

    test("projects the current store-shaped fixture without legacy top-level reads", () => {
      const fixture = buildSingleChapterFixture();

      const result = projectAllFromStores(
        fixture.studio,
        fixture.script,
        fixture.director,
        fixture.editing,
        fixture.tts,
        fixture.media,
        fixture.remotion,
        fixture.projectId,
        fixture.chapterId,
      );

      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.artifacts.some((artifact) => artifact.kind === "editing-project")).toBe(true);
      expect(result.legacyMappings.some((mapping) => mapping.rule === "numeric-tts-sceneid")).toBe(true);
    });

    test("projects every chapter when no chapter filter is supplied and resolves video ownership through tracks", () => {
      const chapterA = buildSingleChapterFixture("chapter-001");
      const chapterB = buildSingleChapterFixture("chapter-002");
      chapterA.studio.novelChapters.push(...chapterB.studio.novelChapters);
      chapterA.studio.agentWorkData.push(...chapterB.studio.agentWorkData);
      chapterA.studio.entityExtractions.push(...chapterB.studio.entityExtractions);
      chapterA.studio.storyboards.push(...chapterB.studio.storyboards);
      chapterA.studio.productionTracks.push(...chapterB.studio.productionTracks);
      chapterA.studio.videoCandidates.push(...chapterB.studio.videoCandidates);
      chapterA.script.episodes.push(...chapterB.script.episodes);
      chapterA.editing.editingProjects = {
        ...chapterA.editing.editingProjects,
        ...chapterB.editing.editingProjects,
      };

      const result = projectAllFromStores(
        chapterA.studio,
        chapterA.script,
        chapterA.director,
        chapterA.editing,
        chapterA.tts,
        chapterA.media,
        chapterA.remotion,
        chapterA.projectId,
      );

      expect(result.artifacts.filter((item) => item.kind === "director-entity-extraction")).toHaveLength(2);
      expect(result.artifacts.filter((item) => item.kind === "storyboard-item")).toHaveLength(10);
      expect(result.artifacts.filter((item) => item.kind === "production-track")).toHaveLength(2);
      const videos = result.artifacts.filter((item) => item.kind === "video-candidate");
      expect(videos).toHaveLength(4);
      expect(new Set(videos.map((item) => item.chapterId))).toEqual(new Set(["chapter-001", "chapter-002"]));
    });


    test("projects scene segments as chapter-owned artifacts and drops stale unresolved legacy candidates", () => {
      const fixture = buildSingleChapterFixture("chapter-001");
      fixture.studio.sceneSegments = [
        {
          id: "scene-segment-1",
          chapterId: "chapter-001",
          sceneNo: 1,
          sceneName: "河雾矿奴",
          storyboardIds: [fixture.studio.storyboards[0]!.id, fixture.studio.storyboards[1]!.id],
          frameRange: [0, 120],
          outputRelativePath: "exports/chapter-001/scenes/Sc01_test.mp4",
          outputAbsolutePath: "/workspace/exports/chapter-001/scenes/Sc01_test.mp4",
          jobId: "chapter-scene:aaaa",
          inputHash: "a".repeat(64),
          createdAt: 100,
        },
      ];
      // legacy ffmpeg 场候选：指向不存在的轨道且 stale——不得再投影成章节产出
      fixture.studio.videoCandidates.push({
        id: "legacy-scene-candidate",
        trackId: "track-chapter-001-scene-1",
        provider: "ffmpeg-local",
        filePath: "/exports/legacy/scene_01.mp4",
        state: "ready",
        createdAt: 50,
        stale: true,
        staleReason: "track source changed",
      });

      const result = projectAllFromStores(
        fixture.studio,
        fixture.script,
        fixture.director,
        fixture.editing,
        fixture.tts,
        fixture.media,
        fixture.remotion,
        fixture.projectId,
        fixture.chapterId,
      );

      const segments = result.artifacts.filter((item) => item.kind === "scene-segment");
      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({
        chapterId: "chapter-001",
        name: expect.stringContaining("场 1") as unknown,
      });
      expect(segments[0]!.physicalRefs[0]).toMatchObject({ path: "/workspace/exports/chapter-001/scenes/Sc01_test.mp4" });
      expect(result.artifacts.some((item) => item.kind === "video-candidate" && item.name.includes("legacy-scene-candidate"))).toBe(false);
    });

    test("scopes novel, script, and agent artifacts to one chapter and maps unique legacy work", () => {
      const fixture = buildSingleChapterFixture("chapter-001");
      const chapterB = buildSingleChapterFixture("chapter-002");
      const legacyWork = {
        ...fixture.studio.agentWorkData[0]!,
        id: "agent-legacy-episode-1",
        episodeId: "episode-1",
      };
      fixture.studio.novelChapters = [
        ...fixture.studio.novelChapters,
        ...chapterB.studio.novelChapters,
      ];
      fixture.studio.agentWorkData = [
        ...fixture.studio.agentWorkData,
        ...chapterB.studio.agentWorkData,
        legacyWork,
      ];
      fixture.script.episodes = [
        ...fixture.script.episodes,
        ...chapterB.script.episodes,
      ];

      const result = projectAllFromStores(
        fixture.studio,
        fixture.script,
        fixture.director,
        fixture.editing,
        fixture.tts,
        fixture.media,
        fixture.remotion,
        fixture.projectId,
        fixture.chapterId,
      );
      const scopedArtifacts = result.artifacts.filter((artifact) =>
        artifact.kind === "novel-chapter"
        || artifact.kind === "script-episode"
        || artifact.kind === "agent-workflow-result"
      );

      expect(scopedArtifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: buildArtifactId("novel", "novel-chapter", "novel-chapter-001"),
          chapterId: "chapter-001",
        }),
        expect.objectContaining({
          id: buildArtifactId("script", "script-episode", "chapter-001"),
          chapterId: "chapter-001",
        }),
        expect.objectContaining({
          id: buildArtifactId("analysis", "agent-workflow-result", legacyWork.id),
          chapterId: "chapter-001",
        }),
      ]));
      expect(scopedArtifacts.some((artifact) => artifact.id.includes("chapter-002"))).toBe(false);
      expect(result.legacyMappings).toContainEqual(expect.objectContaining({
        rule: "episode-1-to-index",
        status: "resolved",
      }));

      const chapterBResult = projectAllFromStores(
        fixture.studio,
        fixture.script,
        fixture.director,
        fixture.editing,
        fixture.tts,
        fixture.media,
        fixture.remotion,
        fixture.projectId,
        chapterB.chapterId,
      );
      expect(chapterBResult.artifacts).not.toContainEqual(expect.objectContaining({
        id: buildArtifactId("analysis", "agent-workflow-result", legacyWork.id),
      }));
    });

    test("blocks legacy episode work when the novel chapter index is duplicated", () => {
      const fixture = buildSingleChapterFixture("chapter-001");
      const legacyWork = {
        ...fixture.studio.agentWorkData[0]!,
        id: "agent-legacy-duplicate-index",
        episodeId: "episode-1",
      };
      fixture.studio.novelChapters.push({
        ...fixture.studio.novelChapters[0]!,
        id: "novel-duplicate-index-1",
      });
      fixture.studio.agentWorkData = [legacyWork];

      const result = projectAllFromStores(
        fixture.studio,
        fixture.script,
        fixture.director,
        fixture.editing,
        fixture.tts,
        fixture.media,
        fixture.remotion,
        fixture.projectId,
        fixture.chapterId,
      );

      expect(result.artifacts).not.toContainEqual(expect.objectContaining({
        id: buildArtifactId("analysis", "agent-workflow-result", legacyWork.id),
      }));
      expect(result.legacyMappings).toContainEqual(expect.objectContaining({
        rule: "episode-1-to-index",
        status: "blocked",
      }));
    });

    test("uses only explicit continuity ownership and blocks ambiguous versions", () => {
      const fixture = buildSingleChapterFixture("chapter-001");
      const baseVersion = fixture.studio.continuityAssetVersions[0]!;
      const ownedByChapterA = {
        ...baseVersion,
        versionId: "continuity-owned-a",
        chapterId: "chapter-001",
      };
      const ownedByChapterB = {
        ...baseVersion,
        versionId: "continuity-owned-b",
        episodeId: "chapter-002",
      };
      const missingOwnership = {
        ...baseVersion,
        versionId: "continuity-unowned",
        referenceImagePaths: ["continuity-bibles/chapter-001/unowned.png"],
      };
      const conflictingOwnership = {
        ...baseVersion,
        versionId: "continuity-conflicting",
        chapterId: "chapter-001",
        episodeId: "chapter-002",
        referenceImagePaths: ["continuity-bibles/chapter-001/conflicting.png"],
      };
      fixture.studio.continuityAssetVersions = [
        ownedByChapterA,
        ownedByChapterB,
        missingOwnership,
        conflictingOwnership,
      ];

      const result = projectAllFromStores(
        fixture.studio,
        fixture.script,
        fixture.director,
        fixture.editing,
        fixture.tts,
        fixture.media,
        fixture.remotion,
        fixture.projectId,
        fixture.chapterId,
      );
      const continuityById = new Map(
        result.artifacts
          .filter((artifact) => artifact.kind === "continuity-bible")
          .map((artifact) => [artifact.id, artifact]),
      );
      const artifactId = (versionId: string) => buildArtifactId(
        "assets",
        "continuity-bible",
        `${baseVersion.assetId}-${versionId}`,
      );

      expect(continuityById.get(artifactId(ownedByChapterA.versionId))).toMatchObject({
        chapterId: "chapter-001",
        deletePolicy: "retain-shared-reference",
      });
      expect(continuityById.has(artifactId(ownedByChapterB.versionId))).toBe(false);
      expect(continuityById.get(artifactId(missingOwnership.versionId))).toMatchObject({
        chapterId: undefined,
        deletePolicy: "blocker-missing-ownership",
        physicalRefs: [expect.objectContaining({
          type: "project-file",
          path: "continuity-bibles/chapter-001/unowned.png",
        })],
      });
      expect(continuityById.get(artifactId(conflictingOwnership.versionId))).toMatchObject({
        chapterId: undefined,
        deletePolicy: "blocker-missing-ownership",
      });
    });

    test("projects current media URL and relativePath fields instead of fixture-only localPath", () => {
      const [localMedia] = projectMediaFiles([{
        id: "media-current-url",
        name: "current.png",
        type: "image",
        projectId: "project-1",
        url: "local-image://shots/current.png",
      }], "project-1");
      const [projectFile] = projectMediaFiles([{
        id: "media-current-relative",
        name: "relative.png",
        type: "image",
        projectId: "project-1",
        relativePath: "workflow-images/current.png",
      }], "project-1");

      expect(localMedia.physicalRefs).toEqual([
        expect.objectContaining({ type: "local-media", path: "local-image://shots/current.png" }),
      ]);
      expect(projectFile.physicalRefs).toEqual([
        expect.objectContaining({ type: "project-file", path: "workflow-images/current.png" }),
      ]);
    });

    test("keeps owned TTS lines deletable and legacy numeric lines blocked", () => {
      const [owned] = projectTTSVoiceLines([
        { sceneId: 1, projectId: "project-1", chapterId: "chapter-001", audioRef: "exports/chapter-001/voice.wav", updatedAt: 42 },
      ], "project-1", "chapter-001");
      const [legacy] = projectTTSVoiceLines([
        { sceneId: 2, projectId: "project-1", audioRef: "exports/chapter-001/legacy.wav" },
      ], "project-1", "chapter-001");

      expect(owned).toMatchObject({
        projectId: "project-1",
        chapterId: "chapter-001",
        deletePolicy: "delete-exclusive-downstream",
        updatedAt: 42,
      });
      expect(legacy).toMatchObject({
        projectId: "project-1",
        chapterId: undefined,
        deletePolicy: "blocker-missing-ownership",
      });
    });

    test("resolves a legacy numeric sceneId only with exact unique script ownership", () => {
      const scenes = [scriptScene("101")];
      const ownership = buildLegacyTtsSceneOwnership(
        [episode("chapter-101", ["101"])],
        scenes,
      );
      const [resolved] = projectTTSVoiceLines(
        [{ sceneId: 101, projectId: "project-1", audioRef: "exports/chapter-101/voice.wav" }],
        "project-1",
        undefined,
        scenes,
        ownership,
      );

      expect(resolved).toMatchObject({
        chapterId: "chapter-101",
        deletePolicy: "delete-exclusive-downstream",
        blockerReason: undefined,
      });
    });

    test("keeps zero-match and multi-match legacy sceneIds blocked", () => {
      const scenes = [scriptScene("202"), scriptScene("303")];
      const ownership = buildLegacyTtsSceneOwnership(
        [
          episode("chapter-202-a", ["202"]),
          episode("chapter-202-b", ["202"], 2),
        ],
        scenes,
      );
      const [ambiguous, missing] = projectTTSVoiceLines(
        [
          { sceneId: 202, projectId: "project-1" },
          { sceneId: 404, projectId: "project-1" },
        ],
        "project-1",
        undefined,
        scenes,
        ownership,
      );

      expect(ambiguous).toMatchObject({
        chapterId: undefined,
        deletePolicy: "blocker-missing-ownership",
      });
      expect(missing).toMatchObject({
        chapterId: undefined,
        deletePolicy: "blocker-missing-ownership",
      });
    });

    test("wires the unique legacy mapping into the complete store projection", () => {
      const fixture = buildSingleChapterFixture();
      const targetEpisode = fixture.script.episodes[0]!;
      fixture.script.scenes = [scriptScene("1"), scriptScene("2")];
      targetEpisode.sceneIds = ["1", "2"];

      const result = projectAllFromStores(
        fixture.studio,
        fixture.script,
        fixture.director,
        fixture.editing,
        fixture.tts,
        fixture.media,
        fixture.remotion,
        fixture.projectId,
        targetEpisode.id,
      );
      const voiceArtifacts = result.artifacts.filter((artifact) => artifact.kind === "tts-scene-voice-line");

      expect(voiceArtifacts).toHaveLength(2);
      expect(voiceArtifacts.every((artifact) => artifact.chapterId === targetEpisode.id)).toBe(true);
      expect(result.legacyMappings).toContainEqual(expect.objectContaining({
        rule: "numeric-tts-sceneid",
        status: "resolved",
      }));
    });

    test("does not block a target chapter for a legacy line uniquely owned by another chapter", () => {
      const fixture = buildSingleChapterFixture();
      const targetEpisode = fixture.script.episodes[0]!;
      fixture.script.episodes = [
        targetEpisode,
        episode("chapter-2", ["9"], 2),
      ];
      fixture.script.scenes = [scriptScene("9")];
      const existingLine = Object.values(fixture.tts.projects[fixture.projectId]!.voiceLines)[0]!;
      fixture.tts.projects[fixture.projectId]!.voiceLines = {
        legacy: { ...existingLine, sceneId: 9, chapterId: undefined, projectId: undefined },
      };

      const result = projectAllFromStores(
        fixture.studio,
        fixture.script,
        fixture.director,
        fixture.editing,
        fixture.tts,
        fixture.media,
        fixture.remotion,
        fixture.projectId,
        targetEpisode.id,
      );

      expect(result.artifacts.some((artifact) => artifact.kind === "tts-scene-voice-line")).toBe(false);
      expect(result.legacyMappings).toContainEqual(expect.objectContaining({
        rule: "numeric-tts-sceneid",
        status: "resolved",
      }));
      expect(result.legacyMappings).not.toContainEqual(expect.objectContaining({
        rule: "numeric-tts-sceneid",
        status: "blocked",
      }));
    });
  });
});
