# grill 拷问报告(11-19 双档 PRD V1)——17 条质询全录(供 PRD 修订吸收)

> 拷问对象:.trellis/tasks/11-19-dualmode-facerefine-rename/prd.md(V1);全部条目带真源证据已核。

## A 问题定义
- **A1(high)**:PRD 全文 0 次提及主开关 1065——「默认=远景修脸」在 (1065=False,5111=False) 出厂态下=不开修脸;须增「双开关语义矩阵」(1065×5111 四态),明确「默认」=「开修脸时默认远景档」;若用户意指修脸默认开须回问。
- **A2(med)**:5111=True+1065=False=高清段静默剪枝,调用方误以为在高清修脸;README/API 文档断言或发车器前置校验。
- **A3(med)**:出口复制案(双 5022/5023 二选一,5100 先例同构)同样满足「都在一个分组」且天然保真 masks 悬空——V1 验尸后应优先出口复制而非硬造等效 mask 源。
- **A4(low)**:与 1116/1117 裁定无冲突;recipes.ts 两处字面量(uiTemplateRef)列入必改。

## B 技术可行性
- **B1(high)**:中链 Switch×自定义节点有引擎级墙先例(1117 multiseg:H3AutoContextSampler×ComfySwitchNode 输出剪枝,接线不可修);正典 5100=出口位,中链位无实弹先例(2012 LATENT Switch 在一采入口区有先例)→**5s 双态探针必须前置到改名之前**。
- **B2(med)**:缓存账整章缺失——翻转即全链失效、回翻不复用、自定义投切件指纹不当=**静默串档**(返回错档缓存比慢更危险);AC3 须加数据级断言(远档态同 seed 双跑字节一致)。
- **B3(high)**:4K 高档显存账缺失——4K 内联三次楔死前科(a2 136min/e 中途亡);须写明 YOLO 在 4K 帧/SAM3 只吃 768 crops/VOSR2 只吃 768 画布的分账;AC2 加「完赛无 OOM」;4K 高档首跑排在打包前。
- **B4(med)**:masks 预案(ii)恒接 5104 与 AC3「False 态=正典现状」互斥矛盾;V1 已证悬空=face_only 分支≠全量——**出口复制案升首选**。
- **B5(med)**:V1 补验:masks 张量形状契约(SAM3 逐 track MASK vs 批维度)+undetected_frames=fade_out 交互。
- **B6(med)**:融合段布局三处左向(5103<5011/5107<5013/5110<5021)违反正典恒向右契约(test:283-291);组数 7→8 或扩四采组框;生成器断言加零左向/组框不交。

## C 二阶效应
- **C1(high)**:契约破坏面≥4 测试函数(:45 路径锚/:336-342 件册/:378-387 len==87→100/:256 七组/:283-291 左向/:426-427 钉死旧名)。
- **C2(high)**:引用面漏片:12+活脚本旧路径(sancai_mother_fix/sancai_firepower/sancai_layout_polish/sancai_renumber/sancai_input_ux/sancai_facerefine_build_1117/sancai_relayvsr_variant/sancai_facerefine_p2source/track_params_sync/workflow_layout_fix_sancai_band/h3_canvas_twin_surgery/multiseg_inline_facerefine_build)+use-storyboard-h3-video-batch.ts:384 与同名 .test.tsx:145+workflow_layout_baseline.json+一镜到底-分段.json:1865 README+h3-three-stage-template.json:1446 README+4 测试 docstring;运行时无文件名拼接(grep 证实全字面量),画布直开读 uiTemplateRef 漏改即断。
- **C3(med)**:7_测试 旧名存量四件(RelayVSR/-1110/修脸/小脸修复)处置未裁;test:426 钉死 -1110 名;AC4「零活引用」须定义文件名豁免或全改。
- **C4(med)**:融合生成器「保留」=双依赖死路(CANON 旧名改名后 FileNotFoundError 栈崩;AUTHOR 在 apps/output 可清)→移 retired/ 或加退役短路 exit 0。
- **C5(med)**:13 节点模板真源(克隆件在 7_测试/生成器:46 引用)+API 模板 +13 同构无 AC;AC 加「API 模板 13 节点同构+5111 可注入」。
- **C6(low)**:AC5「正典 md5 锁」查无此物(engine-sync 无哈希字段)→改「gitnexus 重索引+审计对账」或指明落点。
- **C7(low)**:清单计数行/手册「96 节点双件」叙述全要动;AC6 附数字对账(正典 87→100、7_测试 不变、手册改单件双档)。

## 内部冲突(V1 版自相矛盾处)
1. §1.2「公共底盘零改动」vs §1.4 改接 859/871——「零改动」只对 widgets 成立,「逐位」须降格为「数据流等效」;
2. §二预案(ii) vs §1.4/AC3 三者不能同时成立;
3. §3.1 vs §四「移 7_测试」语义悬空(已在 7_测试);
4. 档位表单开关世界观 vs 正典双开关实况(无 1065);
5. **施工序自锁**:序 1 验尸可能推翻 5114 设计→序 2 已按 Switch 定案→序 5 才实弹;探针应前置序 1.5;
6. 13=9+4 记账口径对齐(弱)。

## 遗漏清单
(1065,5111)四态矩阵+README 9999 增 1119 版调用段(极性口径延伸 5112-5114,防 wf2api 反转坑)/API 模板+13 同构注入验证/显存预算节+OOM 判据/缓存失效串档风险行+数据级 AC/布局判据入断言/中链 Switch 先例引用+探针前置/7_测试 旧名四件裁定/活脚本 12 处处置+baseline.json+README 引用/multiseg_inline 以正典为只读模板源(:46)重跑误带 13 新节点未核/AC5 md5 锁落点/V1 补形状契约与 fade_out 交互。
