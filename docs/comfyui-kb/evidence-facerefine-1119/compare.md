# 真源同帧四路终对比(dualmode compare)— 1119

## 口径

- **禁跨生成代理帧**: 四路全部同源 `facerefine-1117/ch002-4k-p3.mp4` 生成系,同帧号直抽对比。四件规格一致(3840x2220, 24fps, 175 帧),对帧成立。
- 源: `apps/output/facerefine-1117/ch002-4k-p3.mp4`
- A2 正典臂(同源): `fusion/a2-canon-4k.mp4`
- 远景档(新默认, 5111=False→5023): `fusion/dualmode/far.mp4`(prompt b84243ec, 332s)
- 高清档(5111=True→5025, 5024 带 masks=[5104]): `fusion/dualmode/hd.mp4`(prompt eb804aa9, 241s)
- 抽帧: `ffmpeg -vf "select=eq(n\,N)" -fps_mode passthrough -frames:v 1`(metrics.py 内置同口径);帧位 f60=远景 / f156=特写;脸区坐标复用 `plan-a2rv.json`(f60 [1864,992,1996,1156], f156 [1605,495,2340,1185])。
- 量化: `dualmode/metrics.py` 三臂各跑一遍(输出在 `cmp/mx-{a2,far,hd}/`,含无损 PNG 基线、3x 脸区件);三臂互比复用其 `compare_pair`(`cmp/pairwise-report.json`)。

## 指标主表(对真源)

| 帧位 | 臂 | lap_src→lap_dst | lap_ratio(锐度) | rmse_face | psnr_face | rmse_full | psnr_full |
|---|---|---|---|---|---|---|---|
| f60 远景 | A2 正典 | 165.1→176.2 | 1.067 | 3.14 | 38.20 | 2.05 | 41.89 |
| f60 远景 | **远景档 far** | 165.1→**199.6** | **1.209** | **10.11** | 28.04 | 2.11 | 41.65 |
| f60 远景 | 高清档 hd | 165.1→177.2 | 1.073 | 3.16 | 38.14 | 2.05 | 41.88 |
| f156 特写 | A2 正典 | 5.8→7.2 | 1.238 | 1.93 | 42.44 | 1.75 | 43.26 |
| f156 特写 | **远景档 far** | 5.8→6.9 | 1.197 | 5.73 | 32.97 | 2.21 | 41.22 |
| f156 特写 | 高清档 hd | 5.8→7.2 | 1.238 | 1.93 | 42.43 | 1.75 | 43.26 |

**互比表(脸区 rmse / 整帧 rmse)**

| 对 | f60 | f156 | 解读 |
|---|---|---|---|
| hd vs A2 | 2.84 / 1.69 | 1.61 / 1.43 | 两次独立渲染但都≈源(编码噪声级) |
| far vs A2 | 9.99 / 1.76 | 5.63 / 1.97 | far 是唯一真正改脸的臂 |
| far vs hd | 9.95 / 1.52 | 5.62 / 1.97 | 全帧差≈噪声级,差异集中在脸区(与图结构一致:共享链,只分叉在脸贴回) |

## 路由定谳(为什么 hd≈源)

graph_far/graph_hd 全图仅两处差异: `4100.filename_prefix` 与 **`5111.PrimitiveBoolean.value`(far=false / hd=true)**。共享主链: H3FaceTrackCrop→H3 参考重采样→H3PerFrameDenoise→贴回;分叉:

- far(5111=False)→ 5023: **5022 H3FaceStitch 无 masks 参数** → face_only 脸框贴回正典行为,真贴了(对源 rmse_face 10.11/5.73)。
- hd(5111=True)→ 5025: **5024 H3FaceStitch 带 `masks=["5104"]`(SAM3 track mask 覆盖 paste_region)** → 实测贴回为空:hd 脸区对源 rmse 1.93/3.16 = A2 直通级,整帧 PSNR 43.26/41.88 ≈ 纯重编码。**验尸报告 B5 预警的「SAM3 mask 张量形状契约未验」风险本次落地**——masks 覆盖分支未贴任何东西,VOSR2(5110, upscale=1)增益随之整体缺席。

## 视觉记录(zai analyze_image,逐臂逐位;单图锚定源特征后问)

- **源 f60**(锚定): 全糊软边,口型微张(唇间小暗区),鼻翼不可辨,重磨皮。
- **far f60**: 四官"相当偏略高"(眉/眼微升,鼻/口相当);口型一致(微张、开度唇形同);发际/脸颊/下颌**无硬边/色差/重影/羽化圈**;同一自然人脸,无熔毁错位。
- **hd f60**: 与源描述**高度吻合、零新细节**,判定为"源插值放大,非生成重绘贴回"——视觉坐实直通。
- **far f156**(源:四官清晰、微张见齿、朱红唇): 相当(略高);口型一致、唇色无异常加深;边缘无贴回痕迹;同一人。细节层(睫毛/唇纹)缺失=源重磨皮同系。
- **hd f156**: 相当(部分略低),**明确无任何超源细节,"高清增益未生效"**;口型基本一致(齿部可见度略弱于源);无贴回痕迹;同一人。
- A2 两帧位视觉沿用 `a2-recheck.md` 已验结论(四官可辨、口型一致、无接缝)。

## 判定(PRD AC1/AC2 红线)

| 红线 | 结果 | 依据 |
|---|---|---|
| AC1a 远景档远景四官≥源 | **PASS** | far f60 lap_ratio 1.209(四臂最高),视觉"相当偏略高" |
| AC1b 远景档≈A2(同链应近同) | **前提不成立** | far vs A2 rmse_face 9.99/5.63——但根因是 **A2 本身≈源直通**(其自身对源 rmse 3.14/1.93),A2 并非 far 同链产物;任何真改脸的臂都不可能≈A2。该红线的参照系写错,应改锚"另一 far 链渲染"或"改脸量级带宽" |
| AC2 高清档脸区清晰度≥远景档(VOSR2+SAM 贴回增益) | **不成立(增益缺席)** | 数值上 hd 7.2 ≥ far 6.9(f156)侥幸成立,但 hd=直通+编码噪声,视觉零超源细节;SAM3 masks 覆盖分支空贴(B5 落地),VOSR2 增益未到达画面。机制坏了,不等式不作数 |
| 两档无接缝/无身份漂/口型保持 | **PASS** | 全部臂、全部帧位视觉均无贴回痕迹、同一人、口型一致 |

## 结论

1. **远景档是四路中唯一真正落笔改脸的臂**,且质量合格:远景位锐度 1.209x源、特写位 1.197x源,口型保持、无接缝、无身份漂移。
2. **高清档 SAM3+VOSR2 贴回链未生效**(空 mask=直通),AC2 的增益机制落空;须先修 B5(SAM3 mask→5024 形状/语义契约,含 undetected_frames=fade_out 交互)再重测。
3. **A2 参照系≈源直通**,PRD「同链应近同」表述需修正;远景档的改脸幅度(rmse_face 5.7~10.1)本身在"贴回重写"量级内属正常,视觉无劣化。

## 图引

- 远景四联(源/A2/远/高 + 4x 脸区): `dualmode/strip-far.jpg`
- 特写四联(同序 + 原生脸区): `dualmode/strip-cu.jpg`
- 量化明细: `cmp/mx-{a2,far,hd}/metrics-report.{md,json}`、`cmp/pairwise-report.json`
- 并排图生成器: `dualmode/build_strips_1119.py`(可复用改帧位/臂)

## 返回摘要(机器可读)

```json
{
  "metrics": [
    {"arm": "A2",  "pos": "f60_far",  "faceSharp": 1.067, "faceRmse": 3.14,  "exprKept": true},
    {"arm": "A2",  "pos": "f156_cu",  "faceSharp": 1.238, "faceRmse": 1.93,  "exprKept": true},
    {"arm": "far", "pos": "f60_far",  "faceSharp": 1.209, "faceRmse": 10.11, "exprKept": true},
    {"arm": "far", "pos": "f156_cu",  "faceSharp": 1.197, "faceRmse": 5.73,  "exprKept": true},
    {"arm": "hd",  "pos": "f60_far",  "faceSharp": 1.073, "faceRmse": 3.16,  "exprKept": true},
    {"arm": "hd",  "pos": "f156_cu",  "faceSharp": 1.238, "faceRmse": 1.93,  "exprKept": true}
  ],
  "verdict": "far=唯一真改脸臂且合格(1.209x锐、口型保持、无接缝无漂移);hd 的 SAM3+VOSR2 贴回未生效=直通(5024 masks=[5104] 空贴,B5 落地),AC2 增益缺席;A2≈源直通,'far≈A2 同链'参照系前提不真,两档接缝/身份/口型红线全过。",
  "strips": ["dualmode/strip-far.jpg", "dualmode/strip-cu.jpg"],
  "report": "dualmode/compare.md"
}
```
