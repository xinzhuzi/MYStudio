import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { buildToonflowWorkbenchModel } from "@/lib/studio/workbench-view-model";
import type { ToonflowWorkbenchAssetMedia } from "@/lib/studio/workbench-view-model";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/scene-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useStudioStore } from "@/stores/studio-store";
import type { ScriptPlan } from "@/types/studio";
import { Film, RefreshCw, WandSparkles } from "lucide-react";
import { EditingWorkbench } from "./EditingWorkbench";
import { VisualContinuityReviewPanel } from "./VisualContinuityReviewPanel";
import { WorkbenchTrackCard } from "./WorkbenchTrackCard";
import { useEditingWorkbenchActions } from "./useEditingWorkbenchActions";

export function WorkbenchTab(props: {
  projectId?: string;
  projectName?: string;
  episodeId?: string;
  directorPlan?: ScriptPlan;
  aspectRatio?: string;
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
  tracks: ReturnType<typeof useStudioStore.getState>["productionTracks"];
  candidates: ReturnType<typeof useStudioStore.getState>["videoCandidates"];
  renderingTrackId: string | null;
  merging: boolean;
  mergeOutput: string | null;
  rebuildTracks: () => void;
  renderTrack: (trackId: string) => void;
  selectVideoCandidate: ReturnType<
    typeof useStudioStore.getState
  >["selectVideoCandidate"];
  deleteVideoCandidate: ReturnType<
    typeof useStudioStore.getState
  >["deleteVideoCandidate"];
  mergeEpisode: () => void;
}) {
  const characters = useCharacterLibraryStore((state) => state.characters);
  const scenes = useSceneStore((state) => state.scenes);
  const propsItems = usePropsLibraryStore((state) => state.items);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const reviewStoryboardHuman = useStudioStore((state) => state.reviewStoryboardHuman);
  const editing = useEditingWorkbenchActions({
    projectId: props.projectId ?? activeProjectId ?? undefined,
    projectName: props.projectName ?? "漫影工作室",
    episodeId: props.episodeId ?? "episode-1",
    directorPlan: props.directorPlan,
    aspectRatio: props.aspectRatio,
    storyboards: props.storyboards,
    productionTracks: props.tracks,
    videoCandidates: props.candidates,
  });
  const assetMediaById = useMemo(
    () =>
      buildWorkbenchAssetMediaMap(
        filterProjectItems(characters, activeProjectId),
        filterProjectItems(scenes, activeProjectId),
        filterProjectItems(propsItems, activeProjectId),
      ),
    [activeProjectId, characters, scenes, propsItems],
  );
  const workbench = buildToonflowWorkbenchModel({
    tracks: props.tracks,
    storyboards: props.storyboards,
    candidates: props.candidates,
    assetMediaById,
  });
  return (
    <div className="space-y-3">
      <VisualContinuityReviewPanel
        storyboards={props.storyboards}
        onReview={reviewStoryboardHuman}
      />
      <EditingWorkbench
        project={editing.currentProject}
        drafting={editing.drafting}
        rendering={editing.rendering}
        renderProgress={editing.renderProgress}
        renderEvidence={editing.renderEvidence}
        error={editing.error}
        canUndo={editing.canUndo}
        canRedo={editing.canRedo}
        onCreateDraft={() => {
          void editing.createDraft().catch(() => undefined);
        }}
        onRender={() => {
          void editing.renderCurrent();
        }}
        onCancelRender={() => {
          void editing.cancelRender();
        }}
        onExecuteCommand={editing.executeCommand}
        onImportSubtitles={editing.importSubtitles}
        onExportSubtitles={editing.exportSubtitles}
        onUndo={editing.undo}
        onRedo={editing.redo}
      />

      <section aria-label="兼容候选与旧拼接导出" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            <h2 className="text-sm font-semibold">兼容候选与旧拼接导出</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              保留逐轨候选生成、选择、删除与旧 concat 导出；不会作为时间线成片失败时的自动回退。
            </p>
          </div>
        </div>
        <div className="grid gap-3 rounded-lg border border-border bg-card p-3 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">model</div>
            <div className="text-sm font-medium">ffmpeg-local</div>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">mode</div>
            <div className="text-sm font-medium">track-candidate</div>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">resolution</div>
            <div className="text-sm font-medium">16:9</div>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <Checkbox checked disabled />
            audio
          </label>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={props.rebuildTracks}>
            <RefreshCw className="h-4 w-4" />
            <span className="whitespace-normal leading-tight">添加 track</span>
          </Button>
          <Button type="button" variant="outline" disabled>
            <WandSparkles className="h-4 w-4" />
            <span className="whitespace-normal leading-tight">生成提示词</span>
          </Button>
          <Button
            onClick={props.mergeEpisode}
            disabled={props.merging || !workbench.canMergeEpisode}
          >
            <Film className="h-4 w-4" />
            <span className="whitespace-normal leading-tight">旧拼接导出</span>
          </Button>
        </div>
        </div>
        {props.mergeOutput && (
          <div className="rounded-md border border-border bg-muted p-3 text-xs">
            旧拼接导出文件: {props.mergeOutput}
          </div>
        )}
        <div className="space-y-3">
          {workbench.trackList.map((track) => (
            <WorkbenchTrackCard
              key={track.id}
              track={track}
              renderingTrackId={props.renderingTrackId}
              renderTrack={props.renderTrack}
              selectVideoCandidate={props.selectVideoCandidate}
              deleteVideoCandidate={props.deleteVideoCandidate}
            />
          ))}
        </div>
      </section>
    </div>
  );
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
