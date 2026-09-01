// SeedVR2 修复档契约(09-01-seedvr2-7bsharp-rollout)。
// 用途:设置→本地配置的模型可见性行(0d7b719 铁律:用到的模型必须展示路径)
// 与超分链 SeedVR2 档的前置状态探测。主进程直连 ComfyUI REST,无 Python 依赖。

export const SEEDVR2_RESTORE_SCHEMA_VERSION = 1 as const;

export const SEEDVR2_RESTORE_PROBE_CHANNEL = "seedvr2-restore-probe";

/** 探测结果:ComfyUI 服务存活 + 修复模型文件在位(大小)。 */
export interface SeedVr2ProbeResultV1 {
  schemaVersion: typeof SEEDVR2_RESTORE_SCHEMA_VERSION;
  /** ComfyUI 服务是否在跑(2 秒快速失败,不阻塞设置页)。 */
  serviceUp: boolean;
  /** 探测的 ComfyUI 根地址(env MYSTUDIO_COMFYUI_BRIDGE_URL 可覆写)。 */
  comfyuiUrl: string;
  /** 修复模型绝对路径(按 ComfyUI 目录约定推导)。 */
  modelFile: string;
  modelPresent: boolean;
  modelBytes: number | null;
}

export function validateSeedVr2ProbeResult(value: unknown):
  | { success: true; value: SeedVr2ProbeResultV1 }
  | { success: false; issues: Array<{ path: string; message: string }> } {
  const issues: Array<{ path: string; message: string }> = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SEEDVR2_RESTORE_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", message: `必须是 ${SEEDVR2_RESTORE_SCHEMA_VERSION}` });
  }
  if (typeof record.serviceUp !== "boolean") issues.push({ path: "serviceUp", message: "必须是布尔值" });
  if (typeof record.comfyuiUrl !== "string" || !record.comfyuiUrl.startsWith("http")) {
    issues.push({ path: "comfyuiUrl", message: "必须是 http 地址" });
  }
  if (typeof record.modelFile !== "string" || !record.modelFile.startsWith("/")) {
    issues.push({ path: "modelFile", message: "必须是绝对路径" });
  }
  if (typeof record.modelPresent !== "boolean") issues.push({ path: "modelPresent", message: "必须是布尔值" });
  if (record.modelBytes !== null && typeof record.modelBytes !== "number") {
    issues.push({ path: "modelBytes", message: "必须是数字或 null" });
  }
  const allowed = ["schemaVersion", "serviceUp", "comfyuiUrl", "modelFile", "modelPresent", "modelBytes"];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) issues.push({ path: key, message: "包含未知字段" });
  }
  return issues.length > 0 ? { success: false, issues } : { success: true, value: record as unknown as SeedVr2ProbeResultV1 };
}
