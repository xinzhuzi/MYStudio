// @vitest-environment node
/** Task-only compiler probe; explicitly enabled, no model calls or project writes. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { useStudioStore } from '@/stores/studio/studio-store';
import { compileActiveDaojieStoryboardFramePrompt, resetExtendedManualContentCache, warmExtendedManualStyleTokens, withActiveVisualManualStoryboardStyleTokens } from '@/lib/studio/visual-manual-style-tokens';
const root = path.resolve(import.meta.dirname, '../../..');
const base = path.join(root, '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026');
const sha = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
it.skipIf(process.env.DIRECTOR_CHAPTER001_RUNTIME_PILOT_PREPARE_V2 !== '1')('freezes source and actual selected visual-manual compiler output', async () => {
  const folder = path.join(base, 'runtime-pilot-generation-v2');
  expect(fs.existsSync(folder)).toBe(false);
  const snapshotFolder = path.join(base, 'snapshot-20261026T161314424840Z');
  const snapshot = JSON.parse(fs.readFileSync(path.join(snapshotFolder, 'snapshot.json'), 'utf8'));
  const input = JSON.parse(fs.readFileSync(path.join(snapshotFolder, 'input.json'), 'utf8'));
  expect(sha(input.chapterText)).toBe(snapshot.sourceSha256);
  expect(snapshot.runtimeConfig.visualManualId).toBe('daojie_ink_guofeng');
  const manual = path.join(snapshot.projectRoot, 'skills/art_skills/daojie_ink_guofeng/art_prompt/art_storyboard_video.md');
  const content = fs.readFileSync(manual, 'utf8');
  expect(content).toContain('<!-- storyboard-image-style-tokens:start -->');
  const sheetFile = path.join(base, 'runtime-pilot-canvas-v4/sheet.png');
  const sheetReceipt = JSON.parse(fs.readFileSync(sheetFile.replace('.png', '.json'), 'utf8'));
  const sheetBytes = fs.readFileSync(sheetFile);
  expect(sha(sheetBytes)).toBe(sheetReceipt.sha256);
  expect(sheetReceipt.realCanvas).toBe(true);
  const prompt = "参考图1的金水河码头空间布局和图2的独孤剑尘身份，合成一张完整连续的码头剧情画面。图1的白昼改为天未亮的夜色，河面浮着灰雾，几十盏风灯的灯焰被江风吹成豆大的蓝白。图2的脸、发型和灰色旧衣保持同一人物身份，按本章灰衫断履的状态呈现：肩头补丁磨出毛边，旧草鞋左侧绑绳已断，鞋底磨穿，半旧背囊囊口用旧绳扎紧，囊的外表完整包住内装物。矿奴弯腰扛着装满灵矿石的藤筐，铁链从脚踝拖到筐绳。独孤剑尘沿码头小路走过，双手随步伐自然垂放。人物、码头和矿奴处于同一幅连续场景，豆大的蓝白风灯是局部小光点，整体为原文夜未散尽的暗色。";
  const previous = useStudioStore.getState().workflowConfig;
  try {
    useStudioStore.setState({ workflowConfig: { ...previous, visualManualId: snapshot.runtimeConfig.visualManualId } });
    resetExtendedManualContentCache();
    await warmExtendedManualStyleTokens(content);
    const styled = withActiveVisualManualStoryboardStyleTokens(prompt);
    const compiled = await compileActiveDaojieStoryboardFramePrompt(styled);
    expect(compiled).not.toBeNull();
    expect(compiled!.status).toBe('ok');
    const request = { model: 'qwen-image-2-1', prompt: [compiled!.positive, sheetReceipt.prompt].join('\n'), negative_prompt: compiled!.negative, aspect_ratio: '16:9', resolution: '1K', image_urls: ['data:image/png;base64,' + sheetBytes.toString('base64')] };
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'request.json'), JSON.stringify(request), { flag: 'wx' });
    fs.writeFileSync(path.join(folder, 'prepared.json'), JSON.stringify({ createdAt: new Date().toISOString(), sourceSha256: snapshot.sourceSha256, sourceExcerpt: input.chapterText.slice(0, input.chapterText.indexOf('“手脚麻利些')), backpackQuote: input.chapterText.split('\n').find((line: string) => line.includes('背一只半旧背囊')), visualManualId: snapshot.runtimeConfig.visualManualId, manual, manualSha256: sha(content), sheetFile, sheetSha256: sha(sheetBytes), sheetBytes: sheetBytes.length, prompt, compiled, requestSha256: sha(JSON.stringify(request)), projectWrites: 0, chain: 'actual selected visual-manual compiler and production Canvas compositor -> explicit direct sidecar request; no frontend action, AI manager, VLM, or project save' }, null, 2), { flag: 'wx' });
  } finally {
    useStudioStore.setState({ workflowConfig: previous });
    resetExtendedManualContentCache();
  }
});
