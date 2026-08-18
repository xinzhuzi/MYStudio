# 转场音效许可清单（SFX Licenses）

> 来源：Kenney.nl（CC0 1.0 公有领域，2026-08-18 下载）。TS 权威映射=
> `composition/build-composition-props.ts` 的 `sfxAssetForTransition`。

| 文件 | 上游 | 来源包 | 许可 |
|---|---|---|---|
| `sfx-boom.ogg` | impactBell_heavy_000.ogg | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sfx-flash.ogg` | impactGlass_light_000.ogg | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sfx-soft.ogg` | pluck_001.ogg | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sfx-warm.ogg` | confirmation_001.ogg | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sfx-whoosh.ogg` | scroll_001.ogg | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sfx-zoom.ogg` | maximize_001.ogg | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sfx-glitch.ogg` | glitch_001.ogg | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sfx-dissolve.ogg` | drop_001.ogg | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |

## 本地生成音效(非打包产物)

> 设置 → 本地配置 → 本地音效生成 与工作台「生成 SFX」产出的 WAV 由本地模型生成,
> 落用户导出/项目媒体目录,**不随应用分发**,因此不涉及再分发许可。

| 引擎 | 模型 | 权重许可 | 说明 |
|---|---|---|---|
| transformers-MusicGen | facebook/musicgen-small | CC-BY-NC-4.0 (weights) | 与本地音乐生成共用缓存;个人/本地使用,商用需 Meta 授权 |
| audiogen(候选,未启用) | facebook/audiogen-medium | CC-BY-NC-4.0 (待核) | 选型候选;启用前须实测音质/体积并核定许可与 audiocraft 依赖 |
