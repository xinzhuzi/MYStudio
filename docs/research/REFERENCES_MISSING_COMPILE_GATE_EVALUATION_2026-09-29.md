# references.missing 编译阻断升格评估(2026-09-29)

> 定位:[跨镜连续性规范-0928](../comfyui-kb/跨镜连续性规范-0928.md) §七P6 的评估结论落档(**只评估,本轮零代码改动**)。P6 原文方向:「`references.missing` 现为审计报告项……不拦编译;评估是否升为编译阻断,与 §三双保险对齐」,验收要点=「评估结论落档即可(升/不升+理由)」。本文全部结论以代码实读行号与真实 store 干跑实测为据,无凭空推断。
>
> 实测时间:2026-09-29;实测对象:装机真实项目 store(`/Users/zhengbingjin/Project/IP/MA`,经 `apps/build/timeline/storage-paths.ts:157 readStudioWorkflowStoreState` 读取,与 automate 链预检同链路);干跑脚本一次性使用后已删,工作树无残留。

## 〇、结论先行

**不升——维持审计报告项,零代码改动。**

三条理由(详见 §三):①「不拦编译」的前提在规范 §三 所辖的两条正式编译链上**不成立**——`audit.ok` 语义已使该码事实阻断编译,升格无增量;②唯一未设门入口(画布单镜生图)不在 §三「正式提示词编译」辖内,且在该处硬拦会打断首图引导流并误伤规范明文允许的非正式测试稿;③实测存量债为零,「待补」状态查询已由 §一⑧ `frameReferencePresence`(0929 已落)承接。

## 一、现状机读:它今天到底拦不拦编译

**码与判定链(行号为 2026-09-29 实读)**:

| 环节 | 位置 | 行为 |
|---|---|---|
| code 闭集成员 | `apps/frontend/lib/studio/visual-continuity.ts:17` | `"references.missing"` 为 21 项闭集成员之一 |
| 判定源头 | 同件 `:241 assertOrderedReferences` | 清单缺失/为空 → throw「缺少有序视觉参考清单」(`:247`);条目无图或带 missing 标记 → throw「第 N 个参考图不可用」(`:255`) |
| audit 映射 | 同件 `:838`(auditVisualContinuity 主循环 catch) | 消息不含「顺序/版本」关键词 → 落码 `references.missing`,push 进 issues |
| ok 语义 | 同件 `:895` | `ok: issues.length === 0`——**任一 issue(含 references.missing)即 ok=false** |

**两条正式编译链均已在此闸内**:

1. **App 一键成片链**:`apps/frontend/lib/studio/chapter-auto-video.ts:196` 对整章 `assertVisualContinuityApproved`(定义 `visual-continuity.ts:898`,`:903` 对 `!audit.ok` 直接 throw)。注释明示「连续性按整章链校验(子集会切断『上一镜』关系);单镜收窄的只是 TTS/入队范围」——单镜视频生产同样过整章闸。
2. **build 侧 automate 链**:`apps/build/chapter_video/automate-chapter001-video.mjs:1431-1433`(`visual-continuity-preflight` 阶段)→ `:154-166 requireVisualContinuityPreflight`(脚本常量 `:16`)→ `apps/build/chapter_video/audit-visual-continuity.ts:30-31`(`!audit.ok || approved !== storyboards` 即 throw)。注:该 mjs 文件当前处于并行会话修改中,行号取自当日实读,函数名为稳定锚点。

**唯一未设门的编译入口=画布单镜生图**:`apps/frontend/lib/studio/image-workflow/request.ts:65-67,94-96` 从画布参考节点组装 `orderedReferenceManifest`/`referenceImages`,零参考节点的图也可发起生图(最终提示词组装在 `graph-build.ts:316-321`,`buildContinuityPrompt` 输出拼入 finalPrompt)。§七P6 所述「不拦编译」仅在该入口成立。

## 二、影响面实测(真实 store 干跑)

对 chapter-001 全量 38 镜跑 `auditVisualContinuity`(与预检同口径,含 continuityAssetVersions):

| 指标 | 实测值 |
|---|---|
| 镜数 | 38 |
| `references.missing` 计数 | **0** |
| 其它 issue 分布 | review.missing 38 / axis.unconfirmed 29 / continuity.stale 19 / references.version 1 / prompt.anaphora 1(合计 88,approved=0,pending=38,stale=19) |
| 参考清单原始统计 | 无清单镜 0;空清单镜 0;清单条目共 128 条;条目 missing 标记 0;条目无 imagePath 0 |
| 本镜图在场性 | mediaRef 25/38;keyframes 37/38 |

**解读**:①`references.missing` 存量债为零——38 镜清单全量在位且逐条有图,「缺图镜」在真实数据中不存在;②当前链红的 88 条 issue 全部来自既有/新近门禁的用户侧整改未完成(轴线三态 P1、禁指代词 P3/A5、审核/过期流转),与 references.missing 无关——升格与否对真实链当前状态**零边际影响**;③本镜图在场性(mediaRef/keyframes)是另一维度(§一⑧),25/38 有 mediaRef 但 37/38 有 keyframes,说明首帧以关键帧序列承载为主,该维度的「待补」查询已由 A1 落的 `frameReferencePresence` 三态字段承接(`apps/frontend/types/studio-storyboard-types.ts`,2026-09-29)。

## 三、不升的理由

1. **升格在正式编译链上是零增量**。§三双保险(「缺一不编译」)所辖的正式视频镜编译入口=App 一键成片链与 automate 链,两者今天都已经因 `audit.ok` 语义把 `references.missing` 当编译阻断处理(§一机读)。把「报告项」改「阻断项」在这两条链上没有可实现的代码位点——机制已存在。
2. **唯一可设门的入口不该设门**。画布单镜生图(`request.ts`)是本镜参考图的**生产现场**而非「正式提示词编译」:分镜首图生成时 storyboard 项尚无 orderedReferenceManifest(三件套由 `apps/frontend/lib/studio/image-workflow/continuity-landing.ts:4-11` 在生图回写后落库),在此硬拦「无参考不生成」=打断首图引导流(鸡生蛋死锁);且 §三 明文允许「非正式测试稿纯文字先行,但不得登记为可生成正式版本」(规范 `:96`)——硬拦零参考生图会误伤该合法路径。真实链误伤非零,不满足 P6「影响面可控才实现」的前提。
3. **实测背书 + 职责已有承接**。存量 references.missing=0(§二),无整改需求;「待补」作为可查询状态由 §一⑧ `frameReferencePresence`(有图/待补/缺失三态,含审计守卫)承担,无需 references.missing 改语义。

## 四、若未来要升(窄口径备忘,另立项触发)

若日后产线裁定画布生图也须纳入双保险,建议窄口径而非全量硬拦,届时另立项:

- 位点:`request.ts` 组装请求处,仅对「登记为可生成正式版本的 storyboard target」要求 ≥1 个可解析资产参考节点;非正式测试稿与首图引导(目标镜尚无 mediaRef/keyframes 且无清单)显式豁免;
- 配套夹具(§七P6 验收口径):缺图正式镜编译被拦、补图后放行、测试稿不受影响三态各一;
- 触发条件:出现真实存量债(干跑 references.missing>0)或用户裁定收紧测试稿政策。

## 五、验收对照(§七P6)

- 「评估结论落档即可(升/不升+理由)」→ **已落档**(本文件,结论=不升+三条理由+实测数据);
- 「若升,夹具=缺图镜编译被拦、补图后放行」→ 结论为不升,该条件分支不适用,未实现任何拦截代码;
- 本轮零代码改动:仅新增本评估文件,规范正文与生产代码未动。
