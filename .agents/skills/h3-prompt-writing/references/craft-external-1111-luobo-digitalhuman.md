# 外部实证:萝卜数字人V6 六段JSON提示词体系(2026-11-11 吸收)

> 源:B站 BV13BWu6rEjR(程序员萝卜 340集,Pika-H3-Singularity-V2 配套数字人/无限时长 V6)
> 一手材料:~/Downloads/1111-pika-h3-digitalhuman/(全片转写+59帧+8件工作流原件)
> 定位:数字人(音频驱动口型)与循环拼接场景的提示词范式;与既有 h3-prompt-writing 体系互补。

## 一、六段 JSON 容器格式(引擎解析契约)

外层是 JSON 字典,键="0".."N-1" 字符串数字(按数字排序取段),值=该段完整提示词:

```json
{"0": "<段0全文>", "1": "<段1全文>", "...": "...", "5": "<段5全文>"}
```

- **格式错=解析全错**(UP主原话,错一段后面全错);报错时用流程内调试框把当前段扔回 AI 重写。
- UP主工作流用 RB_Code 做 `items[idx % n]` 取段(键数字排序);我们 API 展开时直接按下标取。
- 段数=采样组数(段0初始化+循环段);每段 8 秒(或5/10秒)。

## 二、生成方法(不手写,扔给 AI 改写)

指令模板(UP主实弹原文):

> 修改这个JSON,把原来的提示词改成 0-5 一共6个 **minimax H3 REF全能参考** 的提示词,角色按参考图,拿着吉他演唱,每段提示词8秒时长。这个是原提示词JSON:{…旧JSON全文…}
> 补充约束(多轮补):只有一张角色参考图是单人的;6个视频是连续的每个8秒;中间有22帧衔接帧。

要点:①必须写明「minimax H3 REF全能参考」模型名(否则不按段写) ②给旧JSON做骨架 ③说清单人/多人 ④说明段长与衔接帧数。

## 三、段内结构模板(逐块保真,帧实证)

每段提示词按块组装(块间 \n 分隔):

1. **`<Subject 1>` 主体**:appearance fully referenced by `<Picture 1>`,identity/face/hairstyle/outfit/body proportions 全取自参考图且恒不变;"She is the only performer"(单人声明)。
2. **手部/道具块**(与我方手持道具七要素同构):"Her hands are never empty: in every shot her left hand stays on the guitar neck…no other hand props" + `<Prop 1>` 道具恒存句(the guitar never disappears, changes design or is replaced)。
3. **`<Audio 1>` 音频锁句**(口型驱动核心):"the provided song in 4/4 at about 96 BPM, continuous across all six segments…each 8-second segment uses its matching window with **vocal timing, pronunciation, rhythm, tempo and phrasing preserved 1:1**";无唱段时"her lips stay softly closed and relaxed"。
4. **`<Subject 3>` 场景恒存**:fully_preserved 场景句,appearance unchanged, no added scene elements(循环段防场景漂移)。
5. **段首身份句+运镜前置**(1115 superi 吸收,J6/J7;只改段内模板块序,官方 Ref2VA 容器字段序不动):每段正文第一句=场景/媒介/时代身份句,不是"谁在干嘛"(知识库 §一.9 :84 身份三件套——提示词第一句永远是"这是一个什么场景");写法引 1107 件 A 节首条(:14)medium-first 实证:媒介身份置首、负向句随行(非真人媒介 "A 2D hand-drawn anime animation, not live-action, not photographed, no real actors";实拍/数字人类媒介正向写 "A clean photographic frame on a small stage at night" 式)。运镜矢量自块 9 Shots 时间轴前置至此——镜头先存在,动作发生在镜头里(知识库 §一.9 :81-82 镜头前置/用镜头包裹动作):白名单 dolly/arc/orbit/rack focus、黑名单 no whip pan/no snap zoom;镜头句先于动作句,以 as/toward 包裹动作("the camera slowly dollies in as she sings into the microphone")。
6. **段叙事**:"Segment N of 6, 8 seconds, …" 段内情绪/动作弧;`<Picture 1> (all shots): fully_preserved …pose and expression vary freely; the hairstyle itself never changes`。
7. **22帧桥接句**(循环缝合核心,逐字):"Continuity: the first 22 frames (00:00.000-00:00.917 at 24 fps) **exactly reproduce** the previous segment's final 22 frames, matching **pose, guitar position, hand placement, lip shape**, lighting and camera motion with no cut or pause"。
8. **Handoff out 交接句**:"final frame at 00:08.000: …settling into the final handoff pose…lips relaxed after the final word"(给下一段的桥定姿态)。
9. **Shots 时间轴**:每段 Shot 1-5,切点 00:00/00:02/00:04/00:06/00:07.2(8秒段);"Cuts land on strong musical accents of `<Audio 1>`";运镜白/黑名单已前置至块 5(1115 吸收),逐 Shot 只写切点与景别。
10. **收尾约束**:"The image is a clean photographic frame, no overlaid text or captions" + 声景声明(Diegetic only: `<Audio 1>` supplies the full sung track)。

## 四、与我方体系的对照

| 元素 | 萝卜 | 我方现状 |
|---|---|---|
| 手部道具句 | hands never empty+Prop恒存 | 1108 手持道具七要素——同构,互证 |
| 多段容器 | 六段JSON+idx取段 | 无(单镜单提示词)——**新增能力** |
| 22帧桥接句 | 逐字实证 | 无——**新增**(配 MotionContext/TaperNoise 机制) |
| Audio 1:1 保持句 | 逐字实证 | 无——**新增**(配 NativeAudioLock/ref_audios 机制) |
| Handoff out | 末帧交接姿态 | 无 |

## 五、用法建议

- 数字人/唱歌:块3 换成唱段(写 BPM/拍号/总秒数);对白数字人:写"provided Mandarin narration, vocal timing…preserved 1:1"(1111 我方实弹写法)。
- 段长与切点随段秒数换算(5秒段切点 0/1.5/3/4;8秒段 0/2/4/6/7.2)。
- 循环段(段≥1)必带 7+8 块;段0 带 6 块的 opening 版(1115 吸收后块号+1:22帧桥/Handoff 原 6/7→7/8,段叙事原 5→6)。
- 音频窗口对齐:段 i 的提示词内容须与该段实际音频切片对应(音乐从哪秒到哪秒说清)。

## 六、1115 superi 吸收·待铺(低优,只立清单不展开)

> 出处:11-15 审计台账件#11,8 缺=J3/J4/J5/J6/J7/J9/J10/J11(J1=有/J2=不适用,非缺)。本批已落 J6/J7(§三块5);余 6 缺待铺,真源=docs/comfyui-kb/参考_提示词工程/刺猬星球super-i/知识库.md(下称"知识库"),铺法按台账 §二件#11 拟改法 2/3,防双真源只引用不复制。

- **J3 抽象词量化**:「段内情绪/动作弧」「神情中性平和」等未拆到可判词——知识库 §一.1(:30 抽象词→可量化视觉动作)+ §四(:159 微表情拆到五官)。
- **J4 光线三要素**:方向+照射对象+阴影结果(件内现仅块7 桥接句提 lighting 连续性)——知识库 §三 光线(:124 光源实体+衰减路径;:125 五种导演级打光)。
- **J5 环境因果句**:块4 场景恒存句是防漂保留句,与「因为X所以Y」环境机制句相反方向,须另立环境因果写法位——知识库 §三(:126 因果逻辑+环境拆前中远景)。
- **J9 活人感公式**:「下意识反应+情绪落点」未成文(块2 手部恒存句已含"正在做的小事"半环);口播/演唱=待机感重灾区优先受益——知识库 §四(:160 人物+正在做的小事+下意识反应+情绪落点;:159 肢体伴随动作)。
- **J10 肤质材质词**:数字人近景/特写正向肤质词缺(换脸侧走融合参数,另件处理)——知识库 §四(:157 皮肤当材质不当效果;:159 生图层加肤质细节词)。
- **J11 前景遮挡+空气介质**:数字人侧可补手法条款(viggle 侧按复核驳回记录=豁免注记不补写)——知识库 §三(:136 物理遮挡+氛围遮挡;语义顺序陷阱:不写"前景是虚化的")。
