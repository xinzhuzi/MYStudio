# ma-gongbi-v1 锁快照(同步守护)

本目录是 MYStudio 道劫手册与 MA `ma-imagegen` 的同步锚点:

- `lock-anchors.json` — 机器可读锚点对(manualAnchor↔maAnchor),契约测试 `lib/studio/daojie-manual-contract.test.ts` 据此校验:①手册硬锁节包含全部 manualAnchor(防手改漂移);②本机 MA 存在时,权威文件包含全部 maAnchor(防快照过期),MA 不存在自动跳过(CI 安全)。
- `runtime-contract.json` — `ma-gongbi-v1` 紧凑运行时合同(三轨映射/模块顺序/分隔符/300-800 长度门/自动层文本),生产编译器 `lib/ai/daojie-prompt-contract.ts` 加载它装配确定性 provider 文本;缺字段/SHA 不匹配时 fail-closed。
- `palette-canon.json` — `ma-gongbi-palette-v1` 色彩代码正典(42 色卡/每轨 8 方案/12 阵营×3 轨配方),由 MA scripts/data/ 两个 TOML 生成;`lib/ai/daojie-palette.ts` 加载它做方案解析与 MA 同构配方文本,AI 自动选配(LLM→规则预筛→source-facts-only 兜底);来源 SHA 与语义投影由同步守护双重校验。
- 同步流程:MA 侧锁文本演化后,跑 `python3 apps/build/scripts/daojie-ma-sync-check.py --ma-root <MA 仓库根>` 出漂移报告(区分「锚点仍在但非锚点文本漂移」与「锚点缺失」;不传 `--ma-root` 时仅做 MYStudio 快照内部一致性校验,CI 安全;加 `--json` 得结构化报告) → 人工更新 prefix.md 硬锁节、runtime-contract.json 与本快照(锚点+sha256+日期)。配套单测:`python3 -m unittest test_daojie_ma_sync_check.py`(在 `apps/build/scripts/` 下运行)。

## 来源指纹(2026-08-25，9 源)

| MA 文件 | sha256 | 提供锁 |
|---|---|---|
| scripts/gongbi/daojie_gongbi_restyle.py | 5e99f2f9…d8bf8 | 底座/结构/身份/衣褶/衣物/头发/鞋靴 |
| scripts/prompting/finish_locks.py | 365f0ca0…65cb3 | 成片质量 |
| knowledge/prompt-templates/美术成片风格提示词模板库.md | 977a0dab…758b9 | 成片主风格锁/通用成片负面(Phase 3) |
| scripts/prompting/gongbi_contract.py | d7f755ef…e71ff | source-facts-only 配料模块 |
| scripts/prompting/length_policy.py | cddf7aa1…0c0a86 | provider-visible 长度与 Avoid 分隔符 |
| scripts/data/三轨选色配料.toml | b1e94b56… | 42 色卡+三轨配色方案(palette-canon) |
| scripts/data/阵营配色与黄金公式.toml | 88be5f17… | 12 阵营×3 轨配方(palette-canon) |
| knowledge/prompt-templates/人物提示词.md | fecfd22a…7ae99 | 三轨写作指导四要素(神态/光词汇/材质微观/动作精度) |
| knowledge/prompt-templates/生图资产模板库.md | 1d734ab5…419b099 | 资产模板写作指导(骨架/角色/场景) |

## 已知有意差异(手册形态适配,非漂移)

- 结构锁英文术语在手册中译为中文(如 diffuse light→漫射光、cinematic key/fill/rim→电影级主光/填充/轮廓光),maAnchor 保留英文原词供直连比对
- 底座锁去掉 MA 项目专属的《三国望神州》商业形似条目
- 「Source facts」在手册语境写为「来源事实」(polisher 链的角色/场景设定)
- 衣物完整锁的 hems 等英文词手册中文化为「下摆」
- 成片主风格锁摘录时省略 MA 原文中的「宣纸/绢本纤维、墨色渗透和矿物颜料颗粒可见」一句——该句与 restyle.py 底座(2026-07-26 用户确认禁纸纹赞美)冲突,以底座口径为准
