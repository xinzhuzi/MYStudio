// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, test, expect } from "vitest";
import { buildArtifactId, projectAllFromStores } from "./artifact-projection";
import { buildSingleChapterFixture } from "./__fixtures__/fixture-builders";

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
  });
});
