import { afterEach, describe, expect, it } from "vitest";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import { useEditingStore } from "@/stores/editing-store";
import {
  getSmokeStoryboardFramePath,
  installWorkflowSmokeBridge,
  isIsolatedSmokeUserDataDir,
  type WorkflowSmokeStageResult,
} from "./workflow-smoke-bridge";

type BrowserMockGlobal = Partial<{
  window: Window & typeof globalThis;
  localStorage: Storage;
}>;

const browserGlobal = globalThis as BrowserMockGlobal;
const previousWindow = browserGlobal.window;
const previousLocalStorage = browserGlobal.localStorage;

afterEach(() => {
  if (previousWindow) {
    browserGlobal.window = previousWindow;
  } else {
    delete browserGlobal.window;
  }
  if (previousLocalStorage) {
    browserGlobal.localStorage = previousLocalStorage;
  } else {
    delete browserGlobal.localStorage;
  }
});

describe("workflow smoke bridge isolation", () => {
  it("allows only temp smoke user data directories", () => {
    expect(isIsolatedSmokeUserDataDir("/var/folders/tmp/mystudio-smoke-abcd")).toBe(true);
    expect(isIsolatedSmokeUserDataDir("/var/folders/tmp/mystudio-installed-smoke-abcd")).toBe(true);
    expect(isIsolatedSmokeUserDataDir("/var/folders/tmp/mystudio-daojie-workflow-run-abcd")).toBe(true);
  });

  it("blocks real MYStudio user data directories", () => {
    expect(isIsolatedSmokeUserDataDir("")).toBe(false);
    expect(isIsolatedSmokeUserDataDir("/Users/me/Library/Application Support/漫影工作室")).toBe(false);
    expect(isIsolatedSmokeUserDataDir("/Users/me/Library/Application Support/MYStudio")).toBe(false);
  });

  it("uses an inline storyboard frame so installed smoke has no missing temp image", () => {
    expect(getSmokeStoryboardFramePath()).toMatch(/^data:image\/png;base64,/);
  });

  it("exposes isolated stepwise execution with stage evidence", async () => {
    const localStorageItems = new Map<string, string>();
    browserGlobal.localStorage = {
      getItem: (key: string) => localStorageItems.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localStorageItems.set(key, value);
      },
      removeItem: (key: string) => {
        localStorageItems.delete(key);
      },
      clear: () => {
        localStorageItems.clear();
      },
      key: (index: number) => Array.from(localStorageItems.keys())[index] ?? null,
      get length() {
        return localStorageItems.size;
      },
    } as Storage;
    browserGlobal.window = {
      mystudioSmoke: {
        enabled: true,
        userDataDir: "/var/folders/tmp/mystudio-smoke-stepwise-test",
      },
      setTimeout: globalThis.setTimeout,
    } as Window &
      typeof globalThis & {
        mystudioSmoke: { enabled: boolean; userDataDir: string };
      };

    installWorkflowSmokeBridge();
    const reset = await window.mystudioWorkflowSmoke?.resetForStepwiseExecution();
    expect(reset?.progress).toBe(0);
    expect(reset?.source).toBe("isolated-smoke-project");

    const stageIds = ["manuals", "novel", "script", "assets", "storyboard", "workbench"];
    const results: Array<WorkflowSmokeStageResult | undefined> = [];
    for (const stageId of stageIds) {
      results.push(await window.mystudioWorkflowSmoke?.runStepwiseWorkflowStage(stageId));
    }

    expect(results.map((result) => result?.stageId)).toEqual(stageIds);
    expect(results.every((result) => result?.ready)).toBe(true);
    expect(results[0]?.evidenceText).toContain("visualManualId");
    expect(results[2]?.evidenceText).toContain("storySkeletonReview=1");
    expect(results[2]?.evidenceText).toContain("adaptationStrategyReview=1");
    expect(results[2]?.evidenceText).toContain("scriptDraftReview=1");
    expect(results.at(-1)?.progress).toBe(100);
    expect(results.at(-1)?.checks).toMatchObject({
      hasFinalExport: true,
      hasEditingProject: true,
      hasTimelineRenderRecord: true,
      hasCompleteTimelineEvidence: true,
      seededEditingEvidence: true,
      hasSelectedCandidate: true,
      hasVoiceBinding: true,
      hasVoiceAudio: true,
      hasWorkflowParityReport: true,
      workflowParityNoErrors: true,
      workflowParityHasOrderedReferences: true,
      workflowParityHasSourceEvidence: true,
    });

    const inspected = await window.mystudioWorkflowSmoke?.inspectWorkflowStages();
    expect(inspected?.source).toBe("isolated-smoke-project");
    expect(inspected?.progress).toBe(100);
    expect(inspected?.stages.find((stage) => stage.id === "workbench")).toMatchObject({
      id: "workbench",
      status: "ready",
    });
    expect(inspected?.evidence.find((item) => item.stageId === "manuals")).toMatchObject({
      ready: true,
      evidence: expect.stringContaining("directorManualId"),
    });
    expect(inspected?.evidence.find((item) => item.stageId === "workbench")).toMatchObject({
      ready: true,
      evidence: expect.stringContaining("selectedCandidates"),
    });
    expect(inspected?.workflowParityReport?.references).toMatchObject({
      storyboardsWithOrderedManifest: 1,
      orderedReferenceCount: 2,
      missingReferenceCount: 0,
    });
    expect(inspected?.editingEvidence).toMatchObject({
      source: "seeded-ui-smoke",
      editingProjectId: "smoke-editing-1",
      editingRevision: 1,
      timelineRenderJobId: "smoke-timeline-render-1",
      hasCompleteTimelineEvidence: true,
      realMediaGeneration: false,
    });
    expect(inspected?.evidenceBoundary).toMatchObject({
      seededUiSmoke: true,
      realMediaGeneration: false,
    });
  });

  it("does not expose the stepwise bridge outside isolated smoke directories", () => {
    browserGlobal.window = {
      mystudioSmoke: {
        enabled: true,
        userDataDir: "/Users/me/Library/Application Support/漫影工作室",
      },
    } as Window &
      typeof globalThis & {
        mystudioSmoke: { enabled: boolean; userDataDir: string };
      };

    installWorkflowSmokeBridge();

    expect(window.mystudioWorkflowSmoke).toBeUndefined();
  });

  it("seeds a complete project-scoped workflow for every node preview", async () => {
    const localStorageItems = new Map<string, string>();
    browserGlobal.localStorage = {
      getItem: (key: string) => localStorageItems.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localStorageItems.set(key, value);
      },
      removeItem: (key: string) => {
        localStorageItems.delete(key);
      },
      clear: () => {
        localStorageItems.clear();
      },
      key: (index: number) => Array.from(localStorageItems.keys())[index] ?? null,
      get length() {
        return localStorageItems.size;
      },
    } as Storage;
    browserGlobal.window = {
      mystudioSmoke: {
        enabled: true,
        userDataDir: "/var/folders/tmp/mystudio-smoke-workflow-test",
      },
      setTimeout: globalThis.setTimeout,
    } as Window &
      typeof globalThis & {
        mystudioSmoke: { enabled: boolean; userDataDir: string };
      };

    installWorkflowSmokeBridge();
    const result = await window.mystudioWorkflowSmoke?.seedCompleteWorkflow();

    expect(result?.progress).toBe(100);
    expect(result?.checks).toMatchObject({
      manualsReady: true,
      novelReady: true,
      scriptReady: true,
      assetsReady: true,
      generationReady: true,
      storyboardReady: true,
      workbenchReady: true,
      hasFinalExport: true,
      hasEditingProject: true,
      hasTimelineRenderRecord: true,
      hasCompleteTimelineEvidence: true,
      seededEditingEvidence: true,
      hasSelectedCandidate: true,
      hasVoiceBinding: true,
      hasVoiceAudio: true,
      hasWorkflowParityReport: true,
      workflowParityNoErrors: true,
      workflowParityHasOrderedReferences: true,
      workflowParityHasSourceEvidence: true,
    });
    expect(result?.workflowParityReport?.storyboard.withSourceEvidence).toBe(1);
    expect(result?.workflowParityReport?.references.storyboardsWithOrderedManifest).toBe(1);
    expect(result?.workflowParityReport?.video).toMatchObject({
      currentEditingProjectId: "smoke-editing-1",
      currentEditingRevision: 1,
      editingProject: expect.objectContaining({
        id: "smoke-editing-1",
        revision: 1,
      }),
      timelineRenderRecords: 1,
      timelineRenderRecord: expect.objectContaining({
        editingRevision: 1,
        evidence: expect.objectContaining({
          jobId: "smoke-timeline-render-1",
        }),
      }),
      completeTimelineEvidence: 1,
      hasCompleteTimelineEvidence: true,
      hasFinalExport: true,
      hasLegacyCompatibilityExport: true,
    });
    expect(result?.workflowParityReport?.evidenceBoundary.realMediaGeneration).toBe(false);

    const studio = useStudioStore.getState();
    expect(studio.scriptPlans[0]?.derivedAssetPlan).toEqual([
      expect.objectContaining({ parentAssetId: "smoke-role-sword" }),
      expect.objectContaining({ parentAssetId: "smoke-scene-mine" }),
      expect.objectContaining({ parentAssetId: "smoke-prop-sword" }),
    ]);
    expect(studio.storyboards[0]?.mediaRef?.path).toMatch(/^data:image\/png;base64,/);
    expect(studio.productionTracks[0]?.selectedVideoId).toBe("smoke-video-1");
    expect(studio.videoCandidates[0]?.filePath).toBe("/tmp/mystudio-smoke-final.mp4");
    expect(
      useEditingStore.getState().getCurrentEditingProject("smoke-chapter-1"),
    ).toMatchObject({
      id: "smoke-editing-1",
      revision: 1,
    });
    expect(studio.scriptPlans[0]).toMatchObject({
      theme: "矿场入局",
      visualStyle: "水墨漫剧",
    });
    expect(studio.agentWorkData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "storySkeletonReview" }),
        expect.objectContaining({ key: "adaptationStrategyReview" }),
        expect.objectContaining({ key: "scriptDraftReview" }),
      ]),
    );

    expect(useCharacterLibraryStore.getState().characters[0]).toMatchObject({
      id: "smoke-role-sword",
      projectId: "default-project",
      thumbnailUrl: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(useSceneStore.getState().scenes[0]).toMatchObject({
      id: "smoke-scene-mine",
      projectId: "default-project",
      referenceImage: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(usePropsLibraryStore.getState().items[1]).toMatchObject({
      id: "smoke-prop-sword-broken",
      parentId: "smoke-prop-sword",
      imageUrl: expect.stringMatching(/^data:image\/png;base64,/),
    });

    const tts = useTtsStore.getState();
    const project = tts.projects["default-project"];
    expect(project?.bindings["character:smoke-role-sword"]).toMatchObject({
      profileId: "smoke-voice-profile",
    });
    expect(project?.voiceLines["1"]).toMatchObject({
      status: "completed",
      audioLocalPath: "/tmp/mystudio-smoke-voice.wav",
    });
  });
});
