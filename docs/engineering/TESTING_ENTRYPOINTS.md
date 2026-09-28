# 测试与验证入口总目录(TESTING_ENTRYPOINTS)

> **真源声明**:命令序列的唯一副本住在 `apps/package.json`(npm scripts)与各编排脚本内;本文档只做「改动类型 → 必跑入口」的指认与路由,**不复制命令字面量**。若本文与真源有出入,以真源为准并回来修本表(对拍口径见文末)。CI 链路真源 = `.github/workflows/build.yml`(quality job 逐 push/PR 跑 `npm run test:all`)。
>
> 所有 npm 入口从 `apps/` 执行;全部报告落 `apps/output/automation/`(JSON,旧报告自动归档)。

## 指认表:改了什么 → 必跑什么

| 改动类型 | 必跑入口(npm 别名 / 工具) | 证据标准 | 真源指针 |
|---|---|---|---|
| 前端 TS/TSX(组件 / store / lib / electron) | 收官全量:`npm run test:all`;快反馈腿(咨询性,不拦门):`npm run test:related -- <改动文件>` | exit 0 + quality-gate-report.json | [`package.json`](../../apps/package.json) `test:all`/`test:related` · [`run-quality-gate.mjs`](../../apps/build/scripts/run-quality-gate.mjs) |
| Python 六域(engines / my_nodes / chapter_video / build_scripts / backend unittest / trellis) | `npm run test:py`(单域排障:`--domain <name>`) | exit 0 + python-tests-report.json(六域齐全) | [`package.json`](../../apps/package.json) `test:py` · [`run-python-tests.mjs`](../../apps/build/scripts/run-python-tests.mjs) |
| 工作流 JSON / 三生成器(道劫 t2i / i2i / qwen21-edit) | `npm run test:workflow`(四段:幂等重跑 / 契约 pytest / 布局棘轮 / 落位审计);**跑生成器前必须先过 preflight_gate(见下纪律)** | exit 0 + workflow-gate-report.json;生产 JSON 与生成器零改动 | [`package.json`](../../apps/package.json) `test:workflow` · [`workflow_gate.py`](../../apps/build/scripts/workflow_gate.py) |
| 打包 / 覆盖安装 | 打包唯一入口 = `build-mac.sh`(AGENTS.md 铁律,不得绕过);装机独立复核:`npm run verify:installed` | exit 0 + verify-installed-report.json(两向 asar 哈希相等) | [`package.json`](../../apps/package.json) `verify:installed` · [`verify-installed.mjs`](../../apps/build/packaging/verify-installed.mjs) |
| 引擎运维(ComfyUI 引擎 / keeper / sidecar 状态排查) | `npm run doctor:engine`(四段全只读;引擎 down = 合法态不判红) | 退出码 0 = 健康/合法 down;仅 token mismatch / 双引擎并存 = 1;engine-doctor-report.json | [`package.json`](../../apps/package.json) `doctor:engine` · [`engine_doctor.py`](../../apps/build/scripts/engine_doctor.py) |
| 卫生域(脚本命名 / 台账核账 / 文件尺寸 / 工作流图 lint / 文档审计) | `npm run hygiene`(已挂 test:all 段;单项脚本命名 lint:`npm run lint:scripts`) | exit 0 + hygiene-gate-report.json | [`package.json`](../../apps/package.json) `hygiene`/`lint:scripts` · [`hygiene_gate.py`](../../apps/build/scripts/hygiene_gate.py) |
| 编辑共享真源前(并行协作) | `python3 apps/build/scripts/preflight_gate.py <paths>`(工具,不走 npm;跑生成器前加 `--regen`) | GREEN(exit 0)才动手;静默窗红须查证写入者后再 `--force`(记档) | [`preflight_gate.py`](../../apps/build/scripts/preflight_gate.py) · 报告 preflight-report.json |
| 提交收官 | `sh apps/build/scripts/commit_gate.sh -m "<信息>" -- <pathspec>`(工具,不走 npm) | 双向对账绿 + 提交后再核 + `git show HEAD --stat` 自动抽验 | [`commit_gate.sh`](../../apps/build/scripts/commit_gate.sh) |

## preflight_gate 使用时机纪律(强制)

**AI 编辑共享真源、或跑工作流生成器之前,必须先过 `preflight_gate`**(三段只读:存在性 / mtime 静默窗 30min / git 脏态),GREEN 才动手:

- **共享真源**(非穷举,判据=多会话/多脚本共同依赖的入口与配置):`apps/package.json`、`run-quality-gate.mjs`、`run-python-tests.mjs`、`requirements-ci.txt`、CI yaml、搜索 SOP(真源 `.claude/knowledge/search-sop.md`)等。
- **跑生成器前**:加 `--regen`——生成器会覆写目标 JSON;若目标含画布手调,先备份对账再动手(2026-09-28 覆盖事故语义)。
- 静默窗红灯 ≠ 一票否决:先查证写入者(`git log`/`git status` 对齐 mtime 与提交时刻);确认是已落定提交的编辑残留后方可 `--force` 越过,forced=true 进报告,如实记档。

## 聚合门 test:all 内部构成(指认,不复制)

`npm run test:all`(= run-quality-gate.mjs,fail-fast,报告 quality-gate-report.json)按序聚合:focused-tests → typecheck → lint → **python-tests**(`test:py`)→ **hygiene** → 全量 vitest(`test`)→ smoke:aitoearn-upgrade →(仅 darwin)build:mac → smoke:desktop。阶段顺序与 skip 惯例以 `run-quality-gate.mjs` 的 `--plan` 输出为准。独立细粒度入口(`test:workflow` / `verify:installed` / `doctor:engine` / `test:related` / `commit_gate.sh` / `preflight_gate.py`)不进门禁,原因与边界见各自脚本头部注释。

## 对拍口径(本文档的维护纪律)

本表每一行入口名必须与 `apps/package.json` 的 scripts 实际键逐一对拍(AC7);工具行(preflight_gate / commit_gate.sh)对拍脚本文件存在性。任何 npm 别名增删改,须同步修本表——CI 与 AI 以本表为路由入口,漂移即事故。
