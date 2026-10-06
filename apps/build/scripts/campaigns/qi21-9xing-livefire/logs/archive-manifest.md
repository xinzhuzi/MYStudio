# 引擎侧日志归档 manifest — qi21-9xing-livefire(2026-10-06 收账员)

本役实弹时间窗(引擎侧日志锚):**2026-10-06 09:08:07 → 11:37:23**(型1 首拍缓存回声拍入队 → 型6 wh探针2 入队);
产线拍窗口 09:19:53(型1)→ 11:22:03(型6 终态,runs/type-*.md §2)。

| 归档件(本仓 logs/) | 引擎侧源(只读) | 切片 | 字节 | sha256 | 行数 |
|---|---|---|---|---|---|
| engine-side.image-prompts-20261006.lines10-45.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/image-prompts-20261006.log(全件 sha256=6e88f8e5a6734bbeacb2c3bb488f32ea4a845aaeff17a5ed16ea7b4edeebf679,45 行,mtime 2026-10-06 11:37) | 行10-45(=窗内全部 12 次入队块:型1 attempt1 f3539410 + 产线拍 6 发 + wh 探针 5 发;行1-9 为 00:11-00:38 前役三次拍,不在本役窗) | 70450 | 71904c8b246d29eb4a544bcedd16dd19b0954810bea802deeeb772d8e986ca2c | 36 |
| engine-side.engine.console.lines96875-end.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/engine.log(全件 sha256=90a4b6e006b1fab7351ffe95b3950fe4e86b8d3aac5f79c7e3266476059a1170,97469 行,mtime 2026-10-06 11:37;控制台镜像大多行无时间戳) | 行96875-97469(窗起行=09:08:07 入队行,窗止=文件末行;文件 mtime=11:37,窗后无写入) | 623403 | c6107be284785876bb5959dc5077bdbb20fd0c633ba7b39ea2cb4a3335998976 | 595 |

切片法:逐字节按行窗拷贝(`python3 archive_engine_logs.py`,行首锚断言通过后落盘),零改源文件。
复取命令(幂等):
- `sed -n '10,45p' <引擎家>/logs/image-prompts-20261006.log > engine-side.image-prompts-20261006.lines10-45.slice.log`
- `sed -n '96875,$p' <引擎家>/logs/engine.log > engine-side.engine.console.lines96875-end.slice.log`

行窗锚(引擎侧 image-prompts-20261006.log,本役 12 次入队逐笔):
行10 f3539410(09:08:07 型1 attempt1 缓存回声拍)/ 行13 9c4d3719(09:19:53 型1)/ 行16 c1707be8(09:37:35 型2)/
行19 b3a04803(09:58:53 型2 wh探针)/ 行22 fc46aba4(10:08:32 型3)/ 行25 97878877(10:23:41 型3 wh探针)/
行28 ad8280e7(10:31:23 型4)/ 行31 ac5735bc(10:43:40 型4 wh探针)/ 行34 c972ae02(10:56:55 型5)/
行37 a00b747a(11:15:50 型6)/ 行40 d021e881(11:34:28 型6 wh探针1)/ 行43 d53b7e88(11:37:23 型6 wh探针2)。
(序号序列 0,0,0,1,2,3,4,5,6,7,9,10,11,12,13 缺 8=服务端序号器口径,runs/type-5/6 记录 §5/§9 已记,如实。)
