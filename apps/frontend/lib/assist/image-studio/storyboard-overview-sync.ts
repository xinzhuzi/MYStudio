// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 章节分镜总览图库内自动保鲜(09-09 主视图 ComfyUI 化·批8):
 * ComfyUI 画布在场时周期把最新分镜总览(MyShot 网格)以固定名
 * overwrite 进工作流库——主视图画布里随时一键打开「分镜总览」,
 * 无需手动生成。变更指纹守卫:分镜未动不重复导入。
 *
 * 09-10 批9:漫影节点图片展示——带图镜的缩略图(发送级缩略管线,
 * 768px<1MB 铁律)先行上传引擎 input 目录(my-shot-*.jpg 同名
 * 覆写幂等),节点 properties.myPreview 携名,画布扩展按名渲染。
 */

import { comfyImageUrlToB64 } from "@/lib/assist/image-studio/comfy-execute";
import { shotPreview2Name, shotPreview2Source, shotPreviewName } from "@/lib/assist/image-studio/storyboard-overview-comfy";
import { buildStageNodePayloadFromState } from "@/lib/assist/image-studio/storyboard-pipeline-comfy";
import { prepareReferenceImageForTransfer } from "@/lib/ai/image-transfer";
import { shardContentStamp } from "@/lib/storage/studio-workflow-shards";
import { getComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

function overviewFingerprint(storyboards: StoryboardItem[]): string {
  return JSON.stringify(
    storyboards
      // 09-12 深审修复:ttsJob 进指纹——环节节点的「配音✓」徽章随配音完成
      // 保鲜;漏掉它=配音后库文件陈旧,节点队列显示未配音。
      .map((item) => [item.id, item.index, item.episodeId, item.mediaRef?.path ?? null, item.ttsJob?.status ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

let lastSyncedFingerprint = "";

// 产物 schema 戳:生成器输出结构升级(如 09-12 节点标题栏改环节名)时递增——
// 指纹只看内容,内容没变就不会重写库文件,老库拿不到新 schema;戳参与指纹
// 强制一次性重写,之后恢复稳态。payload/节点字段结构性变更必须同步此戳。
const WORKFLOW_SCHEMA_STAMP = "v4.3-flat-title";

// 资产封面 url→引擎文件名会话缓存:autoOpen 与保鲜链同走转换,同 cover 重复
// 打开/重保鲜零重传(上传幂等靠同名覆写,缓存只省往返)
const assetCoverNameCache = new Map<string, string>();

export interface OverviewSyncDeps {
  /** v4 内容全量:组件层喂老画布模型映射出的载荷(技能/资产卡/队列进度) */
  buildPayloads?: () => import("./storyboard-pipeline-comfy").StageNodePayload[];
  /** 读图→b64(不带 data: 前缀);默认走应用内 IPC 双 scheme */
  readImageB64?: (url: string) => Promise<string | null>;
  /** 上传引擎 input 目录;默认引擎客户端(引擎须在运行) */
  uploadPreview?: (name: string, imageB64: string) => Promise<boolean>;
}

export function readStoryboardImageB64(url: string): Promise<string> {
  return comfyImageUrlToB64(url);
}

/** 缩略上传 best-effort:失败只计数不阻断导入(节点退化为纯文字卡) */
async function uploadShotPreviews(storyboards: StoryboardItem[], deps: OverviewSyncDeps): Promise<number> {
  const readImageB64 = deps.readImageB64 ?? ((url) => readStoryboardImageB64(url).catch(() => null));
  const uploadPreview =
    deps.uploadPreview ??
    (async (name, imageB64) => (await getComfyEngineClient()?.uploadBridgeReference(name, imageB64))?.accepted === true);
  let uploaded = 0;
  for (const storyboard of storyboards) {
    // 双帧上传(09-14 用户裁定:每镜多张图都上屏):帧1=my-shot-<id>.jpg,
    // 帧2=my-shot-<id>-k2.jpg(回接后每镜常 2 帧);best-effort 同款
    const jobs: Array<[string, string]> = [];
    const name1 = shotPreviewName(storyboard);
    if (name1) jobs.push([name1, storyboard.mediaRef?.path ?? ""]);
    const name2 = shotPreview2Name(storyboard);
    const source2 = shotPreview2Source(storyboard);
    if (name2 && source2) jobs.push([name2, source2]);
    for (const [name, sourcePath] of jobs) {
      if (!sourcePath) continue;
      const raw = await readImageB64(sourcePath);
      if (!raw) continue;
      try {
        const dataUrl = raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
        const prepared = await prepareReferenceImageForTransfer(dataUrl);
        const pure = prepared.slice(prepared.indexOf(",") + 1);
        if (await uploadPreview(name, pure)) uploaded += 1;
      } catch {
        // 单镜缩略失败不阻断:该镜节点暂无图,下次指纹变化重试
      }
    }
  }
  return uploaded;
}

/** 资产卡封面上传(autoOpen 打开前与保鲜链共享):cover=本地/项目路径 →
 * 引擎 input(my-asset-<url戳>.jpg),载荷改写为文件名供画布自绘;
 * best-effort,失败保留原值(节点退化字牌)。
 * 文件名按 cover URL 内容戳定名(09-12 真跑根修):位置序号在多章节/增删
 * 资产时互相覆盖会串图;URL 定名同图恒同名,重传幂等零串扰。 */
export async function ensureStageAssetCoversUploaded(
  payloads: import("./storyboard-pipeline-comfy").StageNodePayload[],
  deps: OverviewSyncDeps = {},
) {
  const readImageB64 = deps.readImageB64 ?? ((url) => readStoryboardImageB64(url).catch(() => null));
  const uploadPreview =
    deps.uploadPreview ??
    (async (name, imageB64) => (await getComfyEngineClient()?.uploadBridgeReference(name, imageB64))?.accepted === true);
  for (const payload of payloads) {
    if (!payload.assets?.length) continue;
    for (const asset of payload.assets) {
      const url = asset.cover;
      if (!url || url.startsWith("my-asset-")) continue;
      const cached = assetCoverNameCache.get(url);
      if (cached) {
        asset.cover = cached;
        continue;
      }
      try {
        const raw = await readImageB64(url);
        if (!raw) continue;
        const dataUrl = raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
        const prepared = await prepareReferenceImageForTransfer(dataUrl);
        const pure = prepared.slice(prepared.indexOf(",") + 1);
        const name = `my-asset-${shardContentStamp(url)}.jpg`;
        if (await uploadPreview(name, pure)) {
          assetCoverNameCache.set(url, name);
          asset.cover = name;
        }
      } catch {
        // 单卡失败不阻断
      }
    }
  }
  return payloads;
}

export async function syncStoryboardOverviewToLibrary(deps: OverviewSyncDeps = {}): Promise<boolean> {
  const state = useStudioStore.getState();
  const storyboards = state.storyboards;
  if (storyboards.length === 0) return false;
  // 指纹=分镜内容+各环节计数(链工作流摘要随章节/规划/资产演进也要保鲜)
  const fingerprint = JSON.stringify([
    WORKFLOW_SCHEMA_STAMP,
    overviewFingerprint(storyboards),
    state.novelChapters.length,
    state.scriptPlans.length,
    state.entityExtractions.length,
    state.productionTracks.length,
  ]);
  if (fingerprint === lastSyncedFingerprint) return true;
  await uploadShotPreviews(storyboards, deps);
  // 09-11 旧画布迁移:保鲜产物升级为分镜流程链工作流(七环节+分镜网格),
  // 落位「0_工作流主线/」;旧「分镜总览 ·」文件不动不删
  // 09-12 stage-node-content-parity:富内容载荷(节点内容对齐老画布)随保鲜同生成
  // v4:组件层载荷优先(老画布模型全量映射);资产封面本地上传为引擎 input 缩略
  const rawPayloads = deps.buildPayloads?.() ?? buildStageNodePayloadFromState(state);
  await ensureStageAssetCoversUploaded(rawPayloads, deps);
  // 09-14 通用化改造(零文件形态):不再向引擎 userdata 导入主线 JSON——
  // 保鲜职责收敛为「缩略/封面上传 + 指纹」;环节载荷由画布侧打开时经
  // buildStageInjections 对仓库通用模板(repo: 只读)现注入,4125 章零落盘。
  lastSyncedFingerprint = fingerprint;
  return true;
}

export function resetOverviewSyncForTests(): void {
  lastSyncedFingerprint = "";
  assetCoverNameCache.clear();
}

/** 引擎就绪瞬失效保鲜指纹(09-12 真跑根修):冷启动窗口(视图先挂载、引擎
 * 后启动)跑过的保鲜把上传失败也随指纹缓存——镜缩略/资产封面从此被短路
 * 跳过,资产卡卡成字牌到内容下次变化。组件在引擎假→真瞬调用,下轮 5s
 * tick(或组件同步触发的立即补跑)整轮重传。 */
export function invalidateOverviewSyncForEngineStart(): void {
  lastSyncedFingerprint = "";
}
