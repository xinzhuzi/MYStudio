import { BuildStoryboardEditingProjectInput, EditingDirectorHints, StoryboardEditingAdapterResult } from "./storyboard-adapter";
import type { AutoEditingPresetV1, AutoEditingRequest, AutoEditingResult, AutoEditingRun, EditingProjectV1 } from "@/types/editing";

/**
 * 自动剪辑契约——预设/类型/输入输出契约。file-size-reduction 拆出,体逐字保留。
 */
export const STORY_DRIVEN_V1_PRESET = {
  version: 1,
  id: "story-driven-v1",
  imageScaleFrom: 1,
  imageScaleTo: 1.06,
  voiceTailPaddingUs: 200_000,
  maxTransitionUs: 350_000,
  maxTransitionRatio: 0.15,
  bgmDuckingDb: -12,
  bgmDuckingAttackUs: 120_000,
  bgmDuckingReleaseUs: 400_000,
} as const satisfies AutoEditingPresetV1;

export interface SelectedEditingBgm {
  id: string;
  mediaId: string;
  name: string;
  path: string;
}

export interface ApprovedEditingSfx extends SelectedEditingBgm {
  storyboardId: string;
  durationUs: number;
}

export type AutoEditingAdapterInput = Omit<
  BuildStoryboardEditingProjectInput,
  "editingProjectId" | "createdAt" | "name"
>;

export interface AutoEditingProposalContext {
  request: AutoEditingRequest;
  project: EditingProjectV1;
  hints: EditingDirectorHints;
}

export interface RunAutoEditingDraftInput {
  request: AutoEditingRequest;
  adapterInput: AutoEditingAdapterInput;
  existingProjects: EditingProjectV1[];
  runId: string;
  editingProjectId: string;
  now: () => number;
  draftName?: string;
  selectedBgm?: SelectedEditingBgm;
  approvedSfx?: ApprovedEditingSfx[];
  generateProposals?: (
    context: AutoEditingProposalContext,
  ) => Promise<unknown>;
  onRun?: (run: AutoEditingRun) => void | Promise<void>;
}

export type AdapterFailure = Extract<
  StoryboardEditingAdapterResult,
  { success: false }
>;

export type RunAutoEditingDraftResult =
  | {
      success: true;
      result: AutoEditingResult;
      staleEditingProjectIds: string[];
    }
  | {
      success: false;
      run: AutoEditingRun;
      adapterFailure?: AdapterFailure;
    };

