# json/ —— 道劫提示词资产唯一真源家

**家规:道劫风格的机读供给资产只住本目录,只有一份。**别处出现的同名文件一律是分发产物或历史记录。

> **统一规范宣言(10-04 用户令)**:本目录是「每个美术风格类型一个 json/ 唯一资产家」规范的**第一个实验**(1005 勘正:色卡正典不住本家——住 ../ma_sync/palette-canon.json,带 MA 同步守护与生产消费方;前晚转制的两件冗余色卡已退役)——道劫打样,未来各美术风格目录均照此模式建 `json/` 家。家的边界=**美术风格**,不分 K2/Q2.1 产线(LoRA 栈等风格资产同住)。

| 文件 | 角色 |
|---|---|
| `qi21_bases.json` | **生产真源**:风格底座(lock_layer)/九型+自由=10 条底座(types)/PE扩写指令/清筛词表/分层契约(layer_contract)/色卡词典(color_lexicon);types[] 每型含 K2 承接字段:lora_recipe/steps_hint/i2i_routes/postprocess/recipe_version(数据实存,配方矩阵文档为其投影) |
| `qi21_strip_lexicon.json` | Q2.1 清筛正则表(pattern;与 qi21_bases 内嵌 strip_lexicon 词表并存,非重复) |
| `daojie_lora_stack.json` | K2 LoRA 栈序(14条) |
| `daojie_loras.json` | K2 LoRA 台账(9条) |
| `prompt_layering.json` | 分层契约完整版(手册版;layer_contract 为其内联精简版,二者由设计互锁) |

## 不收项边界(1004 穷尽核验轮,防再问漏没漏)

MA `美术风格提炼/` 目录中**未收编**的部分及理由:md 方法论文档×6(选色决策实战卡/宋代审美提炼/装配规范/阵营md/中国式原始提示词208KB案例集/索引)——文档层按裁定住 docs/prompts 参考;`manifest.json`(290KB 上游素材溯源器,管的是 md 素材的来源哈希,不涉色卡数据);`licenses/`(整包许可文件,要点已在两 JSON 的 _meta 注记);`images/` 90+ 素材图。色卡机读资产=两个 toml 的全部内容,已 100% 转制(递归键 diff 零差)。

## 分发与同步

- 引擎侧 `my_nodes/nodes/` 下四个同名 JSON = **同步产物**(引擎节点按同目录相对路径读,产物必须随 my_nodes 部署走)——由 `apps/build/scripts/daojie_prompt_source_sync.py` 从本家单向复制(四件),契约测试 `test_prompt_source_single_truth` 锁逐字节一致。**禁手改产物,改真源后跑同步脚本。**
- md 文档层(`docs/prompts/` 的 05库/主体句示例/九型配方;本手册 style_guide/art_prompt)= 记录与写作宪法,不是机读供给,不在本家。

## 修改流程

改 `qi21_bases.json`(真源) → `python3 apps/build/scripts/daojie_prompt_source_sync.py` → 契约测试回归绿。
