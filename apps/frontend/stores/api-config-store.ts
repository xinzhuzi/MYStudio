// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * API Config Store v2
 * Manages API providers and keys with localStorage persistence
 * Supports multi-key rotation and IProvider interface (AionUi pattern)
 */

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { ProviderId, ServiceType } from '@opencut/ai-core';
import { 
  type IProvider, 
  DEFAULT_PROVIDERS, 
  generateId, 
  parseApiKeys,
  maskApiKey as maskKey,
  updateProviderKeys,
  classifyModelByName,
} from '@/lib/api-key-manager';
import { injectDiscoveryCache, type DiscoveredModelLimits } from '@/lib/ai/model-registry';
import type { ModelBinding } from '@/types/studio';
import { LOCAL_TTS_BASE_URL } from '@/lib/tts/constants';
import { TTS_MODEL_GROUPS } from '@/lib/tts/model-catalog';

// Re-export IProvider for convenience
export type { IProvider } from '@/lib/api-key-manager';

// ==================== AI Feature Types ====================

/**
 * AI 功能模块类型
 * 每个功能可以绑定一个 API 供应商
 */
export type AIFeature = 
  | 'script_analysis'       // 剧本分析
  | 'character_generation'  // 角色图片生成
  | 'scene_generation'      // 场景图片生成
  | 'video_generation'      // 视频生成
  | 'image_understanding'   // 图片理解/分析
  | 'chat'                  // 通用对话
  | 'freedom_image'         // 自由板块-图片生成
  | 'freedom_video'         // 自由板块-视频生成
  | 'tts';                  // TTS 口播/音频生成

/**
 * 功能绑定配置
 * 每个功能可绑定多个供应商/模型（多选）
 * 格式: platform:model 数组，如 ['memefast:deepseek-v3.2', 'memefast:gemini-3-pro-image-preview']
 */
export type FeatureBindings = Record<AIFeature, string[] | null>;

export type AgentUseMode = 'simple' | 'advanced';

export type AgentDeploymentKey =
  | 'universalAi'
  | 'eventAnalysisAgent'
  | 'scriptAgent'
  | 'scriptAgent:decisionAgent'
  | 'scriptAgent:supervisionAgent'
  | 'scriptAgent:storySkeletonAgent'
  | 'scriptAgent:adaptationStrategyAgent'
  | 'scriptAgent:scriptAgent'
  | 'productionAgent:decisionAgent'
  | 'productionAgent:supervisionAgent'
  | 'productionAgent:deriveAssetsAgent'
  | 'productionAgent:generateAssetsAgent'
  | 'productionAgent:directorPlanAgent'
  | 'productionAgent:storyboardGenAgent'
  | 'productionAgent:storyboardPanelAgent'
  | 'productionAgent:storyboardTableAgent'
  | 'storySkeletonAgent'
  | 'adaptationStrategyAgent'
  | 'scriptDraft'
  | 'entityExtraction'
  | 'episodeOutline'
  | 'storyboardImage'
  | 'videoTrack'
  | 'tts';

export interface AgentDeploymentConfig {
  key: AgentDeploymentKey;
  name: string;
  desc: string;
  modelId?: string;
  vendorId?: string;
  temperature?: number;
  maxOutputTokens?: number;
  disabled?: boolean;
}

export interface AgentDeploymentGroup {
  id: string;
  label: string;
  desc: string;
  keys: AgentDeploymentKey[];
}

export interface ResolvedAgentModel {
  deployment: AgentDeploymentConfig;
  provider: IProvider;
  model: string;
}

export type ProviderAdapterModelType = 'text' | 'image' | 'video' | 'tts' | 'vision';

export interface ProviderAdapterModelDefinition {
  modelName: string;
  type: ProviderAdapterModelType;
  capabilities?: string[];
}

export interface ProviderAdapterValidationResult {
  ok: boolean;
  state: 'valid' | 'invalid';
  reason?: string;
  providerId?: string;
  models: ProviderAdapterModelDefinition[];
}

export interface ProviderAdapterCode {
  providerId: string;
  code: string;
  updatedAt: number;
  validationState?: 'valid' | 'invalid';
  validationReason?: string;
}

export const DEFAULT_LOCAL_TTS_PROVIDER_ID = 'manying-local-tts';
export const DEFAULT_LOCAL_TTS_MODEL = 'qwen-tts-1.7B';

export function createDefaultLocalTtsProvider(): IProvider {
  return {
    id: DEFAULT_LOCAL_TTS_PROVIDER_ID,
    platform: 'manying-local-tts',
    name: '本地 TTS',
    baseUrl: LOCAL_TTS_BASE_URL,
    apiKey: '',
    model: TTS_MODEL_GROUPS.flatMap((group) => group.models.map((model) => model.modelName)),
    capabilities: ['tts'],
  };
}

/**
 * 功能信息定义
 */
export const AI_FEATURES: Array<{
  key: AIFeature;
  name: string;
  description: string;
}> = [
  { key: 'script_analysis', name: '剧本分析', description: '将故事文本分解为结构化剧本' },
  { key: 'character_generation', name: '角色生成', description: '生成角色参考图和变体服装' },
  { key: 'scene_generation', name: '场景生成', description: '生成场景环境参考图' },
  { key: 'video_generation', name: '视频生成', description: '将图片转换为视频' },
  { key: 'image_understanding', name: '图片理解', description: '读取图片并生成文字描述，可使用支持图片输入的文本模型' },
  { key: 'chat', name: '通用对话', description: 'AI 对话和文本生成' },
  { key: 'freedom_image', name: '自由板块-图片', description: '自由板块独立的图片生成配置' },
  { key: 'freedom_video', name: '自由板块-视频', description: '自由板块独立的视频生成配置' },
  { key: 'tts', name: 'TTS 口播', description: '旁白、对白和音频生成模型配置' },
];

export const API_AGENT_DEPLOYMENT_DEFAULTS: AgentDeploymentConfig[] = [
  {
    key: 'universalAi',
    name: '通用AI',
    desc: '简单模式下的默认模型，供未单独配置的工作流任务复用',
    temperature: 0.7,
    maxOutputTokens: 4096,
  },
  {
    key: 'eventAnalysisAgent',
    name: '事件分析Agent',
    desc: '负责按 Toonflow 事件表格式提取章节事件摘要',
    temperature: 0.2,
    maxOutputTokens: 1024,
  },
  {
    key: 'entityExtraction',
    name: '实体提取Agent',
    desc: '负责从剧本提取角色/场景/道具并去重、归并别名、按集关联',
    temperature: 0.2,
    maxOutputTokens: 2048,
  },
  {
    key: 'episodeOutline',
    name: '分集细纲Agent',
    desc: '负责把骨架+改编策略逐集落到每场 beat，降低骨架→剧本跨度',
    temperature: 0.5,
    maxOutputTokens: 4096,
  },
  {
    key: 'scriptAgent',
    name: '剧本Agent',
    desc: '负责剧本总控、任务拆解和对话式策划',
    temperature: 0.7,
    maxOutputTokens: 4096,
  },
  {
    key: 'scriptAgent:decisionAgent',
    name: '剧本决策Agent',
    desc: '负责判断剧本阶段下一步执行骨架、策略、草稿或监督',
    temperature: 0.2,
    maxOutputTokens: 2048,
  },
  {
    key: 'scriptAgent:storySkeletonAgent',
    name: '故事骨架Agent',
    desc: '负责从小说章节、事件摘要和项目设定整理故事骨架',
    temperature: 0.6,
    maxOutputTokens: 4096,
  },
  {
    key: 'scriptAgent:adaptationStrategyAgent',
    name: '改编策略Agent',
    desc: '负责将小说内容转成漫剧/短剧改编策略',
    temperature: 0.7,
    maxOutputTokens: 4096,
  },
  {
    key: 'scriptAgent:scriptAgent',
    name: '剧本执行Agent',
    desc: '负责分场剧本、对白和镜头文字草稿生成',
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
  {
    key: 'scriptAgent:supervisionAgent',
    name: '剧本监督Agent',
    desc: '负责检查剧本输出与小说事件、风格手册和任务目标的一致性',
    temperature: 0.2,
    maxOutputTokens: 4096,
  },
  {
    key: 'productionAgent:decisionAgent',
    name: '制作决策Agent',
    desc: '负责判断制作阶段下一步执行资产拆解、导演计划或分镜表',
    temperature: 0.2,
    maxOutputTokens: 2048,
  },
  {
    key: 'productionAgent:directorPlanAgent',
    name: '导演计划Agent',
    desc: '负责根据导演手册整理单集镜头调度、节奏和画面方案',
    temperature: 0.5,
    maxOutputTokens: 4096,
  },
  {
    key: 'productionAgent:storyboardGenAgent',
    name: '分镜生成Agent',
    desc: '负责把剧本片段转换成可制作的分镜草案',
    temperature: 0.6,
    maxOutputTokens: 8192,
  },
  {
    key: 'productionAgent:storyboardPanelAgent',
    name: '分镜画面Agent',
    desc: '负责补充分镜画面描述、构图、角色动作和镜头提示',
    temperature: 0.6,
    maxOutputTokens: 4096,
  },
  {
    key: 'productionAgent:storyboardTableAgent',
    name: '分镜表Agent',
    desc: '负责输出结构化分镜表、trackKey、时长和素材引用建议',
    temperature: 0.4,
    maxOutputTokens: 8192,
  },
  {
    key: 'productionAgent:deriveAssetsAgent',
    name: '资产拆解Agent',
    desc: '负责从剧本和分镜中拆解角色、场景、道具、音频等资产需求',
    temperature: 0.5,
    maxOutputTokens: 4096,
  },
  {
    key: 'productionAgent:generateAssetsAgent',
    name: '资产生成计划Agent',
    desc: '负责整理资产生成提示词、参考图需求和批量生产计划',
    temperature: 0.6,
    maxOutputTokens: 4096,
  },
  {
    key: 'productionAgent:supervisionAgent',
    name: '制作监督Agent',
    desc: '负责检查分镜、素材和制作计划是否符合视觉/导演手册',
    temperature: 0.2,
    maxOutputTokens: 4096,
  },
  {
    key: 'storySkeletonAgent',
    name: '故事骨架兼容入口',
    desc: '兼容旧版绑定；新流程优先使用剧本策划下的故事骨架Agent',
    temperature: 0.6,
    maxOutputTokens: 4096,
  },
  {
    key: 'adaptationStrategyAgent',
    name: '改编策略兼容入口',
    desc: '兼容旧版绑定；新流程优先使用剧本策划下的改编策略Agent',
    temperature: 0.7,
    maxOutputTokens: 4096,
  },
  {
    key: 'scriptDraft',
    name: '剧本草稿兼容入口',
    desc: '兼容旧版绑定；新流程优先使用剧本策划下的剧本执行Agent',
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
  {
    key: 'storyboardImage',
    name: '分镜图片模型',
    desc: '负责分镜参考图、角色/场景参考图和关键帧图片生成',
    temperature: 0.5,
    maxOutputTokens: 2048,
  },
  {
    key: 'videoTrack',
    name: '视频片段Agent',
    desc: '负责生产工作台的单 track 视频任务绑定',
    temperature: 0.5,
    maxOutputTokens: 2048,
  },
  {
    key: 'tts',
    name: 'TTS',
    desc: '负责旁白、对白和音频生成任务绑定',
    vendorId: DEFAULT_LOCAL_TTS_PROVIDER_ID,
    modelId: DEFAULT_LOCAL_TTS_MODEL,
    temperature: 0.3,
    maxOutputTokens: 2048,
  },
];

export const API_AGENT_DEPLOYMENT_GROUPS: AgentDeploymentGroup[] = [
  {
    id: 'fallback',
    label: '通用与兜底',
    desc: '简单模式下复用的文本模型，只兜底文本类 Agent',
    keys: ['universalAi'],
  },
  {
    id: 'novel',
    label: '小说理解',
    desc: '章节事件、事件状态和小说上下文理解',
    keys: ['eventAnalysisAgent'],
  },
  {
    id: 'script',
    label: '剧本策划',
    desc: '对应 Toonflow 剧本 Agent 的决策、执行和监督链路',
    keys: [
      'scriptAgent',
      'scriptAgent:decisionAgent',
      'scriptAgent:storySkeletonAgent',
      'scriptAgent:adaptationStrategyAgent',
      'scriptAgent:scriptAgent',
      'scriptAgent:supervisionAgent',
      'storySkeletonAgent',
      'adaptationStrategyAgent',
      'scriptDraft',
      'entityExtraction',
      'episodeOutline',
    ],
  },
  {
    id: 'production',
    label: '制作规划',
    desc: '对应 Toonflow 制作 Agent 的导演计划、分镜、资产拆解和监督',
    keys: [
      'productionAgent:decisionAgent',
      'productionAgent:directorPlanAgent',
      'productionAgent:storyboardGenAgent',
      'productionAgent:storyboardPanelAgent',
      'productionAgent:storyboardTableAgent',
      'productionAgent:deriveAssetsAgent',
      'productionAgent:generateAssetsAgent',
      'productionAgent:supervisionAgent',
    ],
  },
  {
    id: 'multimodal',
    label: '多模态执行',
    desc: '图片、视频和 TTS 等真实执行模型，不能用文本模型兜底',
    keys: ['storyboardImage', 'videoTrack', 'tts'],
  },
];

const AGENT_DEPLOYMENT_MODEL_TYPES: Record<AgentDeploymentKey, ProviderAdapterModelType> = {
  universalAi: 'text',
  eventAnalysisAgent: 'text',
  scriptAgent: 'text',
  'scriptAgent:decisionAgent': 'text',
  'scriptAgent:supervisionAgent': 'text',
  'scriptAgent:storySkeletonAgent': 'text',
  'scriptAgent:adaptationStrategyAgent': 'text',
  'scriptAgent:scriptAgent': 'text',
  'productionAgent:decisionAgent': 'text',
  'productionAgent:supervisionAgent': 'text',
  'productionAgent:deriveAssetsAgent': 'text',
  'productionAgent:generateAssetsAgent': 'text',
  'productionAgent:directorPlanAgent': 'text',
  'productionAgent:storyboardGenAgent': 'text',
  'productionAgent:storyboardPanelAgent': 'text',
  'productionAgent:storyboardTableAgent': 'text',
  storySkeletonAgent: 'text',
  adaptationStrategyAgent: 'text',
  scriptDraft: 'text',
  entityExtraction: 'text',
  episodeOutline: 'text',
  storyboardImage: 'image',
  videoTrack: 'video',
  tts: 'tts',
};

export function getAgentDeploymentModelType(key: AgentDeploymentKey): ProviderAdapterModelType {
  return AGENT_DEPLOYMENT_MODEL_TYPES[key];
}

const VALID_ADAPTER_MODEL_TYPES = new Set<ProviderAdapterModelType>([
  'text',
  'image',
  'video',
  'tts',
  'vision',
]);

export function createDefaultAgentDeployments(): AgentDeploymentConfig[] {
  return API_AGENT_DEPLOYMENT_DEFAULTS.map((deployment) => ({ ...deployment }));
}

function normalizeAgentDeployments(
  deployments: AgentDeploymentConfig[] | undefined | null,
): AgentDeploymentConfig[] {
  const existing = deployments || [];
  const knownKeys = new Set(API_AGENT_DEPLOYMENT_DEFAULTS.map((deployment) => deployment.key));
  const normalizedDefaults = API_AGENT_DEPLOYMENT_DEFAULTS.map((deployment) => ({
    ...deployment,
    ...(existing.find((item) => item.key === deployment.key) || {}),
  }));
  const extra = existing.filter((item) => !knownKeys.has(item.key));
  return [...normalizedDefaults, ...extra];
}

function parseAdapterJsonBlock(code: string): unknown {
  const match = code.match(/\/\*\s*mystudio-vendor-json\s*([\s\S]*?)\*\//m);
  if (!match?.[1]) {
    throw new Error('缺少 mystudio-vendor-json 配置块');
  }
  return JSON.parse(match[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateProviderAdapterCodeText(code: string): ProviderAdapterValidationResult {
  let parsed: unknown;
  try {
    parsed = parseAdapterJsonBlock(code);
  } catch (error) {
    return {
      ok: false,
      state: 'invalid',
      reason: error instanceof Error ? error.message : '供应商代码格式无效',
      models: [],
    };
  }

  if (!isRecord(parsed) || !isRecord(parsed.vendor)) {
    return { ok: false, state: 'invalid', reason: '缺少 vendor', models: [] };
  }

  const vendor = parsed.vendor;
  const providerId = typeof vendor.id === 'string' ? vendor.id : undefined;
  const rawModels = Array.isArray(parsed.models) ? parsed.models : [];
  const seen = new Set<string>();
  const models: ProviderAdapterModelDefinition[] = [];

  for (const rawModel of rawModels) {
    if (!isRecord(rawModel) || typeof rawModel.modelName !== 'string') {
      return { ok: false, state: 'invalid', reason: '模型定义缺少 modelName', providerId, models };
    }
    const type = rawModel.type;
    if (typeof type !== 'string' || !VALID_ADAPTER_MODEL_TYPES.has(type as ProviderAdapterModelType)) {
      return { ok: false, state: 'invalid', reason: `模型类型无效: ${String(type)}`, providerId, models };
    }
    if (seen.has(rawModel.modelName)) {
      return { ok: false, state: 'invalid', reason: `模型名称重复: ${rawModel.modelName}`, providerId, models };
    }
    seen.add(rawModel.modelName);
    models.push({
      modelName: rawModel.modelName,
      type: type as ProviderAdapterModelType,
      capabilities: Array.isArray(rawModel.capabilities)
        ? rawModel.capabilities.filter((capability): capability is string => typeof capability === 'string')
        : undefined,
    });
  }

  return {
    ok: true,
    state: 'valid',
    providerId,
    models,
  };
}


// ==================== Types ====================

/**
 * 高级生成选项
 * 控制视频生成的高级行为
 */
export interface AdvancedGenerationOptions {
  /** 启用视觉连续性：自动将上一分镜尾帧传递给下一分镜作为参考 */
  enableVisualContinuity: boolean;
  /** 启用断点续传：批量生成中断后可从上次位置继续 */
  enableResumeGeneration: boolean;
  /** 启用内容审核容错：遇到敏感内容自动跳过，继续生成其他分镜 */
  enableContentModeration: boolean;
  /** 启用多模型自动切换：首分镜使用 t2v，后续使用 i2v */
  enableAutoModelSwitch: boolean;
}


/** 高级选项默认值 */
export const DEFAULT_ADVANCED_OPTIONS: AdvancedGenerationOptions = {
  enableVisualContinuity: true,
  enableResumeGeneration: true,
  enableContentModeration: true,
  enableAutoModelSwitch: false,
};

// ==================== Image Host Types ====================

/**
 * 图床平台
 */
export type ImageHostPlatform = 'imgbb' | 'imgurl' | 'scdn' | 'catbox' | 'cloudflare_r2' | 'custom';

/**
 * 图床供应商配置（独立映射）
 */
export interface ImageHostProvider {
  id: string;
  platform: ImageHostPlatform;
  name: string;
  baseUrl: string;
  uploadPath: string; // 可为完整 URL 或路径
  apiKey: string; // 支持多 Key（逗号/换行），允许游客上传的平台可留空
  enabled: boolean;
  apiKeyParam?: string; // Query 参数名（如 key）
  apiKeyHeader?: string; // Header 名称（可选）
  apiKeyFormField?: string; // 表单字段中的 Key 名称（如 userhash）
  apiKeyOptional?: boolean; // 是否允许不填 Key（游客上传）
  expirationParam?: string; // 过期参数名（如 expiration）
  imageField?: string; // 表单字段名（默认 image）
  imagePayloadType?: 'base64' | 'file'; // 图片字段传输模式
  nameField?: string; // 表单字段名（默认 name）
  staticFormFields?: Record<string, string>; // 固定附加表单字段
  responseUrlField?: string; // 响应中 URL 字段路径（如 data.url）
  responseDeleteUrlField?: string; // 响应中删除 URL 字段路径
}

/** 图床供应商预设（仅保留当前在用范围内的平台） */
export const IMAGE_HOST_PRESETS: Omit<ImageHostProvider, 'id' | 'apiKey'>[] = [
  {
    platform: 'scdn',
    name: 'SCDN 图床',
    baseUrl: 'https://img.scdn.io',
    uploadPath: '/api/v1.php',
    enabled: true,
    apiKeyOptional: true,
    imageField: 'image',
    imagePayloadType: 'file',
    responseUrlField: 'url',
  },
  {
    platform: 'catbox',
    name: 'Catbox',
    baseUrl: 'https://catbox.moe',
    uploadPath: '/user/api.php',
    enabled: false,
    apiKeyFormField: 'userhash',
    apiKeyOptional: true,
    imageField: 'fileToUpload',
    imagePayloadType: 'file',
    staticFormFields: {
      reqtype: 'fileupload',
    },
  },
  {
    platform: 'imgbb',
    name: 'imgbb',
    baseUrl: 'https://api.imgbb.com',
    uploadPath: '/1/upload',
    enabled: false,
    apiKeyParam: 'key',
    expirationParam: 'expiration',
    imageField: 'image',
    nameField: 'name',
    responseUrlField: 'data.url',
    responseDeleteUrlField: 'data.delete_url',
  },
  {
    platform: 'imgurl',
    name: 'ImgURL',
    baseUrl: 'https://www.imgurl.org',
    uploadPath: '/api/v3/upload',
    enabled: false,
    apiKeyHeader: 'Authorization',
    imageField: 'file',
    responseUrlField: 'data.url',
  },
  {
    platform: 'custom',
    name: '自定义图床',
    baseUrl: '',
    uploadPath: '',
    enabled: false,
  },
  {
    platform: 'cloudflare_r2',
    name: 'Cloudflare R2',
    baseUrl: '',
    uploadPath: '',
    enabled: false,
  },
];

/** 首次启动默认创建的图床（仅 SCDN 默认开启，ImgBB 默认关闭） */
export const DEFAULT_IMAGE_HOST_PROVIDERS: Omit<ImageHostProvider, 'id' | 'apiKey'>[] =
  IMAGE_HOST_PRESETS.filter((preset) => preset.platform === 'scdn' || preset.platform === 'imgbb');

const ACTIVE_IMAGE_HOST_PLATFORMS = new Set<ImageHostPlatform>(['imgbb', 'imgurl', 'scdn', 'catbox', 'cloudflare_r2', 'custom']);

export function isVisibleImageHostPlatform(platform: string): platform is ImageHostPlatform {
  return ACTIVE_IMAGE_HOST_PLATFORMS.has(platform as ImageHostPlatform);
}

export function isVisibleImageHostProvider(
  provider: Pick<ImageHostProvider, 'platform'>,
): boolean {
  return isVisibleImageHostPlatform(provider.platform);
}

export function findImageHostPreset(
  platform: ImageHostPlatform,
): Omit<ImageHostProvider, 'id' | 'apiKey'> | undefined {
  return IMAGE_HOST_PRESETS.find((preset) => preset.platform === platform);
}

function createDefaultImageHostProviders(): ImageHostProvider[] {
  return DEFAULT_IMAGE_HOST_PROVIDERS.map((provider) => ({
    ...provider,
    id: generateId(),
    apiKey: '',
  }));
}

function isUnconfiguredDefaultImgBBProvider(provider: ImageHostProvider): boolean {
  const imgbbPreset = findImageHostPreset('imgbb');
  if (!imgbbPreset || provider.platform !== 'imgbb') {
    return false;
  }

  return (provider.apiKey || '').trim().length === 0
    && provider.name === imgbbPreset.name
    && (provider.baseUrl || '') === imgbbPreset.baseUrl
    && (provider.uploadPath || '') === imgbbPreset.uploadPath;
}

type ImageHostProviderDefaults = Partial<Omit<ImageHostProvider, 'id' | 'name' | 'apiKey' | 'enabled'>>;

function isUnconfiguredDefaultCatboxProvider(provider: ImageHostProvider): boolean {
  const catboxPreset = findImageHostPreset('catbox');
  if (!catboxPreset || provider.platform !== 'catbox') {
    return false;
  }

  return (provider.apiKey || '').trim().length === 0
    && provider.name === catboxPreset.name
    && (provider.baseUrl || '') === catboxPreset.baseUrl
    && (provider.uploadPath || '') === catboxPreset.uploadPath;
}
const IMAGE_HOST_PLATFORM_DEFAULTS: Partial<Record<ImageHostPlatform, ImageHostProviderDefaults>> = {
  imgbb: {
    baseUrl: 'https://api.imgbb.com',
    uploadPath: '/1/upload',
    apiKeyParam: 'key',
    expirationParam: 'expiration',
    imageField: 'image',
    nameField: 'name',
    responseUrlField: 'data.url',
    responseDeleteUrlField: 'data.delete_url',
  },
  imgurl: {
    baseUrl: 'https://www.imgurl.org',
    uploadPath: '/api/v3/upload',
    apiKeyHeader: 'Authorization',
    imageField: 'file',
  },
  scdn: {
    baseUrl: 'https://img.scdn.io',
    uploadPath: '/api/v1.php',
    apiKeyOptional: true,
    imageField: 'image',
    imagePayloadType: 'file',
    responseUrlField: 'url',
  },
  catbox: {
    baseUrl: 'https://catbox.moe',
    uploadPath: '/user/api.php',
    apiKeyFormField: 'userhash',
    apiKeyOptional: true,
    imageField: 'fileToUpload',
    imagePayloadType: 'file',
    staticFormFields: {
      reqtype: 'fileupload',
    },
  },
};

function normalizeImageHostProvider(provider: ImageHostProvider): ImageHostProvider {
  const defaults = IMAGE_HOST_PLATFORM_DEFAULTS[provider.platform];
  if (!defaults) {
    return provider;
  }

  if (provider.platform === 'catbox') {
    return {
      ...provider,
      baseUrl: provider.baseUrl || defaults.baseUrl || '',
      uploadPath: provider.uploadPath || defaults.uploadPath || '',
      apiKeyFormField: 'userhash',
      apiKeyOptional: true,
      imageField: 'fileToUpload',
      imagePayloadType: 'file',
      staticFormFields: {
        ...(provider.staticFormFields || {}),
        reqtype: 'fileupload',
      },
      responseUrlField: undefined,
      responseDeleteUrlField: undefined,
    };
  }

  if (provider.platform === 'scdn') {
    return {
      ...provider,
      baseUrl: provider.baseUrl || defaults.baseUrl || '',
      uploadPath: provider.uploadPath || defaults.uploadPath || '',
      apiKeyOptional: true,
      imageField: 'image',
      imagePayloadType: 'file',
      responseUrlField: 'url',
      responseDeleteUrlField: undefined,
    };
  }


  if (provider.platform === 'imgbb') {
    return {
      ...provider,
      baseUrl: provider.baseUrl || defaults.baseUrl || '',
      uploadPath: provider.uploadPath || defaults.uploadPath || '',
      apiKeyParam: defaults.apiKeyParam,
      expirationParam: defaults.expirationParam,
      imageField: defaults.imageField,
      nameField: defaults.nameField,
      responseUrlField: defaults.responseUrlField,
      responseDeleteUrlField: defaults.responseDeleteUrlField,
    };
  }

  if (provider.platform === 'imgurl') {
    return {
      ...provider,
      baseUrl: provider.baseUrl || defaults.baseUrl || '',
      uploadPath: provider.uploadPath || defaults.uploadPath || '',
      apiKeyHeader: defaults.apiKeyHeader,
      imageField: provider.imageField || defaults.imageField,
    };
  }

  return provider;
}

function normalizeImageHostProviders(providers: ImageHostProvider[] | undefined | null): ImageHostProvider[] {
  return (providers || []).filter(isVisibleImageHostProvider).map(normalizeImageHostProvider);
}

/** Legacy 图床配置（仅用于迁移） */
export interface LegacyImageHostConfig {
  type: ImageHostPlatform;
  imgbbApiKey: string;
  cloudflareR2?: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  };
  custom?: {
    uploadUrl: string;
    apiKey: string;
  };
}

interface APIConfigState {
  // Provider-based storage (v2)
  providers: IProvider[];

  // Toonflow-style workflow model deployment config
  agentUseMode: AgentUseMode;
  agentDeployments: AgentDeploymentConfig[];
  providerAdapterCodes: ProviderAdapterCode[];
  studioBindingsMigrated: boolean;
  
  // Feature bindings - which provider to use for each feature
  featureBindings: FeatureBindings;
  
  // Legacy: API Keys (v1, for migration)
  apiKeys: Partial<Record<ProviderId, string>>;
  
  // Concurrency control
  concurrency: number;
  
  // Aspect ratio preference
  aspectRatio: '16:9' | '9:16';
  orientation: 'landscape' | 'portrait';
  
  // Advanced generation options
  advancedOptions: AdvancedGenerationOptions;
  
  // Image host providers (independent mapping)
  imageHostProviders: ImageHostProvider[];
  
  // Model endpoint types from API sync (model ID -> supported_endpoint_types)
  modelEndpointTypes: Record<string, string[]>;
  
  // Model metadata from /api/pricing_new (MemeFast platform classification)
  // model_name -> model_type: "文本" | "图像" | "音视频" | "检索"
  modelTypes: Record<string, string>;
  // model_name -> tags: ["对话","识图","工具"] etc.
  modelTags: Record<string, string[]>;
  // model_name -> enable_groups: ["官转","纯AZ","default"] (MemeFast only)
  modelEnableGroups: Record<string, string[]>;
  
  // Discovered model limits (Error-driven Discovery)
  // model_name -> { maxOutput?, contextWindow?, discoveredAt }
  discoveredModelLimits: Record<string, DiscoveredModelLimits>;

  // 用户为每个模型显式配置的「思考模式」开关（覆盖按名字的自动判断）
  // model_name -> true(强制开) | false(强制关)；未配置则回退到 supportsThinking(model)
  modelThinkingOverrides: Record<string, boolean>;
}

interface APIConfigActions {
  // Provider management (v2)
  addProvider: (provider: Omit<IProvider, 'id'>) => IProvider;
  updateProvider: (provider: IProvider) => void;
  removeProvider: (id: string) => void;
  getProviderByPlatform: (platform: string) => IProvider | undefined;
  getProviderById: (id: string) => IProvider | undefined;
  syncProviderModels: (providerId: string) => Promise<{ success: boolean; count: number; error?: string }>;

  // Toonflow-style workflow model deployment config
  setAgentUseMode: (mode: AgentUseMode) => void;
  setAgentDeployment: (deployment: Partial<AgentDeploymentConfig> & Pick<AgentDeploymentConfig, 'key'>) => void;
  getResolvedAgentModel: (key: AgentDeploymentKey) => ResolvedAgentModel | null;
  migrateStudioBindings: (bindings: ModelBinding[]) => { migrated: boolean; count: number };
  upsertProviderAdapterCode: (providerId: string, code: string) => ProviderAdapterValidationResult;
  validateProviderAdapterCode: (providerId: string) => ProviderAdapterValidationResult;
  syncModelsFromProviderAdapterCode: (providerId: string) => { success: boolean; count: number; error?: string };
  
  // Feature binding management (multi-select)
  setFeatureBindings: (feature: AIFeature, bindings: string[] | null) => void;
  toggleFeatureBinding: (feature: AIFeature, binding: string) => void;
  getFeatureBindings: (feature: AIFeature) => string[];
  getProvidersForFeature: (feature: AIFeature) => Array<{ provider: IProvider; model: string }>;
  isFeatureConfigured: (feature: AIFeature) => boolean;
  // Legacy single-select compat (deprecated)
  setFeatureBinding: (feature: AIFeature, providerId: string | null) => void;
  getFeatureBinding: (feature: AIFeature) => string | null;
  getProviderForFeature: (feature: AIFeature) => IProvider | undefined;
  
  // Legacy API Key management (v1 compat)
  setApiKey: (provider: ProviderId, key: string) => void;
  getApiKey: (provider: ProviderId) => string;
  clearApiKey: (provider: ProviderId) => void;
  clearAllApiKeys: () => void;
  
  // Concurrency
  setConcurrency: (n: number) => void;
  
  // Aspect ratio
  setAspectRatio: (ratio: '16:9' | '9:16') => void;
  toggleOrientation: () => void;
  
  // Advanced generation options
  setAdvancedOption: <K extends keyof AdvancedGenerationOptions>(key: K, value: AdvancedGenerationOptions[K]) => void;
  resetAdvancedOptions: () => void;
  
  // Image host provider management
  addImageHostProvider: (provider: Omit<ImageHostProvider, 'id'>) => ImageHostProvider;
  updateImageHostProvider: (provider: ImageHostProvider) => void;
  removeImageHostProvider: (id: string) => void;
  getImageHostProviderById: (id: string) => ImageHostProvider | undefined;
  getEnabledImageHostProviders: () => ImageHostProvider[];
  isImageHostConfigured: () => boolean;
  
  // Validation
  isConfigured: (provider: ProviderId) => boolean;
  isPlatformConfigured: (platform: string) => boolean;
  checkRequiredKeys: (services: ServiceType[]) => APIConfigStatus;
  checkChatKeys: () => APIConfigStatus;
  checkVideoGenerationKeys: () => APIConfigStatus;
  
  // Display helpers
  maskApiKey: (key: string) => string;
  getAllConfigs: () => { provider: ProviderId; configured: boolean; masked: string }[];
  
  // Model limits discovery
  getDiscoveredModelLimits: (model: string) => DiscoveredModelLimits | undefined;
  setDiscoveredModelLimits: (model: string, limits: Partial<DiscoveredModelLimits>) => void;

  // Per-model thinking-mode override（设置里手动标记「思考模式」）
  getModelThinkingOverride: (model: string) => boolean | undefined;
  setModelThinkingOverride: (model: string, enabled: boolean | undefined) => void;
}

type APIConfigStore = APIConfigState & APIConfigActions;

// ==================== Status Type ====================

export interface APIConfigStatus {
  isAllConfigured: boolean;
  missingKeys: string[];
  friendlyMessage: string;
}

// ==================== Provider Info ====================

/**
 * 供应商信息映射
 * 1. memefast - 旧版 OpenAI 兼容服务入口
 * 2. runninghub - RunningHub，视角切换/多角度生成
 */
const PROVIDER_INFO: Record<ProviderId, { name: string; services: ServiceType[] }> = {
  memefast: { name: 'OpenAI 兼容服务', services: ['chat', 'image', 'video', 'vision'] },
  runninghub: { name: 'RunningHub', services: ['image', 'vision'] },
  openai: { name: 'OpenAI', services: [] },
  custom: { name: 'Custom', services: [] },
};

// ==================== Initial State ====================

export function createDefaultFeatureBindings(): FeatureBindings {
  return {
    script_analysis: null,
    character_generation: null,
    scene_generation: null,
    video_generation: null,
    image_understanding: null,
    chat: null,
    freedom_image: null,
    freedom_video: null,
    tts: [`${DEFAULT_LOCAL_TTS_PROVIDER_ID}:${DEFAULT_LOCAL_TTS_MODEL}`],
  };
}

const defaultFeatureBindings = createDefaultFeatureBindings();
const defaultImageHostProviders: ImageHostProvider[] = createDefaultImageHostProviders();

function omitRecordKeys<T>(record: Record<string, T>, keys: Iterable<string>): Record<string, T> {
  const next = { ...record };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

function ensureDefaultLocalTtsProvider(providers: IProvider[] | undefined | null): IProvider[] {
  const existing = providers || [];
  if (existing.some((provider) => provider.id === DEFAULT_LOCAL_TTS_PROVIDER_ID)) {
    return existing;
  }
  return [createDefaultLocalTtsProvider(), ...existing];
}

function isLocalTtsProvider(provider: IProvider) {
  return (
    provider.platform === 'manying-local-tts'
    || (
      provider.platform === 'tts-compatible'
      && provider.baseUrl.trim().replace(/\/+$/, '') === LOCAL_TTS_BASE_URL
    )
  );
}

const initialState: APIConfigState = {
  providers: [createDefaultLocalTtsProvider()],
  agentUseMode: 'simple',
  agentDeployments: createDefaultAgentDeployments(),
  providerAdapterCodes: [],
  studioBindingsMigrated: false,
  featureBindings: defaultFeatureBindings,
  apiKeys: {},
  concurrency: 1,  // Default to serial execution (single key rate limit)
  aspectRatio: '16:9',
  orientation: 'landscape',
  advancedOptions: { ...DEFAULT_ADVANCED_OPTIONS },
  imageHostProviders: defaultImageHostProviders,
  modelEndpointTypes: {},
  modelTypes: {},
  modelTags: {},
  modelEnableGroups: {},
  discoveredModelLimits: {},
  modelThinkingOverrides: {},
};

const fallbackAPIConfigStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function getAPIConfigStorage(): StateStorage {
  if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
    return localStorage;
  }
  return fallbackAPIConfigStorage;
}

// ==================== Store ====================

export const useAPIConfigStore = create<APIConfigStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ==================== Workflow Agent Deployment Config ====================

      setAgentUseMode: (mode) => {
        set({ agentUseMode: mode });
      },

      setAgentDeployment: (deployment) => {
        set((state) => {
          const defaults = API_AGENT_DEPLOYMENT_DEFAULTS.find((item) => item.key === deployment.key);
          const nextDeployment: AgentDeploymentConfig = {
            ...(defaults || { key: deployment.key, name: deployment.key, desc: '' }),
            ...(state.agentDeployments.find((item) => item.key === deployment.key) || {}),
            ...deployment,
          };
          const exists = state.agentDeployments.some((item) => item.key === deployment.key);
          return {
            agentDeployments: normalizeAgentDeployments(
              exists
                ? state.agentDeployments.map((item) => (item.key === deployment.key ? nextDeployment : item))
                : [...state.agentDeployments, nextDeployment],
            ),
          };
        });
      },

      getResolvedAgentModel: (key) => {
        const state = get();
        const deployments = normalizeAgentDeployments(state.agentDeployments);
        const universal = deployments.find((item) => item.key === 'universalAi');
        const exact = deployments.find((item) => item.key === key);
        const canUseTextFallback = getAgentDeploymentModelType(key) === 'text';
        const deployment = state.agentUseMode === 'simple' && key !== 'universalAi' && canUseTextFallback && universal?.modelId && !universal.disabled
          ? universal
          : exact;

        if (!deployment || deployment.disabled || !deployment.modelId) {
          return null;
        }

        let vendorId = deployment.vendorId;
        let model = deployment.modelId;
        if (!vendorId) {
          const splitAt = model.indexOf(':');
          if (splitAt > 0) {
            vendorId = model.slice(0, splitAt);
            model = model.slice(splitAt + 1);
          }
        }

        if (!vendorId || !model) {
          return null;
        }

        const provider = state.providers.find((item) => item.id === vendorId || item.platform === vendorId);
        if (!provider) {
          return null;
        }

        if (provider.model.length > 0 && !provider.model.includes(model)) {
          return null;
        }

        return { deployment, provider, model };
      },

      migrateStudioBindings: (bindings) => {
        const state = get();
        if (state.studioBindingsMigrated) {
          return { migrated: false, count: 0 };
        }

        const allowedKeys = new Set(API_AGENT_DEPLOYMENT_DEFAULTS.map((item) => item.key));
        const updates: AgentDeploymentConfig[] = [];
        for (const binding of bindings) {
          if (!allowedKeys.has(binding.key as AgentDeploymentKey)) {
            continue;
          }
          const splitAt = binding.modelId.indexOf(':');
          const vendorId = splitAt > 0 ? binding.modelId.slice(0, splitAt) : undefined;
          const modelId = splitAt > 0 ? binding.modelId.slice(splitAt + 1) : binding.modelId;
          const defaults = API_AGENT_DEPLOYMENT_DEFAULTS.find((item) => item.key === binding.key);
          if (!defaults || !modelId) {
            continue;
          }
          updates.push({
            ...defaults,
            ...(state.agentDeployments.find((item) => item.key === binding.key) || {}),
            key: binding.key as AgentDeploymentKey,
            vendorId,
            modelId,
          });
        }

        if (updates.length === 0) {
          return { migrated: false, count: 0 };
        }

        const merged = normalizeAgentDeployments([
          ...state.agentDeployments.filter((item) => !updates.some((update) => update.key === item.key)),
          ...updates,
        ]);
        set({
          agentDeployments: merged,
          studioBindingsMigrated: true,
        });
        return { migrated: true, count: updates.length };
      },

      upsertProviderAdapterCode: (providerId, code) => {
        const result = validateProviderAdapterCodeText(code);
        set((state) => ({
          providerAdapterCodes: [
            ...state.providerAdapterCodes.filter((item) => item.providerId !== providerId),
            {
              providerId,
              code,
              updatedAt: Date.now(),
              validationState: result.state,
              validationReason: result.reason,
            },
          ],
        }));
        return result;
      },

      validateProviderAdapterCode: (providerId) => {
        const item = get().providerAdapterCodes.find((adapter) => adapter.providerId === providerId);
        if (!item) {
          return { ok: false, state: 'invalid', reason: '尚未保存供应商适配代码', models: [] };
        }
        return validateProviderAdapterCodeText(item.code);
      },

      syncModelsFromProviderAdapterCode: (providerId) => {
        const result = get().validateProviderAdapterCode(providerId);
        if (!result.ok) {
          return { success: false, count: 0, error: result.reason || '供应商适配代码无效' };
        }
        const provider = get().providers.find((item) => item.id === providerId);
        if (!provider) {
          return { success: false, count: 0, error: '供应商不存在' };
        }
        const models = result.models.map((model) => model.modelName);
        get().updateProvider({ ...provider, model: models });
        return { success: true, count: models.length };
      },

      // ==================== Provider Management (v2) ====================
      
      addProvider: (providerData) => {
        const newProvider: IProvider = {
          ...providerData,
          id: generateId(),
        };
        set((state) => ({
          providers: [...state.providers, newProvider],
        }));
        // Update key manager
        updateProviderKeys(newProvider.id, newProvider.apiKey);
        console.log(`[APIConfig] Added provider: ${newProvider.name}`);
        return newProvider;
      },

      updateProvider: (provider) => {
        set((state) => ({
          providers: state.providers.map(p => p.id === provider.id ? provider : p),
        }));
        // Update key manager
        updateProviderKeys(provider.id, provider.apiKey);
        console.log(`[APIConfig] Updated provider: ${provider.name}`);
      },

      removeProvider: (id) => {
        const provider = get().providers.find(p => p.id === id);
        set((state) => ({
          providers: state.providers.filter(p => p.id !== id),
          providerAdapterCodes: state.providerAdapterCodes.filter((item) => item.providerId !== id),
          featureBindings: Object.fromEntries(
            Object.entries(state.featureBindings).map(([feature, bindings]) => {
              const filtered = (bindings || []).filter((binding) => {
                const splitAt = binding.indexOf(':');
                const providerKey = splitAt > 0 ? binding.slice(0, splitAt) : binding;
                return providerKey !== id && providerKey !== provider?.platform;
              });
              return [feature, filtered.length > 0 ? filtered : null];
            }),
          ) as FeatureBindings,
          agentDeployments: normalizeAgentDeployments(
            state.agentDeployments.map((deployment) => {
              const modelProviderKey = deployment.modelId?.includes(':')
                ? deployment.modelId.slice(0, deployment.modelId.indexOf(':'))
                : undefined;
              const shouldClear =
                deployment.vendorId === id
                || deployment.vendorId === provider?.platform
                || modelProviderKey === id
                || modelProviderKey === provider?.platform;
              return shouldClear
                ? { ...deployment, vendorId: undefined, modelId: undefined }
                : deployment;
            }),
          ),
        }));
        if (provider) {
          console.log(`[APIConfig] Removed provider: ${provider.name}`);
        }
      },

      getProviderByPlatform: (platform) => {
        return get().providers.find(p => p.platform === platform);
      },

      getProviderById: (id) => {
        return get().providers.find(p => p.id === id);
      },

      syncProviderModels: async (providerId) => {
        const provider = get().providers.find(p => p.id === providerId);
        if (!provider) return { success: false, count: 0, error: '供应商不存在' };

        const keys = parseApiKeys(provider.apiKey);
        if (keys.length === 0) return { success: false, count: 0, error: '请先配置 API Key' };

        const baseUrl = provider.baseUrl?.replace(/\/+$/, '');
        if (!baseUrl) return { success: false, count: 0, error: 'Base URL 未配置' };

        try {
          // 用 Set 收集所有 key 的模型，自动去重
          const allModelIds = new Set<string>();
          const isMemefast = provider.platform === 'memefast';
          const memefastTypes: Record<string, string> = {};
          const memefastTags: Record<string, string[]> = {};
          const memefastEndpoints: Record<string, string[]> = {};
          const memefastEnableGroups: Record<string, string[]> = {};

          if (isMemefast) {
            // MemeFast: /api/pricing_new 获取全量元数据（公开接口）
            const domain = baseUrl.replace(/\/v\d+$/, '');
            const pricingUrl = `${domain}/api/pricing_new`;

            const response = await fetch(pricingUrl);
            if (!response.ok) {
              return { success: false, count: 0, error: `pricing_new API 返回 ${response.status}` };
            }

            const json = await response.json();
            const data: Array<{ model_name: string; model_type?: string; tags?: string; supported_endpoint_types?: string[]; enable_groups?: string[] }> = json.data;
            if (!Array.isArray(data) || data.length === 0) {
              return { success: false, count: 0, error: '响应格式异常' };
            }

            console.log(`[APIConfig] Fetched ${data.length} models from pricing_new`);

            // Collect fresh MemeFast metadata first.
            // After sync completes we remove only this provider's stale entries,
            // then merge these fresh values into the latest store state.
            for (const m of data) {
              const name = m.model_name;
              if (!name) continue;
              if (m.model_type) memefastTypes[name] = m.model_type;
              if (m.tags) {
                memefastTags[name] = typeof m.tags === 'string'
                  ? m.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
                  : m.tags;
              }
              if (Array.isArray(m.supported_endpoint_types)) {
                memefastEndpoints[name] = m.supported_endpoint_types;
              }
              if (Array.isArray(m.enable_groups) && m.enable_groups.length > 0) {
                memefastEnableGroups[name] = m.enable_groups;
              }
            }

            // pricing_new 返回全量（公开列表），先收入
            for (const m of data) {
              if (typeof m.model_name === 'string' && m.model_name.length > 0) {
                allModelIds.add(m.model_name);
              }
            }

            // 再遍历每个 key 查 /v1/models 补充该 key 独有模型
            const modelsUrl = /\/v\d+$/.test(baseUrl)
              ? `${baseUrl}/models`
              : `${baseUrl}/v1/models`;

            for (let ki = 0; ki < keys.length; ki++) {
              try {
                const resp = await fetch(modelsUrl, {
                  headers: { 'Authorization': `Bearer ${keys[ki]}` },
                });
                if (!resp.ok) {
                  console.warn(`[APIConfig] MemeFast key#${ki + 1} /v1/models returned ${resp.status}, skip`);
                  continue;
                }
                const j = await resp.json();
                const arr: Array<{ id: string; supported_endpoint_types?: string[] } | string> = j.data || j;
                if (!Array.isArray(arr)) continue;
                for (const m of arr) {
                  const id = typeof m === 'string' ? m : m.id;
                  if (typeof id === 'string' && id.length > 0) allModelIds.add(id);
                  // 补充 endpoint_types
                  if (typeof m !== 'string' && m.id && Array.isArray(m.supported_endpoint_types)) {
                    memefastEndpoints[m.id] = m.supported_endpoint_types as string[];
                  }
                }
                console.log(`[APIConfig] MemeFast key#${ki + 1} contributed models, total so far: ${allModelIds.size}`);
              } catch (e) {
                console.warn(`[APIConfig] MemeFast key#${ki + 1} /v1/models failed:`, e);
              }
            }
          } else {
            // Standard OpenAI-compatible: 遍历每个 key 查 /v1/models，合并去重
            const modelsUrl = /\/v\d+$/.test(baseUrl)
              ? `${baseUrl}/models`
              : `${baseUrl}/v1/models`;

            const endpointUpdates: Record<string, string[]> = {};
            let anySuccess = false;
            let lastError = '';

            for (let ki = 0; ki < keys.length; ki++) {
              try {
                const response = await fetch(modelsUrl, {
                  headers: { 'Authorization': `Bearer ${keys[ki]}` },
                });

                if (!response.ok) {
                  lastError = `key#${ki + 1} API 返回 ${response.status}`;
                  console.warn(`[APIConfig] ${lastError}`);
                  continue;
                }

                const json = await response.json();
                const data: Array<{ id: string; [key: string]: unknown }> = json.data || json;
                if (!Array.isArray(data) || data.length === 0) {
                  console.warn(`[APIConfig] key#${ki + 1} returned empty model list`);
                  continue;
                }

                anySuccess = true;
                for (const m of data) {
                  const id = typeof m === 'string' ? m : m.id;
                  if (typeof id === 'string' && id.length > 0) allModelIds.add(id);
                  // Capture endpoint_types
                  if (typeof m !== 'string' && m.id && Array.isArray(m.supported_endpoint_types)) {
                    endpointUpdates[m.id] = m.supported_endpoint_types as string[];
                  }
                }
                console.log(`[APIConfig] key#${ki + 1} contributed models, total so far: ${allModelIds.size}`);
              } catch (e) {
                lastError = `key#${ki + 1} 网络请求失败`;
                console.warn(`[APIConfig] ${lastError}:`, e);
              }
            }

            if (Object.keys(endpointUpdates).length > 0) {
              set((state) => ({
                modelEndpointTypes: {
                  ...state.modelEndpointTypes,
                  ...endpointUpdates,
                },
              }));
            }

            if (!anySuccess) {
              return { success: false, count: 0, error: lastError || 'API 返回异常' };
            }
          }

          const modelIds = Array.from(allModelIds);
          if (modelIds.length === 0) {
            return { success: false, count: 0, error: '未获取到任何模型' };
          }

          if (isMemefast) {
            const providerOwnedModels = new Set([...(provider.model || []), ...modelIds]);
            set((state) => ({
              modelTypes: {
                ...omitRecordKeys(state.modelTypes, providerOwnedModels),
                ...memefastTypes,
              },
              modelTags: {
                ...omitRecordKeys(state.modelTags, providerOwnedModels),
                ...memefastTags,
              },
              modelEndpointTypes: {
                ...omitRecordKeys(state.modelEndpointTypes, providerOwnedModels),
                ...memefastEndpoints,
              },
              modelEnableGroups: {
                ...omitRecordKeys(state.modelEnableGroups, providerOwnedModels),
                ...memefastEnableGroups,
              },
            }));
            console.log(`[APIConfig] Stored MemeFast metadata: ${Object.keys(memefastTypes).length} types, ${Object.keys(memefastTags).length} tags`);
          }

          // Replace provider model list with merged & deduped data
          get().updateProvider({ ...provider, model: modelIds });

          console.log(`[APIConfig] Synced ${modelIds.length} models for ${provider.name} (from ${keys.length} keys)`);
          return { success: true, count: modelIds.length };
        } catch (error) {
          console.error('[APIConfig] Model sync failed:', error);
          return { success: false, count: 0, error: '网络请求失败，请检查网络' };
        }
      },

      // ==================== Feature Binding Management (Multi-Select) ====================
      
      // 设置功能的所有绑定（替换）
      setFeatureBindings: (feature, bindings) => {
        set((state) => ({
          featureBindings: { ...state.featureBindings, [feature]: bindings },
        }));
        console.log(`[APIConfig] Set ${feature} -> [${bindings?.join(', ') || '无'}]`);
      },
      
      // 切换单个绑定（添加/移除）
      toggleFeatureBinding: (feature, binding) => {
        const current = get().featureBindings[feature] || [];
        const exists = current.includes(binding);
        
        // 同时检查 legacy 格式（platform:model）是否存在
        // 例如 binding = "{id}:deepseek-v3" 但 current 里可能有 "memefast:deepseek-v3"
        let legacyMatch: string | null = null;
        const idx = binding.indexOf(':');
        if (idx > 0) {
          const providerId = binding.slice(0, idx);
          const model = binding.slice(idx + 1);
          const provider = get().providers.find(p => p.id === providerId);
          if (provider) {
            const legacyKey = `${provider.platform}:${model}`;
            if (legacyKey !== binding && current.includes(legacyKey)) {
              legacyMatch = legacyKey;
            }
          }
        }
        
        if (exists || legacyMatch) {
          // 删除：同时移除精确匹配和 legacy 格式
          const newBindings = current.filter(b => b !== binding && b !== legacyMatch);
          set((state) => ({
            featureBindings: { ...state.featureBindings, [feature]: newBindings.length > 0 ? newBindings : null },
          }));
          console.log(`[APIConfig] Toggle ${feature}: ${binding} -> removed${legacyMatch ? ` (also removed legacy: ${legacyMatch})` : ''}`);
        } else {
          // 添加
          const newBindings = [...current, binding];
          set((state) => ({
            featureBindings: { ...state.featureBindings, [feature]: newBindings.length > 0 ? newBindings : null },
          }));
          console.log(`[APIConfig] Toggle ${feature}: ${binding} -> added`);
        }
      },

      // 获取功能的所有绑定
      getFeatureBindings: (feature) => {
        const bindings = get().featureBindings;
        const value = bindings?.[feature];
        // 兼容旧数据：如果是字符串，转为数组
        if (typeof value === 'string') return [value];
        return value || [];
      },

      // 获取功能对应的所有 provider + model
      getProvidersForFeature: (feature) => {
        const bindings = get().getFeatureBindings(feature);
        const results: Array<{ provider: IProvider; model: string }> = [];
        
        for (const binding of bindings) {
          const idx = binding.indexOf(':');
          if (idx <= 0) continue;
          const platformOrId = binding.slice(0, idx);
          const model = binding.slice(idx + 1);
          // 1. 优先按 provider.id 精确匹配（始终安全）
          let provider = get().providers.find(p => p.id === platformOrId);
          // 2. Fallback: 按 platform 匹配，但仅当该 platform 下只有一个供应商时
          //    （防止多个 custom 供应商时误选第一个）
          if (!provider) {
            const platformMatches = get().providers.filter(p => p.platform === platformOrId);
            if (platformMatches.length === 1) {
              provider = platformMatches[0];
            } else if (platformMatches.length > 1) {
              console.warn(`[APIConfig] Ambiguous platform binding "${binding}" matches ${platformMatches.length} providers, skipping`);
            }
          }
          if (!provider) {
            continue;
          }
          if (parseApiKeys(provider.apiKey).length === 0 && !isLocalTtsProvider(provider)) {
            continue;
          }

          // Skip stale hidden bindings that no longer exist in the provider's synced model list.
          // This prevents runtime from executing models that the service-mapping UI can no longer display.
          if (provider.model.length > 0 && !provider.model.includes(model)) {
            console.warn(
              `[APIConfig] Skipping stale binding "${binding}" for ${feature}: model "${model}" is not in provider "${provider.name}" model list`
            );
            continue;
          }

          results.push({ provider, model });
        }
        return results;
      },

      isFeatureConfigured: (feature) => {
        return get().getProvidersForFeature(feature).length > 0;
      },
      
      // Legacy single-select compat (deprecated, for backward compat)
      setFeatureBinding: (feature, providerId) => {
        // 单选兼容：设置为单元素数组
        get().setFeatureBindings(feature, providerId ? [providerId] : null);
      },

      getFeatureBinding: (feature) => {
        const bindings = get().getFeatureBindings(feature);
        return bindings[0] || null;
      },

      getProviderForFeature: (feature) => {
        const providers = get().getProvidersForFeature(feature);
        return providers[0]?.provider;
      },

      // ==================== Legacy API Key management (v1 compat) ====================
      
      setApiKey: (provider, key) => {
        // Update legacy apiKeys
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        }));
        
        // Also update provider if exists
        const existingProvider = get().getProviderByPlatform(provider);
        if (existingProvider) {
          get().updateProvider({ ...existingProvider, apiKey: key });
        }
        
        console.log(`[APIConfig] Updated ${provider} API key: ${get().maskApiKey(key)}`);
      },

      getApiKey: (provider) => {
        // First check providers (v2)
        const prov = get().getProviderByPlatform(provider);
        if (prov?.apiKey) {
          // Return first key for compatibility
          const keys = parseApiKeys(prov.apiKey);
          return keys[0] || '';
        }
        // Fallback to legacy apiKeys
        return get().apiKeys[provider] || '';
      },

      clearApiKey: (provider) => {
        // Clear from legacy
        set((state) => {
          const newKeys = { ...state.apiKeys };
          delete newKeys[provider];
          return { apiKeys: newKeys };
        });
        
        // Also clear from provider if exists
        const existingProvider = get().getProviderByPlatform(provider);
        if (existingProvider) {
          get().updateProvider({ ...existingProvider, apiKey: '' });
        }
        
        console.log(`[APIConfig] Cleared ${provider} API key`);
      },

      clearAllApiKeys: () => {
        // Clear legacy
        set({ apiKeys: {} });
        
        // Clear all provider keys
        const { providers, updateProvider } = get();
        providers.forEach(p => {
          updateProvider({ ...p, apiKey: '' });
        });
        
        console.log('[APIConfig] Cleared all API keys');
      },

      // ==================== Concurrency ====================
      
      setConcurrency: (n) => {
        const value = Math.max(1, n); // 最小为1，无上限
        set({ concurrency: value });
        console.log(`[APIConfig] Set concurrency to ${value}`);
      },

      // ==================== Aspect ratio ====================
      
      setAspectRatio: (ratio) => {
        set({
          aspectRatio: ratio,
          orientation: ratio === '16:9' ? 'landscape' : 'portrait',
        });
        console.log(`[APIConfig] Set aspect ratio to ${ratio}`);
      },

      toggleOrientation: () => {
        const { aspectRatio } = get();
        const newRatio = aspectRatio === '16:9' ? '9:16' : '16:9';
        get().setAspectRatio(newRatio);
      },

      // ==================== Advanced Generation Options ====================
      
      setAdvancedOption: (key, value) => {
        set((state) => ({
          advancedOptions: { ...state.advancedOptions, [key]: value },
        }));
        console.log(`[APIConfig] Set advanced option ${key} = ${value}`);
      },

      resetAdvancedOptions: () => {
        set({ advancedOptions: { ...DEFAULT_ADVANCED_OPTIONS } });
        console.log('[APIConfig] Reset advanced options to defaults');
      },

      // ==================== Image Host Providers (independent) ====================

      addImageHostProvider: (providerData) => {
        const newProvider = normalizeImageHostProvider({
          ...providerData,
          id: generateId(),
        });
        set((state) => ({
          imageHostProviders: [...state.imageHostProviders, newProvider],
        }));
        console.log(`[APIConfig] Added image host: ${newProvider.name}`);
        return newProvider;
      },

      updateImageHostProvider: (provider) => {
        const normalizedProvider = normalizeImageHostProvider(provider);
        set((state) => ({
          imageHostProviders: state.imageHostProviders.map(p => p.id === normalizedProvider.id ? normalizedProvider : p),
        }));
        console.log(`[APIConfig] Updated image host: ${normalizedProvider.name}`);
      },

      removeImageHostProvider: (id) => {
        const provider = get().imageHostProviders.find(p => p.id === id);
        set((state) => ({
          imageHostProviders: state.imageHostProviders.filter(p => p.id !== id),
        }));
        if (provider) {
          console.log(`[APIConfig] Removed image host: ${provider.name}`);
        }
      },

      getImageHostProviderById: (id) => {
        const provider = get().imageHostProviders.find(p => p.id === id);
        return provider && isVisibleImageHostProvider(provider)
          ? normalizeImageHostProvider(provider)
          : undefined;
      },

      getEnabledImageHostProviders: () => {
        return normalizeImageHostProviders(get().imageHostProviders).filter(p => p.enabled);
      },

      isImageHostConfigured: () => {
        const providers = normalizeImageHostProviders(get().imageHostProviders);
        return providers.some(p => {
          const hasKey = parseApiKeys(p.apiKey).length > 0;
          const hasUrl = !!(p.baseUrl || p.uploadPath);
          return p.enabled && hasUrl && (p.apiKeyOptional || hasKey);
        });
      },

      // ==================== Validation ====================
      
      isConfigured: (provider) => {
        // Check v2 providers first
        const prov = get().getProviderByPlatform(provider);
        if (prov) {
          return parseApiKeys(prov.apiKey).length > 0;
        }
        // Fallback to legacy
        const key = get().apiKeys[provider];
        return !!key && key.length > 0;
      },

      isPlatformConfigured: (platform) => {
        const provider = get().getProviderByPlatform(platform);
        return !!provider && parseApiKeys(provider.apiKey).length > 0;
      },

      checkRequiredKeys: (services) => {
        const missing: string[] = [];
        const { isConfigured } = get();

        for (const service of services) {
          // Find provider for this service
          for (const [providerId, info] of Object.entries(PROVIDER_INFO)) {
            if (info.services.includes(service) && !isConfigured(providerId as ProviderId)) {
              if (!missing.includes(info.name)) {
                missing.push(info.name);
              }
            }
          }
        }

        return {
          isAllConfigured: missing.length === 0,
          missingKeys: missing,
          friendlyMessage: missing.length === 0
            ? '所有 API Key 已配置'
            : `缺少以下 API Key：${missing.join('、')}`,
        };
      },

      checkChatKeys: () => {
        return get().checkRequiredKeys(['chat']);
      },

      checkVideoGenerationKeys: () => {
        return get().checkRequiredKeys(['chat', 'image', 'video']);
      },

      // ==================== Display helpers ====================
      
      maskApiKey: (key) => {
        return maskKey(key);
      },

      getAllConfigs: () => {
        const { apiKeys, maskApiKey, isConfigured } = get();
        return (Object.keys(PROVIDER_INFO) as ProviderId[]).map((provider) => ({
          provider,
          configured: isConfigured(provider),
          masked: maskApiKey(apiKeys[provider] || ''),
        }));
      },

      // ==================== Model limits discovery ====================

      getDiscoveredModelLimits: (model) => {
        return get().discoveredModelLimits[model];
      },

      setDiscoveredModelLimits: (model, limits) => {
        set((state) => ({
          discoveredModelLimits: {
            ...state.discoveredModelLimits,
            [model]: {
              ...state.discoveredModelLimits[model],
              ...limits,
              discoveredAt: Date.now(),
            } as DiscoveredModelLimits,
          },
        }));
        console.log(`[APIConfig] Discovered model limits for ${model}:`, limits);
      },

      getModelThinkingOverride: (model) => {
        return get().modelThinkingOverrides[model];
      },

      setModelThinkingOverride: (model, enabled) => {
        set((state) => {
          const next = { ...state.modelThinkingOverrides };
          if (typeof enabled === 'boolean') {
            next[model] = enabled;
          } else {
            delete next[model];
          }
          return { modelThinkingOverrides: next };
        });
      },
    }),
    {
      name: 'opencut-api-config',  // localStorage key
      storage: createJSONStorage(getAPIConfigStorage),
      version: 17,  // v17: add per-model thinking-mode overrides (modelThinkingOverrides)
      migrate: (persistedState: unknown, version: number) => {
        // Use mutable result object for chained migration
         
        const result = { ...(persistedState as any) } as Partial<APIConfigState> & { imageHostConfig?: LegacyImageHostConfig };
        console.log(`[APIConfig] Chained migration: v${version} → v16`);
        
        // Default feature bindings for migration
        const defaultBindings: FeatureBindings = {
          script_analysis: null,
          character_generation: null,
          scene_generation: null,
          video_generation: null,
          image_understanding: null,
          chat: null,
          freedom_image: null,
          freedom_video: null,
          tts: null,
        };
        const resolveImageHostProviders = (): ImageHostProvider[] => {
          const legacyConfig = result?.imageHostConfig;
          let imageHostProviders: ImageHostProvider[] = normalizeImageHostProviders(result?.imageHostProviders || []);

          if (
            imageHostProviders.length > 0
            && !imageHostProviders.some((provider) => provider.platform === 'catbox')
            && imageHostProviders.every(isUnconfiguredDefaultImgBBProvider)
          ) {
            imageHostProviders = createDefaultImageHostProviders();
          }

          if (
            imageHostProviders.length > 0
            && !imageHostProviders.some((provider) => provider.platform === 'scdn')
            && imageHostProviders.every((provider) => (
              isUnconfiguredDefaultImgBBProvider(provider) || isUnconfiguredDefaultCatboxProvider(provider)
            ))
          ) {
            imageHostProviders = createDefaultImageHostProviders();
          }

          if (!imageHostProviders || imageHostProviders.length === 0) {
            if (legacyConfig) {
              const imgbbPreset = findImageHostPreset('imgbb');
              if (legacyConfig.type === 'imgbb' && imgbbPreset) {
                imageHostProviders = [
                  {
                    ...imgbbPreset,
                    id: generateId(),
                    apiKey: legacyConfig.imgbbApiKey || '',
                    enabled: true,
                  },
                ];
              } else if (legacyConfig.type === 'custom' && legacyConfig.custom) {
                imageHostProviders = [
                  {
                    id: generateId(),
                    platform: 'custom',
                    name: '自定义图床',
                    baseUrl: legacyConfig.custom.uploadUrl || '',
                    uploadPath: '',
                    apiKey: legacyConfig.custom.apiKey || '',
                    enabled: true,
                  },
                ];
              } else if (legacyConfig.type === 'cloudflare_r2') {
                imageHostProviders = [
                  {
                    id: generateId(),
                    platform: 'cloudflare_r2',
                    name: 'Cloudflare R2',
                    baseUrl: '',
                    uploadPath: '',
                    apiKey: '',
                    enabled: false,
                  },
                ];
              }
            }

            if (!imageHostProviders || imageHostProviders.length === 0) {
              imageHostProviders = createDefaultImageHostProviders();
            }
          }

          return normalizeImageHostProviders(imageHostProviders);
        };

        // ========== Chained migration: each step mutates `result` and falls through ==========
        
        // v0/v1 → v2: Migrate apiKeys to providers
        if (version <= 1) {
          const oldApiKeys = result?.apiKeys || {};
          const providers: IProvider[] = [];
          
          for (const template of DEFAULT_PROVIDERS) {
            const existingKey = oldApiKeys[template.platform as ProviderId] || '';
            providers.push({
              id: generateId(),
              ...template,
              apiKey: existingKey,
            });
          }
          
          console.log(`[APIConfig] v0/v1→v2: Migrated ${providers.length} providers from apiKeys`);
          result.providers = providers;
          result.featureBindings = defaultBindings;
          result.apiKeys = oldApiKeys;
          version = 2; // continue to next step
        }

        // v2 → v3: Ensure providers and featureBindings exist
        if (version <= 2) {
          result.providers = result.providers || [];
          result.featureBindings = { ...defaultBindings, ...(result.featureBindings || {}) };
          version = 3;
        }

        // v3 → v4: Ensure RunningHub model uses AppId
        if (version <= 3) {
          result.providers = (result.providers || []).map((p: IProvider) => {
            if (p.platform === 'runninghub') {
              const hasOldModel = p.model?.includes('qwen-image-edit-angles');
              const hasAppId = p.model?.includes('2009613632530812930');
              if (!p.model || p.model.length === 0 || hasOldModel || !hasAppId) {
                return { ...p, model: ['2009613632530812930'] };
              }
            }
            return p;
          });
          result.featureBindings = { ...defaultBindings, ...(result.featureBindings || {}) };
          version = 4;
        }

        // v4/v5 → v6: Convert featureBindings from string to string[] (multi-select)
        if (version <= 5) {
          const oldBindings = result.featureBindings || {};
          const newBindings: FeatureBindings = { ...defaultBindings };
          
          for (const [key, value] of Object.entries(oldBindings)) {
            const feature = key as AIFeature;
            if (typeof value === 'string' && value) {
              newBindings[feature] = [value];
              console.log(`[APIConfig] v5→v6: Migrated ${feature}: "${value}" -> ["${value}"]`);
            } else if (Array.isArray(value)) {
              newBindings[feature] = value;
            } else {
              newBindings[feature] = null;
            }
          }
          
          result.featureBindings = newBindings;
          console.log(`[APIConfig] v5→v6: Migrated featureBindings to multi-select format`);
          version = 6;
        }

        // v6 → v7: Remove deprecated providers (dik3, nanohajimi, apimart, zhipu)
        if (version <= 6) {
          const DEPRECATED_PLATFORMS = ['dik3', 'nanohajimi', 'apimart', 'zhipu'];
          const oldProviders: IProvider[] = result.providers || [];
          const cleanedProviders = oldProviders.filter(
            (p: IProvider) => !DEPRECATED_PLATFORMS.includes(p.platform)
          );
          const removedCount = oldProviders.length - cleanedProviders.length;
          if (removedCount > 0) {
            console.log(`[APIConfig] v6→v7: Removed ${removedCount} deprecated providers`);
          }
          
          const oldBindings = result.featureBindings || {};
          const cleanedBindings: FeatureBindings = { ...defaultBindings };
          for (const [key, value] of Object.entries(oldBindings)) {
            const feature = key as AIFeature;
            if (Array.isArray(value)) {
              const filtered = value.filter(
                (b: string) => !DEPRECATED_PLATFORMS.some((dp) => b.startsWith(dp + ':'))
              );
              cleanedBindings[feature] = filtered.length > 0 ? filtered : null;
            } else {
              cleanedBindings[feature] = null;
            }
          }
          
          result.providers = cleanedProviders;
          result.featureBindings = cleanedBindings;
          version = 7;
        }

        // v7 → v8: (no-op, pass through)
        if (version <= 7) {
          version = 8;
        }

        // v8 → v9: Convert platform:model bindings to id:model format
        if (version <= 8) {
          const providers: IProvider[] = result.providers || [];
          const oldBindings = result.featureBindings || {};
          const newBindings: FeatureBindings = { ...defaultBindings };
          let convertedCount = 0;
          let removedCount = 0;
          
          for (const [key, value] of Object.entries(oldBindings)) {
            const feature = key as AIFeature;
            if (!Array.isArray(value)) {
              newBindings[feature] = value ? [value as unknown as string] : null;
              continue;
            }
            const converted: string[] = [];
            for (const binding of value) {
              const idx = binding.indexOf(':');
              if (idx <= 0) { converted.push(binding); continue; }
              const platformOrId = binding.slice(0, idx);
              const model = binding.slice(idx + 1);
              
              if (providers.some(p => p.id === platformOrId)) {
                converted.push(binding);
                continue;
              }
              
              const matches = providers.filter(p => p.platform === platformOrId);
              if (matches.length === 1) {
                const newBinding = `${matches[0].id}:${model}`;
                converted.push(newBinding);
                convertedCount++;
                console.log(`[APIConfig] v8→v9: Converted binding "${binding}" -> "${newBinding}"`);
              } else if (matches.length > 1) {
                removedCount++;
                console.warn(`[APIConfig] v8→v9: Removed ambiguous binding "${binding}" (${matches.length} providers with platform "${platformOrId}")`);
              } else {
                converted.push(binding);
              }
            }
            newBindings[feature] = converted.length > 0 ? converted : null;
          }
          
          if (convertedCount > 0 || removedCount > 0) {
            console.log(`[APIConfig] v8→v9: Converted ${convertedCount} bindings, removed ${removedCount} ambiguous`);
          }
          
          result.featureBindings = newBindings;
          version = 9;
        }

        // v9 → v10: normalize image-host provider fields (pass through to resolveImageHostProviders at end)
        if (version <= 9) {
          version = 10;
        }

        // v10 → v11: switch defaults to Catbox/ImgBB (pass through to resolveImageHostProviders at end)
        if (version <= 10) {
          version = 11;
        }

        // v11 → v12: switch defaults to SCDN (pass through to resolveImageHostProviders at end)
        if (version <= 11) {
          version = 12;
        }

        // v12 → v13: Clear stale API metadata caches to force fresh sync on startup
        // This fixes the issue where cached modelEndpointTypes / modelEnableGroups / modelTypes / modelTags
        // from an old version cause incorrect API routing after an in-place upgrade (覆盖安装)
        if (version <= 12) {
          console.log(`[APIConfig] v12→v13: Clearing stale API metadata caches (modelEndpointTypes, modelTypes, modelTags, modelEnableGroups, discoveredModelLimits)`);
          result.modelEndpointTypes = {};
          result.modelTypes = {};
          result.modelTags = {};
          result.modelEnableGroups = {};
          result.discoveredModelLimits = {};
          
          // Backfill missing provider defaults without overwriting user-edited values.
          if (Array.isArray(result.providers)) {
            result.providers = result.providers.map((p: IProvider) => {
              const template = DEFAULT_PROVIDERS.find(t => t.platform === p.platform);
              if (template) {
                const updated = {
                  ...p,
                  baseUrl: p.baseUrl?.trim() ? p.baseUrl : template.baseUrl,
                  name: p.name?.trim() ? p.name : template.name,
                };
                if (updated.baseUrl !== p.baseUrl || updated.name !== p.name) {
                  console.log(`[APIConfig] v12→v13: Updated ${p.platform} baseUrl: "${p.baseUrl}" -> "${template.baseUrl}"`);
                }
                return updated;
              }
              return p;
            });
          }
          
          version = 13;
        }

        // v13 → v14: ensure Toonflow-style agent deployments and provider adapter code store exist
        if (version <= 13) {
          result.agentUseMode = result.agentUseMode || 'simple';
          result.agentDeployments = normalizeAgentDeployments(result.agentDeployments);
          result.providerAdapterCodes = result.providerAdapterCodes || [];
          result.studioBindingsMigrated = Boolean(result.studioBindingsMigrated);
          version = 14;
        }

        // v14 → v15: remove the old empty MemeFast marketing placeholder.
        if (version <= 14) {
          if (Array.isArray(result.providers)) {
            result.providers = result.providers.filter((provider: IProvider) => {
              if (provider.platform !== 'memefast') return true;
              return parseApiKeys(provider.apiKey).length > 0;
            });
          }
          version = 15;
        }

        // v15 → v16: built-in local TTS provider and Qwen3-TTS 1.7B defaults are applied in final normalization.
        if (version <= 15) {
          version = 16;
        }

        // v16 → v17: 新增 per-model 思考模式覆盖表（默认空，未配置则按名字自动判断）
        if (version <= 16) {
          if (!result.modelThinkingOverrides || typeof result.modelThinkingOverrides !== 'object') {
            result.modelThinkingOverrides = {};
          }
          version = 17;
        }

        // ========== Final normalization (always runs) ==========

        // Ensure all feature binding keys exist and normalize string → string[]
        const finalBindings: FeatureBindings = { ...defaultBindings };
        if (result.featureBindings) {
          for (const [key, value] of Object.entries(result.featureBindings)) {
            const feature = key as AIFeature;
            if (typeof value === 'string' && value) {
              finalBindings[feature] = [value];
            } else if (Array.isArray(value)) {
              finalBindings[feature] = value;
            } else {
              finalBindings[feature] = null;
            }
          }
        }
        if (!finalBindings.tts || finalBindings.tts.length === 0) {
          finalBindings.tts = [`${DEFAULT_LOCAL_TTS_PROVIDER_ID}:${DEFAULT_LOCAL_TTS_MODEL}`];
        }
        result.featureBindings = finalBindings;

        result.agentUseMode = result.agentUseMode || 'simple';
        result.agentDeployments = normalizeAgentDeployments(result.agentDeployments);
        result.providerAdapterCodes = result.providerAdapterCodes || [];
        result.studioBindingsMigrated = Boolean(result.studioBindingsMigrated);
        result.providers = ensureDefaultLocalTtsProvider(result.providers as IProvider[] | undefined | null);

        if (!result.modelThinkingOverrides || typeof result.modelThinkingOverrides !== 'object') {
          result.modelThinkingOverrides = {};
        }

        // Resolve image host providers (handles all legacy formats)
        result.imageHostProviders = resolveImageHostProviders();

        console.log(`[APIConfig] Migration complete: v${version}`);
        return result;
      },
      partialize: (state) => ({
        // Persist these fields
        providers: state.providers,
        agentUseMode: state.agentUseMode,
        agentDeployments: state.agentDeployments,
        providerAdapterCodes: state.providerAdapterCodes,
        studioBindingsMigrated: state.studioBindingsMigrated,
        featureBindings: state.featureBindings,
        apiKeys: state.apiKeys, // Keep for backward compat
        concurrency: state.concurrency,
        aspectRatio: state.aspectRatio,
        orientation: state.orientation,
        advancedOptions: state.advancedOptions,
        imageHostProviders: state.imageHostProviders,
        modelEndpointTypes: state.modelEndpointTypes,
        modelTypes: state.modelTypes,
        modelTags: state.modelTags,
        modelEnableGroups: state.modelEnableGroups,
        discoveredModelLimits: state.discoveredModelLimits,
        modelThinkingOverrides: state.modelThinkingOverrides,
      }),
    }
  )
);

// ==================== Selectors ====================

/**
 * Check if all required APIs for video generation are configured
 */
export const useIsVideoGenerationReady = (): boolean => {
  return useAPIConfigStore((state) => {
    const status = state.checkVideoGenerationKeys();
    return status.isAllConfigured;
  });
};

/**
 * Get the current concurrency setting
 */
export const useConcurrency = (): number => {
  return useAPIConfigStore((state) => state.concurrency);
};

// ==================== Model Registry Cache Injection ====================

// Inject discovery cache into model-registry (avoids circular dependency)
// This runs once when the module is loaded
injectDiscoveryCache(
  (model: string) => useAPIConfigStore.getState().getDiscoveredModelLimits(model),
  (model: string, limits: Partial<DiscoveredModelLimits>) => useAPIConfigStore.getState().setDiscoveredModelLimits(model, limits),
);
