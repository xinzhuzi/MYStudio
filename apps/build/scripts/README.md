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
