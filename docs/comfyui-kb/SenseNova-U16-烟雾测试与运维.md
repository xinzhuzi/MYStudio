# SenseNova U1.6 烟雾测试与运维(1127 固化)

换装役实弹件的固化真源:执行脚本 `apps/build/scripts/sensenova_bf16_smoke.py`(直投引擎 `/prompt`,
不经 App);产物与时间账落 `apps/output/sensenova-smoke/<时间戳>/`(历史役产物在
`apps/output/sensenova-bf16-1127/`)。下次生图自检直接跑脚本,勿再手搓 payload。

## checkpoint 事实

- 在役:`sensenova_u1.6_8b_mot_bf16.safetensors`,35,065,860,024 B,sha256 `196861c4…b6af88`
  (与 HF LFS oid 完全吻合),Win 盘位 `E:\IP\dhp\comfyui\models\checkpoints\`。
- 8 步加速 LoRA:`sensenova_u1.6_8b_mot_8step_lora_bf16.safetensors`(模板内 LoRA 开关=true 时挂)。
- int8 全家已清退(1127 用户裁定 bf16 为主,全库零 int8 引用,盘上零 int8 文件);
  回退=从 ModelScope `Comfy-Org/SenseNova-U1` 重下对应 int8 件,两件官方模板
  `ckpt_name` 改回即可(上游字节钉惯例在官方模板上已让位全替换裁定,89a23dde)。

## 引擎端口现查(禁抄常量)

端口随决议在 17000-17999 漂移,发车前现查:

```bash
# Win
ssh zbj@192.168.0.101 "type E:\\IP\\dhp\\comfyui\\manifest.json" | grep -E '"port"'
# Mac
grep '"port"' ~/Library/Application\ Support/漫影工作室/comfyui/manifest.json
```

## 用法

```bash
# 只组包人审(不发车)
python3 apps/build/scripts/sensenova_bf16_smoke.py --dry-run --set 21=42

# t2i 实弹(Win 引擎;复现 1127 实弹一发,已做逐字节对拍验证)
python3 apps/build/scripts/sensenova_bf16_smoke.py --engine http://192.168.0.101:17000 \
  --set 21=42 --set 10=true --set 11=8 --set 13=1

# i2i 实弹(先推参考图再填 LoadImage;黄昏→雪夜改写例见 apps/output/sensenova-bf16-1127/)
python3 apps/build/scripts/sensenova_bf16_smoke.py --engine http://192.168.0.101:17000 \
  --workflow "1_图片/SenseNova/2_图生图/sn-道劫-i2i-api.json" \
  --upload-image 参考图.png --set 17=参考图.png --set 24=42
```

`--set 节点=值` 写 Primitive 系 `value` 键;`--set 节点.键=值` 写任意 widget 键
(如 `24.filename_prefix=...`);值按 JSON 解析,`@路径` 读文件当字符串(长提示词用)。
`--set` 前必 `--dry-run` 人审一次(发车前提示词审计铁律)。

## 两张模板填参地图

| 参数 | t2i 节点 | i2i 节点 |
| --- | --- | --- |
| seed(PrimitiveInt) | 21 | 24 |
| 8步LoRA 开关(PrimitiveBool,true=快档) | 10 | 9 |
| 快档步数(快档true 时生效) | 11(8) | 10(8) |
| 快档 cfg | 13(1.0) | 12(1.0) |
| 慢档步数/cfg(开关=false 时生效) | 12(50)/14(4.0) | 11(50)/13(4.0) |
| 主体句(PrimitiveStringMultiline) | 2 | — |
| 编辑指令(PrimitiveStringMultiline) | — | 2 |
| 风格底座(PrimitiveStringMultiline) | 3 | — |
| 参考图(LoadImage) | — | 17 |
| 落盘前缀(SaveImage) | 24.filename_prefix | 27.filename_prefix |

## 1127 实弹留档(实发提示词全文)

t2i 女修一发(与 int8 A/B 同文同种子 42;时间账见 `apps/output/sensenova-bf16-1127/timing-ledger.json`):

**主体句(节点 2)**:

> 一位筑基后期的年轻女修，青玉色道袍束月白腰带，足蹬青布道履，乌黑长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门赭石石阶最上一级，身体正面朝向观者、微向左转，重心落于右腿，左脚虚点下一级石阶；左手自然垂于身侧，五指放松；右臂微屈，右手持剑鞘近柄端于身前，五指完全环扣剑鞘，剑身完整收在鞘中，鞘尖朝下、剑柄朝上，乌木剑鞘、白玉剑格、剑柄缠灰银丝、鞘口垂朱红剑穗，全身仅此一柄长剑；视线越过阶下青灰云海望向远处青绿群山，旧金色晨光自左侧斜照，衣袂被山风微微掀起。

**风格底座(节点 3)**:

> 美术风格底座：国风二维动漫手绘插画。造型概括鲜明，轮廓与内部结构以白描式线条塑形，线条细稳连贯、轻重富有节奏，转折利落且保留手绘笔性；平整分层的清晰色面与简洁明暗色块塑形，辅以工笔分染与薄层罩染，色面边界清楚。采用丰富多彩、明快协调的中国传统设色，主色统领、辅色呼应、点睛色突出，饱和度与对比度层级分明；材质统一于线描设色语言。数字绘画表面洁净平整，线条与设色层次清晰，细节疏密有序；保留彩色连环画的凝练造型与绘画感。

## 已定谳结论(勿重实验)

- **bf16 为主**(1127 用户裁定):t2i 1536×2048 快档 ~16s(含 15.2GiB 模型首次流送;
  二发起稳态更快);int8 同种子 A/B 轨迹完全分歧(PSNR 14.4,99.85% 像素有差)
  =**跨精度同种子像素对拍无效**,判定权归人眼。
- **i2i 场景级改写弱**:黄昏→雪夜实弹未生效(身份/构图保持),SenseNova i2i 只宜
  局部编辑(去物/改画法类),场景改写走其他产线。
- **引擎免重启换档**:checkpoint 换名后 object_info 即列新件,无需重启引擎。
