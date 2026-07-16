import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';

import { getStyleById, DEFAULT_STYLE_ID } from '@/lib/constants/visual-styles';
import type { SceneViewpoint } from '@/lib/script/scene-viewpoint-generator';
import type { ContactSheetPromptSet, PendingSceneData, PendingViewpointData } from '@/stores/media-panel-store';
import { ATMOSPHERE_PRESETS, TIME_PRESETS, useSceneStore } from '@/stores/scene-store';
import type { PromptLanguage } from '@/types/script';

import type { ContactSheetLayout } from './generation-panel-utils';

type SceneStoreState = ReturnType<typeof useSceneStore.getState>;
type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface UsePendingSceneIntakeOptions {
  pendingSceneData: PendingSceneData | null;
  setPendingSceneData: (data: PendingSceneData | null) => void;
  scriptPromptLanguage?: PromptLanguage;
  currentFolderId: string | null;
  resourceProjectId: string | null;
  addScene: SceneStoreState['addScene'];
  selectScene: SceneStoreState['selectScene'];
  onSceneCreated?: (id: string) => void;
  setPromptLanguage: StateSetter<PromptLanguage>;
  setName: StateSetter<string>;
  setLocation: StateSetter<string>;
  setTime: StateSetter<string>;
  setAtmosphere: StateSetter<string>;
  setVisualPrompt: StateSetter<string>;
  setTags: StateSetter<string[]>;
  setNotes: StateSetter<string>;
  setStyleId: StateSetter<string>;
  setPendingViewpoints: StateSetter<PendingViewpointData[]>;
  setPendingContactSheetPrompts: StateSetter<ContactSheetPromptSet[]>;
  setCurrentPageIndex: StateSetter<number>;
  setContactSheetPrompt: StateSetter<string | null>;
  setContactSheetPromptZh: StateSetter<string | null>;
  setContactSheetLayout: (layout: ContactSheetLayout) => void;
  setContactSheetAspectRatio: (ratio: '16:9' | '9:16') => void;
  setExtractedViewpoints: StateSetter<SceneViewpoint[]>;
}

export function usePendingSceneIntake(options: UsePendingSceneIntakeOptions): void {
  const consumedDataRef = useRef<PendingSceneData | null>(null);
  const {
    pendingSceneData, setPendingSceneData, scriptPromptLanguage, currentFolderId,
    resourceProjectId, addScene, selectScene, onSceneCreated, setPromptLanguage,
    setName, setLocation, setTime, setAtmosphere, setVisualPrompt, setTags, setNotes,
    setStyleId, setPendingViewpoints, setPendingContactSheetPrompts, setCurrentPageIndex,
    setContactSheetPrompt, setContactSheetPromptZh, setContactSheetLayout,
    setContactSheetAspectRatio, setExtractedViewpoints,
  } = options;

  useEffect(() => {
    if (!pendingSceneData) return;
    if (consumedDataRef.current === pendingSceneData) return;
    consumedDataRef.current = pendingSceneData;
    const data = pendingSceneData;
    setPendingSceneData(null);
    if (data.promptLanguage) setPromptLanguage(data.promptLanguage);
    else if (scriptPromptLanguage) setPromptLanguage(scriptPromptLanguage);

    if (data.name && data.location) {
      const timeId = data.time
        ? TIME_PRESETS.find((preset) => preset.label === data.time || preset.id === data.time)?.id || 'day'
        : 'day';
      const atmosphereId = data.atmosphere
        ? ATMOSPHERE_PRESETS.find((preset) => preset.label === data.atmosphere || preset.id === data.atmosphere)?.id || 'peaceful'
        : 'peaceful';
      const parsedStyleId = data.styleId && getStyleById(data.styleId)?.id || DEFAULT_STYLE_ID;
      setStyleId(parsedStyleId);
      const sceneInput = {
        name: data.name.trim(),
        location: data.location.trim(),
        time: timeId,
        atmosphere: atmosphereId,
        visualPrompt: data.visualPrompt?.trim() || undefined,
        tags: data.tags?.length ? data.tags : undefined,
        notes: data.notes?.trim() || undefined,
        styleId: parsedStyleId || undefined,
        folderId: currentFolderId,
        projectId: resourceProjectId || undefined,
        architectureStyle: data.architectureStyle,
        lightingDesign: data.lightingDesign,
        colorPalette: data.colorPalette,
        eraDetails: data.eraDetails,
        keyProps: data.keyProps,
        spatialLayout: data.spatialLayout,
        linkedEpisodeId: data.sourceEpisodeId,
      } as Parameters<SceneStoreState['addScene']>[0];
      const newId = addScene(sceneInput);
      selectScene(newId);
      onSceneCreated?.(newId);

      if (data.viewpoints?.length && data.contactSheetPrompts?.length) {
        setPendingViewpoints(data.viewpoints);
        setPendingContactSheetPrompts(data.contactSheetPrompts);
        setCurrentPageIndex(0);
        const firstPage = data.contactSheetPrompts[0];
        setContactSheetPrompt(firstPage.prompt);
        setContactSheetPromptZh(firstPage.promptZh);
        const { rows, cols } = firstPage.gridLayout;
        setContactSheetLayout(rows * cols <= 4 ? '2x2' : '3x3');
        setContactSheetAspectRatio(cols >= rows ? '16:9' : '9:16');
        setExtractedViewpoints(data.viewpoints.filter((viewpoint) => viewpoint.pageIndex === 0).map((viewpoint) => ({
          id: viewpoint.id,
          name: viewpoint.name,
          nameEn: viewpoint.nameEn,
          shotIds: viewpoint.shotIds,
          keyProps: viewpoint.keyProps,
          keyPropsEn: viewpoint.keyPropsEn,
          description: '',
          descriptionEn: '',
          gridIndex: viewpoint.gridIndex,
        })));
        const pageCount = data.contactSheetPrompts.length;
        toast.success(`场景「${data.name}」已创建\n✔ ${data.viewpoints.length} 个视角已加载${pageCount > 1 ? `（${pageCount}张联合图）` : ''}`);
      } else {
        toast.success(`场景「${data.name}」已自动创建`);
      }
      return;
    }

    setName(data.name || '');
    setLocation(data.location || '');
    if (data.time) setTime(TIME_PRESETS.find((preset) => preset.label === data.time || preset.id === data.time)?.id || 'day');
    if (data.atmosphere) setAtmosphere(ATMOSPHERE_PRESETS.find((preset) => preset.label === data.atmosphere || preset.id === data.atmosphere)?.id || 'peaceful');
    if (data.styleId) {
      const style = getStyleById(data.styleId);
      if (style) setStyleId(style.id);
    }
    if (data.visualPrompt) setVisualPrompt(data.visualPrompt);
    if (data.tags) setTags(data.tags);
    if (data.notes) setNotes(data.notes);
  }, [pendingSceneData, setPendingSceneData, addScene, selectScene, onSceneCreated, currentFolderId]);
}
