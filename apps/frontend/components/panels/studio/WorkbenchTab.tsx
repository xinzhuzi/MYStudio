import { Button } from "@/components/ui/button";
import type { ToonflowWorkbenchAssetMedia } from "@/lib/studio/workbench-view-model";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ScriptPlan } from "@/types/studio";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { Film } from "lucide-react";
import { NativeRemotionStudioHost } from "./NativeRemotionStudioHost";
import { VisualContinuityReviewPanel } from "./VisualContinuityReviewPanel";
import { useEditingWorkbenchActions } from "./useEditingWorkbenchActions";

export function WorkbenchTab(props: {
  projectId?: string;
  projectName?: string;
  episodeId?: string;
  directorPlan?: ScriptPlan;
  aspectRatio?: string;
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
  remotionShotSlots?: RemotionCurrentSlotV1[];
  /** Legacy fixture compatibility; formal UI never reads these fields. */
  tracks?: ReturnType<typeof useStudioStore.getState>["productionTracks"];
  candidates?: ReturnType<typeof useStudioStore.getState>["videoCandidates"];
}) {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const reviewStoryboardHuman = useStudioStore((state) => state.reviewStoryboardHuman);
  const continuityAssetVersions = useStudioStore((state) => state.continuityAssetVersions);
  const reviewContinuityAssetVersionHuman = useStudioStore((state) => state.reviewContinuityAssetVersionHuman);
  const editing = useEditingWorkbenchActions({
    projectId: props.projectId ?? activeProjectId ?? undefined,
    projectName: props.projectName ?? "漫影工作室",
    episodeId: props.episodeId ?? "episode-1",
    directorPlan: props.directorPlan,
    aspectRatio: props.aspectRatio,
    storyboards: props.storyboards,
    remotionShotSlots: props.remotionShotSlots,
  });
  const chapterReady = isCurrentChapterReady(
    props.episodeId ?? "episode-1",
    props.storyboards,
    props.remotionShotSlots ?? [],
  );
  return (
    <div className="space-y-3">
      <VisualContinuityReviewPanel
        storyboards={props.storyboards}
        continuityAssetVersions={continuityAssetVersions}
        onReview={reviewStoryboardHuman}
        onReviewAsset={reviewContinuityAssetVersionHuman}
      />
      {editing.currentProject && chapterReady ? <NativeRemotionStudioHost
        projectId={editing.currentProject.projectId}
        chapterId={editing.currentProject.episodeId}
        revision={editing.currentProject.revision}
      /> : (
        <section aria-label="Remotion 章节工作台准备" className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Film className="h-4 w-4" />
            原生 Remotion Studio 章节工作台
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            当前章节尚未生成可编辑工程。先完成当前章的 Remotion 分镜队列，系统会据此加载原生 Studio。
          </p>
          <div className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-xs text-cyan-100">
            分镜物料 → <strong>StoryboardShot</strong> 单镜 MP4 → 原生 Remotion Studio → <strong>ChapterVideo</strong> 章节合成 → 章节 MP4
          </div>
          <Button
            className="mt-4"
            disabled={editing.drafting || !chapterReady}
            onClick={() => { void editing.createDraft().catch(() => undefined); }}
          >
            {editing.drafting ? "正在准备…" : "准备当前章"}
          </Button>
          {!chapterReady ? (
            <p className="mt-3 text-xs text-muted-foreground">
              已验证单镜槽位：{countCurrentShotSlots(props.episodeId ?? "episode-1", props.storyboards, props.remotionShotSlots ?? [])}/{props.storyboards.length}；全部成功后才能进入章节工作台。
            </p>
          ) : null}
          {editing.error && <p className="mt-3 text-sm text-destructive">{editing.error}</p>}
        </section>
      )}
    </div>
  );
}

function isCurrentChapterReady(
  episodeId: string,
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"],
  slots: RemotionCurrentSlotV1[],
) {
  return storyboards.length > 0
    && countCurrentShotSlots(episodeId, storyboards, slots) === storyboards.length;
}

function countCurrentShotSlots(
  episodeId: string,
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"],
  slots: RemotionCurrentSlotV1[],
) {
  const storyboardIds = new Set(storyboards.map((storyboard) => storyboard.id));
  return new Set(
    slots
      .filter((slot) => slot.target.kind === "shot"
        && slot.target.chapterId === episodeId
        && storyboardIds.has(slot.target.shotId)
        && slot.job.status === "succeeded")
      .map((slot) => slot.target.kind === "shot" ? slot.target.shotId : ""),
  ).size;
}

function filterProjectItems<T extends { projectId?: string }>(
  items: T[],
  projectId: string | null,
) {
  return projectId ? items.filter((item) => item.projectId === projectId) : items;
}

export function buildWorkbenchAssetMediaMap(
  characters: ReturnType<typeof useCharacterLibraryStore.getState>["characters"],
  scenes: ReturnType<typeof useSceneStore.getState>["scenes"],
  propsItems: ReturnType<typeof usePropsLibraryStore.getState>["items"],
): Record<string, ToonflowWorkbenchAssetMedia> {
  const entries: Record<string, ToonflowWorkbenchAssetMedia> = {};
  for (const character of characters) {
    const path =
      character.thumbnailUrl ??
      character.views.find((view) => view.imageUrl)?.imageUrl ??
      character.referenceImages?.[0];
    if (path) {
      entries[character.id] = {
        id: character.id,
        name: character.name,
        fileType: "image",
        path,
        prompt: character.visualTraits || character.description,
      };
    }
    for (const variation of character.variations ?? []) {
      entries[variation.id] = {
        id: variation.id,
        name: variation.name,
        fileType: "image",
        path: variation.referenceImage,
        prompt: variation.visualPromptZh || variation.visualPrompt,
        parentAssetId: character.id,
        parentAssetName: character.name,
        state: variation.name,
        reason: variation.stageDescription || variation.ageDescription,
        imageWorkflowId: variation.imageWorkflowId,
        imageWorkflowTarget: {
          kind: "asset",
          assetType: "character",
          parentId: character.id,
          id: variation.id,
        },
      };
    }
  }
  for (const scene of scenes) {
    const path =
      scene.referenceImage ??
      scene.referenceImageBase64 ??
      getOptionalStringField(scene, "contactSheetImage");
    entries[scene.id] = {
      id: scene.id,
      name: scene.viewpointName || scene.name,
      fileType: "image",
      path,
      prompt: scene.visualPrompt || scene.location || scene.atmosphere,
      parentAssetId: scene.parentSceneId,
      parentAssetName: scene.parentSceneId
        ? scenes.find((item) => item.id === scene.parentSceneId)?.name
        : undefined,
      state: scene.viewpointName,
      reason: scene.notes || scene.spatialLayout,
      imageWorkflowId: scene.imageWorkflowId,
      imageWorkflowTarget: scene.parentSceneId
        ? {
            kind: "asset",
            assetType: "scene",
            parentId: scene.parentSceneId,
            id: scene.id,
          }
        : undefined,
    };
  }
  for (const item of propsItems) {
    entries[item.id] = {
      id: item.id,
      name: item.category || item.name,
      fileType: "image",
      path: item.imageUrl,
      prompt: item.visualPrompt || item.description,
      parentAssetId: item.parentId,
      parentAssetName: item.parentId
        ? propsItems.find((prop) => prop.id === item.parentId)?.name
        : undefined,
      state: item.category,
      reason: item.description,
      imageWorkflowId: item.imageWorkflowId,
      imageWorkflowTarget: item.parentId
        ? {
            kind: "asset",
            assetType: "prop",
            parentId: item.parentId,
            id: item.id,
          }
        : undefined,
    };
  }
  return entries;
}

function getOptionalStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}
