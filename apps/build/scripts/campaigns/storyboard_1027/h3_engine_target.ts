/**
 * H3 驱动引擎目标预检(纯文件;10-29 收账:App 外 campaign 直投不得盲打本地引擎)。
 *
 * 铁律:零仓库导入(仅 node 内建)、零顶层副作用——vitest 测试只 import 本文件;
 * 驱动本体(h3_matrix_driver.ts)import 本文件解析 ENGINE,不得反向依赖。
 *
 * 令牌决议照 backend/comfyui/bridge_contract.py:50-57(resolve_bridge_token)同款顺序:
 * ① env MANYING_LOCAL_IMAGE_TOKEN(bridge_contract.py:26 实测常量名)
 * ② {userDataRoot}/python/profiles/image-gen/config.json 的 controlToken(唯一键)
 * ③ 双缺=空串(fail-closed,不自愈空转)。
 * 禁止走 frontend local-image-token.ts 的 window.imageGenRuntime IPC——纯 Node 无桥
 * =恒空串=sidecar 令牌门(server.py /comfy/* 鉴权)恒 403。
 * userDataRoot TS 侧=~/Library/Application Support/漫影工作室(与驱动本体硬编码
 * 绝对路径风格一致;Python 侧 manifest.user_data_root 多分支决议无法跨语言复制);
 * env MYSTUDIO_USER_DATA 可覆写(测试注入)。
 *
 * 预检语义(评审钉死):令牌决议为空串时仍照发 GET /comfy/engine/remote(空
 * Authorization 头),由网络结果定分支——连接拒绝/超时(sidecar 未起,含 App 未
 * 装机机器)=视作无 settings→维持缺省 17001(存量独立跑零变化);403=显式报错
 * 退出(『令牌读取失败』仅作空令牌时 403 的文案归因,不是独立提前退出分支);
 * 200→按 source 判,'settings'=路由已指远端→拒绝盲投本地,'env'/'managed'/
 * 'fallback'=17001;H3_ENGINE 显式→env 胜出(零网络调用)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LOCAL_ENGINE = "http://127.0.0.1:17001";
export const SIDECAR_ENGINE_REMOTE_URL = "http://127.0.0.1:17595/comfy/engine/remote";

export interface EngineTargetEnv {
  H3_ENGINE?: string | undefined;
  MANYING_LOCAL_IMAGE_TOKEN?: string | undefined;
  MYSTUDIO_USER_DATA?: string | undefined;
}

export interface PrecheckResponse {
  status: number;
  json: () => Promise<unknown>;
}

export type PrecheckFetch = (url: string, init: { headers: Record<string, string> }) => Promise<PrecheckResponse>;
export type TokenResolver = () => string;

export type EngineTarget =
  | { kind: "engine"; engine: string; note: string }
  | { kind: "abort"; message: string };

export function driverUserDataRoot(env: EngineTargetEnv): string {
  const override = (env.MYSTUDIO_USER_DATA || "").trim();
  if (override) return override;
  return path.join(os.homedir(), "Library", "Application Support", "漫影工作室");
}

export function resolveControlToken(env: EngineTargetEnv): string {
  const fromEnv = (env.MANYING_LOCAL_IMAGE_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = fs.readFileSync(
      path.join(driverUserDataRoot(env), "python", "profiles", "image-gen", "config.json"),
      "utf8",
    );
    const data = JSON.parse(raw) as { controlToken?: unknown };
    return typeof data.controlToken === "string" ? data.controlToken : "";
  } catch {
    return ""; // 缺文件/坏 JSON/非对象形态=空串(双缺 fail-closed,照 resolve_bridge_token)
  }
}

export async function resolveEngineTarget(
  env: EngineTargetEnv,
  fetchImpl: PrecheckFetch,
  tokenResolver: TokenResolver = () => resolveControlToken(env),
): Promise<EngineTarget> {
  const explicit = (env.H3_ENGINE || "").trim();
  if (explicit) {
    return { kind: "engine", engine: explicit, note: "H3_ENGINE 显式(env 胜出,零网络调用)" };
  }
  const token = tokenResolver();
  let response: PrecheckResponse;
  try {
    response = await fetchImpl(SIDECAR_ENGINE_REMOTE_URL, {
      headers: { Authorization: token ? `Bearer ${token}` : "" },
    });
  } catch {
    // sidecar 未起(连接拒绝/超时;含 App 未装机机器)=视作无 settings→缺省本地
    return { kind: "engine", engine: DEFAULT_LOCAL_ENGINE, note: "sidecar 未起=无 settings→缺省本地(存量独立跑零变化)" };
  }
  if (response.status === 403) {
    return token
      ? { kind: "abort", message: `引擎路由预检被拒(HTTP 403):sidecar 令牌校验失败(${SIDECAR_ENGINE_REMOTE_URL})` }
      : { kind: "abort", message: `令牌读取失败:sidecar 在线但令牌为空被拒(HTTP 403,${SIDECAR_ENGINE_REMOTE_URL})——请改从漫影 App 内跑,或显式设 H3_ENGINE 指定引擎` };
  }
  if (response.status !== 200) {
    return { kind: "abort", message: `引擎路由预检意外应答 HTTP ${response.status}(${SIDECAR_ENGINE_REMOTE_URL})` };
  }
  let body: { url?: unknown; source?: unknown } | null = null;
  try {
    body = (await response.json()) as { url?: unknown; source?: unknown } | null;
  } catch {
    return { kind: "abort", message: `引擎路由预检应答不是 JSON(${SIDECAR_ENGINE_REMOTE_URL})` };
  }
  const source = body && typeof body.source === "string" ? body.source : "";
  if (source === "settings") {
    const remote = body && typeof body.url === "string" && body.url ? body.url : "(未知)";
    return { kind: "abort", message: `路由已指向 ${remote},拒绝盲投本地;需本地请显式 H3_ENGINE` };
  }
  return { kind: "engine", engine: DEFAULT_LOCAL_ENGINE, note: `路由来源=${source || "unknown"}(非 settings)→缺省本地` };
}
