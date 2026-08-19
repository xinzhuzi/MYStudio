import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSourceMemoryService } from "../../frontend/electron/storage/source-memory-service";
import { sha256Of } from "../../frontend/electron/storage/source-memory-index";

const realProjectRoot = "/Users/zhengbingjin/Project/IP/MA";

function sourceHashes(projectRoot: string) {
  const memory = fs.readFileSync(path.join(projectRoot, "novel/source-memory/MEMORY.md"), "utf8");
  const chapter = fs.readFileSync(path.join(projectRoot, "novel/chapters/chapter-001.md"), "utf8");
  return { memory: sha256Of(memory), chapter: sha256Of(chapter) };
}

function cloneNovel(sourceRoot: string, label: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `source-memory-${label}-`));
  const sourceNovel = path.join(sourceRoot, "novel");
  const targetNovel = path.join(root, "novel");
  const targetMemory = path.join(targetNovel, "source-memory");
  fs.mkdirSync(path.join(targetNovel, "chapters"), { recursive: true });
  fs.mkdirSync(targetMemory, { recursive: true });
  fs.cpSync(path.join(sourceNovel, "source-memory/MEMORY.md"), path.join(targetMemory, "MEMORY.md"));
  fs.cpSync(path.join(sourceNovel, "chapters"), path.join(targetNovel, "chapters"), { recursive: true });
  for (const name of ["README.md", "manifest.json", "records.jsonl", "index.sqlite", "build-state.json"]) {
    const source = path.join(sourceNovel, "source-memory", name);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(targetMemory, name));
  }
  return root;
}

async function run() {
  const before = sourceHashes(realProjectRoot);
  const fixture = cloneNovel(realProjectRoot, "fixture");
  const fixtureService = createSourceMemoryService({ getProjectRoot: () => fixture });
  const fixtureBuild = await fixtureService.build("fixture");
  const fixtureStatus = fixtureService.status("fixture");
  const fixtureHit = fixtureService.search("fixture", "晏燎", 6);
  const zeroQuery = "玄霜孤城";
  const fixtureEmpty = fixtureService.search("fixture", zeroQuery, 6);

  const originalChapter = fs.readFileSync(path.join(fixture, "novel/chapters/chapter-001.md"), "utf8");
  fs.writeFileSync(path.join(fixture, "novel/chapters/chapter-001.md"), `${originalChapter}\n## 临时漂移探针\n`, "utf8");
  const stale = { status: fixtureService.status("fixture"), search: fixtureService.search("fixture", "晏燎", 6) };
  fs.writeFileSync(path.join(fixture, "novel/chapters/chapter-001.md"), originalChapter, "utf8");

  const recoveredSource = cloneNovel(realProjectRoot, "recovery");
  const recoveryService = createSourceMemoryService({ getProjectRoot: () => recoveredSource });
  await recoveryService.build("recovery");
  const activeBefore = recoveryService.status("recovery").buildId;
  const activePath = path.join(recoveredSource, "novel/source-memory/active.json");
  const active = JSON.parse(fs.readFileSync(activePath, "utf8")) as { generationPath: string };
  fs.writeFileSync(path.join(recoveredSource, "novel/source-memory", active.generationPath, "index.sqlite"), "corrupt", "utf8");
  const recovery = await recoveryService.rebuildIndex("recovery");

  const copyRoot = cloneNovel(fixture, "copy");
  const isolatedService = createSourceMemoryService({
    getProjectRoot: (projectId) => (projectId === "source" ? fixture : copyRoot),
  });
  const copyBuild = await isolatedService.build("copy");
  const copyIsolation = isolatedService.search("copy", "晏燎", 6).hits?.every((hit) => hit.sourcePath.startsWith("novel/")) ?? false;

  const after = sourceHashes(realProjectRoot);
  const realService = createSourceMemoryService({ getProjectRoot: () => realProjectRoot });
  const realBuild = await realService.build("real-ma");
  const realStatus = realService.status("real-ma");
  const realHit = realService.search("real-ma", "晏燎", 6);
  const realEmpty = realService.search("real-ma", zeroQuery, 6);

  console.log(JSON.stringify({
    real: { before, after, sourceUnchanged: JSON.stringify(before) === JSON.stringify(after), build: realBuild, status: realStatus, hitCount: realHit.hits?.length ?? 0, zeroQuery, emptyCount: realEmpty.hits?.length ?? 0 },
    fixture: { build: fixtureBuild, status: fixtureStatus, hitCount: fixtureHit.hits?.length ?? 0, zeroQuery, emptyCount: fixtureEmpty.hits?.length ?? 0, stale, copyBuild, copyIsolation },
    recovery: { activeBefore, recovery },
  }, null, 2));
}

void run();
