import { ipcMain } from "electron";
import type { RemotionStudioSession } from "@rendering/plugins/remotion/studio/remotion-studio-service";

export const REMOTION_STUDIO_ENSURE_SESSION_CHANNEL = "remotion-studio-ensure-session";
export const REMOTION_STUDIO_CLOSE_SESSION_CHANNEL = "remotion-studio-close-session";
export const REMOTION_STUDIO_EDITING_UPDATED_EVENT = "remotion-studio-editing-updated";

export interface RemotionStudioEditingUpdatedEvent {
  projectId: string;
  chapterId: string;
  revision: number;
}

export interface RemotionStudioEnsureSessionRequest {
  projectId: string;
  chapterId: string;
  revision: number;
}

export type RemotionStudioEnsureSessionReply =
  | {
      status: "ready";
      sessionId: string;
      url: string;
      projectId: string;
      chapterId: string;
      revision: number;
    }
  | {
      status: "blocked" | "failed";
      projectId: string;
      chapterId: string;
      revision: number;
      message: string;
    };

export type RemotionStudioIpcValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: Array<{ path: string; message: string }> };

export interface RegisterRemotionStudioIpcOptions {
  ensureSession: (request: RemotionStudioEnsureSessionRequest) => Promise<RemotionStudioSession>;
  closeSession?: (projectId: string) => Promise<void>;
}

/**
 * This is intentionally a narrow identity-only bridge. The renderer never
 * supplies projection source, paths, ports, or capability tokens.
 */
export function registerRemotionStudioIpcHandlers(
  options: RegisterRemotionStudioIpcOptions,
): { dispose: () => Promise<void> } {
  ipcMain.handle(REMOTION_STUDIO_ENSURE_SESSION_CHANNEL, async (_event, payload: unknown) => {
    const request = assertValid(validateRemotionStudioEnsureSessionRequest(payload));
    try {
      const session = await options.ensureSession(request);
      return validateReadySession(session, request);
    } catch (error) {
      return {
        status: isBlockedError(error) ? "blocked" : "failed",
        ...request,
        message: error instanceof Error ? error.message : "无法建立原生 Remotion Studio 会话",
      } satisfies RemotionStudioEnsureSessionReply;
    }
  });
  ipcMain.handle(REMOTION_STUDIO_CLOSE_SESSION_CHANNEL, async (_event, payload: unknown) => {
    const projectId = assertValidProjectId(payload);
    if (!options.closeSession) return { status: "closed" as const, projectId };
    await options.closeSession(projectId);
    return { status: "closed" as const, projectId };
  });
  return {
    async dispose() {
      ipcMain.removeHandler(REMOTION_STUDIO_ENSURE_SESSION_CHANNEL);
      ipcMain.removeHandler(REMOTION_STUDIO_CLOSE_SESSION_CHANNEL);
    },
  };
}

function assertValidProjectId(value: unknown): string {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId"])) {
    throw new Error("Studio close 请求只允许 projectId");
  }
  const projectId = validateId(value.projectId, "projectId");
  if (!projectId) throw new Error("projectId 无效");
  return projectId;
}

export function validateRemotionStudioEnsureSessionRequest(
  value: unknown,
): RemotionStudioIpcValidationResult<RemotionStudioEnsureSessionRequest> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId", "chapterId", "revision"])) {
    return failure("$", "Studio session 请求只允许 projectId、chapterId、revision");
  }
  const projectId = validateId(value.projectId, "projectId");
  const chapterId = validateId(value.chapterId, "chapterId");
  if (!projectId) return failure("projectId", "projectId 无效");
  if (!chapterId) return failure("chapterId", "chapterId 无效");
  if (!Number.isInteger(value.revision) || (value.revision as number) <= 0) {
    return failure("revision", "revision 必须是正整数");
  }
  return { success: true, value: { projectId, chapterId, revision: value.revision as number } };
}

export function validateRemotionStudioEnsureSessionReply(
  value: unknown,
): RemotionStudioIpcValidationResult<RemotionStudioEnsureSessionReply> {
  if (!isRecord(value) || typeof value.status !== "string") return failure("$", "Studio session 响应无效");
  const request = validateRemotionStudioEnsureSessionRequest({
    projectId: value.projectId,
    chapterId: value.chapterId,
    revision: value.revision,
  });
  if (!request.success) return request;
  if (value.status === "ready") {
    const sessionId = validateId(value.sessionId, "sessionId");
    if (!hasOnlyKeys(value, ["status", "sessionId", "url", "projectId", "chapterId", "revision"])
      || !sessionId
      || !isStudioUrl(value.url)) return failure("$", "Studio ready 响应无效");
    return { success: true, value: { status: "ready", ...request.value, sessionId, url: value.url } };
  }
  if ((value.status === "blocked" || value.status === "failed")
    && hasOnlyKeys(value, ["status", "projectId", "chapterId", "revision", "message"])
    && typeof value.message === "string" && value.message.trim()) {
    return { success: true, value: { status: value.status, ...request.value, message: value.message.trim() } };
  }
  return failure("$", "Studio session 响应状态无效");
}

export function validateRemotionStudioEditingUpdatedEvent(
  value: unknown,
): RemotionStudioIpcValidationResult<RemotionStudioEditingUpdatedEvent> {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["projectId", "chapterId", "revision"])
    || !validateId(value.projectId, "projectId")
    || !validateId(value.chapterId, "chapterId")
    || !Number.isInteger(value.revision)
    || (value.revision as number) <= 0) {
    return failure("$", "Studio editing revision event 无效");
  }
  return {
    success: true,
    value: {
      projectId: value.projectId as string,
      chapterId: value.chapterId as string,
      revision: value.revision as number,
    },
  };
}

function validateReadySession(
  session: RemotionStudioSession,
  request: RemotionStudioEnsureSessionRequest,
): RemotionStudioEnsureSessionReply {
  const reply = {
    status: "ready" as const,
    sessionId: session.sessionId,
    url: session.url,
    projectId: session.projectId,
    chapterId: session.chapterId,
    revision: session.revision,
  };
  const parsed = validateRemotionStudioEnsureSessionReply(reply);
  if (!parsed.success || session.projectId !== request.projectId || session.chapterId !== request.chapterId || session.revision !== request.revision) {
    throw new Error("Studio projection identity 与请求不一致");
  }
  return parsed.value;
}

function assertValid<T>(result: RemotionStudioIpcValidationResult<T>): T {
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return result.value;
}

function validateId(value: unknown, _label: string): string | null {
  return typeof value === "string" && value.trim() && !/[\\/\0]/.test(value) ? value.trim() : null;
}

function isStudioUrl(value: unknown): value is string {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && Number.isInteger(Number(url.port)) && url.port.length > 0;
  } catch { return false; }
}

function isBlockedError(error: unknown): boolean {
  return error instanceof Error && /缺少|未找到|无效|不属于|不存在|blocked/i.test(error.message);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure<T>(path: string, message: string): RemotionStudioIpcValidationResult<T> {
  return { success: false, issues: [{ path, message }] };
}
