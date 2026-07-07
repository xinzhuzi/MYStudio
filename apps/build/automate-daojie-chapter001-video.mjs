import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const appsRoot = process.cwd();
const repoRoot = resolve(appsRoot, '..');
const generatorScript = resolve(repoRoot, 'Library', 'build_daojie_chapter001_workflow.py');
const reportPath = resolve(appsRoot, 'output', 'automation', 'daojie-chapter001-video-report.json');
const packagedAppBin = resolve(appsRoot, 'release', 'build', 'mac-arm64', 'mac-arm64', '漫影工作室.app', 'Contents', 'MacOS', '漫影工作室');
const installedAppBin = '/Applications/漫影工作室.app/Contents/MacOS/漫影工作室';
const MIN_DIALOGUE_COVERAGE_RATIO = 0.92;
const MIN_DISTINCT_VOICE_REFERENCES = 5;
const MIN_AUDIO_MEAN_VOLUME_DB = -55;
const MAX_DAOJIE_VIDEO_DURATION_SECONDS = 180;
const REQUIRED_STORYBOARD_IMAGE_MODE = 'real-ai-reference-image-workflow';
const REQUIRED_WORKFLOW_STEPS = [
  'novel_import',
  'script_generation',
  'asset_extraction',
  'asset_catalog',
  'script_plan',
  'storyboard_table',
  'frame_generation',
  'tts_generation',
  'segment_render',
  'track_candidates',
  'final_merge',
  'project_writeback',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with exit code ${result.status}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function parseGeneratorOutput(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf('\n{');
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`无法解析视频生成脚本输出: ${error instanceof Error ? error.message : String(error)}\n${trimmed}`);
  }
}

function probeVideo(filePath) {
  const result = run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,duration',
    '-of', 'json',
    filePath,
  ]);
  return JSON.parse(result.stdout);
}

function meanVolumeDb(filePath) {
  const result = run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i', filePath,
    '-af', 'volumedetect',
    '-f', 'null',
    '-',
  ]);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = output.match(/mean_volume:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*dB/);
  if (!match || match[1] === '-inf') return null;
  return Number(match[1]);
}

function loadStoryboardImageProviderConfigsFromAppSettings() {
  if (process.env.MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON) {
    return process.env.MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON;
  }
  const appBin = process.env.MYSTUDIO_IMAGE_CONFIG_APP_BIN
    || process.env.MYSTUDIO_SMOKE_APP_BIN
    || (existsSync(installedAppBin) ? installedAppBin : packagedAppBin);
  if (!existsSync(appBin)) return undefined;
  const debugPort = process.env.MYSTUDIO_IMAGE_CONFIG_DEBUG_PORT || '9395';
  const appConfigExpression = `(() => {
    const raw = localStorage.getItem('opencut-api-config');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const state = parsed.state || parsed;
    const providers = Array.isArray(state.providers) ? state.providers : [];
    const bindings = state.featureBindings?.freedom_image || state.defaultModelByCategory?.freedom_image || [];
    return bindings.map((binding) => {
      const [providerId, model] = String(binding).split(':');
      const provider = providers.find((item) => item.id === providerId);
      if (!provider || !provider.baseUrl || !provider.apiKey || !model) return null;
      return {
        providerName: provider.name || provider.id || 'freedom-image',
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model,
      };
    }).filter(Boolean);
  })()`;
const bridge = String.raw`
import { spawn } from 'node:child_process';
const appBin = process.env.MYSTUDIO_IMAGE_CONFIG_APP_BIN;
const debugPort = process.env.MYSTUDIO_IMAGE_CONFIG_DEBUG_PORT || '9395';
const appConfigExpression = ${JSON.stringify(appConfigExpression)};
const app = spawn(appBin, ['--remote-debugging-port=' + debugPort], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + ' ' + response.status);
  return response.json();
};
const waitTarget = async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await readJson('http://127.0.0.1:' + debugPort + '/json/list');
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('no app page target for opencut-api-config');
};
const cdpEval = async (wsUrl, expression) => {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const id = 1;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cdp eval timeout')), 15000);
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === id) {
        clearTimeout(timer);
        resolve(message);
      }
    });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  if (result.error) throw new Error(JSON.stringify(result.error));
  if (result.result && result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result.result.value;
};
try {
  const target = await waitTarget();
  const configs = await cdpEval(target.webSocketDebuggerUrl, appConfigExpression);
  process.stdout.write(JSON.stringify(configs));
} finally {
  app.kill('SIGTERM');
  setTimeout(() => app.kill('SIGKILL'), 3000).unref();
}
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', bridge], {
    cwd: appsRoot,
    env: {
      ...process.env,
      MYSTUDIO_IMAGE_CONFIG_APP_BIN: appBin,
      MYSTUDIO_IMAGE_CONFIG_DEBUG_PORT: debugPort,
    },
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) return undefined;
  try {
    const configs = JSON.parse(result.stdout || '[]');
    return Array.isArray(configs) && configs.length > 0 ? JSON.stringify(configs) : undefined;
  } catch {
    return undefined;
  }
}

function requireWorkflowSteps(generated) {
  const steps = Array.isArray(generated.workflowSteps) ? generated.workflowSteps : [];
  const stepIds = new Set(steps.map((step) => step?.id).filter(Boolean));
  const missing = REQUIRED_WORKFLOW_STEPS.filter((step) => !stepIds.has(step));
  if (missing.length > 0) {
    throw new Error(`工作流步骤未完成: ${missing.join(', ')}`);
  }
  const failed = steps.filter((step) => REQUIRED_WORKFLOW_STEPS.includes(step?.id) && step.ok !== true);
  if (failed.length > 0) {
    throw new Error(
      `工作流步骤未完成: ${failed
        .map((step) => `${step.id}${step.evidence ? `(${step.evidence})` : ''}`)
        .join(', ')}`,
    );
  }
}

function writeFailureReport(generated, error) {
  const storyboardImageGenerationMode =
    generated?.storyboardImageGenerationMode ||
    generated?.imageGenerationMode ||
    REQUIRED_STORYBOARD_IMAGE_MODE;
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    command: 'npm run video:daojie:chapter001',
    generatorScript,
    finalVideo: generated?.final,
    storyboards: generated?.storyboards,
    storyboardSourceSegments: generated?.storyboardSourceSegments,
    totalStoryboardDuration: generated?.totalStoryboardDuration,
    storyboardsWithAssetLinks: generated?.storyboardsWithAssetLinks,
    assetLinks: generated?.assetLinks,
    storyboardImageGenerationMode,
    imageGenerationMode: generated?.imageGenerationMode,
    imageGenerationProvider: generated?.imageGenerationProvider,
    generatedFrameImages: generated?.generatedFrameImages,
    framesWithRealAssetImages: generated?.framesWithRealAssetImages,
    storyboardImageWorkflowManifest: generated?.storyboardImageWorkflowManifest,
    error,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (!existsSync(generatorScript)) {
  throw new Error(`视频生成脚本不存在: ${generatorScript}`);
}

let generated;
try {
  const storyboardImageProviderConfigs = loadStoryboardImageProviderConfigsFromAppSettings();
  generated = parseGeneratorOutput(run('python3', [generatorScript], {
    env: {
      MANYING_REQUIRE_REAL_TTS: '1',
      MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE: REQUIRED_STORYBOARD_IMAGE_MODE,
      ...(storyboardImageProviderConfigs && { MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON: storyboardImageProviderConfigs }),
    },
  }).stdout);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeFailureReport(null, `生成器执行失败: ${message}`);
  throw error;
}
const finalVideo = generated.final;
if (!finalVideo || !existsSync(finalVideo)) {
  throw new Error(`最终视频不存在: ${finalVideo || 'missing'}`);
}
requireWorkflowSteps(generated);
if (generated.storyboardsWithAssetLinks !== generated.storyboards) {
  throw new Error(`分镜资产链接不完整: ${generated.storyboardsWithAssetLinks ?? 0}/${generated.storyboards ?? 0}`);
}
if (!(Number(generated.assetLinks) > 0)) {
  throw new Error('分镜未关联塑角/造景/道具资产');
}
const expectedStoryboardSegments = Number(generated.storyboardSourceSegments ?? generated.storyboards);
if (!(expectedStoryboardSegments > 0)) {
  throw new Error(`没有解析到可生成的分镜片段: ${generated.storyboardSourceSegments ?? 'missing'}`);
}
if (Number(generated.storyboards) !== expectedStoryboardSegments) {
  throw new Error(`分镜数量必须按片段生成: ${generated.storyboards ?? 0}/${expectedStoryboardSegments}`);
}
if (generated.framesWithRealAssetImages !== generated.storyboards) {
  throw new Error(`分镜真实资产图片不完整: ${generated.framesWithRealAssetImages ?? 0}/${generated.storyboards ?? 0}`);
}
const storyboardImageGenerationMode = generated.storyboardImageGenerationMode || generated.imageGenerationMode;
if (storyboardImageGenerationMode === 'asset-composite') {
  const error = 'storyboardImageGenerationMode=asset-composite 不能作为 Toonflow 式分镜图生成验收；它只允许用于 fallback/smoke 路径';
  writeFailureReport(generated, error);
  throw new Error(error);
}
if (storyboardImageGenerationMode !== 'real-ai-reference-image-workflow') {
  throw new Error(`分镜图生成模式异常: ${storyboardImageGenerationMode || 'missing'}`);
}
if (!Array.isArray(generated.derivedAssetPlan) || generated.derivedAssetPlan.length === 0) {
  throw new Error(`衍生资产预划缺失: ${generated.derivedAssetPlan?.length ?? 0}`);
}
for (const item of generated.derivedAssetPlan) {
  if (!item?.parentAssetId || !item?.state || !item?.reason) {
    throw new Error(`衍生资产预划字段不完整: ${JSON.stringify(item)}`);
  }
}
if (!Array.isArray(generated.derivedAssetManifest) || generated.derivedAssetManifest.length !== generated.derivedAssetPlan.length) {
  throw new Error(`衍生资产落地明细缺失: ${generated.derivedAssetManifest?.length ?? 0}/${generated.derivedAssetPlan.length}`);
}
for (const item of generated.derivedAssetManifest) {
  for (const [label, filePath] of Object.entries({
    sourceImagePath: item?.sourceImagePath,
    resultImagePath: item?.resultImagePath,
  })) {
    if (!filePath || !existsSync(filePath)) {
      throw new Error(`衍生资产图片不存在: ${item?.derivedAssetId || 'missing'} / ${label} / ${filePath || 'missing'}`);
    }
  }
  if (!item?.parentAssetId || !item?.derivedAssetId || !item?.imageWorkflowId || !item?.imageWorkflowNodeId || !item?.assetType) {
    throw new Error(`衍生资产落地字段不完整: ${JSON.stringify(item)}`);
  }
}
if (generated.generatedFrameImages !== generated.storyboards) {
  throw new Error(`分镜图片生成数量异常: ${generated.generatedFrameImages ?? 0}/${generated.storyboards ?? 0}`);
}
if (!Array.isArray(generated.storyboardMediaManifest) || generated.storyboardMediaManifest.length !== generated.storyboards) {
  throw new Error(`分镜媒体明细缺失: ${generated.storyboardMediaManifest?.length ?? 0}/${generated.storyboards ?? 0}`);
}
for (const item of generated.storyboardMediaManifest) {
  for (const [label, filePath] of Object.entries({
    framePath: item?.framePath,
    audioPath: item?.audioPath,
    segmentPath: item?.segmentPath,
    voiceReferenceAudioPath: item?.voiceReferenceAudioPath,
  })) {
    if (!filePath || !existsSync(filePath)) {
      throw new Error(`分镜媒体明细文件不存在: ${item?.storyboardId || 'missing'} / ${label} / ${filePath || 'missing'}`);
    }
  }
  if (!Array.isArray(item.imageAssetPaths) || item.imageAssetPaths.length === 0) {
    throw new Error(`分镜媒体明细缺少资产图片: ${item?.storyboardId || 'missing'}`);
  }
  for (const imagePath of item.imageAssetPaths) {
    if (!existsSync(imagePath)) {
      throw new Error(`分镜资产图片不存在: ${item?.storyboardId || 'missing'} / ${imagePath}`);
    }
  }
}
if (!Array.isArray(generated.storyboardImageWorkflowManifest) || generated.storyboardImageWorkflowManifest.length !== generated.storyboards) {
  throw new Error(`分镜图片工作流明细缺失: ${generated.storyboardImageWorkflowManifest?.length ?? 0}/${generated.storyboards ?? 0}`);
}
for (const item of generated.storyboardImageWorkflowManifest) {
  const referenceNodes = Array.isArray(item?.referenceNodes) ? item.referenceNodes : [];
  const generatedNodeId = item?.generatedNodeId;
  const edges = Array.isArray(item?.referenceToGeneratedEdges) ? item.referenceToGeneratedEdges : [];
  if (!item?.flowId || !item?.targetStoryboardId || !generatedNodeId || !item?.resultUrl) {
    throw new Error(`分镜图片工作流字段不完整: ${JSON.stringify(item)}`);
  }
  if (referenceNodes.length === 0) {
    throw new Error(`分镜图片工作流缺少参考节点: ${item.flowId}`);
  }
  const edgeKeys = new Set(edges.map((edge) => `${edge?.source}->${edge?.target}`));
  for (const referenceNode of referenceNodes) {
    if (!referenceNode?.id || !referenceNode?.assetId || !referenceNode?.assetType || !referenceNode?.imageUrl) {
      throw new Error(`分镜图片工作流参考节点字段不完整: ${JSON.stringify(referenceNode)}`);
    }
    if (!edgeKeys.has(`${referenceNode.id}->${generatedNodeId}`)) {
      throw new Error(`分镜图片工作流缺少参考图到生成图连线: ${item.flowId} / ${referenceNode.id}->${generatedNodeId}`);
    }
  }
}
if (!(Number(generated.matchedAssetImages) > 0)) {
  throw new Error(`没有匹配到可用于合成的资产图片: ${generated.matchedAssetImages ?? 'missing'}`);
}
if (!Array.isArray(generated.assetImageManifest) || generated.assetImageManifest.length < Number(generated.matchedAssetImages || 0)) {
  throw new Error(`资产图片明细缺失: ${generated.assetImageManifest?.length ?? 0}/${generated.matchedAssetImages ?? 0}`);
}
for (const item of generated.assetImageManifest) {
  if (!item?.imagePath || !existsSync(item.imagePath)) {
    throw new Error(`资产图片明细文件不存在: ${item?.assetName || 'missing'} / ${item?.imagePath || 'missing'}`);
  }
}
if (!Array.isArray(generated.trackCandidateManifest) || generated.trackCandidateManifest.length !== Number(generated.tracks || 0)) {
  throw new Error(`生产轨候选明细缺失: ${generated.trackCandidateManifest?.length ?? 0}/${generated.tracks ?? 0}`);
}
for (const item of generated.trackCandidateManifest) {
  if (!(Number(item?.storyboardCount) > 0) || !Array.isArray(item?.candidateFiles) || item.candidateFiles.length === 0) {
    throw new Error(`生产轨候选明细异常: ${JSON.stringify(item)}`);
  }
  for (const filePath of item.candidateFiles) {
    if (!existsSync(filePath)) {
      throw new Error(`生产轨候选视频不存在: ${item.trackId || 'missing'} / ${filePath}`);
    }
  }
}
if (Array.isArray(generated.missingImageAssets) && generated.missingImageAssets.length > 0) {
  throw new Error(`存在未命中的图片资产: ${generated.missingImageAssets.join(', ')}`);
}
if (!generated.voiceReferenceAudioPath || !existsSync(generated.voiceReferenceAudioPath)) {
  throw new Error(`未绑定资产库音色参考: ${generated.voiceReferenceAudioPath || 'missing'}`);
}
if (!(Number(generated.dialogueCoverageRatio) >= MIN_DIALOGUE_COVERAGE_RATIO)) {
  throw new Error(`台词覆盖率过低: ${generated.dialogueCoverageRatio ?? 'missing'}/${MIN_DIALOGUE_COVERAGE_RATIO}`);
}
if (!generated.speakerVoiceMap || typeof generated.speakerVoiceMap !== 'object') {
  throw new Error('缺少 speakerVoiceMap 报告字段');
}
const voiceReferencePaths = new Set(Object.values(generated.speakerVoiceMap).map((item) => item?.voiceReferenceAudioPath).filter(Boolean));
if (voiceReferencePaths.size < MIN_DISTINCT_VOICE_REFERENCES) {
  throw new Error(`角色音色映射不足: ${voiceReferencePaths.size}/${MIN_DISTINCT_VOICE_REFERENCES}`);
}
for (const [speaker, voiceProfile] of Object.entries(generated.speakerVoiceMap)) {
  if (!voiceProfile?.voiceReferenceAudioPath || !existsSync(voiceProfile.voiceReferenceAudioPath)) {
    throw new Error(`角色音色参考不存在: ${speaker} / ${voiceProfile?.voiceReferenceAudioPath || 'missing'}`);
  }
}
if (!generated.speakerAudioStats || typeof generated.speakerAudioStats !== 'object') {
  throw new Error('角色音频统计缺失');
}
if (!generated.speakerAudioSamples || typeof generated.speakerAudioSamples !== 'object') {
  throw new Error('角色音频样本缺失');
}
for (const [speaker, stats] of Object.entries(generated.speakerAudioStats)) {
  if (!(Number(stats?.lines) > 0) || !(Number(stats?.audioFiles) > 0)) {
    throw new Error(`角色音频统计异常: ${speaker} / ${JSON.stringify(stats)}`);
  }
  const sample = generated.speakerAudioSamples[speaker];
  if (!sample?.path || !existsSync(sample.path) || !(Number(sample.duration) > 0)) {
    throw new Error(`角色音频样本异常: ${speaker} / ${JSON.stringify(sample)}`);
  }
  if (!generated.ttsMode.includes('silent-visual-preview') && !(Number(sample.meanVolumeDb) >= MIN_AUDIO_MEAN_VOLUME_DB)) {
    throw new Error(`角色音频样本音量过低: ${speaker} / ${JSON.stringify(sample)}`);
  }
}
if (Array.isArray(generated.missingVoiceProfiles) && generated.missingVoiceProfiles.length > 0) {
  throw new Error(`存在未绑定角色音色: ${generated.missingVoiceProfiles.join(', ')}`);
}
if (!generated.ttsMode) {
  throw new Error('缺少 ttsMode 报告字段');
}
if (!generated.ttsBackend) {
  throw new Error('缺少 ttsBackend 报告字段');
}
if (!generated.voiceEmotionProfile) {
  throw new Error('缺少 voiceEmotionProfile 报告字段');
}
if (generated.ttsMocked) {
  throw new Error(`TTS 返回 mock 音频，不能作为最终音频: ${JSON.stringify(generated.ttsWarnings ?? [])}`);
}
if (generated.ttsMode.includes('fallback-system-voice') && process.env.MYSTUDIO_ALLOW_TTS_FALLBACK !== '1') {
  throw new Error('不能使用系统朗读 fallback 作为最终音频；如只做预览，显式设置 MYSTUDIO_ALLOW_TTS_FALLBACK=1');
}
if (generated.ttsMode.includes('silent-visual-preview') && process.env.MYSTUDIO_DAOJIE_SILENT_PREVIEW !== '1') {
  throw new Error('不能使用静音视觉预览作为最终音频；如只做画面检查，显式设置 MYSTUDIO_DAOJIE_SILENT_PREVIEW=1');
}
if (!Array.isArray(generated.assetImagePaths) || generated.assetImagePaths.length === 0) {
  throw new Error('视频没有使用任何真实资产图片');
}
for (const assetImagePath of generated.assetImagePaths) {
  if (!existsSync(assetImagePath)) {
    throw new Error(`真实资产图片不存在: ${assetImagePath}`);
  }
  if (!(statSync(assetImagePath).size > 0)) {
    throw new Error(`真实资产图片为空: ${assetImagePath}`);
  }
}
if (generated.frameSize?.width !== 1920 || generated.frameSize?.height !== 1080) {
  throw new Error(`分镜画面尺寸错误: ${generated.frameSize?.width ?? 'missing'}x${generated.frameSize?.height ?? 'missing'}`);
}

const probe = probeVideo(finalVideo);
const streams = Array.isArray(probe.streams) ? probe.streams : [];
const videoStream = streams.find((stream) => stream.codec_type === 'video');
const audioStream = streams.find((stream) => stream.codec_type === 'audio');
const finalVideoDuration = Number(probe.format?.duration ?? 0);
const audioDuration = Number(audioStream?.duration ?? 0);

if (!videoStream) throw new Error('最终视频缺少 video stream');
if (!audioStream) throw new Error('最终视频缺少 audio stream');
if (!(finalVideoDuration > 0)) throw new Error(`最终视频 duration 异常: ${probe.format?.duration ?? 'missing'}`);
if (finalVideoDuration > MAX_DAOJIE_VIDEO_DURATION_SECONDS) {
  throw new Error(`最终视频时长超过3分钟规格: ${finalVideoDuration.toFixed(2)}s/${MAX_DAOJIE_VIDEO_DURATION_SECONDS}s`);
}
if (!(audioDuration > 0)) throw new Error(`最终视频 audio duration 异常: ${audioStream?.duration ?? 'missing'}`);
if (!generated.finalVideoEvidence || generated.finalVideoEvidence.path !== finalVideo || !existsSync(generated.finalVideoEvidence.path)) {
  throw new Error(`最终视频证据缺失: ${JSON.stringify(generated.finalVideoEvidence ?? null)}`);
}
if (!(Number(generated.finalVideoEvidence.sizeBytes) > 0) || !/^[a-f0-9]{64}$/.test(String(generated.finalVideoEvidence.sha256 || ''))) {
  throw new Error(`最终视频证据异常: ${JSON.stringify(generated.finalVideoEvidence)}`);
}
const finalAudioMeanVolumeDb = meanVolumeDb(finalVideo);
if (!generated.ttsMode.includes('silent-visual-preview') && !(Number(finalAudioMeanVolumeDb) >= MIN_AUDIO_MEAN_VOLUME_DB)) {
  throw new Error(`最终视频音量过低: ${finalAudioMeanVolumeDb ?? 'missing'} dB`);
}

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  command: 'npm run video:daojie:chapter001',
  generatorScript,
  finalVideo,
  storyboards: generated.storyboards,
  storyboardSourceSegments: generated.storyboardSourceSegments,
  totalStoryboardDuration: generated.totalStoryboardDuration,
  targetDurationSeconds: generated.targetDurationSeconds,
  scriptTextChars: generated.scriptTextChars,
  spokenTextChars: generated.spokenTextChars,
  dialogueCoverageRatio: generated.dialogueCoverageRatio,
  storyboardsWithAssetLinks: generated.storyboardsWithAssetLinks,
  assetLinks: generated.assetLinks,
  storyboardImageGenerationMode,
  imageGenerationMode: generated.imageGenerationMode,
  imageGenerationProvider: generated.imageGenerationProvider,
  derivedAssetPlan: generated.derivedAssetPlan,
  derivedAssetManifest: generated.derivedAssetManifest,
  generatedFrameImages: generated.generatedFrameImages,
  matchedAssetImages: generated.matchedAssetImages,
  framesWithRealAssetImages: generated.framesWithRealAssetImages,
  assetImagePaths: generated.assetImagePaths,
  storyboardMediaManifest: generated.storyboardMediaManifest,
  storyboardImageWorkflowManifest: generated.storyboardImageWorkflowManifest,
  assetImageManifest: generated.assetImageManifest,
  trackCandidateManifest: generated.trackCandidateManifest,
  missingImageAssets: generated.missingImageAssets,
  workflowSteps: generated.workflowSteps,
  voiceReferenceAudioPath: generated.voiceReferenceAudioPath,
  speakerVoiceMap: generated.speakerVoiceMap,
  speakerAudioStats: generated.speakerAudioStats,
  speakerAudioSamples: generated.speakerAudioSamples,
  missingVoiceProfiles: generated.missingVoiceProfiles,
  finalVideoEvidence: generated.finalVideoEvidence,
  finalVideoDuration,
  finalAudioMeanVolumeDb,
  ttsMode: generated.ttsMode,
  ttsBackend: generated.ttsBackend,
  ttsMocked: generated.ttsMocked,
  ttsWarnings: generated.ttsWarnings,
  voiceEmotionProfile: generated.voiceEmotionProfile,
  frameSize: generated.frameSize,
  tracks: generated.tracks,
  videoCandidates: generated.videoCandidates,
  streams,
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
