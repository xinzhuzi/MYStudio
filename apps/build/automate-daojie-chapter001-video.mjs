import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const appsRoot = process.cwd();
const repoRoot = resolve(appsRoot, '..');
const generatorScript = resolve(repoRoot, 'Library', 'build_daojie_chapter001_workflow.py');
const timelineRunnerScript = 'build/render-daojie-editing-timeline.ts';
const storyboardImageHelper = resolve(appsRoot, 'build', 'generate-storyboard-image.mjs');
const viteNodeBin = './node_modules/.bin/vite-node';
const reportPath = resolve(appsRoot, 'output', 'automation', 'daojie-chapter001-video-report.json');
const packagedAppBin = resolve(appsRoot, 'release', 'build', 'mac-arm64', 'mac-arm64', '漫影工作室.app', 'Contents', 'MacOS', '漫影工作室');
const installedAppBin = '/Applications/漫影工作室.app/Contents/MacOS/漫影工作室';
const skipPrekill = process.env.MYSTUDIO_SMOKE_SKIP_PREKILL === '1';
const probeProvidersOnly = process.argv.includes('--probe-providers');
const probeGenerationOnly = process.argv.includes('--probe-generation');
const MIN_DIALOGUE_COVERAGE_RATIO = 0.92;
const MIN_AUDIO_MEAN_VOLUME_DB = -55;
const MAX_DAOJIE_VIDEO_DURATION_SECONDS = 180;
const MIN_DAOJIE_DIRECTOR_PLAN_CHARS = 4500;
const MIN_DAOJIE_DIRECTOR_PLAN_CHINESE_CHARS = 2500;
const MIN_DAOJIE_DIRECTOR_PLAN_H2_SECTIONS = 6;
const EXPECTED_DAOJIE_DIRECTOR_PLAN_SCENES = 5;
const MIN_DAOJIE_DIRECTOR_PLAN_BULLETS = 50;
const REQUIRED_STORYBOARD_IMAGE_MODE = 'real-ai-reference-image-workflow';
const REQUIRED_DAOJIE_DIRECTOR_PLAN_SECTIONS = [
  '## ① 主题立意与叙事核心',
  '## ② 视觉风格与画面基调',
  '## ③ 叙事结构与节奏规划',
  '## ④ 分场景情绪与画面意图',
  '## ⑤ 声音方向',
  '## ⑥ 转场与视觉连续性',
];
const REQUIRED_DAOJIE_DIRECTOR_PLAN_SCENES = ['Sc 1-1', 'Sc 1-2', 'Sc 1-3', 'Sc 1-4', 'Sc 1-5'];
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

function runOptional(command, args) {
  spawnSync(command, args, {
    cwd: appsRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'ignore',
  });
}

function stopExistingMYStudioInstances() {
  if (skipPrekill) {
    console.log('[video] skipping pre-run MYStudio instance cleanup');
    return;
  }
  if (process.platform === 'darwin') {
    runOptional('osascript', [
      '-e',
      'tell application id "com.manju2026.manying-studio" to quit',
    ]);
  }
  for (const processName of [
    '漫影工作室',
    '漫影工作室 Helper',
    'manying-studio',
  ]) {
    runOptional('pkill', ['-x', processName]);
  }
  runOptional('pkill', ['-f', '漫影工作室.app/Contents']);
  console.log('[video] closed existing MYStudio instances before Daojie video generation');
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

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function directorPlanAuditFields(generated) {
  return {
    directorPlanChars: generated?.directorPlanChars,
    directorPlanChineseChars: generated?.directorPlanChineseChars,
    directorPlanH2Sections: generated?.directorPlanH2Sections,
    directorPlanSceneSections: generated?.directorPlanSceneSections,
    directorPlanBulletCount: generated?.directorPlanBulletCount,
    directorPlanRequiredSectionsPresent: generated?.directorPlanRequiredSectionsPresent,
    directorPlanRequiredSceneSectionsPresent: generated?.directorPlanRequiredSceneSectionsPresent,
    directorPlanStructuredSceneIntents: generated?.directorPlanStructuredSceneIntents,
    directorPlanStructuredSceneIntentsComplete: generated?.directorPlanStructuredSceneIntentsComplete,
    directorPlanHasDerivedAssetSection: generated?.directorPlanHasDerivedAssetSection,
  };
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
const app = spawn(appBin, ['--remote-debugging-port=' + debugPort], {
  env: {
    ...process.env,
    MYSTUDIO_SMOKE: '1',
    MYSTUDIO_SMOKE_BACKGROUND: '1',
  },
  stdio: ['ignore', 'ignore', 'ignore'],
});
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

function parseImageApiKeys(apiKey, apiKeys = []) {
  const raw = [];
  if (Array.isArray(apiKeys)) raw.push(...apiKeys);
  if (apiKey) raw.push(apiKey);
  return [...new Set(raw
    .flatMap((value) => String(value || '').split(/[,\n]/))
    .map((value) => value.trim())
    .filter(Boolean))];
}

function redactProbeText(value) {
  return String(value || '')
    .replace(/Bearer\s+[^\r\n"]+/gi, 'Bearer <redacted>')
    .replace(/sk-[A-Za-z0-9_\-.]{8,}/gi, 'sk-<redacted>')
    .replace(/[A-Za-z0-9_-]{24,}/g, '<redacted>');
}

function normalizeProbeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '').replace(/\/v\d+$/, '');
}

function normalizeProviderConfigsForProbe(rawConfigJson) {
  if (!rawConfigJson) return [];
  const parsed = JSON.parse(rawConfigJson);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((provider) => {
    const apiKeys = parseImageApiKeys(provider.apiKey, provider.apiKeys);
    return {
      providerName: provider.providerName || provider.name || 'freedom-image',
      baseUrl: provider.baseUrl || provider.baseURL || '',
      model: provider.model || '',
      apiKeys,
    };
  }).filter((provider) => provider.baseUrl && provider.model && provider.apiKeys.length > 0);
}

async function probeImageProviderModels(provider) {
  let host = '';
  try {
    host = new URL(provider.baseUrl).host;
  } catch {
    host = '';
  }
  const result = {
    providerName: provider.providerName,
    host,
    model: provider.model,
    keyCount: provider.apiKeys.length,
    modelsEndpointStatus: 'not-run',
    modelCount: null,
    error: '',
  };
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(new Error('models probe timeout')), 8000);
    const response = await fetch(`${normalizeProbeBaseUrl(provider.baseUrl)}/v1/models`, {
      headers: { Authorization: `Bearer ${provider.apiKeys[0]}` },
      signal: controller.signal,
    });
    result.modelsEndpointStatus = String(response.status);
    const text = await response.text();
    if (!response.ok) {
      result.error = redactProbeText(text).slice(0, 300);
      return result;
    }
    try {
      const data = JSON.parse(text);
      result.modelCount = Array.isArray(data.data) ? data.data.length : null;
    } catch {
      result.error = 'non-json models response';
    }
  } catch (error) {
    result.error = redactProbeText(error instanceof Error ? error.message : String(error)).slice(0, 300);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return result;
}

async function runImageProviderProbe() {
  const configsJson = loadStoryboardImageProviderConfigsFromAppSettings();
  const providers = normalizeProviderConfigsForProbe(configsJson);
  const probes = [];
  for (const provider of providers) {
    probes.push(await probeImageProviderModels(provider));
  }
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    command: 'npm run video:daojie:chapter001:probe-providers',
    mode: 'provider-models-only',
    generatedImages: 0,
    generationEndpointCalled: false,
    providerCount: providers.length,
    probes,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  const probeReportPath = resolve(appsRoot, 'output', 'automation', 'daojie-chapter001-provider-probe-report.json');
  writeFileSync(probeReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, reportPath: probeReportPath }, null, 2));
}

function probeReferenceDataUrl(referencePath) {
  if (!referencePath || !existsSync(referencePath)) {
    throw new Error(`真实生图探针参考图不存在: ${referencePath || 'MYSTUDIO_IMAGE_PROBE_REFERENCE_PATH 未设置'}`);
  }
  const mimeType = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }[extname(referencePath).toLowerCase()];
  if (!mimeType) throw new Error(`真实生图探针不支持该参考图格式: ${extname(referencePath)}`);
  return `data:${mimeType};base64,${readFileSync(referencePath).toString('base64')}`;
}

async function saveProbeImage(imageUrl, outputPath) {
  if (imageUrl.startsWith('data:image/')) {
    const commaIndex = imageUrl.indexOf(',');
    if (commaIndex < 0) throw new Error('真实生图探针返回了无效 data URL');
    writeFileSync(outputPath, Buffer.from(imageUrl.slice(commaIndex + 1), 'base64'));
    return;
  }
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`真实生图探针结果下载失败: HTTP ${response.status}`);
  writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function runImageGenerationProbe() {
  const configsJson = loadStoryboardImageProviderConfigsFromAppSettings();
  const providers = normalizeProviderConfigsForProbe(configsJson);
  if (providers.length === 0) throw new Error('真实生图探针没有读取到 freedom_image provider 配置');
  const referencePath = process.env.MYSTUDIO_IMAGE_PROBE_REFERENCE_PATH || '';
  const referenceImages = [probeReferenceDataUrl(referencePath)];
  const prompt = process.env.MYSTUDIO_IMAGE_PROBE_PROMPT || [
    '基于参考图中的同一角色，生成无文字的角色连续性设定板。',
    '身份事实：成年男性，清瘦如剑，冷峻面容，银白长发半束高髻，洗旧灰色剑袍，右肩旧裂痕，腰间归元古剑。',
    '同一画面从左到右严格排列正面、左侧面、背面三个全身正交视图；同一身高、体型、脸、发型、服装和武器，双手自然下垂，脚部完整。',
    '彩色水墨国风，工笔线描锁定脸、手、发丝、衣褶与古剑结构，宣纸矿物淡彩，灰袍保持设定，旧金剑饰与克制石青、赭石环境色形成可辨层次。',
    '纯净浅色设定板背景，不要文字、标签、边框、水印、额外人物、重复姿态、镜像复制、透视夸张、错误手指或武器穿身。',
  ].join(' ');
  const helperPayload = {
    providers: providers.map((provider) => ({
      providerName: provider.providerName,
      baseUrl: provider.baseUrl,
      apiKeys: provider.apiKeys,
      model: provider.model,
      aspectRatio: '4:3',
      resolution: '1K',
      timeoutSeconds: 360,
    })),
    prompt,
    referenceImages,
    aspectRatio: '4:3',
    resolution: '1K',
    timeoutSeconds: 360,
  };
  const result = spawnSync('node', [storyboardImageHelper], {
    cwd: appsRoot,
    input: JSON.stringify(helperPayload),
    encoding: 'utf8',
    timeout: 420000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`真实生图探针失败: ${redactProbeText(result.stderr || result.stdout).slice(0, 600)}`);
  }
  const parsed = JSON.parse(result.stdout || '{}');
  const imageUrl = String(parsed.url || parsed.imageUrl || '');
  if (!imageUrl) throw new Error('真实生图探针没有返回图片');
  const outputDir = resolve(appsRoot, 'output', 'automation', 'daojie-chapter001-generation-probe');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, 'dugu-turnaround-probe.png');
  await saveProbeImage(imageUrl, outputPath);
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    command: 'npm run video:daojie:chapter001:probe-generation',
    mode: 'real-generation-with-reference',
    generationEndpointCalled: true,
    generatedImages: 1,
    referenceImageCount: 1,
    referencePath,
    prompt,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    outputPath,
    outputSha256: sha256File(outputPath),
    outputSizeBytes: statSync(outputPath).size,
    providers: providers.map((provider) => ({
      providerName: provider.providerName,
      host: new URL(provider.baseUrl).host,
      model: provider.model,
      keyCount: provider.apiKeys.length,
    })),
  };
  const generationProbeReportPath = resolve(appsRoot, 'output', 'automation', 'daojie-chapter001-generation-probe-report.json');
  writeFileSync(generationProbeReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, reportPath: generationProbeReportPath }, null, 2));
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

function requireStoryboardPromptIntegrity(generated) {
  const storyboardCount = Number(generated.storyboards);
  const manifest = Array.isArray(generated.storyboardPromptManifest) ? generated.storyboardPromptManifest : [];
  if (manifest.length !== storyboardCount) {
    throw new Error(`分镜提示词审计明细缺失: ${manifest.length}/${storyboardCount}`);
  }
  const requiredCounts = [
    ['storyboardPromptsWithReferenceBindings', '分镜提示词参考图绑定不完整'],
    ['storyboardPromptsWithDaojieStyleLock', '分镜提示词道劫风格锁不完整'],
    ['storyboardPromptsWithLightSection', '分镜提示词光影段不完整'],
  ];
  for (const [field, message] of requiredCounts) {
    if (Number(generated[field]) !== storyboardCount) {
      throw new Error(`${message}: ${generated[field] ?? 'missing'}/${storyboardCount}`);
    }
  }
  if (Number(generated.storyboardPromptsWithMissingVisibleCharacterRefs || 0) !== 0) {
    throw new Error(`分镜可见角色缺少参考图: ${JSON.stringify(generated.storyboardPromptMissingVisibleCharacterRefs || [])}`);
  }
  if (Number(generated.storyboardPromptsWithRawAssetNameLeaks || 0) !== 0) {
    throw new Error(`分镜画面段仍泄漏原始资产名: ${JSON.stringify(generated.storyboardPromptRawAssetNameLeaks || [])}`);
  }
}

function requireDirectorPlanIntegrity(generated) {
  if (Number(generated.directorPlanChars) < MIN_DAOJIE_DIRECTOR_PLAN_CHARS) {
    throw new Error(`导演规划正文过短: ${generated.directorPlanChars ?? 'missing'}/${MIN_DAOJIE_DIRECTOR_PLAN_CHARS}`);
  }
  if (Number(generated.directorPlanChineseChars) < MIN_DAOJIE_DIRECTOR_PLAN_CHINESE_CHARS) {
    throw new Error(`导演规划中文有效字数过少: ${generated.directorPlanChineseChars ?? 'missing'}/${MIN_DAOJIE_DIRECTOR_PLAN_CHINESE_CHARS}`);
  }
  if (Number(generated.directorPlanH2Sections) < MIN_DAOJIE_DIRECTOR_PLAN_H2_SECTIONS) {
    throw new Error(`导演规划二级章节不足: ${generated.directorPlanH2Sections ?? 'missing'}/${MIN_DAOJIE_DIRECTOR_PLAN_H2_SECTIONS}`);
  }
  if (Number(generated.directorPlanSceneSections) !== EXPECTED_DAOJIE_DIRECTOR_PLAN_SCENES) {
    throw new Error(`导演规划 Sc 场景段必须为 ${EXPECTED_DAOJIE_DIRECTOR_PLAN_SCENES}: ${generated.directorPlanSceneSections ?? 'missing'}`);
  }
  if (Number(generated.directorPlanBulletCount) < MIN_DAOJIE_DIRECTOR_PLAN_BULLETS) {
    throw new Error(`导演规划 bullet 细项不足: ${generated.directorPlanBulletCount ?? 'missing'}/${MIN_DAOJIE_DIRECTOR_PLAN_BULLETS}`);
  }

  const requiredSections = generated.directorPlanRequiredSectionsPresent || {};
  const missingSections = REQUIRED_DAOJIE_DIRECTOR_PLAN_SECTIONS.filter((section) => requiredSections[section] !== true);
  if (missingSections.length > 0) {
    throw new Error(`导演规划缺少必需章节: ${missingSections.join(', ')}`);
  }

  const requiredScenes = generated.directorPlanRequiredSceneSectionsPresent || {};
  const missingScenes = REQUIRED_DAOJIE_DIRECTOR_PLAN_SCENES.filter((sceneId) => requiredScenes[sceneId] !== true);
  if (missingScenes.length > 0) {
    throw new Error(`导演规划缺少必需 Sc 场景段: ${missingScenes.join(', ')}`);
  }

  if (Number(generated.directorPlanStructuredSceneIntents) !== EXPECTED_DAOJIE_DIRECTOR_PLAN_SCENES) {
    throw new Error(
      `结构化导演规划场景意图数量异常: ${generated.directorPlanStructuredSceneIntents ?? 'missing'}/${EXPECTED_DAOJIE_DIRECTOR_PLAN_SCENES}`,
    );
  }
  if (Number(generated.directorPlanStructuredSceneIntentsComplete) !== EXPECTED_DAOJIE_DIRECTOR_PLAN_SCENES) {
    throw new Error(
      `结构化导演规划场景意图不完整: ${generated.directorPlanStructuredSceneIntentsComplete ?? 'missing'}/${EXPECTED_DAOJIE_DIRECTOR_PLAN_SCENES}`,
    );
  }
  if (generated.directorPlanHasDerivedAssetSection !== true) {
    throw new Error('导演规划缺少衍生资产预划清单');
  }
}

function requireStoryboardCountFollowsDirectorPlan(generated) {
  const storyboardCount = Number(generated.storyboards);
  const expectedStoryboardSegments = Number(generated.storyboardSourceSegments);
  if (!(storyboardCount > 0)) {
    throw new Error(`没有生成可用分镜: ${generated.storyboards ?? 'missing'}`);
  }
  if (!(expectedStoryboardSegments > 0)) {
    throw new Error(`没有解析到导演计划可生成分镜片段: ${generated.storyboardSourceSegments ?? 'missing'}`);
  }
  if (storyboardCount !== expectedStoryboardSegments) {
    throw new Error(`分镜数量必须按导演计划源片段生成: ${storyboardCount}/${expectedStoryboardSegments}`);
  }
  return { storyboardCount, expectedStoryboardSegments };
}

function requireDynamicStoryboardSource(generated) {
  if (generated.storyboardSourceKind !== 'project-storyboard-table') {
    throw new Error(
      `真实成片必须读取项目最新 storyboardTable，禁止 bootstrap source: ${generated.storyboardSourceKind || 'missing'}`,
    );
  }
  if (!generated.storyboardSourceWorkId) {
    throw new Error('真实成片缺少 storyboardSourceWorkId');
  }
  if (!(Number(generated.storyboardSourceUpdatedAt) > 0)) {
    throw new Error(`真实成片缺少 storyboardSourceUpdatedAt: ${generated.storyboardSourceUpdatedAt ?? 'missing'}`);
  }
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function calculateVoiceBindingFingerprint(speakerVoiceMap) {
  const rows = Object.entries(speakerVoiceMap)
    .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
    .map(([speakerId, voiceProfile]) => ({
      profileId: voiceProfile?.profileId || '',
      referenceAudioPath: voiceProfile?.voiceReferenceAudioPath || '',
      speakerId,
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function requireStoryboardVoiceoverIntegrity(generated, storyboardCount) {
  const manifest = Array.isArray(generated.voiceoverManifest)
    ? generated.voiceoverManifest
    : [];
  if (manifest.length !== storyboardCount) {
    throw new Error(`逐镜口播明细缺失: ${manifest.length}/${storyboardCount}`);
  }
  if (Number(generated.audioCount) !== storyboardCount) {
    throw new Error(`逐镜真实音频数量异常: ${generated.audioCount ?? 'missing'}/${storyboardCount}`);
  }

  const speakerIds = new Set();
  const storyboardIds = new Set();
  for (const [offset, item] of manifest.entries()) {
    const storyboardId = item?.storyboardId || 'missing';
    if (storyboardId === 'missing' || storyboardIds.has(storyboardId)) {
      throw new Error(`逐镜口播 storyboardId 非唯一: ${storyboardId}`);
    }
    storyboardIds.add(storyboardId);
    const expectedIndex = offset + 1;
    if (Number(item?.index) !== expectedIndex) {
      throw new Error(`逐镜口播 index 必须连续为 1..N: ${storyboardId} / ${item?.index ?? 'missing'} / ${expectedIndex}`);
    }
    for (const field of ['speaker', 'speakerId', 'line', 'ttsSpokenText', 'voiceStyle']) {
      if (!String(item?.[field] ?? '').trim()) {
        throw new Error(`逐镜口播字段缺失: ${storyboardId} / ${field}`);
      }
    }
    if (item.requiresFixedVoice !== true) {
      throw new Error(`逐镜口播未要求固定音色: ${storyboardId}`);
    }
    if (!(Number(item.durationTarget) > 0)) {
      throw new Error(`逐镜口播 durationTarget 非正数: ${storyboardId}`);
    }
    if (
      item.speakerId !== 'narrator'
      && !String(item.speakerId).startsWith('character:')
    ) {
      throw new Error(`逐镜口播 speakerId 非 canonical: ${storyboardId} / ${item.speakerId}`);
    }
    for (const [field, filePath] of Object.entries({
      audioPath: item.audioPath,
      voiceReferenceAudioPath: item.voiceReferenceAudioPath,
    })) {
      if (!filePath || !existsSync(filePath) || !(statSync(filePath).size > 0)) {
        throw new Error(`逐镜口播文件不可读: ${storyboardId} / ${field} / ${filePath || 'missing'}`);
      }
    }
    if (!item.profileId || !['fixed', 'ai-selected'].includes(item.match)) {
      throw new Error(`逐镜固定音色证据缺失: ${storyboardId} / ${JSON.stringify(item)}`);
    }
    speakerIds.add(item.speakerId);
  }

  const speakerVoiceMap = generated.speakerVoiceMap;
  if (!speakerVoiceMap || typeof speakerVoiceMap !== 'object') {
    throw new Error('缺少 speakerVoiceMap 报告字段');
  }
  const voiceMapKeys = Object.keys(speakerVoiceMap).sort();
  const manifestSpeakerIds = [...speakerIds].sort();
  if (JSON.stringify(voiceMapKeys) !== JSON.stringify(manifestSpeakerIds)) {
    throw new Error(
      `speakerVoiceMap 未覆盖全部 canonical speakerId: ${voiceMapKeys.join(', ')} / ${manifestSpeakerIds.join(', ')}`,
    );
  }
  for (const [speakerId, voiceProfile] of Object.entries(speakerVoiceMap)) {
    if (!voiceProfile?.profileId) {
      throw new Error(`角色音色缺少 profileId: ${speakerId}`);
    }
    if (
      !voiceProfile?.voiceReferenceAudioPath
      || !existsSync(voiceProfile.voiceReferenceAudioPath)
      || !(statSync(voiceProfile.voiceReferenceAudioPath).size > 0)
    ) {
      throw new Error(`角色音色参考不存在: ${speakerId} / ${voiceProfile?.voiceReferenceAudioPath || 'missing'}`);
    }
    if (!['fixed', 'ai-selected'].includes(voiceProfile.match)) {
      throw new Error(`角色音色 match 非法: ${speakerId} / ${voiceProfile.match || 'missing'}`);
    }
  }

  for (const item of manifest) {
    const voiceProfile = speakerVoiceMap[item.speakerId];
    if (
      item.profileId !== voiceProfile.profileId
      || item.voiceReferenceAudioPath !== voiceProfile.voiceReferenceAudioPath
      || item.match !== voiceProfile.match
    ) {
      throw new Error(`逐镜固定音色与 speakerVoiceMap 不一致: ${item.storyboardId}`);
    }
  }

  const fingerprint = String(generated.voiceBindingFingerprint || '');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error(`固定音色 fingerprint 异常: ${generated.voiceBindingFingerprint || 'missing'}`);
  }
  const calculatedFingerprint = calculateVoiceBindingFingerprint(speakerVoiceMap);
  if (fingerprint !== calculatedFingerprint) {
    throw new Error(`固定音色 fingerprint 与 speakerVoiceMap 不一致: ${fingerprint} / ${calculatedFingerprint}`);
  }
  const fixed = Array.isArray(generated.fixedVoiceBindings)
    ? generated.fixedVoiceBindings
    : [];
  const selected = Array.isArray(generated.aiSelectedVoiceBindings)
    ? generated.aiSelectedVoiceBindings
    : [];
  const bindingEvidence = [...new Set([...fixed, ...selected])].sort();
  if (JSON.stringify(bindingEvidence) !== JSON.stringify(manifestSpeakerIds)) {
    throw new Error(
      `固定音色状态未覆盖全部 speaker: ${bindingEvidence.join(', ')} / ${manifestSpeakerIds.join(', ')}`,
    );
  }
}

function writeFailureReport(generated, error, timelineResult = null) {
  const storyboardImageGenerationMode =
    generated?.storyboardImageGenerationMode ||
    generated?.imageGenerationMode ||
    REQUIRED_STORYBOARD_IMAGE_MODE;
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    command: 'npm run video:daojie:chapter001',
    generatorScript,
    finalVideo: timelineResult?.timelineRenderRecord?.evidence?.path,
    finalVideoEvidence: timelineResult?.timelineRenderRecord?.evidence,
    legacyCompatibilityVideo: generated?.final,
    legacyCompatibilityVideoEvidence: generated?.finalVideoEvidence,
    timelineRenderRecord: timelineResult?.timelineRenderRecord,
    storyboards: generated?.storyboards,
    storyboardSourceKind: generated?.storyboardSourceKind,
    storyboardSourceWorkId: generated?.storyboardSourceWorkId,
    storyboardSourceUpdatedAt: generated?.storyboardSourceUpdatedAt,
    storyboardSourceSegments: generated?.storyboardSourceSegments,
    totalStoryboardDuration: generated?.totalStoryboardDuration,
    ...directorPlanAuditFields(generated),
    storyboardsWithAssetLinks: generated?.storyboardsWithAssetLinks,
    assetLinks: generated?.assetLinks,
    storyboardImageGenerationMode,
    imageGenerationMode: generated?.imageGenerationMode,
    imageGenerationProvider: generated?.imageGenerationProvider,
    generatedFrameImages: generated?.generatedFrameImages,
    framesWithRealAssetImages: generated?.framesWithRealAssetImages,
    storyboardPromptManifest: generated?.storyboardPromptManifest,
    storyboardPromptsWithReferenceBindings: generated?.storyboardPromptsWithReferenceBindings,
    storyboardPromptsWithDaojieStyleLock: generated?.storyboardPromptsWithDaojieStyleLock,
    storyboardPromptsWithLightSection: generated?.storyboardPromptsWithLightSection,
    storyboardPromptsWithMissingVisibleCharacterRefs: generated?.storyboardPromptsWithMissingVisibleCharacterRefs,
    storyboardPromptsWithRawAssetNameLeaks: generated?.storyboardPromptsWithRawAssetNameLeaks,
    storyboardPromptMissingVisibleCharacterRefs: generated?.storyboardPromptMissingVisibleCharacterRefs,
    storyboardPromptRawAssetNameLeaks: generated?.storyboardPromptRawAssetNameLeaks,
    storyboardImageWorkflowManifest: generated?.storyboardImageWorkflowManifest,
    voiceoverManifest: generated?.voiceoverManifest,
    audioCount: generated?.audioCount,
    speakerVoiceMap: generated?.speakerVoiceMap,
    voiceBindingFingerprint: generated?.voiceBindingFingerprint,
    fixedVoiceBindings: generated?.fixedVoiceBindings,
    aiSelectedVoiceBindings: generated?.aiSelectedVoiceBindings,
    error,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (!existsSync(generatorScript)) {
  throw new Error(`视频生成脚本不存在: ${generatorScript}`);
}

if (probeProvidersOnly) {
  stopExistingMYStudioInstances();
  await runImageProviderProbe();
  process.exit(0);
}

if (probeGenerationOnly) {
  stopExistingMYStudioInstances();
  await runImageGenerationProbe();
  process.exit(0);
}

stopExistingMYStudioInstances();

let generated;
try {
  const storyboardImageProviderConfigs = loadStoryboardImageProviderConfigsFromAppSettings();
  generated = parseGeneratorOutput(run('python3', [generatorScript], {
    env: {
      MANYING_REQUIRE_REAL_TTS: '1',
      MYSTUDIO_DAOJIE_ALLOW_STORYBOARD_BOOTSTRAP: '0',
      MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE: REQUIRED_STORYBOARD_IMAGE_MODE,
      ...(storyboardImageProviderConfigs && { MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON: storyboardImageProviderConfigs }),
    },
  }).stdout);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeFailureReport(null, `生成器执行失败: ${message}`);
  throw error;
}
const legacyCompatibilityVideo = generated.final;
const legacyCompatibilityVideoEvidence = generated.finalVideoEvidence;
if (!legacyCompatibilityVideo || !existsSync(legacyCompatibilityVideo)) {
  throw new Error(`legacy compatibility 视频不存在: ${legacyCompatibilityVideo || 'missing'}`);
}
if (
  !legacyCompatibilityVideoEvidence
  || legacyCompatibilityVideoEvidence.path !== legacyCompatibilityVideo
  || !existsSync(legacyCompatibilityVideoEvidence.path)
) {
  throw new Error(`legacy compatibility 视频证据缺失: ${JSON.stringify(legacyCompatibilityVideoEvidence ?? null)}`);
}
if (
  !(Number(legacyCompatibilityVideoEvidence.sizeBytes) > 0)
  || !/^[a-f0-9]{64}$/.test(String(legacyCompatibilityVideoEvidence.sha256 || ''))
) {
  throw new Error(`legacy compatibility 视频证据异常: ${JSON.stringify(legacyCompatibilityVideoEvidence)}`);
}
requireWorkflowSteps(generated);
requireDirectorPlanIntegrity(generated);
const { storyboardCount } = requireStoryboardCountFollowsDirectorPlan(generated);
requireDynamicStoryboardSource(generated);
requireStoryboardVoiceoverIntegrity(generated, storyboardCount);
if (generated.storyboardsWithAssetLinks !== generated.storyboards) {
  throw new Error(`分镜资产链接不完整: ${generated.storyboardsWithAssetLinks ?? 0}/${generated.storyboards ?? 0}`);
}
if (!(Number(generated.assetLinks) > 0)) {
  throw new Error('分镜未关联塑角/造景/道具资产');
}
if (!(Number(generated.scriptTextChars) > 0) || !(Number(generated.spokenTextChars) > 0)) {
  throw new Error(
    `第一章口播文字为空: source=${generated.scriptTextChars ?? 'missing'}, spoken=${generated.spokenTextChars ?? 'missing'}`,
  );
}
if (generated.framesWithRealAssetImages !== storyboardCount) {
  throw new Error(`分镜真实资产图片不完整: ${generated.framesWithRealAssetImages ?? 0}/${storyboardCount}`);
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
requireStoryboardPromptIntegrity(generated);
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

let timelineResult;
try {
  if (!existsSync(resolve(appsRoot, timelineRunnerScript))) {
    throw new Error(`timeline runner 不存在: ${resolve(appsRoot, timelineRunnerScript)}`);
  }
  if (!existsSync(resolve(appsRoot, viteNodeBin))) {
    throw new Error(`vite-node 不存在: ${resolve(appsRoot, viteNodeBin)}`);
  }
  timelineResult = parseGeneratorOutput(run(viteNodeBin, [
    '--config', 'build/vite-node.config.ts',
    timelineRunnerScript,
  ], {
    cwd: appsRoot,
    env: { MYSTUDIO_DAOJIE_TIMELINE_RUNNER: '1' },
  }).stdout);
  const editingProject = timelineResult?.editingProject;
  const autoEditingRun = timelineResult?.autoEditingRun;
  const timelineRenderPlan = timelineResult?.timelineRenderPlan;
  const timelineRenderRecord = timelineResult?.timelineRenderRecord;
  const evidence = timelineRenderRecord?.evidence;
  if (!timelineResult?.ok || !editingProject || !autoEditingRun || !timelineRenderPlan || !timelineRenderRecord || !evidence) {
    throw new Error(`timeline runner 报告字段不完整: ${JSON.stringify(timelineResult ?? null)}`);
  }
  if (
    editingProject.projectId !== timelineRenderRecord.projectId
    || editingProject.episodeId !== timelineRenderRecord.episodeId
    || editingProject.id !== timelineRenderRecord.editingProjectId
    || editingProject.revision !== timelineRenderRecord.editingRevision
    || editingProject.sourceSnapshotHash !== timelineRenderRecord.sourceSnapshotHash
  ) {
    throw new Error('timeline render record 与 EditingProject identity 不一致');
  }
  if (
    timelineRenderPlan.jobId !== evidence.jobId
    || timelineRenderPlan.editingProjectId !== editingProject.id
    || timelineRenderPlan.editingRevision !== editingProject.revision
    || autoEditingRun.editingProjectId !== editingProject.id
    || autoEditingRun.renderJobId !== evidence.jobId
  ) {
    throw new Error('timeline plan/run/evidence identity 不一致');
  }
  if (
    timelineResult.sourceCounts?.storyboards !== generated.storyboards
    || timelineResult.sourceCounts?.productionTracks !== generated.tracks
  ) {
    throw new Error(
      `timeline source count 与 Python 写回不一致: ${JSON.stringify(timelineResult.sourceCounts ?? null)}`,
    );
  }
  if (
    timelineResult.finalVideo !== evidence.path
    || timelineResult.finalVideoEvidence?.path !== evidence.path
    || timelineResult.finalVideoEvidence?.sha256 !== evidence.sha256
  ) {
    throw new Error('timeline runner final path/hash 与 render evidence 不一致');
  }
  for (const [label, artifactPath] of Object.entries({
    editingProjectPath: timelineResult.editingProjectPath,
    autoEditingRunPath: timelineResult.autoEditingRunPath,
    timelineRenderPlanPath: timelineResult.timelineRenderPlanPath,
    progressHistoryPath: timelineResult.progressHistoryPath,
    timelineRenderRecordPath: timelineResult.timelineRenderRecordPath,
    runnerReportPath: timelineResult.runnerReportPath,
    outputPath: evidence.path,
    snapshotPath: evidence.snapshotPath,
    renderPlanPath: evidence.renderPlanPath,
    inputManifestPath: evidence.inputManifestPath,
    filterGraphPath: evidence.filterGraphPath,
    logPath: evidence.logPath,
    ffprobePath: evidence.ffprobePath,
  })) {
    if (!artifactPath || !existsSync(artifactPath) || !(statSync(artifactPath).size > 0)) {
      throw new Error(`timeline artifact 缺失或为空: ${label} / ${artifactPath || 'missing'}`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(String(evidence.sha256 || '')) || sha256File(evidence.path) !== evidence.sha256) {
    throw new Error(`timeline 最终视频 SHA-256 异常: ${evidence.sha256 || 'missing'}`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(evidence.snapshotHash || '')) || sha256File(evidence.snapshotPath) !== evidence.snapshotHash) {
    throw new Error(`timeline EditingProject snapshot hash 异常: ${evidence.snapshotHash || 'missing'}`);
  }
  if (!Array.isArray(timelineResult.progressHistory) || !timelineResult.progressHistory.some((item) => item?.stage === 'completed')) {
    throw new Error('timeline progress history 未到 completed');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeFailureReport(generated, `timeline runtime 执行失败: ${message}`, timelineResult);
  throw error;
}

const finalVideo = timelineResult.timelineRenderRecord.evidence.path;
const finalVideoEvidence = timelineResult.timelineRenderRecord.evidence;
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
if (!finalVideoEvidence || finalVideoEvidence.path !== finalVideo || !existsSync(finalVideoEvidence.path)) {
  throw new Error(`最终视频证据缺失: ${JSON.stringify(finalVideoEvidence ?? null)}`);
}
if (!(Number(finalVideoEvidence.sizeBytes) > 0) || !/^[a-f0-9]{64}$/.test(String(finalVideoEvidence.sha256 || ''))) {
  throw new Error(`最终视频证据异常: ${JSON.stringify(finalVideoEvidence)}`);
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
  timelineRunnerScript,
  finalVideo,
  editingProject: timelineResult.editingProject,
  autoEditingRun: timelineResult.autoEditingRun,
  timelineRenderPlan: timelineResult.timelineRenderPlan,
  timelineProgressHistory: timelineResult.progressHistory,
  timelineRenderRecord: timelineResult.timelineRenderRecord,
  timelineArtifacts: {
    editingProjectPath: timelineResult.editingProjectPath,
    autoEditingRunPath: timelineResult.autoEditingRunPath,
    timelineRenderPlanPath: timelineResult.timelineRenderPlanPath,
    progressHistoryPath: timelineResult.progressHistoryPath,
    timelineRenderRecordPath: timelineResult.timelineRenderRecordPath,
    runnerReportPath: timelineResult.runnerReportPath,
  },
  legacyCompatibilityVideo,
  legacyCompatibilityVideoEvidence,
  storyboards: generated.storyboards,
  storyboardSourceKind: generated.storyboardSourceKind,
  storyboardSourceWorkId: generated.storyboardSourceWorkId,
  storyboardSourceUpdatedAt: generated.storyboardSourceUpdatedAt,
  storyboardSourceSegments: generated.storyboardSourceSegments,
  totalStoryboardDuration: generated.totalStoryboardDuration,
  targetDurationSeconds: generated.targetDurationSeconds,
  scriptTextChars: generated.scriptTextChars,
  spokenTextChars: generated.spokenTextChars,
  dialogueCoverageRatio: generated.dialogueCoverageRatio,
  ...directorPlanAuditFields(generated),
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
  storyboardPromptManifest: generated.storyboardPromptManifest,
  storyboardPromptsWithReferenceBindings: generated.storyboardPromptsWithReferenceBindings,
  storyboardPromptsWithDaojieStyleLock: generated.storyboardPromptsWithDaojieStyleLock,
  storyboardPromptsWithLightSection: generated.storyboardPromptsWithLightSection,
  storyboardPromptsWithMissingVisibleCharacterRefs: generated.storyboardPromptsWithMissingVisibleCharacterRefs,
  storyboardPromptsWithRawAssetNameLeaks: generated.storyboardPromptsWithRawAssetNameLeaks,
  storyboardPromptMissingVisibleCharacterRefs: generated.storyboardPromptMissingVisibleCharacterRefs,
  storyboardPromptRawAssetNameLeaks: generated.storyboardPromptRawAssetNameLeaks,
  storyboardMediaManifest: generated.storyboardMediaManifest,
  voiceoverManifest: generated.voiceoverManifest,
  audioCount: generated.audioCount,
  storyboardImageWorkflowManifest: generated.storyboardImageWorkflowManifest,
  assetImageManifest: generated.assetImageManifest,
  trackCandidateManifest: generated.trackCandidateManifest,
  missingImageAssets: generated.missingImageAssets,
  workflowSteps: generated.workflowSteps,
  voiceReferenceAudioPath: generated.voiceReferenceAudioPath,
  speakerVoiceMap: generated.speakerVoiceMap,
  voiceBindingFingerprint: generated.voiceBindingFingerprint,
  fixedVoiceBindings: generated.fixedVoiceBindings,
  aiSelectedVoiceBindings: generated.aiSelectedVoiceBindings,
  speakerAudioStats: generated.speakerAudioStats,
  speakerAudioSamples: generated.speakerAudioSamples,
  missingVoiceProfiles: generated.missingVoiceProfiles,
  finalVideoEvidence: timelineResult.timelineRenderRecord.evidence,
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
