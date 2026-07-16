export interface GroupGenerationResult {
  groupId: string;
  success: boolean;
  videoUrl: string | null;
  error: string | null;
}

export interface BatchGenerationProgress {
  total: number;
  completed: number;
  current: string | null;
  results: GroupGenerationResult[];
}
