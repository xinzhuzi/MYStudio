// Artifact Execution Controller - Shared Contract (Slice 8)
// Defines interfaces for cross-layer artifact deletion execution
// Imported by both Slice 7 and Slice 8 → zero conflicts

/**
 * Controller interface for artifact execution operations
 * Encapsulates the execute() call that delegates to IPC or mock handlers
 */
export interface ArtifactExecutionController {
  execute(planId: string, confirmation: DeletionConfirmation): Promise<ExecuteResult>;
}

/**
 * Deletion confirmation payload with scope metadata
 * Used by both chapter-level and artifact-list deletion flows
 */
export interface DeletionConfirmation {
  type: 'chapter' | 'artifacts';
  chapterTitle?: string;    // Title of chapter being deleted (if type === 'chapter')
  chapterId?: string;       // ID of chapter being deleted
  artifactCount?: number;   // Number of artifacts affected (if type === 'artifacts')
}

/**
 * Execute result envelope
 * Consistent success/failure contract for all deletion operations
 */
export interface ExecuteResult {
  success: boolean;
  error?: string;           // Present only when success === false
  planId?: string;          // Echo back planId for audit trail
  deletedIds?: string[];    // List of IDs actually deleted
}

/**
 * Recovery query result from artifact inventory
 * Used by Slice 8 recovery UI to show undeletable items
 */
export interface RecoveryQueryResult {
  projectId: string;
  undeletableArtifacts: {
    id: string;
    type: string;
    blockerReason: string;
  }[];
  totalSize: number;
}
