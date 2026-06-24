import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const appsRoot = process.cwd();
const repoRoot = resolve(appsRoot, '..');
const generatorScript = resolve(repoRoot, 'Library', 'build_daojie_chapter001_workflow.py');
const reportPath = resolve(appsRoot, 'output', 'automation', 'daojie-chapter001-video-report.json');
const MIN_DAOJIE_STORYBOARDS = 40;
const MIN_DIALOGUE_COVERAGE_RATIO = 0.92;
const MIN_DISTINCT_VOICE_REFERENCES = 5;
const MIN_AUDIO_MEAN_VOLUME_DB = -55;

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
    '-show_entries', 'stream=codec_type,duration',
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

if (!existsSync(generatorScript)) {
  throw new Error(`视频生成脚本不存在: ${generatorScript}`);
}

const generated = parseGeneratorOutput(run('python3', [generatorScript], {
  env: { MANYING_REQUIRE_REAL_TTS: '1' },
}).stdout);
const finalVideo = generated.final;
if (!finalVideo || !existsSync(finalVideo)) {
  throw new Error(`最终视频不存在: ${finalVideo || 'missing'}`);
}
if (generated.storyboardsWithAssetLinks !== generated.storyboards) {
  throw new Error(`分镜资产链接不完整: ${generated.storyboardsWithAssetLinks ?? 0}/${generated.storyboards ?? 0}`);
}
if (!(Number(generated.assetLinks) > 0)) {
  throw new Error('分镜未关联塑角/造景/道具资产');
}
if (!(Number(generated.storyboards) >= MIN_DAOJIE_STORYBOARDS)) {
  throw new Error(`道劫第一章分镜过少: ${generated.storyboards ?? 0}/${MIN_DAOJIE_STORYBOARDS}`);
}
if (generated.framesWithRealAssetImages !== generated.storyboards) {
  throw new Error(`分镜真实资产图片不完整: ${generated.framesWithRealAssetImages ?? 0}/${generated.storyboards ?? 0}`);
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
const audioDuration = Number(audioStream?.duration ?? 0);

if (!videoStream) throw new Error('最终视频缺少 video stream');
if (!audioStream) throw new Error('最终视频缺少 audio stream');
if (!(audioDuration > 0)) throw new Error(`最终视频 audio duration 异常: ${audioStream?.duration ?? 'missing'}`);
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
  scriptTextChars: generated.scriptTextChars,
  spokenTextChars: generated.spokenTextChars,
  dialogueCoverageRatio: generated.dialogueCoverageRatio,
  storyboardsWithAssetLinks: generated.storyboardsWithAssetLinks,
  assetLinks: generated.assetLinks,
  framesWithRealAssetImages: generated.framesWithRealAssetImages,
  assetImagePaths: generated.assetImagePaths,
  missingImageAssets: generated.missingImageAssets,
  voiceReferenceAudioPath: generated.voiceReferenceAudioPath,
  speakerVoiceMap: generated.speakerVoiceMap,
  speakerAudioStats: generated.speakerAudioStats,
  speakerAudioSamples: generated.speakerAudioSamples,
  missingVoiceProfiles: generated.missingVoiceProfiles,
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
