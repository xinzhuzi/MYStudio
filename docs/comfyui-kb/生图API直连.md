# 生图 API 直连调用(qi21_sidecar_api)

最后核账:2026-10-21(同日增 2b 透明底口径)

漫影 App 的文生图/图生图,除走 App UI 外,可由脚本直连 sidecar 的
OpenAI 兼容 API 完成——与 App 传输层同一条链(装配/底座/PE 门禁全在
产品路径内,零漂移)。固定调用器:

```
apps/build/scripts/qi21_sidecar_api.py   # 依赖同目录 cdp_eval.mjs(App 在驾唤醒 sidecar 用)
```

## 用法

```bash
# 文生图(可注入十型型层;型名见 qi21_bases.json:人物海报/场景/道具/美宣/
# 人物多视图/高清人脸/分镜剧情图/表情差分/概念气氛图/设定卡)
python3 qi21_sidecar_api.py t2i --prompt "主体句" [--base-type 人物海报] \
    [--aspect 1:1|3:4|4:3|16:9|9:16] [--out xx.png] [--dry-run]

# 图生图(缺省=道劫美术风格转换装配;--base-type 切型层全拼档)
python3 qi21_sidecar_api.py i2i --prompt "指令" --ref 参考图.png \
    [--base-type 表情差分] [--shape keep|square|32] [--out xx.png] [--dry-run]
```

## 关键口径(2026-10-22 i2i 型层注入役更新)

1. **模型恒 `qwen-image-2-1`**(qwen21 模块→道劫 t2i/i2i 模板)。
   `comfyui-bridge` 是 K2 老桥自动路由(krea2_edit_ref),HDR VAE 引擎无件
   必拒,禁与本工具混用。
2. **i2i 型层注入已通**(10-22 口径,推翻 10-21「i2i 不吃型层」旧断言):
   i2i 带 `--base-type`/`base_type` 即切「道劫美术类型」全拼档——桥覆写三锚
   (6:4010 注型选择/6:4011+6:4022 组装用途同切,4022=画幅路由→型画幅,
   只改 4011 会恒跟参考画幅);终稿=指令+类型句+美术风格底座三段,型负面
   merge 进负面槽;RGBA 由 6:180 连线 6:4010 跟型自动激活(透明型直出真
   Alpha)。缺省不传=道劫美术风格转换两段装配(指令+底座,10-19 口径全量
   向后兼容);i2i PE 恒关。构图/版式语言归型层,指令只写操作+保真+逐格
   内容(如表情差分九情绪+五官物理描述);`--shape`
   预整形参考控画幅——缺省路 i2i 输出画幅=参考 AR×2(引擎 /16 取整),如 364×768
   参考出 704×1472。多视图 3:2 家族口径(1248×832)用 `--shape 32` 垫边。
2b. **透明底=型层专属**(10-21 立,10-22 扩到 i2i):十型真源 rgba_default
   ——道具/人物多视图/高清人脸/表情差分=**透明底**(RGBA 真 Alpha,由
   MyQi21FinalOutput 透明模式包装);人物海报/场景/美宣/分镜/概念/设定卡/自由=
   非透明。i2i 带 base_type 注入透明型即直出 Alpha(表情差分首用例=角色弹窗
   表情差分,产物=透明底九宫格);无参考路的透明型产物仍走
   `t2i --base-type <透明型>`+主体句(身份由七段公式主体句锚:发色/衣色/
   配饰材质/全身鞋履,过道劫 PE 门禁);t2i 画幅也由型层 WhSuggest 承载
   (t2i 模板无 width/height 绑定,aspect_ratio 参数对该模板无效)。
3. **指令纪律**(道劫美术风格转换同款):单段中文/肯定式/保真段先行/比例禁入
   正文/负面不写。t2i 另过道劫 PE 门禁:全身像主体句必写鞋履(如
   「足蹬深色布履」),否则引擎 500 拒单。
4. **鉴权与通道自愈**:令牌真源=`<userData>/python/profiles/image-gen/
   config.json` 的 controlToken;sidecar 缺席时 App 在驾→CDP 9223
   `imageGenRuntime.setup()` 唤醒,App 未在驾→独立拉起(装机 backend);
   App 未在驾且引擎亡→脚本自动起引擎保活守护(engine_manager 的
   ensure_engine_ready 须常驻父进程抱着,调用进程退出引擎即收摊)。
5. **白图坑**:引擎冷启/中断窗口期 API 会 200 返回纯白件(恒 11394B)
   ——调用器内置检测删件重试;503=引擎冷启耐心等,409=排队等待。
6. **收编进资产库**:App 在驾禁直写 db,走 CDP 桥 `window.studioAssets.
   addImage/removeImage`(源文件须在受管根内,/tmp 拒收);App 未在驾可
   直写 db(先备份)+thumbs 镜像。战役范本见 `campaigns/
   asset_face_portrait_realms_1021.py`(晏燎十境界脸)与 `campaigns/
   asset_dugu_char_views_1021.py`(独孤剑尘人物图+多视图)。

## 与既有脚本的关系

`qi21_local_ten_types.py` 等历史文生图脚本是引擎 websocket 直提的各役
收据器(one-off,绑死当役模板/断言),不复用、不新增——API 直连一律走
本件。引擎侧只读诊断用 `engine_doctor.py`。
