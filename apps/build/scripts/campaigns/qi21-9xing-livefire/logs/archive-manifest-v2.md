# 引擎侧日志归档 manifest · v2(7-9 型补拍窗)— qi21-9xing-livefire(2026-10-06 v2 收账员)

v1 归档窗见 archive-manifest.md(行10-45 / engine.log 行96875-97469,窗止 11:37:23);本档为 v2 轮续切,无缝续接(v1 切片末行 97469,本窗自 97470 起)。

v2 轮窗口(引擎侧收据日志锚):**2026-10-06 12:12:43 → 13:36:33**;
九型产线三发(7/8/9 型)窗口 **12:50:38(型7 排队)→ 13:31:40(型9 终态,runs/type-7/8/9-*.md §2)**。
窗内事件:7-9 型被取代的三发 App 画布扫场拍(12:12/12:19/12:26)→ 扫场/实验其余投递 → **九型产线三发(12:50:38/13:07:50/13:24:32)** → 工作流真源被他会话改(mtime 13:31:02)→ **引擎重启**(~13:33,横幅 engine.log 行98291「ComfyUI version」/行98463「Starting server」;pid 92224@17000 → 32378@17001)→ 重启后他会话新投一发(number=0,13:36:33,已完成)。

| 归档件(本仓 logs/) | 引擎侧源(只读) | 切片 | 字节 | sha256 | 行数 |
|---|---|---|---|---|---|
| engine-side.image-prompts-20261006.lines46-81.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/image-prompts-20261006.log(归档时点全件 sha256=e80b13d022d4faa8877919a688c35074b59b882f6cea270a1c7e6c0289ee989d,81 行) | 行46-81(=窗内全部 12 次入队块,逐笔见下) | 143623 | 6f0a65d8e1b71f9e397ff0d24c2f0fb99852d4af2c9fc6d527d778f082962589 | 36 |
| engine-side.engine.console.lines97470-end.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/engine.log(归档时点全件 sha256=e9cc7d124935ada30b3d5ba412c12bf00946a7d316dfc38b81753ae03029db1c,98484 行) | 行97470-98484(窗起=v1 切片末行次行;窗止=归档时点末行;含引擎重启横幅) | 680513 | 9d98afafec33d931469eb669d15820e7fabbb2ee34d7123190d334e099e96e63 | 1015 |

切片法:逐字节按行窗拷贝(`python3 archive_engine_logs_v2.py`,行首锚断言通过后落盘),零改源文件。
复取命令(幂等,行窗以归档时点为准):
- `sed -n '46,81p' <引擎家>/logs/image-prompts-20261006.log > engine-side.image-prompts-20261006.lines46-81.slice.log`
- `sed -n '97470,98484p' <引擎家>/logs/engine.log > engine-side.engine.console.lines97470-end.slice.log`

行窗锚(引擎侧 image-prompts-20261006.log,窗内 12 次入队逐笔):
行46 number=14 4945120e(12:12:43,7 型扫场拍→被取代,.bak 存档)/ 行49 number=15 91ea95a6(12:19:25,8 型扫场拍→被取代)/
行52 number=16 2bb4e36f(12:26:29,9 型扫场拍→被取代)/ 行55 number=17 587301c1(12:27:48,他会话投递)/
行58 number=18 8317cb37(12:33:35,他会话投递;type-10-自由 图件 12:40 落位与之相合,自由不在九型,FACTS §6.3)/
行61 number=19 bc1375a6(12:38:37,他会话投递)/ 行64 number=20 3d9fd517(12:40:27,他会话投递)/
行67 number=21 9ff2981b(12:43:11,他会话投递;runs/exp-pe-sysprompt-transparent/ 实验时窗相合)/
行70 number=22 5b05816c(**12:50:38,型7 分镜剧情图 产线拍**)/ 行73 number=23 fec5c1d6(**13:07:50,型8 表情差分 产线拍**)/
行76 number=24 aae7ec8e(**13:24:32,型9 概念气氛图 产线拍**)/ 行79 number=0 3a451e34(13:36:33,引擎重启后他会话新投;序号归零=重启证据)。
(7/8/9 型产线拍 pid 与收账任务书逐字一致;三发扫场拍 pid 与 runs/type-7/8/9-*.md 头部「本拍取代注记」逐字一致;「他会话投递」四笔+重启后一笔不属九型账,pid 原样列,不作归因推测。)
