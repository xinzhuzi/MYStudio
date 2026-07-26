import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { Scene } from "@/stores/library/scene-store";
import type {
  ContactSheetPromptSet,
  PendingViewpointData,
} from "@/stores/navigation/media-panel-store";
import type { ContactSheetLayout } from "./generation-panel-utils";
import { buildContactSheetLayoutSync } from "./contact-sheet-layout-sync";

interface UseContactSheetLayoutSyncOptions {
  aspectRatio: "16:9" | "9:16";
  viewpoints: PendingViewpointData[];
  prompts: ContactSheetPromptSet[];
  currentPageIndex: number;
  currentPrompt: string | null;
  selectedScene: Scene | null;
  styleId: string;
  setLayout: Dispatch<SetStateAction<ContactSheetLayout>>;
  setPrompts: Dispatch<SetStateAction<ContactSheetPromptSet[]>>;
  setPrompt: Dispatch<SetStateAction<string | null>>;
  setPromptZh: Dispatch<SetStateAction<string | null>>;
}

export function useContactSheetLayoutSync(
  options: UseContactSheetLayoutSyncOptions,
) {
  // Keep the original aspect-ratio-only synchronization trigger.
  useEffect(() => {
    const sync = buildContactSheetLayoutSync({
      aspectRatio: options.aspectRatio,
      viewpoints: options.viewpoints,
      prompts: options.prompts,
      currentPageIndex: options.currentPageIndex,
      hasCurrentPrompt: Boolean(options.currentPrompt),
      selectedScene: options.selectedScene,
      styleId: options.styleId,
    });
    if (!sync) return;

    options.setLayout(sync.layout);
    options.setPrompts(sync.prompts);
    if (sync.prompt) options.setPrompt(sync.prompt);
    if (sync.promptZh) options.setPromptZh(sync.promptZh);
    console.log("[ContactSheet] 宽高比变化，更新布局:", {
      aspectRatio: options.aspectRatio,
      vpCount: options.viewpoints.length,
      newLayout: sync.prompts[0]?.gridLayout,
      selectedSceneId: options.selectedScene?.id,
    });
  }, [options.aspectRatio]); // 只监听宽高比变化
}
