// SeedVR2 修复档设置页探测(09-01):模型可见性铁律——用到的模型必须在本地配置展示。
// 主进程直连 ComfyUI(2s 快速失败)+ 模型文件 stat;不加载模型、不常驻轮询。

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SEEDVR2_RESTORE_SCHEMA_VERSION,
  type SeedVr2ProbeResultV1,
} from "@rendering/contracts/seedvr2-restore";
import { SEEDVR2_RESTORE_MODEL } from "./seedvr2-restore-client";

/** ComfyUI 模型目录约定(与后端 model_cache.comfyui_models_dir 同源的 mac 默认布局);
 *  env 可覆写以适配非默认安装位置。 */
export function seedvr2ModelsDir(): string {
  const override = process.env.MYSTUDIO_COMFYUI_SEEDVR2_DIR;
  if (override) return override;
  return path.join(os.homedir(), "Project", "ComfyUI", "models", "SEEDVR2");
}

export async function probeSeedVr2(deps: { fetchImpl?: typeof fetch } = {}): Promise<SeedVr2ProbeResultV1> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  // 17598:8 千段端口撞车高发(08-31 用户裁定换冷门口);与 restore-client/桥引擎同源
  const comfyuiUrl = (process.env.MYSTUDIO_COMFYUI_BRIDGE_URL ?? "http://127.0.0.1:17598").replace(/\/$/, "");
  let serviceUp = false;
  try {
    const response = await fetchImpl(`${comfyuiUrl}/system_stats`, { signal: AbortSignal.timeout(2000) });
    serviceUp = response.ok;
  } catch {
    serviceUp = false;
  }
  const modelFile = path.join(seedvr2ModelsDir(), SEEDVR2_RESTORE_MODEL);
  let modelBytes: number | null = null;
  try {
    modelBytes = fs.statSync(modelFile).size;
  } catch {
    modelBytes = null;
  }
  return {
    schemaVersion: SEEDVR2_RESTORE_SCHEMA_VERSION,
    serviceUp,
    comfyuiUrl,
    modelFile,
    modelPresent: modelBytes !== null,
    modelBytes,
  };
}
