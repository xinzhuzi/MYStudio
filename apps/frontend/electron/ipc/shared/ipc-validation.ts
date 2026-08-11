import { ipcMain, type IpcMainInvokeEvent } from "electron";

/**
 * Shared IPC validation utilities (BUG-S001 fix).
 *
 * 统一 IPC 输入校验层:所有 ipcMain.handle 入口都应通过 createValidatedHandler
 * 或显式 assertValid 校验 payload,避免路径穿越/命令注入/类型混淆。
 *
 * 现有 31 个已校验 handler 可继续用自己的 assertValid;新 handler 与迁移中的
 * 87 个未校验 handler 统一使用本模块。
 */

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: ValidationIssue[] };

export type ValidateFn<T> = (payload: unknown) => ValidationResult<T>;
export type AsyncValidateFn<T> = (
  payload: unknown,
) => Promise<ValidationResult<T>>;

/**
 * IPC 校验失败错误。携带结构化 issues 便于 renderer 展示与日志审计。
 */
export class IpcValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(
      issues.length > 0
        ? issues.map((i) => `${i.path}: ${i.message}`).join("; ")
        : "IPC payload validation failed",
    );
    this.name = "IpcValidationError";
    this.issues = issues;
  }
}

/**
 * 断言校验结果成功,失败抛 IpcValidationError。
 *
 * 与各 remotion-xxx-ipc.ts 内部 assertValid 行为一致,但集中导出,
 * 消除 5+ 处重复定义。
 */
export function assertValid<T>(result: ValidationResult<T>): T {
  if (!result.success) {
    throw new IpcValidationError(result.issues);
  }
  return result.value;
}

/** 异步校验变体,用于 validate 函数本身返回 Promise 的场景。 */
export async function assertValidAsync<T>(
  result: Promise<ValidationResult<T>>,
): Promise<T> {
  return assertValid(await result);
}

/**
 * 创建带输入校验的 ipcMain.handle 包装器。
 *
 * @param channel  IPC 频道名
 * @param validate payload 校验函数(同步)
 * @param handler  校验通过后的业务 handler,接收已校验的 request
 *
 * @example
 * createValidatedHandler(
 *   "studio-save-material",
 *   validateStudioSaveMaterialRequest,
 *   async (_event, request) => saveMaterial(request),
 * );
 */
export function createValidatedHandler<T>(
  channel: string,
  validate: ValidateFn<T>,
  handler: (
    event: IpcMainInvokeEvent,
    request: T,
  ) => unknown | Promise<unknown>,
): void {
  ipcMain.handle(channel, async (event, payload: unknown) => {
    const request = assertValid(validate(payload));
    return handler(event, request);
  });
}

/**
 * 异步 validate 变体(如 validate 内部需要读文件/网络)。
 */
export function createAsyncValidatedHandler<T>(
  channel: string,
  validate: AsyncValidateFn<T>,
  handler: (
    event: IpcMainInvokeEvent,
    request: T,
  ) => unknown | Promise<unknown>,
): void {
  ipcMain.handle(channel, async (event, payload: unknown) => {
    const request = await assertValidAsync(validate(payload));
    return handler(event, request);
  });
}

/**
 * 辅助:构造一个"无 payload"的校验函数,用于仅校验空请求的 channel。
 * 与现有 assertEmptyRequest(validateRemotionRuntimeStatusRequest(payload)) 配套。
 */
export function validateEmptyRequest(_payload: unknown): ValidationResult<null> {
  return { success: true, value: null };
}

/**
 * 辅助:构造一个"原样透传但标记已校验"的 passthrough。
 * 仅用于无法立刻定义 schema 的迁移过渡期,**不应**长期使用。
 */
export function validatePassthrough<T = unknown>(
  payload: unknown,
): ValidationResult<T> {
  return { success: true, value: payload as T };
}
