/**
 * HyperFrames Registry 依赖下载链实证(08-21 字体本地化):
 * 全量跑 downloadRegistryDeps,验证三件事——
 * 1. 全部依赖下载成功(含字体 CSS)
 * 2. 字体 CSS 内零 gstatic 外链(已改写为 _files/ 相对路径)
 * 3. checkRegistryDepsInstalled 完整性判定为 installed
 *
 * 目标目录:MYSTUDIO_DEPS_TARGET 覆盖(默认 /tmp 临时目录,不碰真机);
 * 传真机 userData 依赖路径即可为装机应用补货/修复。
 *
 * 运行: cd apps && vite-node --config build/timeline/vite-node.config.ts build/scripts/registry-deps-verify.ts
 */
import fs from "node:fs";
import path from "node:path";
import { downloadRegistryDeps, checkRegistryDepsInstalled } from "../../frontend/electron/rendering/plugins/hyperframes/registry-deps";

const TMP_DIR = process.env.MYSTUDIO_DEPS_TARGET?.trim() || "/tmp/hy-registry-deps-verify";

async function main() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  const t0 = Date.now();
  const result = await downloadRegistryDeps(TMP_DIR, (cur, total, name) => {
    if (cur % 10 === 0 || cur === total) console.log(`  [${cur}/${total}] ${name}`);
  });
  console.log(`下载: ${result.downloaded} 成功, ${result.failed.length} 失败, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (result.failed.length) console.log("失败清单:", result.failed);

  const check = checkRegistryDepsInstalled(TMP_DIR);
  console.log(`完整性: ${check.installedCount}/${check.totalCount} installed=${check.installed}`);

  let fontCss = 0;
  let externalRefs = 0;
  let fontFiles = 0;
  const fontsRoot = path.join(TMP_DIR, "fonts");
  if (fs.existsSync(fontsRoot)) {
    for (const fam of fs.readdirSync(fontsRoot)) {
      const cssPath = path.join(fontsRoot, fam, `${fam}.css`);
      if (!fs.existsSync(cssPath)) continue;
      fontCss++;
      externalRefs += (fs.readFileSync(cssPath, "utf8").match(/https?:\/\//g) ?? []).length;
      const filesDir = path.join(fontsRoot, fam, "_files");
      if (fs.existsSync(filesDir)) fontFiles += fs.readdirSync(filesDir).length;
    }
  }
  console.log(`字体: ${fontCss} 个 CSS,外链残留 ${externalRefs},字体文件本体 ${fontFiles} 个`);

  const pass = result.success && check.installed && externalRefs === 0;
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
