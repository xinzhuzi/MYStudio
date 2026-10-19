/**
 * 资产按名分夹迁移演练入口(10-19-asset-name-folders L3 步12)
 *
 * 定位:对【任意资产根副本】跑迁移+核账并输出五重核账台账——只碰传入的副本根,
 * 绝不触碰生产库(调用方负责先拷贝;生产 MA=/Users/zhengbingjin/Project/IP/MA 只读)。
 *
 * Usage(仓根基准):
 *   cd apps && npx vite-node --config build/timeline/vite-node.config.ts \
 *     build/scripts/asset-name-folder-drill.ts --project-root /tmp/asset-drill/proj [--noop-check]
 *
 * 布局要求:--project-root 指向含 store/assets 与 store/studio-workflow 的项目根副本
 * (rsync 生产 MA/store → 副本即可)。--noop-check 时二跑复核输出 no-op(幂等闭环)。
 *
 * 退出码:0=migrated/noop(P5 核账全绿);1=interrupted(核账红/异常,不落 marker)。
 */
import fs from "node:fs";
import path from "node:path";
import {
  ASSET_NAME_FOLDERS_MARKER,
  runAssetNameFolderMigration,
  type AssetNameFolderRootResult,
} from "../../frontend/electron/storage/asset-name-folder-migration";

interface DrillArgs {
  projectRoot: string;
  noopCheck: boolean;
}

function parseArgs(argv: string[]): DrillArgs {
  const args: DrillArgs = { projectRoot: "", noopCheck: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--project-root") {
      args.projectRoot = String(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--noop-check") {
      args.noopCheck = true;
    }
  }
  if (!args.projectRoot) {
    console.error("用法:asset-name-folder-drill.ts --project-root <项目根副本> [--noop-check]");
    process.exit(1);
  }
  const resolved = path.resolve(args.projectRoot);
  if (!fs.existsSync(path.join(resolved, "store", "assets", "assets.db"))) {
    console.error(`副本缺 store/assets/assets.db:${resolved}`);
    process.exit(1);
  }
  args.projectRoot = resolved;
  return args;
}

function printRootResult(label: string, root: AssetNameFolderRootResult): void {
  console.log(`[${label}] root=${root.root}`);
  console.log(`  status=${root.status}${root.reason ? ` reason=${root.reason}` : ""}`);
  console.log(`  movedFiles=${root.movedFiles} rewrittenRefs=${root.rewrittenRefs} anomalies=${root.anomalies.length}`);
  if (root.ledgerDir) {
    console.log(`  ledger=${root.ledgerDir}`);
    const ledgerPath = path.join(root.ledgerDir, "migration-ledger.json");
    if (fs.existsSync(ledgerPath)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8")) as {
        phases?: Array<{ name: string; ms: number; status: string }>;
        baseline?: { fileCount?: number; dbRows?: number; brokenRefs?: string[] };
        files?: { moved: number; alreadyMoved: number; conflicts: string[]; missing: string[] };
        refs?: { rewritten: number; expected: number };
        error?: string;
      };
      console.log(`  P5 基线:fileCount=${ledger.baseline?.fileCount} dbRows=${ledger.baseline?.dbRows} 基线断链=${ledger.baseline?.brokenRefs?.length ?? 0}`);
      console.log(`  挪动:moved=${ledger.files?.moved} alreadyMoved=${ledger.files?.alreadyMoved} conflicts=${ledger.files?.conflicts?.length ?? 0} missing=${ledger.files?.missing?.length ?? 0}`);
      console.log(`  引用:rewritten=${ledger.refs?.rewritten} expected=${ledger.refs?.expected}`);
      for (const phase of ledger.phases ?? []) {
        console.log(`  相位 ${phase.name} ${phase.status} ${phase.ms}ms`);
      }
      if (ledger.error) console.log(`  error=${ledger.error}`);
    }
    for (const anomaly of root.anomalies.slice(0, 10)) {
      console.log(`  anomaly: ${anomaly}`);
    }
    if (root.anomalies.length > 10) console.log(`  …anomalies 共 ${root.anomalies.length} 条(全量见台账)`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const assetRoot = path.join(args.projectRoot, "store", "assets");

  console.log(`== 资产按名分夹迁移演练(副本)== projectRoot=${args.projectRoot}`);
  void runAssetNameFolderMigration({
    assetRoots: () => [assetRoot],
    getStorageBasePath: () => args.projectRoot,
    locationStore: { get: () => undefined, set: () => undefined, delete: () => undefined, all: () => ({ drill: args.projectRoot }) },
    log: (message) => console.warn(`[asset-name-folders] ${message}`),
  }).then((result) => {
    for (const root of result.roots) printRootResult("run-1", root);
    const markerPath = path.join(assetRoot, ASSET_NAME_FOLDERS_MARKER);
    console.log(`marker 在场=${fs.existsSync(markerPath)}(${markerPath})`);

    const finish = (code: number) => {
      if (args.noopCheck && result.status !== "interrupted") {
        void runAssetNameFolderMigration({
          assetRoots: () => [assetRoot],
          getStorageBasePath: () => args.projectRoot,
          locationStore: { get: () => undefined, set: () => undefined, delete: () => undefined, all: () => ({ drill: args.projectRoot }) },
          log: (message) => console.warn(`[asset-name-folders] ${message}`),
        }).then((second) => {
          for (const root of second.roots) printRootResult("run-2(noop-check)", root);
          process.exit(second.status === "interrupted" ? 1 : code);
        });
        return;
      }
      process.exit(result.status === "interrupted" ? 1 : code);
    };
    finish(result.status === "interrupted" ? 1 : 0);
  });
}

main();
