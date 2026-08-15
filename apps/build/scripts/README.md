# apps/build/scripts

大文本处理与一次性辅助脚本的统一存放处(参见 `.claude/CLAUDE.md`「大量内容处理铁律」)。

## 用途

- 处理 **>1 万字** 的读取 / 转换 / 插入时,脚本放这里,在本地磁盘上读写,**不通过 AI 上下文传递大文本**。
- 跨文件数据汇总、批量数据插入、大文件格式转换等批处理脚本。
- AI 上下文只传元数据和指令,用脚本做重活。

## 为什么放这里

- **进版本库**(区别于 `apps/out/` / `apps/release/` / `apps/output/` 这些被 `.gitignore` 忽略、且会被每次 build 重写的产物目录)。
- 与 `apps/build/chapter_video/`、`apps/build/timeline/` 同属构建工具边界。
- **不需要删除**,长期保留可追溯。

> 通用大文本脚本放本目录;chapter-video 成片流水线脚本放 `../chapter_video/` 与 `../chapter_video/pipeline/`。

## 路径治理脚本

`project-path-governance.mjs scan` 默认只读生成 manifest，记录文件级
SHA-256、字节数、mtime 和硬保护分类。实际处理只能使用已批准的精确
manifest、小批次 `batch-id` 和 `applied-output`：

```bash
node apps/build/scripts/project-path-governance.mjs trash \
  --manifest .trellis/tasks/08-01-audit-project-paths-and-cleanup/research/<approved>.json \
  --batch-id batch-a-001 \
  --applied-output .trellis/tasks/08-01-audit-project-paths-and-cleanup/research/<applied>.json
```

`trash` 只调用 `/usr/bin/trash --stopOnError --verbose`，拒绝 glob、路径
逃逸、保护目录、证据漂移、重复/重叠目标和超过 20 个顶层目标。批准
manifest 必须位于上述 task `research/`，其 `batchId` 必须与命令完全一致；
`scan` 与 `trash` 不接受彼此的参数。

执行器在调用 trash 前以独占方式持久写入 `status=pending` 的 applied evidence；
runner 抛错或非零退出会把同一路径更新为 `status=failed`，成功则更新为
`status=applied`。既有 `applied-output` 永不覆盖，未经精确清单批准不得运行。
自动化测试只能在临时夹具上注入 `trashRunner`；禁止从测试调用生产 CLI
`trash` 或真实 `/usr/bin/trash`。

## userData 只读治理扫描

`user-data-governance.mjs` 默认只生成 Application Support 的文件级 dry-run 证据；
它还提供一个只筛选 `.DS_Store` 的候选批次和一个必须经过人工批准、应用已退出确认的
Trash 执行门。`--output` 必须位于 `<userData>` 外，且已有文件永不覆盖：

```bash
node apps/build/scripts/user-data-governance.mjs \
  --user-data "<userData>" \
  --output "/tmp/mystudio-user-data-manifest.json"
```

生成只含 Finder 元数据的候选批次（不会移动任何文件）：

```bash
node apps/build/scripts/user-data-governance.mjs batch \
  --user-data "<userData>" \
  --output ".trellis/tasks/<task>/research/finder-metadata-trash-candidate.json" \
  --batch-id batch-userdata-ds-YYYYMMDD
```

候选清单的 `approved=false`。人工确认精确目标后，用 `approve` 写出不可覆盖的
`mode=approved-trash`/`approved=true` 清单（这一步本身就是批准记录）：

```bash
node apps/build/scripts/user-data-governance.mjs approve \
  --user-data "<userData>" \
  --manifest ".trellis/tasks/<task>/research/finder-metadata-trash-candidate.json" \
  --output ".trellis/tasks/<task>/research/finder-metadata-trash-approved.json" \
  --approval-note "人工确认仅处理列出的 Finder 元数据"
```

只有该批准清单并明确传入 `--confirm-app-exited`，才允许：

```bash
node apps/build/scripts/user-data-governance.mjs trash \
  --user-data "<userData>" \
  --manifest ".trellis/tasks/<task>/research/finder-metadata-trash-approved.json" \
  --batch-id batch-userdata-ds-YYYYMMDD \
  --applied-output ".trellis/tasks/<task>/research/finder-metadata-trash-applied.json" \
  --confirm-app-exited
```

执行器只调用 `/usr/bin/trash --stopOnError --verbose`，并在调用前写入
`status=pending` 的 applied/recovery evidence；失败写 `status=failed`，成功写
`status=applied`。它重新核对每个目标的路径、类型、字节数、mtime 和 SHA-256，
任何漂移、符号链接、非 `.DS_Store` 或未批准目标都会停止。

每条记录包含路径、类型、字节数、mtime、SHA-256、分类依据和建议 disposition；
JSON、SQLite、symlink 另带结构化证据。SQLite 状态固定为 `ok`、`locked`、
`corrupt-or-unreadable`，其中 `locked` 只表示运行时占用，不能据此清理。symlink
的 SHA-256 对 link target 文本取值，不跟随链接读取根外内容；只有 realpath 成功落到
userData 外才标记 `hold-symlink-escape`。断链或
`Singleton*` / `.com.github.Electron.*` marker 会保留不可解析/marker 证据。

分类边界如下：

- `.DS_Store` 普通文件是 `finder-metadata / trash-eligible-after-approval`，仍需后续精确 manifest 和人工批准。
- Chromium/Electron cache、会话、Cookie、IndexedDB、DevTools 和锁标记全部保留，扫描器不把“可重建”解释为自动清理。主进程已把 Chromium 会话数据整体收敛到 `<userData>/Chromium/`（`app.setPath('sessionData')`，见 `apps/frontend/electron/runtime/chromium-data-dir.ts`），扫描器会剥掉 `Chromium/` 前缀后按内部布局继续分类。
- 顶层 `assets.db`、`assets/assets.db.bak-*`、`assets/db.json.migrated` 是 legacy/orphan、恢复或迁移证据，全部保留。
- Python/模型 symlink、项目、资产、媒体、技能、TTS/Remotion runtime 以及未知条目都不会进入自动清理批次。

## 统一质量门禁

`run-quality-gate.mjs` 是 MYStudio 验证链的唯一编排入口，由
`npm run test:all` 调用。它只组合现有命令，不复制测试实现：默认顺序为聚焦测试、
typecheck、lint、完整 Vitest、AiToEarn upgrade smoke、macOS 打包/覆盖安装/installed
smoke，以及 packaged desktop smoke。报告写入
`apps/output/automation/quality-gate-report.json`；`--plan` 只打印顺序，
`--skip-release` 跳过发布相关阶段。
