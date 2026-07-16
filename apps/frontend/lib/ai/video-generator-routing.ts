export type VideoApiFormat = 'openai_official' | 'unified' | 'volc' | 'wan' | 'kling' | 'replicate';

export const VIDEO_FORMAT_MAP: Record<string, VideoApiFormat> = {
  'openAI官方视频格式': 'openai_official', 'openAI视频格式': 'openai_official',
  '豆包视频异步': 'volc', '异步': 'wan',
  '文生视频': 'kling', '图生视频': 'kling', '视频延长': 'kling', 'omni-video': 'kling',
  '动作控制': 'kling', '多模态视频编辑': 'kling', '数字人': 'kling', '对口型': 'kling',
  '视频特效': 'kling',
  'openai': 'unified', '视频统一格式': 'unified', 'grok视频': 'unified',
  'openai-response': 'unified', '海螺视频生成': 'unified', 'luma视频生成': 'unified',
  'luma视频扩展': 'unified', 'runway图生视频': 'unified', 'aigc-video': 'unified',
  'wan视频生成': 'unified', 'vidu文生视频': 'unified', 'vidu图生视频': 'unified',
  'vidu参考生视频': 'unified', 'vidu首尾帧': 'unified', 'luma视频延长': 'unified',
};

const UNIFIED_ENDPOINT_PATHS: Record<string, { submit: string; poll: (id: string) => string }> = {
  'grok视频': { submit: '/v1/video/create', poll: id => `/v1/video/query?id=${id}` },
  '视频统一格式': { submit: '/v1/video/create', poll: id => `/v1/video/query?id=${id}` },
  '海螺视频生成': { submit: '/minimax/v1/video_generation', poll: id => `/minimax/v1/query/video_generation?task_id=${id}` },
  'luma视频生成': { submit: '/luma/generations', poll: id => `/luma/generations/${id}` },
  'luma视频扩展': { submit: '/luma/generations', poll: id => `/luma/generations/${id}` },
  'luma视频延长': { submit: '/luma/generations', poll: id => `/luma/generations/${id}` },
  'runway图生视频': { submit: '/runwayml/v1/image_to_video', poll: id => `/runwayml/v1/tasks/${id}` },
  'wan视频生成': { submit: '/alibailian/api/v1/services/aigc/video-generation/video-synthesis', poll: id => `/alibailian/api/v1/tasks/${id}` },
  'aigc-video': { submit: '/tencent-vod/v1/aigc-video', poll: id => `/tencent-vod/v1/aigc-video/${id}` },
  'vidu文生视频': { submit: '/ent/v2/text2video', poll: id => `/ent/v2/task?task_id=${id}` },
  'vidu图生视频': { submit: '/ent/v2/img2video', poll: id => `/ent/v2/task?task_id=${id}` },
  'vidu参考生视频': { submit: '/ent/v2/reference2video', poll: id => `/ent/v2/task?task_id=${id}` },
  'vidu首尾帧': { submit: '/ent/v2/start-end2video', poll: id => `/ent/v2/task?task_id=${id}` },
};
const DEFAULT_UNIFIED_ENDPOINT = { submit: '/v1/video/generations', poll: (id: string) => `/v1/video/generations/${id}` };

export function getUnifiedEndpointPaths(endpointTypes: string[]) {
  return endpointTypes.map(type => UNIFIED_ENDPOINT_PATHS[type]).find(Boolean) ?? DEFAULT_UNIFIED_ENDPOINT;
}

export function detectVideoApiFormat(model: string, endpointTypes: string[] = []): VideoApiFormat {
  for (const format of ['openai_official', 'kling', 'volc', 'wan'] as const) {
    if (endpointTypes.some(type => VIDEO_FORMAT_MAP[type] === format)) return format;
  }
  if (endpointTypes.some(type => type.includes('/') && type.endsWith('异步'))) return 'replicate';
  if (endpointTypes.some(type => VIDEO_FORMAT_MAP[type] === 'unified')) return 'unified';
  const name = model.toLowerCase();
  if (name.includes('sora-2')) return 'openai_official';
  if (name.includes('kling')) return 'kling';
  if (name.includes('doubao') || name.includes('seedance') || name.includes('seedream')) return 'volc';
  if (name.includes('wan')) return 'wan';
  return 'unified';
}
