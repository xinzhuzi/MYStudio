// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { beforeEach, describe, expect, it } from "vitest";
import type { SplitScene } from "@/stores/director/director-store";
import { useDirectorStore } from "@/stores/director/director-store";
import {
  splitSceneImageReviewApproved,
  splitSceneImageReviewIssue,
} from "./split-scene-image-review";

const PROJECT_ID = "p-review";

function seedScene(overrides: Partial<SplitScene> = {}): SplitScene {
  return {
    id: 0,
    sceneName: "山村学校",
    sceneLocation: "教室内部",
    imageDataUrl: "data:image/png;base64,aGVsbG8=",
    imageHttpUrl: null,
    width: 1280,
    height: 720,
    imagePrompt: "",
    imagePromptZh: "",
    imageStatus: "completed",
    imageProgress: 100,
    imageError: null,
    needsEndFrame: false,
    endFrameImageUrl: null,
    endFrameHttpUrl: null,
    endFrameSource: null,
    endFramePrompt: "",
    endFramePromptZh: "",
    endFrameStatus: "idle",
    endFrameProgress: 0,
    endFrameError: null,
    videoPrompt: "",
    videoPromptZh: "",
    videoStatus: "idle",
    videoProgress: 0,
    videoUrl: null,
    videoError: null,
    videoMediaId: null,
    characterIds: [],
    emotionTags: [],
    dialogue: "",
    actionSummary: "",
    cameraMovement: "",
    soundEffectText: "",
    shotSize: null,
    duration: "5",
    ambientSound: "",
    ...overrides,
  } as SplitScene;
}

function activeScenes(): SplitScene[] {
  return useDirectorStore.getState().projects[PROJECT_ID]!.splitScenes;
}

beforeEach(() => {
  useDirectorStore.setState({
    activeProjectId: PROJECT_ID,
    projects: {
      [PROJECT_ID]: {
        splitScenes: [seedScene()],
        trailerScenes: [],
      },
    },
  } as never);
});

describe("split-scene-image-review(1125 导演域人审判定)", () => {
  it("无记录=待审拦;rejected=拦带原因;approved=放行", () => {
    const absent = seedScene();
    expect(splitSceneImageReviewApproved(absent)).toBe(false);
    expect(splitSceneImageReviewIssue(absent)).toContain("未通过人审");

    const rejected = seedScene({ imageReview: { status: "rejected", approvedAt: 1, reasons: ["主角画了两个"] } });
    expect(splitSceneImageReviewApproved(rejected)).toBe(false);
    expect(splitSceneImageReviewIssue(rejected)).toContain("驳回");
    expect(splitSceneImageReviewIssue(rejected)).toContain("主角画了两个");

    const approved = seedScene({ imageReview: { status: "approved", approvedAt: 1, reasons: [] } });
    expect(splitSceneImageReviewApproved(approved)).toBe(true);
    expect(splitSceneImageReviewIssue(approved)).toBeNull();
  });

  it("reviewSplitSceneImage 批准/驳回落库;updateSplitSceneImage 换图即作废回待审", () => {
    const store = useDirectorStore.getState();
    store.reviewSplitSceneImage(0, { status: "approved", reasons: [] });
    expect(activeScenes()[0]!.imageReview).toMatchObject({ status: "approved" });
    expect(splitSceneImageReviewApproved(activeScenes()[0])).toBe(true);

    store.updateSplitSceneImage(0, "data:image/png;base64,bmV3", 1280, 720);
    expect(activeScenes()[0]!.imageReview).toBeUndefined();
    expect(splitSceneImageReviewIssue(activeScenes()[0])).toContain("未通过人审");

    store.reviewSplitSceneImage(0, { status: "rejected", reasons: [" 服装漂移 "] });
    expect(activeScenes()[0]!.imageReview).toMatchObject({ status: "rejected", reasons: ["服装漂移"] });
  });
});
