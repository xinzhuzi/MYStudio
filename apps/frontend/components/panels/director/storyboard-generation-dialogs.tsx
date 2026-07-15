import type { ComponentProps } from "react";
import { AngleSwitchDialog, AngleSwitchResultDialog } from "@/components/angle-switch";
import { QuadGridDialog, QuadGridResultDialog } from "@/components/quad-grid";
import type { SplitScene } from "@/stores/director-store";
import type { StoryboardGenerationUiController } from "./use-storyboard-generation-ui";

type StoryboardDialogScene = Pick<
  SplitScene,
  "id" | "imageDataUrl" | "endFrameImageUrl" | "startFrameAngleSwitchHistory" | "endFrameAngleSwitchHistory"
>;

type StoryboardGenerationDialogsProps = {
  controller: StoryboardGenerationUiController;
  scenes: StoryboardDialogScene[];
  onGenerateAngle: ComponentProps<typeof AngleSwitchDialog>["onGenerate"];
  onApplyAngle: ComponentProps<typeof AngleSwitchResultDialog>["onApply"];
  onGenerateGrid: ComponentProps<typeof QuadGridDialog>["onGenerate"];
  onApplyGrid: ComponentProps<typeof QuadGridResultDialog>["onApply"];
  onCopyGridToScene: ComponentProps<typeof QuadGridResultDialog>["onCopyToScene"];
};

export function StoryboardGenerationDialogs({
  controller,
  scenes,
  onGenerateAngle,
  onApplyAngle,
  onGenerateGrid,
  onApplyGrid,
  onCopyGridToScene,
}: StoryboardGenerationDialogsProps) {
  const angleScene = controller.angleSwitchTarget
    ? scenes.find((scene) => scene.id === controller.angleSwitchTarget?.sceneId)
    : undefined;
  const gridScene = controller.quadGridTarget
    ? scenes.find((scene) => scene.id === controller.quadGridTarget?.sceneId)
    : undefined;
  const anglePreview = controller.angleSwitchTarget?.type === "end" ? angleScene?.endFrameImageUrl : angleScene?.imageDataUrl;
  const gridPreview = controller.quadGridTarget?.type === "end" ? gridScene?.endFrameImageUrl : gridScene?.imageDataUrl;
  const angleHistory = controller.angleSwitchTarget?.type === "end"
    ? angleScene?.endFrameAngleSwitchHistory || []
    : angleScene?.startFrameAngleSwitchHistory || [];

  return (
    <>
      <AngleSwitchDialog
        open={controller.angleSwitchOpen}
        onOpenChange={controller.setAngleSwitchOpen}
        onGenerate={onGenerateAngle}
        isGenerating={controller.isAngleSwitching}
        frameType={controller.angleSwitchTarget?.type || "start"}
        previewUrl={anglePreview || undefined}
        sameSceneShotsCount={0}
      />
      <AngleSwitchResultDialog
        open={controller.angleSwitchResultOpen}
        onOpenChange={controller.setAngleSwitchResultOpen}
        result={controller.angleSwitchResult}
        history={angleHistory}
        selectedHistoryIndex={controller.selectedHistoryIndex}
        onSelectHistory={controller.setSelectedHistoryIndex}
        onApply={onApplyAngle}
        onRegenerate={() => {
          controller.setAngleSwitchResultOpen(false);
          controller.setAngleSwitchOpen(true);
        }}
      />
      <QuadGridDialog
        open={controller.quadGridOpen}
        onOpenChange={controller.setQuadGridOpen}
        onGenerate={onGenerateGrid}
        isGenerating={controller.isQuadGridGenerating}
        frameType={controller.quadGridTarget?.type || "start"}
        previewUrl={gridPreview || undefined}
      />
      <QuadGridResultDialog
        open={controller.quadGridResultOpen}
        onOpenChange={controller.setQuadGridResultOpen}
        result={controller.quadGridResult}
        frameType={controller.quadGridTarget?.type || "start"}
        currentSceneId={controller.quadGridTarget?.sceneId ?? 0}
        availableScenes={scenes.map((scene) => ({ id: scene.id, label: `分镜 ${scene.id + 1}` }))}
        onApply={onApplyGrid}
        onCopyToScene={onCopyGridToScene}
      />
    </>
  );
}
