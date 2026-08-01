# apps/build/scripts

大文本处理与一次性辅助脚本的统一存放处(参见 `.claude/CLAUDE.md`「大量内容处理铁律」)。

## 用途

- 处理 **>1 万字** 的读取 / 转换 / 插入时,脚本放这里,在本地磁盘上读写,**不通过 AI 上下文传递大文本**。
- 跨文件数据汇总、批量数据插入、大文件格式转换等批处理脚本。
- AI 上下文只传元数据和指令,用脚本做重活。

## 为什么放这里

- **进版本库**(区别于 `apps/out/` / `apps/release/` / `apps/output/` 这些被 `.gitignore` 忽略、且会被每次 build 重写的产物目录)。
- 与 `apps/build/daojie/`、`apps/build/timeline/` 同属构建工具边界。
- **不需要删除**,长期保留可追溯。

> 通用大文本脚本放本目录;daojie 成片流水线脚本放 `../daojie/` 与 `../daojie/pipeline/`。

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

## 统一质量门禁

`run-quality-gate.mjs` 是 MYStudio 验证链的唯一编排入口，由
`npm run test:all` 调用。它只组合现有命令，不复制测试实现：默认顺序为聚焦测试、
typecheck、lint、完整 Vitest、AiToEarn upgrade smoke、macOS 打包/覆盖安装/installed
smoke，以及 packaged desktop smoke。报告写入
`apps/output/automation/quality-gate-report.json`；`--plan` 只打印顺序，
`--skip-release` 跳过发布相关阶段。
