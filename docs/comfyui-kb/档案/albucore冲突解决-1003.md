# albumentations×albumentationsx 的 albucore 冲突解决(1003 役落账)

> 引擎 venv: `~/Library/Application Support/漫影工作室/comfyui/venv`(python 3.12)。
> 症状:`pip check` 报 1 条冲突——`albumentations 2.0.8 has requirement albucore==0.0.24, but you have albucore 0.2.20`。
> 本役已收口:pip check 清零,走**案 B(卸载双件)**。2026-10-03。

## 一、机制:三方钉版互斥 + 一个隐藏的共用目录

依赖链(引擎 venv 实测,`pip show` + dist-info METADATA):

| 包 | 版本 | 对 albucore 的要求 | 谁拽进来的 |
|---|---|---|---|
| albumentations(主线) | 2.0.8 | `==0.0.24`(钉死) | transparent-background |
| albumentationsx(x 分叉) | 2.4.13 | `==0.2.20`(钉死) | comfyui_controlnet_aux 新 requirements(1003 已升) |
| transparent-background | 1.3.4 | `albumentations>=1.3.1`、`albucore>=0.0.16`(弹性) | 手动装(Required-by 空),Essentials requirements.txt 在列 |

两个 `==` 钉版互斥,albucore 只能二选一——这就是冲突本体。**禁用强装老 albucore 0.0.24**:会炸 albumentationsx,两头空。

### 关键事实一:PyPI 主线已死在 2.0.8(案 A 不可行的根因)

官方 PyPI(https://pypi.org/simple/,非镜像)上主线 `albumentations` 最新即 **2.0.8**(其后 2.0.9~2.4.13 全部发布在 `albumentationsx` 名下)。所以「升级主线 albumentations 到兼容 albucore 0.2.20 的新版」此路不通:`pip install -U albumentations` 对包本身是空操作,且 resolver 会顺手把 albucore **降级**到 0.0.24(干跑实测 `Would install albucore-0.0.24`)——正中上文禁令。

### 关键事实二:x 分叉与主库共用 `albumentations/` 模块目录(踩坑点)

`albumentationsx` 的 PyPI **包名**是 x,但安装的**模块名**仍是 `albumentations`(其 RECORD 236 个文件全部落在 `site-packages/albumentations/` 下,与主库 2.0.8 的 124 文件重叠,后装覆盖)。推论:

- `import albumentationsx` **永远 ModuleNotFoundError**——该模块名从未存在(修复前后都一样)。烟测别再用它,正确烟测=`import albumentations`(跑的就是 x 的码)。
- 磁盘上实际只有一套代码:当前 `albumentations.__version__ == 2.4.13`(x 赢得覆盖战)。
- **卸载主库会把共用目录拆烂**:pip 按主库 RECORD 删文件,删的是已被 x 覆盖的路径(含 `albumentations/__init__.py`)。所以案 B 卸主库后必须 `pip install --force-reinstall --no-deps albumentationsx==2.4.13` 修复共享目录,否则包变残废。

## 二、使用面真相(卸载无损依据,1003 探子定谳+本役复核)

- **transparent-background 全引擎仅 2 处真实引用,均为函数内惰性导入**(卸载不影响节点注册):
  - `ComfyUI_essentials/image.py:810`(`TransparentBGSession+` 节点,类定义在 :795)
  - `ComfyUI-Easy-Use/py/nodes/image.py:971`(imageRemBg 的 Inspyrenet 档,自带 try/except 重装自愈)
  - 勘误:`comfyui-minimax-h3-prompt-enhancer-T8/qwen_image21.py:406` 的命中是同名**局部变量** `has_transparent_background`,非包引用。
- **仓库全部工作流对这两组节点零使用**(全库 rg `TransparentBGSession|imageRemBg|Inspyrenet` 无命中;rembg 抠像已被 Qwen21 原生 alpha 替代)。
- **主线 albumentations 的 import 面**仅 controlnet_aux 的 `src/custom_controlnet_aux/diffusion_edge/**` 9 个 vendored 文件(小众预处理器,同样零工作流使用);且它们 `import albumentations` 解析到的是 x 的码,卸主库后照常可导。

## 三、所走方案:案 B 实操三步(已执行,验收全绿)

```bash
VENV="$HOME/Library/Application Support/漫影工作室/comfyui/venv"
# 1. 卸双件(transparent-background 无任何已装包依赖,卸之无伤)
"$VENV/bin/pip" uninstall -y transparent-background albumentations
# 2. 修复共用目录(见 关键事实二;--no-deps 不动 albucore 0.2.20)
"$VENV/bin/pip" install --force-reinstall --no-deps albumentationsx==2.4.13
# 3. 复核
"$VENV/bin/pip" check        # → No broken requirements found. EXIT 0
"$VENV/bin/python" -c 'import albumentations; print(albumentations.__version__)'  # → 2.4.13
```

验收记录(2026-10-03 实测):`pip check` 零冲突 EXIT 0;`import albumentations` OK(2.4.13);功能烟测 `A.Compose([HorizontalFlip, RandomBrightnessContrast])` 实跑 numpy 图通过;引擎无需重启(纯 venv 层)。终态包集=albucore 0.2.20 + albumentationsx 2.4.13,主库与 transparent-background 已清出。

## 四、回种面备案(案 B 的已知盲区)

`ComfyUI_essentials/requirements.txt:5` 含 `transparent-background`(无 pin;Easy-Use 无此条目)。**Essentials 下次更新装依赖时会把 transparent-background 拉回**,其弹性 `albumentations>=1.3.1` 会让 resolver 从 PyPI 重装主线 2.0.8 并可能拽 albucore 降级 0.0.24(炸 x)。回种日处置:重跑本档第三节三步(卸+修复+复核),或届时若主线已复活新版再评估走案 A。任务档 `.trellis/tasks/10-03-albucore-conflict-resolution/task.json` notes 已同步。
