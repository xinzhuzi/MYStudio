export type DiagnosticsLogLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticsLogCategory =
  | "ui"
  | "action"
  | "ipc"
  | "network"
  | "ai"
  | "tts"
  | "asset"
  | "workflow"
  | "storage"
  | "runtime";

export interface DiagnosticsLogError {
  name?: string;
  message: string;
  stack?: string;
}

export interface DiagnosticsLogEntryInput {
  level?: DiagnosticsLogLevel;
  category: DiagnosticsLogCategory;
  operationId?: string;
  requestId?: string;
  message: string;
  context?: Record<string, unknown>;
  durationMs?: number;
  error?: unknown;
}

export interface DiagnosticsLogEntry extends Omit<DiagnosticsLogEntryInput, "level" | "error"> {
  timestamp: string;
  level: DiagnosticsLogLevel;
  context?: Record<string, unknown>;
  error?: DiagnosticsLogError;
}

export interface DiagnosticsLogQuery {
  since?: string;
  until?: string;
  minLevel?: DiagnosticsLogLevel;
  level?: DiagnosticsLogLevel;
  categories?: DiagnosticsLogCategory[];
  operationId?: string;
  requestId?: string;
  limit?: number;
}

export interface DiagnosticsLogQueryResult {
  entries: DiagnosticsLogEntry[];
  total: number;
}

export interface DiagnosticsLogInfo {
  directory: string;
  totalBytes: number;
  fileCount: number;
  recentWarnCount: number;
  recentErrorCount: number;
  retentionDays: number;
  files: Array<{
    name: string;
    path: string;
    size: number;
    updatedAt: string;
  }>;
}

export interface DiagnosticsLogExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface DiagnosticsLogClearResult {
  success: boolean;
  removedFiles: number;
  error?: string;
}

export interface DiagnosticsLogOpenFolderResult {
  success: boolean;
  directory?: string;
  error?: string;
}
