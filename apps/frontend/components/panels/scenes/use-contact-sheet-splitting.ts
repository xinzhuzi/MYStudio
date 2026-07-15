import { useCallback } from "react";
import type { ChangeEvent } from "react";
import type { PendingViewpointData, ContactSheetPromptSet } from "@/stores/media-panel-store";
import type { SceneViewpoint } from "@/lib/script/scene-viewpoint-generator";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { splitStoryboardImage } from "@/lib/storyboard/image-splitter";
import { toast } from "sonner";
import {
  buildDirectUploadLayoutData,
  getLayoutDimensions,
  mapGridResultsToViewpoints,
  type ContactSheetLayout,
} from "./generation-panel-utils";

type ViewpointImages = Record<string, { imageUrl: string; gridIndex: number }>;

interface UseContactSheetSplittingOptions {
  contactSheetImage: string | null;
  contactSheetPrompt: string | null;
  contactSheetLayout: ContactSheetLayout;
  contactSheetAspectRatio: "16:9" | "9:16";
  extractedViewpoints: SceneViewpoint[];
  pendingViewpoints: PendingViewpointData[];
  pendingContactSheetPrompts: ContactSheetPromptSet[];
  currentPageIndex: number;
  selectScene: (id: string | null) => void;
  setName: (name: string) => void;
  setLocation: (location: string) => void;
  setContactSheetLayout: (layout: ContactSheetLayout) => void;
  setContactSheetPrompt: (prompt: string | null) => void;
  setContactSheetPromptZh: (prompt: string | null) => void;
  setContactSheetImage: (image: string | null) => void;
  setExtractedViewpoints: (viewpoints: SceneViewpoint[]) => void;
  setPendingViewpoints: (viewpoints: PendingViewpointData[]) => void;
  setPendingContactSheetPrompts: (prompts: ContactSheetPromptSet[]) => void;
  setCurrentPageIndex: (index: number) => void;
  setSplitViewpointImages: (images: ViewpointImages) => void;
  setIsSplitting: (isSplitting: boolean) => void;
}

export function useContactSheetSplitting({
  contactSheetImage,
  contactSheetPrompt,
  contactSheetLayout,
  contactSheetAspectRatio,
  extractedViewpoints,
  pendingViewpoints,
  pendingContactSheetPrompts,
  currentPageIndex,
  selectScene,
  setName,
  setLocation,
  setContactSheetLayout,
  setContactSheetPrompt,
  setContactSheetPromptZh,
  setContactSheetImage,
  setExtractedViewpoints,
  setPendingViewpoints,
  setPendingContactSheetPrompts,
  setCurrentPageIndex,
  setSplitViewpointImages,
  setIsSplitting,
}: UseContactSheetSplittingOptions) {
  const readContactSheetFile = useCallback((file: File, onLoaded?: () => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      setContactSheetImage(String(event.target?.result || ""));
      onLoaded?.();
    };
    reader.readAsDataURL(file);
  }, [setContactSheetImage]);

  const handleUploadContactSheet = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    readContactSheetFile(file, () => toast.success("联合图已上传，可以进行切割"));
  }, [readContactSheetFile]);

  const handleDirectUploadContactSheet = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    selectScene(null);
    const timestamp = new Date().toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).replace(/[\/:]/g, "-");
    const autoSceneName = `联合图场景-${timestamp}`;
    setName(autoSceneName);
    setLocation(autoSceneName);

    const layoutData = buildDirectUploadLayoutData(contactSheetLayout, contactSheetAspectRatio);
    const dimensions = layoutData.promptPage.gridLayout;
    setExtractedViewpoints(layoutData.viewpoints);
    setPendingContactSheetPrompts([layoutData.promptPage]);
    setPendingViewpoints(layoutData.pendingViewpoints);
    setCurrentPageIndex(0);
    setContactSheetPrompt("[直接上传 - 无提示词]");
    setContactSheetPromptZh("[直接上传 - 无提示词]");
    readContactSheetFile(file, () => {
      toast.success(`联合图已上传（${dimensions.rows}×${dimensions.cols} = ${dimensions.rows * dimensions.cols}格），切割后将自动创建新场景`);
    });
  }, [contactSheetAspectRatio, contactSheetLayout, readContactSheetFile, selectScene, setContactSheetPrompt, setContactSheetPromptZh, setCurrentPageIndex, setExtractedViewpoints, setLocation, setName, setPendingContactSheetPrompts, setPendingViewpoints]);

  const handleContactSheetLayoutChange = useCallback((newLayout: ContactSheetLayout) => {
    setContactSheetLayout(newLayout);
    if (contactSheetPrompt !== "[直接上传 - 无提示词]") return;
    const layoutData = buildDirectUploadLayoutData(newLayout, contactSheetAspectRatio);
    setExtractedViewpoints(layoutData.viewpoints);
    setPendingViewpoints(layoutData.pendingViewpoints);
    setPendingContactSheetPrompts([layoutData.promptPage]);
    setSplitViewpointImages({});
  }, [contactSheetAspectRatio, contactSheetPrompt, setContactSheetLayout, setExtractedViewpoints, setPendingContactSheetPrompts, setPendingViewpoints, setSplitViewpointImages]);

  const handleSplitContactSheet = useCallback(async () => {
    const currentPageViewpoints = pendingViewpoints.filter((viewpoint) => viewpoint.pageIndex === currentPageIndex);
    const viewpointsToUse = currentPageViewpoints.length > 0 ? currentPageViewpoints : extractedViewpoints;
    if (!contactSheetImage || viewpointsToUse.length === 0) {
      toast.error("请先上传联合图并生成提示词");
      return;
    }

    setIsSplitting(true);
    try {
      const pageLayout = pendingContactSheetPrompts[currentPageIndex]?.gridLayout;
      const dimensions = pageLayout || getLayoutDimensions(contactSheetLayout, contactSheetAspectRatio);
      let imageForSplit = contactSheetImage;
      if (/^https?:\/\//.test(contactSheetImage)) {
        try {
          const response = await fetch(contactSheetImage);
          const blob = await response.blob();
          imageForSplit = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          console.warn("[Split] HTTP→base64 转换失败，使用原URL:", error);
        }
      }

      const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
      const splitResults = await splitStoryboardImage(imageForSplit, {
        aspectRatio: contactSheetAspectRatio,
        resolution: imageSettings.defaultResolution === "4K" ? "4K" : "2K",
        sceneCount: dimensions.rows * dimensions.cols,
        options: {
          expectedRows: dimensions.rows,
          expectedCols: dimensions.cols,
          filterEmpty: false,
          edgeMarginPercent: 0.02,
        },
      });
      const viewpointImages = mapGridResultsToViewpoints(splitResults, viewpointsToUse, dimensions.cols);
      if (currentPageViewpoints.length > 0 && extractedViewpoints.length === 0) {
        setExtractedViewpoints(currentPageViewpoints.map((viewpoint) => ({
          id: viewpoint.id,
          name: viewpoint.name,
          nameEn: viewpoint.nameEn,
          shotIds: viewpoint.shotIds,
          keyProps: viewpoint.keyProps,
          keyPropsEn: viewpoint.keyPropsEn,
          description: "",
          descriptionEn: "",
          gridIndex: viewpoint.gridIndex,
        })));
      }
      setSplitViewpointImages(viewpointImages);
      toast.success(`已切割为 ${Object.keys(viewpointImages).length} 个视角图片`);
    } catch (error) {
      console.error("[ContactSheet] 切割失败:", error);
      toast.error("切割失败，请检查图片格式");
    } finally {
      setIsSplitting(false);
    }
  }, [contactSheetAspectRatio, contactSheetImage, contactSheetLayout, currentPageIndex, extractedViewpoints, pendingContactSheetPrompts, pendingViewpoints, setExtractedViewpoints, setIsSplitting, setSplitViewpointImages]);

  return {
    handleUploadContactSheet,
    handleDirectUploadContactSheet,
    handleContactSheetLayoutChange,
    handleSplitContactSheet,
  };
}
