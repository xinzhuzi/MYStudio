# 验尸结论(11-19,V1/V2/V3)+A2 数据缺陷说明

## V1 H3FaceStitch.masks 悬空语义(源码:ComfyUI-H3-FaceRefine/nodes.py,已 scp 副本 /tmp/h3facerefine_nodes.py)
- masks=optional MASK(2198-2204,tooltip "Overrides paste_region");run() 默认 None(2214-2216)。
- 三分支(2276-2300):masks 非 None→画布空间 mask 双线性缩放+膨胀+羽化;masks None 且 paste_region=="full_crop"→唯一全量贴回(cosine 羽化);masks None 且默认 "face_only"→**按 transform.face_rect 造脸框膨胀+高斯羽化 mask 只贴脸区**(_face_region_mask 752-778;face_rects 缺失兜底中心 1/4 框 2295)。
- 全分支共用 grid_sample warp 回源帧(2303-2316)+加权合成(2344)。
- **定论:masks 悬空=face_only 脸框贴回(正典现状行为);「全 1 SolidMask」≠悬空(全 1=全画布贴回)。→ 双档 masks 投切采用出口复制案(双 5022/5023)。**
- B5 补验待办:SAM3 逐 track MASK 张量形状(帧/批维)与 5022 期望形状契约;undetected_frames=fade_out 与 masks 交互。

## V2 H3PerFrameDenoise 七参语义(nodes.py 2515-2701)
[1.0, 0.35, "absolute_px", 60.0, 200.0, 1, 9] =
- 1.0=denoise_multiplier_small_face(脸最小处拿满调度器 denoise)
- 0.35=denoise_multiplier_large_face(脸最大处只拿 35%)
- absolute_px=按源帧绝对像素窗口(批安全);60=face_px_small;200=face_px_large;1=gamma 线性;9=smooth_frames 时间平滑窗
- 映射(2619-2640):strength = 1.0+(0.35-1.0)·clip((face-60)/140,0,1)——**脸越小越强、脸越大越轻**(小脸要 H3 凭空合成,大脸有真细节怕重写)。
- **ch002 4K 远景 45-75px:strength 0.93-1.0(小脸满档端)**——远景小脸的修脸力度本来就最猛;远景失败主因=差分拽回(已移除)+空提示词,非档位不足。
- **定论:远景修脸档参数=正典零调整;「远景档要为小脸加力」的假设不成立(方向反了)。** absent 帧 strength=0 不修(2650-2652)。

## V3 ComfySwitchNode(object_info 17000 实拉)
switch=["BOOLEAN"];on_true/on_false=["COMFY_MATCHTYPE_V3",{lazy:true,allowed_types:"*"}]——任意类型通吃+lazy(未选分支不执行)。三型(LATENT/MASK/IMAGE)合法。
**但 B1 引擎墙风险仍在**:中链位(5013→5014/5021→5022 之间)无实弹先例(1117 multiseg 中链 Switch×自定义节点=引擎级输出剪枝墙),**5s 双态探针前置到改名之前**。

## A2 终判数据缺陷(重要)
- A2 产物/帧为真(a2-canon-4k.mp4+a2_f60/f160.jpg);但 vision 判定时 src/b4kfix 四帧已从盘上消失(fusion 目录曾被删重建,b-4k-fix.mp4 等 11-18 产物丢失),vision 用了**跨生成代理帧**(e-p4v2 等)——**该轮「A2 远景 3/10 塌方」结论口径无效**。
- 正确重验口径:a2-canon-4k.mp4 vs 真源 facerefine-1117/ch002-4k-p3.mp4 同帧号对比(两件都在盘);此项列入工作流对比阶段。

## 环境事故记录
- Bash 壳 spawn ENOENT 根因=会话 cwd 目录被删(非壳坏);重建目录即愈。
- fusion/object_info_17000.json 曾丢,已从引擎重拉 9.1MB 回填。
