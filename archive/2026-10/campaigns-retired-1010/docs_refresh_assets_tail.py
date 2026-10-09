"""Apply narrow, source-checked corrections to the remaining asset guides."""
from pathlib import Path
root=Path(__file__).resolve().parents[3]

def change(name,pairs):
 p=root/name;s=p.read_text()
 for a,b in pairs:
  assert s.count(a)==1,(name,a[:80],s.count(a))
  s=s.replace(a,b,1)
 p.write_text(s);assert p.read_text()==s;print(name)

change('docs/assets/PROPS_LIBRARY_OPERATIONS.md',[
 ('# 道具目录操作手册','# 历史道具目录组件参考'),
 ('本文说明资产页中的本地道具目录视图。源码入口是 `apps/frontend/components/panels/assets/PropsLibrary.tsx`。', '本文保留旧本地道具目录组件的操作记录，源码仍在 `apps/frontend/components/panels/assets/PropsLibrary.tsx`。2026-09-20 核验：当前资产页 `index.tsx` 的道具入口挂载 `StudioAssetLibrary type="tool"`，没有挂载该目录组件。下面的目录树与按钮不作为当前 UI 操作指引；当前入口见 [资产导入与管理](./ASSET_IMPORT_AND_MANAGEMENT.md)。'),
 ('常见入口是：','当前道具入口是（显示资产网格与分类筛选，不显示本文旧目录树）：'),
])
change('docs/assets/ASSET_IMPORT_AND_MANAGEMENT.md',[
 ('项目还保留一个本地道具目录视图，主要由 MY 工作流「剧本资产管理」的落地衍生资产写入。完整说明见 [道具目录操作手册](./PROPS_LIBRARY_OPERATIONS.md)。它支持：', '仓库还保留本地道具目录组件，但当前资产页没有挂载它。下列是旧组件能力，不能在当前 `资产 -> 道具` 页面照做；历史说明见 [道具目录组件参考](./PROPS_LIBRARY_OPERATIONS.md)：'),
])
change('docs/workflow/WORKFLOW_ASSET_GENERATION_OPERATIONS.md',[
 ('| 整理道具目录 | 资产 -> 道具，或 [道具目录操作手册](../assets/PROPS_LIBRARY_OPERATIONS.md) |', '| 管理道具资产 | 资产 -> 道具；旧目录组件未挂载，见 [历史道具目录参考](../assets/PROPS_LIBRARY_OPERATIONS.md) |'),
])
change('docs/assets/VISUAL_STYLE_MANAGEMENT.md',[
 ('| 工作流 | `风格与导演选择` 选择视觉手册和导演手册 |', '| 工作流 | `MY 工作流 -> 风格与导演` 选择视觉手册和导演手册 |'),
])
p=root/'docs/assets/ROLE_AUDIO_ASSIGNMENT_REFERENCE.md';s=p.read_text()
s=s.replace('资产 -> 角色库','资产 -> 角色').replace('按钮只在 `角色库` 顶部显示。','按钮只在 `角色` 资产页顶部显示。').replace('`资产 -> 音频库` 会把音频分为：','`资产 -> 配音`（页面标题 `配音库`）会把音频分为：')
a='''3. 读取全部角色。
4. 读取全部音频素材。
5. 构造可克隆音色候选。
6. 先用本地规则打分。
7. 如果 `universalAi` 可用，再让 AI 在 Top 候选里二次裁决。
8. 为每个角色写入 reference profile 和 speaker 绑定。'''
b='''3. 合并本地与资产库角色，按项目实体身份解析 speaker，并加入旁白目标。
4. 读取音频素材，构造可克隆参考音频列表。
5. 先校验已有固定绑定及参考音频可读性；有效固定音色予以复用，不全部重分配。
6. 对未绑定目标进行匹配；有 `universalAi` 时在每个角色最多 8 个音频中做 AI 语义裁决，否则使用本地规则。
7. 计划出现错误时阻断写入并提示原因。
8. 当前按钮写入计划 `created` 中的新 profile 和 speaker 绑定。'''
assert a in s;s=s.replace(a,b)
s=s.replace('已为 N 个角色自动分配音频（本地规则）\n已为 N 个角色自动分配音频（AI语义匹配）','固定音色校验完成：复用 N，新建 M（本地规则）\n固定音色校验完成：复用 N，新建 M（AI语义匹配）')
p.write_text(s);assert p.read_text()==s;print(p.relative_to(root))
change('docs/assets/ASSET_AUDIO_ASSIGNMENT.md',[
 ('系统会读取全部角色和音频候选，按以下顺序处理：','系统会读取角色、旁白目标与音频候选。已有固定绑定先校验并复用，只对未绑定目标继续匹配；计划出现错误会阻断写入。后续匹配顺序为：'),
 ('4. 每个角色写入对应的克隆音色 profile 和 speaker 绑定。','4. 为计划中需要新建的目标写入克隆音色 profile 和 speaker 绑定，提示复用数与新建数。'),
])
change('docs/assets/art-styles.md',[
 ('漫影工作室内置 60 种美术风格，可在分镜生产时一键套用。下图为各风格的代表效果。','本页展示内置美术风格的代表图，不是当前可用风格数量或模型出图效果的保证。完整可用列表以 `资产 -> 风格库` 为准；在 `MY 工作流 -> 风格与导演` 中选择项目使用的视觉手册。'),
 ('_MYStudio ships with 60 built-in art styles, applicable in one click during storyboard production. Below are representative samples of each style._','_These are representative style references. The Assets style library is the source for the available manuals; select a manual in the workflow style-and-director stage._'),
])
change('docs/assets/art-styles.en.md',[
 ('MYStudio ships with **60 built-in art styles** covering 2D animation, 3D rendering, stop-motion, and live-action imagery. Apply any of them with one click during storyboard production. Below are representative samples.','This gallery shows representative references across 2D animation, 3D rendering, stop-motion, and live-action imagery. It is not a fixed inventory count or a guarantee of model output. Check the Assets style library for available manuals, and select the project manual in the workflow style-and-director stage.'),
])
