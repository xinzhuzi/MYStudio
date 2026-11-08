/**
 * 单镜全参考配对探针(1030 单镜分析门 · 吸收件③)。
 *
 * 把同一个镜的两支 mp4 配对比分:重出前后(越改越差?)、0.2 草稿档 vs
 * 0.98 正式档(草稿门放行的是不是同一件东西)。零新依赖——libvmaf/ssim/psnr
 * 本机 ffmpeg 已内建。
 *
 * 读数口径(与 chapter-qc-fullref.ts 头注同律):
 *  - VMAF/PSNR 越大越像基准,SSIM 亦然;
 *  - 同一支片自比 VMAF≈99.58 而非 100,别把 `=== 100` 当一致;
 *  - `scaled=true` 说明待检流被重采样过(跨档比),缩放自身会压分,不可当零影响;
 *  - 全参考只答「像不像」,不答「好不好」——好不好归无参考侧(siti/blur/DOVER)。
 *
 * Usage:
 *   npx vite-node --config build/timeline/vite-node.config.ts \
 *       build/scripts/shot_fullref_pair_1030.ts <基准.mp4> <待检.mp4> [vmaf,ssim,psnr]
 */
import { compareFullReferencePair, type FullRefMetric } from "@rendering/plugins/videoqc/chapter-qc-fullref";

const [referencePath, distortedPath, metricArg] = process.argv.slice(2);
if (!referencePath || !distortedPath) {
  console.error("用法: shot_fullref_pair_1030.ts <基准.mp4> <待检.mp4> [vmaf,ssim,psnr]");
  process.exit(2);
}
const metrics = metricArg
  ? (metricArg.split(",").map((name) => name.trim()) as FullRefMetric[])
  : undefined;

const result = await compareFullReferencePair({ referencePath, distortedPath, metrics });
console.log(JSON.stringify({
  reference: referencePath,
  distorted: distortedPath,
  scaled: result.geometry.scaled,
  geometry: result.geometry,
  elapsedMs: result.elapsedMs,
  scores: {
    vmaf: result.scores.vmaf,
    ssimAll: result.scores.ssim?.all,
    ssimY: result.scores.ssim?.y,
    psnrAverage: result.scores.psnr?.average,
    psnrMin: result.scores.psnr?.min,
  },
  errors: result.errors,
}, null, 1));
if (Object.keys(result.errors).length > 0) process.exitCode = 1;
