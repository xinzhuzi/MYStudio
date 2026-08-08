// 一次性诊断:扫描真实项目磁盘,找出被推断为 blocker-missing-ownership 的产物。
// 只读,不改任何数据。复用 artifact-inventory-service.ts 的章节推断正则。
import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";

const PROJECT_ROOT = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0";
const CHAPTER_RE = /((?:chapter|episode)[-_][A-Za-z0-9-]+)/i;

const files = [];
async function walk(dir, rel="") {
  for (const e of await readdir(dir, { withwith: true })) {
    void withwith; // placeholder
  }
}
// 重写干净的 walk
async function walkDir(dir, rel="") {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await walkDir(full, relPath);
    } else if (e.isFile()) {
      files.push({ full, relPath, name: e.name });
    }
  }
}
await walkDir(PROJECT_ROOT);

// 分类:有章节归属 vs 无章节归属(阻塞)
const withChapter = [];
const blocked = [];
for (const f of files) {
  const m = f.relPath.match(CHAPTER_RE);
  if (m) { withChapter.push({ ...f, chapter: m[1] }); }
  else { blocked.push(f); }
}

console.log(`总文件数: ${files.length}`);
console.log(`有章节归属(可删): ${withChapter.length}`);
console.log(`无章节归属(阻塞): ${blocked.length}`);
console.log("");
console.log("=== 阻塞产物按顶层目录分组 ===");
const byTop = {};
for (const f of blocked) {
  const top = f.relPath.split("/")[0];
  (byTop[top] ??= []).push(f);
}
for (const [top, arr] of Object.entries(byTop).sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`\n[${top}] ${arr.length} 个文件`);
  // 每组抽样5个路径
  for (const f of arr.slice(0,5)) console.log(`   ${f.relPath}`);
  if (arr.length > 5) console.log(`   ... 还有 ${arr.length-5} 个`);
}
