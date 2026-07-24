import type {
  ScriptData,
  Shot,
  ScriptCharacter,
  EpisodeRawScript,
  ProjectBackground,
  PromptLanguage,
  CalibrationStrictness,
  FilteredCharacterRecord,
  SeriesMeta,
} from "@/types/script";

export type ParseStatus = "idle" | "parsing" | "ready" | "error";
export type ShotListStatus = "idle" | "generating" | "ready" | "error";

export interface BatchProgress { current: number; total: number; message: string; }
export interface ScriptInputDraft { mode: "import" | "create"; idea: string; updatedAt: number; }
export type ScriptCalibrationStatus = "idle" | "calibrating" | "completed" | "error";
export type ScriptViewpointStatus = "idle" | "analyzing" | "completed" | "error";
export type ScriptStructureStatus = "idle" | "processing" | "completed" | "error";
export type ScriptImportStatus = "idle" | "importing" | "ready" | "error";
export type ScriptSynopsisStatus = "idle" | "generating" | "completed" | "error";

export interface ScriptCalibrationState {
  titleCalibrationStatus: ScriptCalibrationStatus;
  characterCalibrationStatus: ScriptCalibrationStatus;
  sceneCalibrationStatus: ScriptCalibrationStatus;
  viewpointAnalysisStatus: ScriptViewpointStatus;
  structureCompletionStatus: ScriptStructureStatus;
  singleShotCalibrationStatus: Record<string, ScriptCalibrationStatus>;
  calibrationDialogOpen: boolean;
  pendingCalibrationCharacters: ScriptCharacter[] | null;
  pendingFilteredCharacters: FilteredCharacterRecord[];
  importStatus: ScriptImportStatus;
  synopsisStatus: ScriptSynopsisStatus;
}

export interface ScriptProjectData {
  rawScript: string; language: string; targetDuration: string; styleId: string;
  inputDraft: ScriptInputDraft; sceneCount?: string; shotCount?: string;
  scriptData: ScriptData | null; parseStatus: ParseStatus; parseError?: string;
  shots: Shot[]; shotStatus: ShotListStatus; shotError?: string;
  batchProgress: BatchProgress | null; characterIdMap: Record<string, string>;
  sceneIdMap: Record<string, string>; updatedAt: number;
  projectBackground: ProjectBackground | null; episodeRawScripts: EpisodeRawScript[];
  metadataMarkdown: string; metadataGeneratedAt?: number; promptLanguage: PromptLanguage;
  calibrationStrictness: CalibrationStrictness; lastFilteredCharacters: FilteredCharacterRecord[];
  calibrationState: ScriptCalibrationState; seriesMeta: SeriesMeta | null;
}
