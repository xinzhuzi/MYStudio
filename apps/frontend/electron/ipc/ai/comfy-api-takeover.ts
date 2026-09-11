/**
 * 漫影云端网关产品配置位(09-10 云端收编二轮)。
 *
 * 用户裁定:ComfyUI 云端节点(OpenAI/Anthropic/LTX…,经 comfy.org /proxy/*
 * 代理)全量保留,只封 comfy.org 登录入口;漫影云=同一批节点「换 URL+换
 * API key」。URL 侧=官方 --comfy-api-base 启动参数(engine_manager 读
 * MYSTUDIO_COMFY_API_BASE 注入);凭据侧=manying_nodes cloud_takeover 补丁
 * (读 MYSTUDIO_COMFY_API_TOKEN)。两个 env 均由本模块经 main 进程 env →
 * image_gen 侧车 → 引擎 spawn 继承链注入。
 *
 * base/token 填真源后生效;留空=零干预,云端节点行为与上游完全一致。
 */

export const COMFY_API_TAKEOVER_ENV_BASE = "MYSTUDIO_COMFY_API_BASE";
export const COMFY_API_TAKEOVER_ENV_TOKEN = "MYSTUDIO_COMFY_API_TOKEN";

/** 产品配置位:漫影网关地址与令牌(如 https://gw.xxx.com 与 sk-xxx)。 */
export const COMFY_API_TAKEOVER = {
  base: "",
  token: "",
};

export function comfyApiTakeoverEnv(
  config: { base: string; token: string } = COMFY_API_TAKEOVER,
): Record<string, string> {
  const entries: Record<string, string> = {};
  if (config.base.trim()) entries[COMFY_API_TAKEOVER_ENV_BASE] = config.base.trim();
  if (config.token.trim()) entries[COMFY_API_TAKEOVER_ENV_TOKEN] = config.token.trim();
  return entries;
}
