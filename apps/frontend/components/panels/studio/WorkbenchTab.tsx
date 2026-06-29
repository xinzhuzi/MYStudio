import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { buildToonflowWorkbenchModel } from "@/lib/studio/workbench-view-model";
import type { ToonflowWorkbenchAssetMedia } from "@/lib/studio/workbench-view-model";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useStudioStore } from "@/stores/studio-store";
import { Film, RefreshCw, WandSparkles } from "lucide-react";
import { WorkbenchTrackCard } from "./WorkbenchTrackCard";

export function WorkbenchTab(props: {
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
  const assetMediaById = useMemo(
    () => buildWorkbenchAssetMediaMap(characters, scenes, propsItems),
    [characters, scenes, propsItems],
  );
  const workbench = buildToonflowWorkbenchModel({
    tracks: props.tracks,
    storyboards: props.storyboards,
    candidates: props.candidates,
    assetMediaById,
  });
  return (
    <div className="space-y-3">
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={props.rebuildTracks}>
            <RefreshCw className="h-4 w-4" />
            添加 track
          </Button>
          <Button type="button" variant="outline" disabled>
            <WandSparkles className="h-4 w-4" />
            生成提示词
          </Button>
          <Button
            onClick={props.mergeEpisode}
            disabled={props.merging || !workbench.canMergeEpisode}
          >
            <Film className="h-4 w-4" />
            导出成片
          </Button>
        </div>
      </div>
      {props.mergeOutput && (
        <div className="rounded-md border border-border bg-muted p-3 text-xs">
          导出文件: {props.mergeOutput}
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
    </div>
  );
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
      if (!variation.referenceImage) continue;
      entries[variation.id] = {
        id: variation.id,
        name: variation.name,
        fileType: "image",
        path: variation.referenceImage,
        prompt: variation.visualPromptZh || variation.visualPrompt,
      };
    }
  }
  for (const scene of scenes) {
    const path =
      scene.referenceImage ??
      scene.referenceImageBase64 ??
      getOptionalStringField(scene, "contactSheetImage");
    if (!path) continue;
    entries[scene.id] = {
      id: scene.id,
      name: scene.name,
      fileType: "image",
      path,
      prompt: scene.visualPrompt || scene.location || scene.atmosphere,
    };
  }
  for (const item of propsItems) {
    if (!item.imageUrl) continue;
    entries[item.id] = {
      id: item.id,
      name: item.name,
      fileType: "image",
      path: item.imageUrl,
      prompt: item.visualPrompt || item.description,
    };
  }
  return entries;
}

function getOptionalStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}
