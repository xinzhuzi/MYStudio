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
5. **段叙事**:"Segment N of 6, 8 seconds, …" 段内情绪/动作弧;`<Picture 1> (all shots): fully_preserved …pose and expression vary freely; the hairstyle itself never changes`。
6. **22帧桥接句**(循环缝合核心,逐字):"Continuity: the first 22 frames (00:00.000-00:00.917 at 24 fps) **exactly reproduce** the previous segment's final 22 frames, matching **pose, guitar position, hand placement, lip shape**, lighting and camera motion with no cut or pause"。
7. **Handoff out 交接句**:"final frame at 00:08.000: …settling into the final handoff pose…lips relaxed after the final word"(给下一段的桥定姿态)。
8. **Shots 时间轴**:每段 Shot 1-5,切点 00:00/00:02/00:04/00:06/00:07.2(8秒段);"Cuts land on strong musical accents of `<Audio 1>`";运镜白名单(dolly/arc/orbit/rack focus)+黑名单(no whip pan, no snap zoom)。
9. **收尾约束**:"The image is a clean photographic frame, no overlaid text or captions" + 声景声明(Diegetic only: `<Audio 1>` supplies the full sung track)。

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
- 循环段(段≥1)必带 6+7 块;段0 带 5 块的 opening 版。
- 音频窗口对齐:段 i 的提示词内容须与该段实际音频切片对应(音乐从哪秒到哪秒说清)。
