# 小黑 H3→LTX2.5 二采原件归档（只读参考，禁运行、禁拷码）

来源：B 站 UP「8g显存小黑的折腾日记」（space.bilibili.com/96854764）搬运材料包，原件落在 `~/Downloads/1106-xiaohei-h3ltx/`，本目录为 2026-11-06 逐字节复制归档（`cmp` 七件全 OK，合计 797,247 B）。

| 件 | 节点数 | 是什么 |
|---|---|---|
| `H3+LTX2.5_二采_一代极速版①.json` | 67 | LTX 换域二采一代（音频支线直通源音） |
| `H3LTX2.5_二采_二代音频对齐版.json` | 76 | 二代（接 `LTXVAudioVAEEncode` 重编码音频） |
| `H3LTX2.5二采_潜空间_转换器_三代单人锁脸_加强版.json` | 76 | 三代（+`XHLTXIdentityOverlap` 锁脸支路） |
| `H3二采放大转LTX2.5三步精修_首尾.json` | 75 | 三步精修 + `RTXVideoSuperResolution` |
| `H3转LTX2.5放大两倍三步精修_首尾_.json` | 77 | 放大两倍变体 + `RTXVideoSuperResolution` |
| `英伟达2klora精修.json` | 45 | **零 LTX 权重**的纯 H3 二阶段精修（NVIDIA Open-H3-Regenerate-2K 配方） |
| `H3LTX2.5二采_节点包与安装说明.txt` | — | 172 行：节点包清单、逐件模型下载说明、低显存纪律(§6) |

**纪律（三条，违反即返工）**

1. **只仿设计与参数口径，禁拷代码与文案**：`Comfyui-XH_Toolbox` 是作者自研包且无公开源；包内 `h3转ltx25精修提示词` skill（含 `SKILL.md`/`references/`/`check_ltx_prompt.py`）**故意不入库**——属他人自研，我方只吸收其结论。
2. **不要原样在引擎里跑**：这些 json 引用 `XH_Toolbox` 节点与 LTX2.5 五件权重，我方两机均无 → 物理起不来；且它们不是漫影工作流库件，不进域分类、不进 App 侧栏。
3. **权重不分发**：链上 H3 系件受 MiniMax H3 Community License 约束（适用地域、衍生品、分发须随附 NOTICE 等），本目录只存 workflow 明文，不含任何模型权重。

排查与吸收判定（可吸收矩阵 A/B/C/D 四层、C1-C15 执行门禁、合规口径）见同层 [`../参考_小黑H3转LTX可吸收排查.md`](../参考_小黑H3转LTX可吸收排查.md)；执行役档=`.trellis/tasks/11-06-xiaohei-h3ltx-absorb/`。
