/**
 * B2 一次性全 store 禁指代词盘点(只读,零 store 写入)——2026-09-29 工单。
 *
 * 形态照 audit-visual-continuity.ts 先例:vite-node + `@/` 别名 + env 门控
 * (MYSTUDIO_INVENTORY_PROMPT_ANAPHORA=1 才执行 main,import 无副作用)。
 * 词表真源纪律:只 import @/lib/studio/prompt-anaphora 的 findPromptAnaphora /
 * PROMPT_ANAPHORA_TERMS,不复制清单另立真源(工单约束③)。
 * 范围:<IP 根>下各项目的 store/studio-workflow/manifest.json 活跃分片(排除目录内
 * 不在 manifest 的历史 .bak);只报字段名恰为 "prompt" 的字符串命中——
 * 「继续」等词在 prompt 外字段(shotSemantics/videoDesc/fingerprint payload
 * 等)亦有分布,按工单一律不报(计划层缩写合法,§三双层规则)。
 * 基线:A1 已于本日改写 sb-chapter-001-033.prompt(评审修订版单句展开),
 * 本盘点以 A1 改后现状为准(工单约束④)。
 * 只读自证:扫描前后对全部分片+manifest 各做 bytes/mtime/sha256 双采,任一
 * 变化即抛错;报告只落 apps/output/automation/。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findPromptAnaphora,
  PROMPT_ANAPHORA_TERMS,
} from "@/lib/studio/prompt-anaphora";
import { parseStudioWorkflowShardManifest } from "@/lib/storage/studio-workflow-shards";

const IP_ROOT = process.env.MYSTUDIO_IP_ROOT?.trim()
  ? path.resolve(process.env.MYSTUDIO_IP_ROOT.trim())
  : "/Users/zhengbingjin/Project/IP";

interface HolderInfo {
  id?: string;
  index?: number;
}

interface PromptField {
  shard: string;
  jsonPath: string;
  text: string;
  holder: HolderInfo;
}

interface HitDetail {
  shard: string;
  jsonPath: string;
  storyboardId: string | null;
  storyboardIndex: number | null;
  term: string;
  charIndex: number;
  excerpt: string;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

interface FileFingerprint {
  bytes: number;
  mtimeMs: number;
  sha256: string;
}

function fingerprint(filePath: string): FileFingerprint {
  const stat = fs.statSync(filePath);
  return { bytes: stat.size, mtimeMs: stat.mtimeMs, sha256: sha256File(filePath) };
}

function collectPromptFields(
  value: unknown,
  jsonPath: string,
  holder: HolderInfo,
  out: PromptField[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectPromptFields(item, `${jsonPath}[${i}]`, holder, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const nextHolder: HolderInfo = {
    id: typeof record.id === "string" ? record.id : holder.id,
    index: typeof record.index === "number" ? record.index : holder.index,
  };
  for (const [key, nested] of Object.entries(record)) {
    if (key === "prompt" && typeof nested === "string") {
      out.push({ shard: "", jsonPath: `${jsonPath}.${key}`, text: nested, holder: { ...nextHolder } });
    }
    if (nested && typeof nested === "object") {
      collectPromptFields(nested, `${jsonPath}.${key}`, nextHolder, out);
    }
  }
}

function isStoryboardShard(shardPath: string): boolean {
  return path.basename(shardPath).startsWith("storyboards-");
}

function main(): void {
  const projectRoots = fs
    .readdirSync(IP_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(IP_ROOT, entry.name));
  const projects: Array<{ project: string; manifest: string; shards: string[] }> = [];
  const skipped: Array<{ dir: string; reason: string }> = [];
  for (const projectRoot of projectRoots) {
    const manifestPath = path.join(projectRoot, "store", "studio-workflow", "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      skipped.push({ dir: projectRoot, reason: "无 store/studio-workflow/manifest.json(非 studio 项目)" });
      continue;
    }
    const manifest = parseStudioWorkflowShardManifest(fs.readFileSync(manifestPath, "utf-8"));
    if (!manifest) throw new Error(`manifest 无法解析: ${manifestPath}`);
    projects.push({ project: projectRoot, manifest: manifestPath, shards: manifest.shards });
  }
  if (projects.length === 0) throw new Error(`IP 根下无 studio 项目: ${IP_ROOT}`);

  // 分片排序:storyboards 分片优先(文件名升序),其余保持 manifest 顺序
  const orderedShards = (shards: string[]) => [
    ...shards.filter(isStoryboardShard).sort(),
    ...shards.filter((name) => !isStoryboardShard(name)),
  ];

  // 只读自证:扫描前指纹
  const watchedFiles: string[] = [];
  for (const project of projects) {
    watchedFiles.push(project.manifest);
    for (const shard of project.shards) {
      watchedFiles.push(path.join(path.dirname(project.manifest), shard));
    }
  }
  const before = new Map(watchedFiles.map((file) => [file, fingerprint(file)]));

  const promptFields: PromptField[] = [];
  const fieldsByShard: Record<string, number> = {};
  for (const project of projects) {
    const base = path.dirname(project.manifest);
    for (const shard of orderedShards(project.shards)) {
      const shardPath = path.join(base, shard);
      const parsed = JSON.parse(fs.readFileSync(shardPath, "utf-8")) as unknown;
      const found: PromptField[] = [];
      collectPromptFields(parsed, "$", {}, found);
      for (const field of found) field.shard = shard;
      promptFields.push(...found);
      fieldsByShard[shard] = (fieldsByShard[shard] ?? 0) + found.length;
    }
  }

  const storyboardFields = promptFields.filter((field) => isStoryboardShard(field.shard));
  const otherFields = promptFields.filter((field) => !isStoryboardShard(field.shard));

  const details: HitDetail[] = [];
  for (const field of [...storyboardFields, ...otherFields]) {
    for (const violation of findPromptAnaphora(field.text)) {
      details.push({
        shard: field.shard,
        jsonPath: field.jsonPath,
        storyboardId: isStoryboardShard(field.shard) ? (field.holder.id ?? null) : (field.holder.id ?? null),
        storyboardIndex: field.holder.index ?? null,
        term: violation.term,
        charIndex: violation.index,
        excerpt: violation.excerpt,
      });
    }
  }

  const hitsByTerm: Record<string, number> = {};
  const hitsByShard: Record<string, number> = {};
  for (const detail of details) {
    hitsByTerm[detail.term] = (hitsByTerm[detail.term] ?? 0) + 1;
    hitsByShard[detail.shard] = (hitsByShard[detail.shard] ?? 0) + 1;
  }
  const storyboardHits = details.filter((detail) => isStoryboardShard(detail.shard)).length;
  const otherHits = details.length - storyboardHits;
  // 数字自洽(完成边界):命中数=逐镜明细行数,且与按词/按分片两独立口径交叉相等;
  // 任一不等即抛错,报告不落盘。
  const sumByTerm = Object.values(hitsByTerm).reduce((acc, n) => acc + n, 0);
  const sumByShard = Object.values(hitsByShard).reduce((acc, n) => acc + n, 0);
  if (details.length !== sumByTerm || details.length !== sumByShard
    || details.length !== storyboardHits + otherHits) {
    throw new Error(`命中数不自洽: details=${details.length} byTerm=${sumByTerm} byShard=${sumByShard}`);
  }

  // 只读自证:扫描后指纹
  const after = new Map(watchedFiles.map((file) => [file, fingerprint(file)]));
  const changed: string[] = [];
  for (const file of watchedFiles) {
    if (before.get(file)!.sha256 !== after.get(file)!.sha256
      || before.get(file)!.bytes !== after.get(file)!.bytes
      || before.get(file)!.mtimeMs !== after.get(file)!.mtimeMs) {
      changed.push(file);
    }
  }
  if (changed.length > 0) throw new Error(`store 只读被破坏: ${changed.join(", ")}`);

  const stamp = new Date().toISOString().replace(/[:\-]/g, "").replace(/\.\d+Z$/, "Z");
  const scriptPath = fileURLToPath(import.meta.url);
  const outDir = path.resolve(path.dirname(scriptPath), "..", "..", "output", "automation");
  const report = {
    generatedAt: new Date().toISOString(),
    task: "B2 全 store 指代词盘点(只读)",
    script: scriptPath,
    anaphoraSource: "apps/frontend/lib/studio/prompt-anaphora.ts#findPromptAnaphora(词表真源复用,共 "
      + `${PROMPT_ANAPHORA_TERMS.length} 词,未复制)`,
    baseline: "A1 改后现状:sb-chapter-001-033.prompt 已于 2026-09-29(时间戳 20260929-105313)单句展开改写,"
      + "该镜改前曾命中「继续」1 处;本盘点不含该历史命中",
    scope: {
      ipRoot: IP_ROOT,
      projects: projects.map((project) => ({
        dir: project.project,
        manifestShards: project.shards.length,
      })),
      skipped,
      scannedShards: watchedFiles.length - projects.length,
      excludedNote: "仅扫 manifest 活跃分片;chapter-001 目录内历史备份 storyboards-001-ca6fa460.json.bak-h3writeback-131826"
        + " 不在 manifest 活跃集,未扫描",
      rule: "只报字段名恰为 prompt 的字符串命中;prompt 外字段(shotSemantics/videoDesc/fingerprint payload 等)"
        + "的「继续」等词按工单不报",
    },
    promptFields: {
      storyboardShots: storyboardFields.length,
      otherPromptFields: otherFields.length,
      total: promptFields.length,
      byShard: fieldsByShard,
    },
    summary: {
      totalHits: details.length,
      storyboardHits,
      otherHits,
      hitsByTerm,
      hitsByShard,
      selfConsistentCheck: `details=${details.length} = byTermSum=${sumByTerm} = byShardSum=${sumByShard} = storyboards(${storyboardHits})+others(${otherHits})`,
    },
    details,
    readOnlyProof: {
      filesWatched: watchedFiles.length,
      allUnchanged: true,
      method: "扫描前后逐文件 bytes+mtime+sha256 三采比对,任一变化即抛错(未触发)",
      fingerprints: Object.fromEntries(
        [...before.entries()].map(([file, fp]) => [path.relative(IP_ROOT, file), fp]),
      ),
    },
  };
  const jsonPathOut = path.join(outDir, `b2-prompt-anaphora-inventory-${stamp}.json`);
  fs.writeFileSync(jsonPathOut, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const mdLines: string[] = [
    "# B2 全 store 禁指代词盘点报告(只读)",
    "",
    `- 生成时间:${report.generatedAt}`,
    `- 脚本:${scriptPath}`,
    `- 词表真源:${report.anaphoraSource}`,
    `- 基线:${report.baseline}`,
    `- 范围:${projects.map((p) => `${path.basename(p.project)}(${p.shards.length} 分片)`).join("、")};只报 prompt 字段命中`,
    `- prompt 字段:storyboards ${storyboardFields.length} 镜 + 其它 ${otherFields.length} 处 = ${promptFields.length} 处`,
    `- 命中:共 ${details.length} 处(storyboards ${storyboardHits} + 其它 ${otherHits});按词 ${JSON.stringify(hitsByTerm)}`,
    `- 只读证明:${watchedFiles.length} 文件前后 bytes+mtime+sha256 全等`,
    `- 视觉结论待用户验收(本报告仅为文本机检盘点)`,
    "",
    "## 命中明细",
    "",
    "| # | 分片 | 镜/持有者 | 命中词 | 摘录 | JSON 路径 |",
    "|---|---|---|---|---|---|",
    ...details.map((detail, i) =>
      `| ${i + 1} | ${detail.shard} | ${detail.storyboardId ?? "-"}${detail.storyboardIndex !== null ? `(index ${detail.storyboardIndex})` : ""} | ${detail.term} | …${detail.excerpt}… | ${detail.jsonPath} |`),
    "",
  ];
  if (details.length === 0) mdLines.push("(零命中)", "");
  const mdPathOut = path.join(outDir, `b2-prompt-anaphora-inventory-${stamp}.md`);
  fs.writeFileSync(mdPathOut, mdLines.join("\n"), "utf-8");

  process.stdout.write(
    `${JSON.stringify(
      {
        jsonReport: jsonPathOut,
        mdReport: mdPathOut,
        storyboardShots: storyboardFields.length,
        otherPromptFields: otherFields.length,
        totalHits: details.length,
        storyboardHits,
        otherHits,
        hitsByTerm,
        readOnlyProof: `${watchedFiles.length} files unchanged`,
      },
      null,
      2,
    )}\n`,
  );
}

function isInventoryEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.MYSTUDIO_INVENTORY_PROMPT_ANAPHORA === "1";
}

if (isInventoryEnabled()) main();
