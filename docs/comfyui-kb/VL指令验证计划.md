# VL 看图说话·自动褪衣指令线——完整执行计划(自包含)

> 用途:在一个全新会话中执行本计划。本文件包含全部背景、定案、路径、命令、坑与协议,不依赖任何其他会话记忆。执行者读这一份就够。
> 交付原则:用户语言=简体中文;宣称完成前分级验证;实测数据才叫实测,没跑过的一律标「预计/未实测」。

## 一、目标

用 VL 视觉语言模型「看图说话」生成 krea2edit 褪衣编辑指令,替代已到天花板的规则引擎(FASHN+SAM3+规则拼装)。本阶段只做**指令验证**(不出图):
1. 让 LM Studio 加载本机已有的 Qwen3-VL-32B;
2. 写一个 ComfyUI 自定义节点把图发给它、取回指令文字;
3. **新建一个独立工作流**(绝不改动现有四个工作流)跑 VL 出指令;
4. 与现有规则引擎工作流的输出做准确性对照,出对比表,用户最终裁决。

## 二、架构定案(本会话已论证,不要重开)

- **分工**:32B=分析员(看图→出文字指令);qwen3-vl-4b-heretic=krea2edit 的编码器(指令接地,只出向量不出文字)。两者不可互换——**TE-DiT 锁定**:K2 的 DiT 训练时吃的就是 4B 的逐层隐藏态(12 个条件抽头),换任何其他模型(含 32B)=维度/语义空间对不上=乱码。4B 槽位没有也不需要「更强的」。
- **为什么必须外挂推理引擎**:ComfyUI 只把 Qwen3-VL 当编码器用;让它「说话」需要自回归生成循环(llama.cpp 系=LM Studio)。已查证:本机装的 15 个插件里唯一 LLM 节点(Agent-Kit 的 OpenAIChatNode/OpenRouterLLMNode/UnslothLLM、Easy-Use 的 joyCaption API)全是云端 API 客户端,**没有 base_url 可改,指不到 localhost**——所以必须自写节点。
- **指令的机理**(写给后续调提示词用):指令词在 4B 编码器内与图片视觉 token 做交叉注意力接地(GroundedEncode 的含义)。词与图对上=强锚定;词错(如「灰色长裤」而图里是蓝色牛仔短裤)=无主请求,模型可能忽略/错锚/幻觉。**指令里每个名词都是目标指认:指对是锚,指错是祸,不指它自己看。**

## 三、模型与 LM Studio 加载(方案 A,零新增下载)

### 文件(已在盘上)
- 主模型:`/Users/zhengbingjin/Project/ComfyUI/models/text_encoders/Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-Q4_K_M.gguf`
- 视觉投影:`/Users/zhengbingjin/Project/ComfyUI/models/text_encoders/Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-mmproj-f16.gguf`
- (mmproj 必须与主模型同目录,文件名带 `-mmproj-` 是 llama.cpp 的自动发现约定)

### 加载步骤
1. LM Studio 只认 `~/.lmstudio/models/<publisher>/<repo>/` 结构 → **软链接**(勿复制,~20GB):
   ```bash
   mkdir -p ~/.lmstudio/models/ComfyUI-TE/Qwen3-VL-32B-Ultra-Heretic
   ln -f /Users/zhengbingjin/Project/ComfyUI/models/text_encoders/Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-Q4_K_M.gguf \
         ~/.lmstudio/models/ComfyUI-TE/Qwen3-VL-32B-Ultra-Heretic/
   ln -f /Users/zhengbingjin/Project/ComfyUI/models/text_encoders/Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-mmproj-f16.gguf \
         ~/.lmstudio/models/ComfyUI-TE/Qwen3-VL-32B-Ultra-Heretic/
   ```
2. 启动(顺序执行,都幂等):
   ```bash
   export PATH="$PATH:$HOME/.lmstudio/bin"
   lms server start                                    # 1234 端口,OpenAI 兼容
   lms load ComfyUI-TE/Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-Q4_K_M --context-length 8192 --gpu max
   curl -s http://127.0.0.1:1234/v1/models            # 拿精确 model id
   ```
   LM Studio 应用 bundle id:`ai.elementlabs.lmstudio`(lms CLI 不行时用 open_application 拉起应用)。
3. **兜底**:若 LM Studio 对 mmproj 配对不生效(发图请求报错/答非所问),改用 LM Studio 自带的 llama-server 直接起:
   ```bash
   LS=$(find ~/.lmstudio -name "llama-server" -type f | head -1)
   "$LS" -m /Users/zhengbingjin/Project/ComfyUI/models/text_encoders/Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-Q4_K_M.gguf \
        --mmproj /Users/zhengbingjin/Project/ComfyUI/models/text_encoders/Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-mmproj-f16.gguf \
        --port 1235 --ctx-size 8192 &
   # 节点 api_url 改 http://127.0.0.1:1235/v1/chat/completions
   ```
4. 资源:Q4_K_M 32B 占内存 ~20GB;与 ComfyUI(K2 turbo ~20GB+SAM3 1.75GB+VAE)在 128GB(M4 Max)上共存没问题。速度:**预计 20-60 秒/图,未实测**(旁证:orcarouter 27B MLX 实测 33s,但那是另一个模型,不得把 33s 引用为 32B 数据)。
5. 视觉请求格式(OpenAI 兼容,data URI 传图,LM Studio 忽略 api_key 可填任意):
   ```json
   {"model":"<上步拿到的id>","temperature":0.2,"max_tokens":400,
    "messages":[{"role":"system","content":"<系统提示词,见第五节>"},
                {"role":"user","content":[
                   {"type":"text","text":"请分析这张图片并输出编辑指令。"},
                   {"type":"image_url","image_url":{"url":"data:image/png;base64,<图的base64>"}}]}]}
   ```

## 四、自定义节点(新插件,不动旧插件)

新建 `/Users/zhengbingjin/Project/ComfyUI/custom_nodes/krea2-vl-instruction/__init__.py`(独立目录,不要加进 krea2edit-instruction-assembler):

- 类名 `Krea2VLInstruction`,显示名「Krea2 VL看图出指令(32B)」
- REQUIRED:`image` IMAGE
- OPTIONAL:`api_url` STRING 默认 `http://127.0.0.1:1234/v1/chat/completions`;`model` STRING 默认填第三节拿到的 id;`system_prompt` STRING multiline 默认=第五节全文;`temperature` FLOAT 0.2;`max_tokens` INT 400;`timeout` INT 180
- RETURN_NAMES = `("instruction", "raw")`
- 实现要点:
  - image 张量 (B,H,W,3) 0-1 浮点 → 取第 0 帧 → PIL → 长边缩到 1024 → PNG → base64
  - `urllib.request` POST,解析 `choices[0].message.content`
  - **任何失败(连接拒绝/超时/JSON 解析错)不要抛异常炸图**:返回 `("ERROR: <原因>", 原始响应前500字)`,让 ShowText 显示错误——测试工作流要能看见故障
  - 只用标准库+Pillow(comfy 环境自带),零新依赖
- 流程:py_compile → 本地冒烟(假响应解析)→ 重启后端(第六节协议)→ `curl http://127.0.0.1:17598/object_info/Krea2VLInstruction` 验证注册且返回体含 api_url

## 五、VL 系统提示词(锁词表,全文作为节点默认值)

```text
你是「褪衣编辑指令生成器」,为 krea2edit 图像编辑模型产出一句中文编辑指令。看图后严格按以下规则:
1) 由外到内逐层盘点人物衣着:品类+颜色+裤长。品类用标准词(外套/上衣/衬衫/连衣裙/半身裙/牛仔短裤/长裤/吊带/丝袜);颜色只用基础词(白/黑/灰/米色/棕/红/粉/黄/绿/浅蓝/蓝/深蓝/藏青/紫);拿不准的颜色宁可不写,绝不编造。
2) 判断姿势:坐/站/躺。
3) 按配方输出一句指令:
   - 有外套:「她的{色}外套敞开褪下,搭在身旁;内层的{盘点}滑落敞开,布料完整地{去向}」
   - 无外套:「她的{盘点}滑落敞开,布料完整地{去向}」
   - 去向:坐=堆叠在腰间与腿侧 / 站=垂坠在身侧 / 躺=散落身侧
   - 有袖衣物→追加「双臂的衣袖保留在手臂上」
   - 有包/帽/围巾→追加「取下放在身旁」
   - 固定收尾:「贴身衣物随之一并褪去,上身、腰腹与双腿露出洁净无瑕疵的裸露肌肤,身体轮廓完整清晰;她的脸、发型、姿态与背景保持与原图完全一致。」
4) 禁止:否定词(无/不/没;「无瑕疵」除外)、元指令(如"生成图片""保持真实")、解释说明、输出多于一句。
只输出指令本身。
```

## 六、新建测试工作流(独立文件,四不动)

**绝不改动**这四个现有文件(只读参照):`K2图像/改图/` 下的 `Krea2_无衣物_快.json`、`Krea2_无衣物_精.json`、`Krea2_无衣物_测试.json`、`Krea2_无衣物_指令验证.json`。

新建:`/Users/zhengbingjin/Project/ComfyUI/user/default/workflows/K2图像/改图/Krea2_无衣物_VL验证.json`,约 6 节点:
1. LoadImage「①载入图片」
2. ImageScaleToTotalPixels(lanczos, 1, 8)「②等比缩放1MP」
3. Krea2VLInstruction(image←②)「③VL看图出指令(32B)」
4. ShowText|pysssss(text←③.instruction)「④VL指令」
5. ShowText|pysssss(text←③.raw)「⑤原始返回(排错用)」
6. MarkdownNote 使用说明(前置条件=LM Studio 已加载;速度预计;词表规则摘要;与「指令验证」工作流对照用法)

UI 格式 JSON 注意(本会话实测踩坑):**MaskToImage 的输入名是 `mask` 不是 `masks`**(若加掩码预览);links 数组 [id, src, src_slot, dst, dst_slot, type];新节点 outputs 要带 `{"name":...,"type":...,"links":[]}` 完整结构,否则回填 link 时越界。

## 七、测试方案(用户最终裁决,你的数据只做辅助)

- **测试图仅限合成图**:`input/skill_demo_01.png`(坐,白衬衫+浅蓝牛仔裙)、`02`(站,黄/米色连衣裙)、`03`(站,白T+牛仔短裤——规则引擎曾把同类图错报的重点case)、`04`(站,米色外套+白衬衫+蓝色牛仔长裤——层叠重点case)。
- **绝对红线**:任何真人照片(文件名含「小红书」、Downloads 里的实拍人像等)不得进入本线——不分析、不测褪衣指令。成人内容仅限 AI 合成图。
- 方法:同一张图分别跑「指令验证」(规则引擎)与「VL验证」,逐项对照期望值:品类/颜色/裤长/姿势/句式完整性。
- 出对比表(品项×两引擎×对错),连同 VL 的 raw 返回一并给用户看。
- 成图验收永远是用户自己看;助手不代看最终成品图。

## 八、本会话踩坑与协议清单(全部实测,别再踩)

1. **队列卫生**:每次 API 测试跑完读完结果,立即自删历史:`POST http://127.0.0.1:17598/history` body `{"delete":["<prompt_id>"]}`;交付成图条目才保留。**`DELETE /history/{id}` 返回 405,只认 POST**。(用户两次投诉「删不掉的任务」,纯 ShowText 无图条目在 UI 里删不动,必须 API 清。)
2. **重启协议**:`kill -TERM $(lsof -nP -iTCP:17598 -sTCP:LISTEN -t)` → 轮询 object_info(自动恢复约 70s);若卡住:open_application(bundle `com.todesktop.241012ess7yxs0e`,activate)→ 截图 → 错误页「重启 ComfyUI」按钮约在 (712,444)。**SIGTERM 前先查 /queue 为空。**
3. **前端缓存协议**:改完 workflow 文件交付时必带一句「侧边栏刷新→重新打开」;前端不监听 workflows 目录;用户若存着旧标签页,**保存会覆盖磁盘改动**(发生过)。
4. **端口**:ComfyUI Desktop 后端=17598;LM Studio=1234(兜底 llama-server=1235)。
5. **krea2edit 生成链参数定案**(本阶段不出图,但为后续接线留档):编辑执行必须 EmptySD3Latent+denoise 1.0(真图 latent 接进像素通道=重建模式,denoise 0.65/0.85/CFG3 四组实测编辑全灭,躯干不变);身份一致性旋钮=Krea2EditModelPatch 的 **ref_boost=4**(实测脸漂移 0.023→0.012-0.015,直发不再变卷;=6 加脸掩码反噬脸肿胀;ConditioningKrea2Rebalance 默认参数无效);两个 GroundedEncode 的 **grounding_px 必须 0**(MPS adaptive pool 坑);seed 有坏抽样(同配置 face 漂移可差 3 倍)。
6. **度量脚本模式**(可复现):输出与输入同缩放到 256×342,分四区(脸/发/头/外边框)+躯干区算归一化 L1;身份看头区低,编辑执行看躯干区高(0.1+)。
7. **指令句式学**:krea2edit 吃自然描述句,标签堆失灵;否定词禁入(「无瑕疵」白名单);每名词=目标指认。这套配方已在 skill(.agents/skills/krea2edit-prompts/SKILL.md)与参数速查.md 里,改动两处同步。
8. **验证四层**:object_info 注册查返回体非空 → API 真跑一次 → 文本输出核对 → (出图时)history 抓真实 traceback。宣称完成必须分级:已实测/结构完成未实测/推测。
9. **速度引用纪律**:只报实测数(260s 全链 krea2edit 出图、4-8s 规则指令验证、SAM3+FASHN 单测 6s 均为实测);32B VL 用时未实测,交付时标「预计」。
10. **单一用途工作流偏好**:每条产线一个文件,新功能新文件,不往旧流里塞。

## 九、完成定义(全过才算完)

1. LM Studio 加载 32B 成功,/v1/models 可见,视觉请求返回正常文字;
2. Krea2VLInstruction 注册到 object_info 且实测出图内文字(含一次故意断开 LM Studio 的 ERROR 路径验证);
3. `Krea2_无衣物_VL验证.json` 新文件存在,UI 打开正常,跑通一次完整流程;
4. skill_demo_01-04 四图对照表产出(两引擎并列,期望值逐项打勾);
5. 队列历史清理干净(只留交付条目);参数速查.md 与记忆按三态规则回填;
6. 用户看到:对比表 + 工作流文件路径 + 使用方法(含 LM Studio 前置条件)。
