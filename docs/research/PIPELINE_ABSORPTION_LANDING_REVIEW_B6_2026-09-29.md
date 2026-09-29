# 八个吸收 + P1-P6 落地换眼独立审读报告(B6,2026-09-29)

> 定位:laneDocs 泳道 B6 工单——以未参与落地的眼,对「八个吸收」及全部落地文件(15 件)逐项出审读意见。**只读+只出意见,零修改**(本报告文件本身除外)。
>
> 审读人声明:本眼未参与 cb9b3a9/2b420c5 两笔落地的任何实现;全部结论来自本会话对提交版与测试件的实读实跑。

## 〇、审读口径

1. **真源=提交版**(工单约束①,防跨泳道竞态):代码与文档一律以 `git show cb9b3a9:<path>` / `git show 2b420c5:<path>` 为准。归属核对实跑:两提案档最后提交=6bd5211(吸收入库笔),`git diff 2b420c5 HEAD -- <三档>` 空输出=2b420c5 版即 HEAD 版;REFERENCES 档首现于 2b420c5;lint 容量件与 prompt-anaphora 件取 cb9b3a9 版,其余代码件取 2b420c5 版(visual-continuity.ts 两笔均改,取终态 2b420c5 版)。下文引用一律记作 `(cb9b3a9:path:line)` 或 `(2b420c5:path:line)`,行号即该提交版行号。
2. **工作树对照推迟**:按约束①须在 laneFrontend+laneStudio 写项(B1/B3/B4)完成后取,本审读不做。只读盘点备案:`git diff --name-only 2b420c5 -- <15 件路径>` 当前仅命中两提案档(=本 run B5 状态回写,已知增量,未作为审读依据);13 件代码档工作树==2b420c5。
3. **「八个吸收」口径**:两档正文可数项=五提案(吸收档 §一~§五)+P1-P6(规范档 §七)共 11 项;「八个吸收」字样在 docs/ 与 apps/ 全 *.md 零命中(grep 实跑),6bd5211 提交信息有「四域八件」字样(或即出处,该八件中招式库三件与 direct-zh/SKILL 两件不在本 B6 清单)。按工单「主会话未提供独立清单,按落地文件清单全读、多读不漏」执行——本报告覆盖 B6 工单 files 全部 15 件,B5 归并口径非八项,故不以八为纲。
4. 矛盾照报不定谳(约束④);不评价生成产物画面(约束⑤)。

## 一、逐件审读记录(15 件,每件至少一条)

分级图例:**一致**(实现与提案/规范口径相符且有测试锁)/**存疑**(发现矛盾或漂移,照报不定谳)/**建议**(改进提示,不构成阻断)。

### 1. docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md —— 一致(附 1 存疑)

- **一致**:五提案「提案—待拍板」框架与 §〇现状对照的缺口判定,与两笔落地形成清晰闭环:提案一容差口径(§一:26「容差=两者取大(5 秒或 10%)」)由落地件补明基数=预算值(04 件 :103,:125,容差公式 `max(TOLERANCE_ABS_SEC, TOLERANCE_RATIO*budget)`);提案二三处置阶梯(§二:61)与 lint REMEDIES 逐字对应(05 件 :35);提案三三态(§三:96)与 precheck 判定树对应(06 件 :183-226);提案四六项生产资料(§四:122)与 MATERIAL_ITEMS 六项一一对应(07 件 :72-108,takeover 测试 `test_material_items_match_proposal_six` :47 锁定);提案五四字段(§五:153)与 FOUR_FIELDS 逐字对应(08 件 :57)。
- **存疑(锚点旧档混用风险)**:§〇表(:17)与 §五(:157,:165)三处引用 `promote_chapter001_storyboard_continuity.py:469-471`,该路径指向**仓库根目录旧存档件**(23,084B,git log 止于 d29a634;ls+git log 双证);现行真源在 `pipeline/` 子目录同名件(2b420c5 版 37,415B,888 行)。旧档行号在本轮落地后既不对应 pipeline 件、也不再是任何活跃链路的锚。正文属 6bd5211 裁定原文,B5 回写按约束未改;照报漂移,不定谳是否修文。
- **建议**:提案一原文未写容差基数(「10%」的百分母),落地件已定=预算值;建议后续文档维护时在 §一:26 补一句基数口径,消除「10%×谁」的歧义。

### 2. docs/comfyui-kb/跨镜连续性规范-0928.md —— 一致(附 1 存疑)

- **一致**:§三禁指代词清单(:87-89,18 词)与 prompt-anaphora 冻结常量逐词同序一致(14 件 :15-35,测试 `t_pa:29` 双向锁);§四三态处置表(:106-112)与 storyboardAxisIssues 判定顺序对应(13 件 :364-421:证据门→站位词表→左右互换→动机词表放行);§五编号格式(:123)与 DIALOGUE_CUE_ID_PATTERN 及 cue 件 CUE_ID_PARSE_RE 同构(13 件 :513;11 件 :62-64);§六区间语义(下界被改镜/上界首独立镜)与 affected_continuity_interval 实现及测试钉住的 §六自拟示例完全对应(09 件 :224-279;`t_promote:581` 用 SH05~SH08 四镜夹具逐字段断言,含断链=上界、legacy 回接延区间两个变体);§七 P1-P6 六项全部有落地对应(见下各件)。
- **存疑(行号锚点漂移)**:§一⑤引 `visual-continuity.ts:338`(【场景锁】段)、§一④引 `:547-557`(道具检查)、§六引 `:567-599`(markContinuityDependentsStale)、§六/§七P5 引 `tests/test_promote…:213-235`——经实跑核对,这些行号在 6bd5211 基线**全部准确**(如 6bd5211 版 markContinuityDependentsStale 恰在 :567、buildContinuityPrompt 在 :327),但两笔落地共 +246 行插入后已漂移(2b420c5 版 markContinuityDependentsStale 在 :788-820、【场景锁】在 :440、selected-shot 测试群在 :200-283)。锚点失准=后续按行号直达会落错位;照报,不定谳是否重锚。

### 3. docs/research/REFERENCES_MISSING_COMPILE_GATE_EVALUATION_2026-09-29.md —— 一致

- **一致**:P6 验收口径「评估结论落档即可(升/不升+理由)」由本档满足(:61 自对照);结论「不升」三条理由的代码锚点全部经本会话对 2b420c5 提交版复核成立:`references.missing` 为 21 项闭集成员(13 件 :15-37,实数 21 与档述一致)、audit 映射在 :838、`ok: issues.length===0` 在 :895、assertVisualContinuityApproved 在 :898;两条正式编译链的门:App 一键成片链(chapter-auto-video.ts,档引 :196/:903,本次未展开复核该文件——如实力薄弱点已标注)与 automate 链(12 件 :152-166 `requireVisualContinuityPreflight` 对 `report.ok!==true||approved!==storyboards` 直接 throw,:1431 阶段名,与档引 :1431-1433/:154-166 吻合);audit-visual-continuity.ts:30-31 `!audit.ok` 即 throw(提交版实读逐字吻合)。档内「38 镜实测 references.missing=0」为其自引干跑数据,本审读未重跑(见 §二.2 关联矛盾)。

### 4. apps/build/chapter_video/review_chapter001_duration_chain.py(2b420c5)—— 一致

- **一致**:四级链①②③级落地:①场预算=入参 JSON 人工填报、工具不代算不平均分配(:189,:349-356);②成稿复核=Σ镜正推、容差 max(5s,10%×预算)双向判(:100-134)、超限场给三选一决定记录位 decision=None 只登记不代决(:70-71,:329-332)、「严禁自动加快语速」=零改写路径+`advisory:True`(:71,:212;测试 `t_review:230` 锁输入零突变);③镜级正推核对 ceil(字数/语速)+开销(:86-97,:271-314);数值真源经 import lint 模块复用零第三处镜像(:48-65;测试 `t_review:60` 锁「无第三镜像」、`:76` 锁与 computeDurationSec 同构);逐级真源声明 sourceOfTruth(:186-196)对应验收「任何一级的数字能向上追溯」。第④级声明不在本工具边界(:195)。
- **建议**:②级成稿复核值只含台词镜正推,空台词镜时长未入 Scene 复核值——docstring 已自declare(:33-35),但动作 heavy 场(无台词镜多)会系统性低估复核值、影响与预算的比对;后续可考虑把无台词镜的名义时长单独列账。

### 5. apps/build/chapter_video/lint_chapter001_dialogue_capacity.py(cb9b3a9)—— 一致

- **一致**:计算链固定=语速(怒4/平3/悲2)→可用说话时间(durationSec−开销)→容量 floor(可用×语速)→超容即违例(:106-123),与提案二顺序(:59-61)逐句对应;词表镜像真源经对 storyboard-table.ts:67-81 提交版逐词核对**完全一致**(FAST/SLOW 词表同词同序、computeDurationSec=ceil(len/speed)+1,测试 `t_lint:24` 锁镜像);开销缺省 1.0s+逐镜覆写(:48-53);三处置 remedies(:35,:102,:122);禁止路径(机械翻倍/加快语速)不可达=纯只读报告零改写(:9;测试 `t_lint:157`);边界测试 36/37 字分界(:35)、悲2 边界(:87)、CLI 双形状+退出码(:198)。
- **建议**:字数统计含「角色名:」前缀的口径偏差已在 docstring 自declare(:18-19「双向自洽」);若后续要对账 P4 的 dialogueText(本镜完整文字),两处口径需先对齐。

### 6. apps/build/chapter_video/precheck_chapter001_keyframe_mobility.py(2b420c5)—— 一致(附 1 建议)

- **一致**:五维全落且机检不动的维度如实标「需人工」不硬造判据(:4-13:遮挡恒人工/脆弱锁定验证人工/景深未命中人工/动作空间无命中人工);三态判定树(:183-226)与提案三:96 对应,「不动」书面理由附词表零命中扫描证据非默认值(:216-223;测试 `t_precheck:177` 锁「需书面理由非默认」);advisory 不拦不删(:19-22,:255;测试 `t_precheck:304`);开关位接线=automate.mjs:26 `MYSTUDIO_CHAPTER_VIDEO_MOBILITY_PRECHECK==='1'` 默认关,:174-197 非零退出只登记「chain continues; 不拦不删」,调用点 :1440-1441(测试 `t_precheck:59` 锁词表锚定提案三、`:254` 锁退出码)。
- **建议**:提案三:96 的「动作配额=每镜最多 1 主动作+1 物理伴随动作」未落机检;docstring 以「python 可达部分」(:36-37)划界但未点名排除配额。验收口径(吸收档:112-114)未含配额,故不算欠验收;建议后续或在档内明示排除,或补机检。

### 7. apps/build/chapter_video/takeover_chapter001_finished_script.py(2b420c5)—— 一致

- **一致**:两轮制=Round1 缺省只产检查报告且剔除路由标注(:422-427,`noProductionArtifacts:True` :325);Round2 `--confirm` 校验 Round1 报告内 sha256,剧本变了 stderr 指引+exit 1(:429-440;测试 `t_takeover:196` 锁拒绝、`:215` 锁须先走 Round1);最短路由三态(可直接进分镜/先补资产/先补表演节拍,资产先于表演,:250-263;测试 `:135`);六项生产资料与提案四:122 逐项对应(:72-108);剧本零写入路径——全文件对剧本只 read_bytes(:359,:399),「chmod 0444 亦照常完成」(:18)实义=只读文件上照常运行(测试 `t_takeover:227` round1_succeeds_on_read_only_script_file 行为证明,非工具执行 chmod);时长初估项与 A2 工具数值 import 复用互引(:23-25,:53-61;测试 `:66` 锁对齐)。
- **建议**:docstring :17-18「剧本文件 chmod 0444 亦照常完成」易被读成「工具会 chmod」;建议后续措辞改为「剧本即使 chmod 0444 亦可正常接管(只读行为证明)」。

### 8. apps/build/chapter_video/ledger_chapter001_cross_layer.py(2b420c5)—— 一致(附 1 存疑)

- **一致**:四字段逐成果承载(FOUR_FIELDS :57;测试 `t_ledger:154` 锁「恰好四字段」);过期真源=promote 写入的 downstreamExpiry,本工具只读生产 store 不写(:10-12,:19);零误伤=list_expired_downstream 只读显式标记(:316-337;测试 `:290` 锁零误报);CLI 三模式=缺省落盘/--artifact/--list-expired(:359-388;测试 `:331`);确定性快照无时间戳(:19-20;测试 `:304`)。
- **存疑(上游层覆盖面)**:提案五(:149-153)的上游=「剧本/分镜/资产/表演节拍」四层;账本成果类型=frame:*/asset:*/h3-clip|tts-audio|tts-job|prompt(:5),**剧本层与表演节拍层无记录类型**;级联触发也仅分镜推广一层(promote docstring :11-12 明示资产批准推广不产生标记)。验收「上游任一层改版确认后…」按字面仅在分镜(+资产只读账本)两层成立。照报欠拟合面,不定谳是否属本轮有意裁剪。

### 9. apps/build/chapter_video/pipeline/promote_chapter001_storyboard_continuity.py(2b420c5)—— 一致(附 1 存疑)

- **一致**:提案五①级联=collect_downstream_artifacts 只收分镜既有引用字段零误伤(:54-90)、mark_downstream_expiry 只新增标记不删不重写、幂等重放不标(:93-127)、清除只经下一次人工确认推广(clearPolicy :124);P5 区间=affected_continuity_interval 双判据(previousStoryboardId 同组链+legacy-shot 回接)上界不入区间(:224-279;测试 `t_promote:581` 钉 §六示例);计划门禁拦未标旧帧回接(:578-585;测试 `t_promote:640+` 锁拦截);apply 级联=先取旧帧依赖再覆盖首帧、标 downstreamExpiry+关键帧过期(:750-784);单镜模式只动目标镜零重算(:200-283;测试 `:526` 锁 zero_recompute、`:547` 锁单一标记);dry-run 即预览过期清单(:555-556;测试 `:466`)。
- **存疑(43 镜硬要求 vs 真实 store 38 镜)**::48 `EXPECTED_SHOTS=1..43` 与 :522「生产 store 必须保留完整 43 镜」;而 REFERENCES 档 §二实测同一产线真实 store 为 38 镜(该档 :37)。两事实各自成立、来源不同(本文件硬编码 vs 真实 store 干跑),按现口径全章推广会被 38 镜 store 拒绝。照报矛盾不定谳(或 43 为历史完整章规模、或 store 已缩);单镜模式不受此限(:200-208)。另注:downstreamExpiry 单标记覆写语义=只保留最近一次推广的过期清单,与 clearPolicy 自洽,账本随之。

### 10. apps/build/chapter_video/repair_chapter001_visual_continuity.py(2b420c5)—— 一致

- **一致**:P5「repair 区间内传播」落地:import pipeline 件共用纯函数(:28-33,EXPIRED_FORBIDDEN_USE/affected_continuity_interval/legacy_dependent_keyframes/mark_keyframes_expired 同源);逐组首改镜求区间→区间成员内 legacy 回接关键帧标「已过期-禁止使用」(:707-744);stale 传播只在区间成员内、直接改镜除外(:754-760;测试 `t_repair:415` 锁稳定上界、`:466` 锁 legacy 回接延区间)。docstring 自declared「不重生图不删资产、缺省 dry-run」(:4-8)与红线一(先 dry-run 后 --apply 自带备份)口径一致。

### 11. apps/build/chapter_video/dialogue_cue_numbering.py(2b420c5)—— 一致(附 1 建议)

- **一致**:编号格式 S{镜号}-D{台词序}{段序}(:6-12,:62-64)与 §五:123 及 P2 dialogueCueId 守卫同构;单元=store 既有 `<br>` 分隔约定(:83-86);超长拆段只落机检可判子集(句末标点→换气符→无停顿不硬切,语义转折归人工,:14-18);五类对账=duplicate/missing-in-tts/missing-in-dialogue/value-mismatch/non-contiguous(:252-293;测试 `t_cue:154/:167/:185/:194` 各类锁定、`:228` 锁 store 零改写、`:39` 锁 §五示例格式);跨镜跨切形态(S07-D1b 属后镜)格式接受、指派归人工(:10-12;测试 `:219` 锚定)。
- **建议**:P4「三处取值一致」中字幕 cue 侧按 docstring 自声明「按同一格式接入」(:4-5)——本工具只对账分镜/TTS 两处,第三处未机器对账;建议后续接线时补第三侧夹具。

### 12. apps/build/chapter_video/automate-chapter001-video.mjs(2b420c5)—— 一致

- **一致**:提案三开关位=:26 `MYSTUDIO_CHAPTER_VIDEO_MOBILITY_PRECHECK==='1'` 默认关;runKeyframeMobilityPrecheck(:172-197)advisory 非阻断——非零退出打日志「chain continues; 不拦不删」后继续(:188-196),报告落 apps/output/automation/(与 06 件 :32 落盘路径互证);调用点 :1440-1441;视觉预检硬门 requireVisualContinuityPreflight(:152-166)对 `report.ok!==true||approved!==storyboards` throw——P6 档「automate 链已被 audit.ok 事实阻断」的机器载体即此;阶段名 visual-continuity-preflight 在 :1431,与 P6 档引吻合。

### 13. apps/frontend/lib/studio/visual-continuity.ts(2b420c5 终态)—— 一致(附 1 建议)

- **一致**:P1=code 联合扩 axis.crossing/axis.unconfirmed(:32-33)、storyboardAxisIssues 三态判定(:381-421)、接线只在链有效前後镜且 audit 只 push 一次(:857-865);8 新用例三态全覆盖+P1 验收「左右互换由换机位 justify 不得误报」(t_vc:586-645,其中 :616 即该验收)+回归护栏(:645)。P2=指纹剔除四新字段(:485-488,决策注释 :477-484;测试 t_vc:672 锁「事后加合法字段指纹逐字节不变→既有批准零扰动」);守卫式消费挂三段早返回后(:638-640;三新码 continuity.anchor/dialogue/frame 实现 :531-606;测试 :702/:732/:753 锁非法检出、:684 锁合法零新 issue、:775 锁接入审计链)。P3 接线=只检产物层 storyboard.prompt(:842-852,分层豁免);buildContinuityPrompt 去「承接上一镜」改【前序衔接】事实表述(:434-439;测试 t_vc:812/:819 锁模板零命中、:855 锁计划层豁免、:825/:843 锁产物层逐词发码带三步指引)。markContinuityDependentsStale 仍为同组下游全区间保守语义+只对已审行标 stale(:788-820),与规范 §六「现语义=保守可靠」描述一致。
- **建议**:P1 落地时声明的折衷——「worldAnchor 属 §七P2 提案、本判定以 position 3×3 站位作空间依据代理」(:376-379)——在 P2 已落地(15 件 :97)的现行版**未回补** worldAnchor 判据;是否回补属新裁定,此处只提示存在该接线位。

### 14. apps/frontend/lib/studio/prompt-anaphora.ts(cb9b3a9)—— 一致

- **一致**:18 词冻结常量顺序抄自规范 §三:89(:15 声明,:16-35 实词;测试 t_pa:29 双向锁——清单多词/少词/异序都会红);纯函数零 React 零副作用(:3-7),「本模块不知道层别、双层规则由调用方负责」(:5-7;测试 t_pa:54 锁同文本两读一致);重叠合并报最长词(:66-83;测试 :66/:72 锁「上一镜头」「仍保持原样」合并);已知限制(中文偶合子串误报如「一同上岸」含「同上」)如实声明不设白名单(:9-12)。章节档 §三清单 18 词经人工逐词比对与常量完全一致(本会话实读两处)。

### 15. apps/frontend/types/studio-storyboard-types.ts(2b420c5)—— 一致

- **一致**:P2 落地=新类型 ShotContinuityWorldAnchor(:65-71,characterId/landmark/relation 三非空字段,与 §二「地标+相对关系」句式对应)与 ShotFrameReferencePresence 三态闭集(:75,present/pending/missing=有图/待补/缺失,§一⑧);ShotContinuityState 纯加法四可选字段 worldAnchor/dialogueCueId/dialogueText/frameReferencePresence(:97-107),注释块明示向后兼容+指纹剔除+守卫机检三决策(:92-95)与 13 件实现互证;接口其余字段(:77-95)未动,ShotContinuityState 消费面(CRITICAL 248 依赖)零反噬由 tsc 门禁背书(2b420c5 提交信息,本审读未重跑 tsc)。

## 二、横切发现(跨件,照报不定谳)

1. **规范档行号锚点漂移**(件 2 详述):§一④⑤/§六/§七P5 共至少 5 处 `path:line` 锚在 6bd5211 基线全准、两笔落地后失准(位移 +130~+221 行不等)。B5 状态回写按约束只加标未改正文,漂移仍在。属文档维护债,非代码缺陷。
2. **promote 43 镜 vs 真实 store 38 镜**(件 9/件 3 详述):`pipeline/promote…py:48,:522` 硬性 1-43 镜 vs REFERENCES 档实测 38 镜。单镜模式不受影响;全章模式按现口径会在真实 store 上拒绝。两事实均有实锚,矛盾照报。
3. **提案五上游四层覆盖**:级联仅分镜层触发+资产层只读入账本;剧本层、表演节拍层既无级联也无账本记录类型(件 8 详述)。
4. **P1×P2 接线位**:axis 判据的 worldAnchor 代理折衷未随 P2 落地回补(件 13 详述)。
5. **提交信息计数口径**:cb9b3a9 称 P3「26用例」;提交版测试件可见用例=t_pa 8 个 it+t_vc P3 相关 5 个 it=13(表驱动断言展开或为其口径,未逐条数断言);同笔「P1 8新用例」与 t_vc:586-645 恰 8 个 it 精确吻合。计数口径不明,照报。
6. **P6 档一处自力薄弱点**:档引 chapter-auto-video.ts:196/:903(App 一键成片链)本次未展开实读(不在 B6 清单 15 件内);automate 链侧已实读吻合。该档其余锚点全部复核成立。

## 三、结论汇总

| # | 件 | 分级 | 测试锁定要点(提交版实读) |
|---|---|---|---|
| 1 | 吸收分析档 | 一致+存疑(旧档锚点) | —(文档) |
| 2 | 跨镜连续性规范 | 一致+存疑(行号漂移) | —(文档) |
| 3 | REFERENCES 评估档 | 一致 | —(文档;代码锚复核成立) |
| 4 | review_duration | 一致 | t_review:60/76/87/130/230 |
| 5 | lint_capacity | 一致 | t_lint:24/35/105/157/198 |
| 6 | precheck_mobility | 一致(+建议:配额) | t_precheck:59/177/254/304 |
| 7 | takeover | 一致 | t_takeover:47/66/135/196/227 |
| 8 | ledger | 一致+存疑(上游层) | t_ledger:154/290/331 |
| 9 | promote(pipeline) | 一致+存疑(43v38) | t_promote:414/526/547/581 |
| 10 | repair | 一致 | t_repair:415/466 |
| 11 | dialogue_cue | 一致(+建议:第三侧) | t_cue:39/154-194/228 |
| 12 | automate.mjs | 一致 | (接线由 06 件测试+实读覆盖) |
| 13 | visual-continuity.ts | 一致(+建议:worldAnchor 回补位) | t_vc:586-645/672-787/812-855 |
| 14 | prompt-anaphora.ts | 一致 | t_pa:29/54/66/72 |
| 15 | studio-storyboard-types.ts | 一致 | t_vc:653-787(P2 组) |

**总评**:15 件全部有审读记录;实现与两档提案/规范口径在各自声明的边界内一致,验收要点均有提交版测试锁定(含 §六示例逐字钉住、18 词双向锁、指纹逐字节不变锁);发现 2 项照报矛盾(旧档锚点混用风险、43v38)、2 项欠拟合面(提案五上游两层、P4 第三侧)、4 项建议(容差基数补文档、动作配额明示、chmod 措辞、worldAnchor 回补位)。全部照报不定谳,零修改被读文件。

> 工作树终态对照:按工单约束①推迟至 laneFrontend+laneStudio 写项完成后;当前时点 15 件中仅两提案档有工作树增量(=本 run B5 状态回写,已知)。
