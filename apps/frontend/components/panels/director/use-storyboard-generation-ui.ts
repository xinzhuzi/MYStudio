import { useCallback, useState } from "react";
import type { AngleSwitchResult } from "@/components/angle-switch";
import type { QuadGridResult } from "@/components/quad-grid";

export type StoryboardFrameTarget = {
  sceneId: number;
  type: "start" | "end";
};

type UseStoryboardGenerationUiOptions = {
  defaultImageGenMode: "single" | "merged";
};

export function useStoryboardGenerationUi({ defaultImageGenMode }: UseStoryboardGenerationUiOptions) {
  const [imageGenMode, setImageGenMode] = useState<"single" | "merged">(defaultImageGenMode);
  const [frameMode, setFrameMode] = useState<"first" | "last" | "both">("first");
  const [isMergedRunning, setIsMergedRunning] = useState(false);
  const [refStrategy, setRefStrategy] = useState<"cluster" | "minimal" | "none">("cluster");
  const [useExemplar, setUseExemplar] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [currentGeneratingId, setCurrentGeneratingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"editing" | "trailer">("editing");
  const [angleSwitchOpen, setAngleSwitchOpen] = useState(false);
  const [angleSwitchResultOpen, setAngleSwitchResultOpen] = useState(false);
  const [angleSwitchTarget, setAngleSwitchTarget] = useState<StoryboardFrameTarget | null>(null);
  const [angleSwitchResult, setAngleSwitchResult] = useState<AngleSwitchResult | null>(null);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);
  const [isAngleSwitching, setIsAngleSwitching] = useState(false);
  const [isExtractingFrame, setIsExtractingFrame] = useState(false);
  const [quadGridOpen, setQuadGridOpen] = useState(false);
  const [quadGridResultOpen, setQuadGridResultOpen] = useState(false);
  const [quadGridTarget, setQuadGridTarget] = useState<StoryboardFrameTarget | null>(null);
  const [quadGridResult, setQuadGridResult] = useState<QuadGridResult | null>(null);
  const [isQuadGridGenerating, setIsQuadGridGenerating] = useState(false);

  const openAngleSwitch = useCallback((target: StoryboardFrameTarget) => {
    setAngleSwitchTarget(target);
    setAngleSwitchResult(null);
    setSelectedHistoryIndex(-1);
    setAngleSwitchOpen(true);
  }, []);

  const openQuadGrid = useCallback((target: StoryboardFrameTarget) => {
    setQuadGridTarget(target);
    setQuadGridResult(null);
    setQuadGridOpen(true);
  }, []);

  return {
    imageGenMode, setImageGenMode,
    frameMode, setFrameMode,
    isMergedRunning, setIsMergedRunning,
    refStrategy, setRefStrategy,
    useExemplar, setUseExemplar,
    isGenerating, setIsGenerating,
    isGeneratingPrompts, setIsGeneratingPrompts,
    currentGeneratingId, setCurrentGeneratingId,
    activeTab, setActiveTab,
    angleSwitchOpen, setAngleSwitchOpen,
    angleSwitchResultOpen, setAngleSwitchResultOpen,
    angleSwitchTarget, setAngleSwitchTarget,
    angleSwitchResult, setAngleSwitchResult,
    selectedHistoryIndex, setSelectedHistoryIndex,
    isAngleSwitching, setIsAngleSwitching,
    isExtractingFrame, setIsExtractingFrame,
    quadGridOpen, setQuadGridOpen,
    quadGridResultOpen, setQuadGridResultOpen,
    quadGridTarget, setQuadGridTarget,
    quadGridResult, setQuadGridResult,
    isQuadGridGenerating, setIsQuadGridGenerating,
    openAngleSwitch,
    openQuadGrid,
  };
}

export type StoryboardGenerationUiController = ReturnType<typeof useStoryboardGenerationUi>;
