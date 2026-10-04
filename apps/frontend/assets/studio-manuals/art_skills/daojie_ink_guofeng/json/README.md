# json/ —— 道劫提示词资产唯一真源家

**家规:道劫提示词的机读供给内容只住本目录,只有一份。**别处出现的同名文件一律是分发产物或历史记录。

| 文件 | 角色 |
|---|---|
| `qi21_bases.json` | **生产真源**:风格底座(lock_layer)/十型底座(types)/PE扩写指令/清筛词表/分层契约(layer_contract)/色卡词典(color_lexicon) |
| `prompt_layering.json` | 分层契约完整版(手册版;layer_contract 为其内联精简版,二者由设计互锁) |
| `ma-palette-source.toml` | MA 42 色备选库摘录(CC-BY-4.0);在用词以 color_lexicon 为准 |

## 分发与同步

- 引擎侧 `apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json` = **同步产物**(引擎节点按同目录相对路径读,产物必须随 my_nodes 部署走)——由 `apps/build/scripts/daojie_prompt_source_sync.py` 从本家单向复制,契约测试锁两份逐字节一致。**禁手改产物,改真源后跑同步脚本。**
- md 文档层(`docs/prompts/` 的 05库/主体句示例/九型配方;本手册 style_guide/art_prompt)= 记录与写作宪法,不是机读供给,不在本家。
- K2 时代 daojie_bases.json 属退役线,不在本家。

## 修改流程

改 `qi21_bases.json`(真源) → `python3 apps/build/scripts/daojie_prompt_source_sync.py` → 契约测试回归绿。
