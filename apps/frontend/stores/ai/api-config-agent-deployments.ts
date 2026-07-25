import type { IProvider } from "@/lib/api-key-manager";
import {
  DEFAULT_LOCAL_TTS_MODEL,
  DEFAULT_LOCAL_TTS_PROVIDER_ID,
} from "./api-config-provider-helpers";

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
    desc: '兼容旧版绑定；新流程优先使用策划编剧下的故事骨架Agent',
    temperature: 0.6,
    maxOutputTokens: 4096,
  },
  {
    key: 'adaptationStrategyAgent',
    name: '改编策略兼容入口',
    desc: '兼容旧版绑定；新流程优先使用策划编剧下的改编策略Agent',
    temperature: 0.7,
    maxOutputTokens: 4096,
  },
  {
    key: 'scriptDraft',
    name: '剧本草稿兼容入口',
    desc: '兼容旧版绑定；新流程优先使用策划编剧下的剧本执行Agent',
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
    label: '策划编剧',
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

export function normalizeAgentDeployments(
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



