// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, test, expect } from "vitest";
import type { Episode, ScriptScene } from "@/types/script";
import {
  buildArtifactId,
  buildLegacyTtsSceneOwnership,
  projectAllFromStores,
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

    test("keeps owned TTS lines deletable and legacy numeric lines blocked", () => {
      const [owned] = projectTTSVoiceLines([
        { sceneId: 1, projectId: "project-1", chapterId: "chapter-001", audioRef: "exports/chapter-001/voice.wav" },
      ], "project-1", "chapter-001");
      const [legacy] = projectTTSVoiceLines([
        { sceneId: 2, projectId: "project-1", audioRef: "exports/chapter-001/legacy.wav" },
      ], "project-1", "chapter-001");

      expect(owned).toMatchObject({
        projectId: "project-1",
        chapterId: "chapter-001",
        deletePolicy: "delete-exclusive-downstream",
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
