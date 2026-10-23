"""托管引擎域(09-09 裁定:engines 独立抽离,不止 image 概念)。

每引擎一个子包(照 Jan extensions/ 一引擎一包先例);本域只管引擎实例
生命周期(安装/更新/launch/守卫/插件策展),零业务生成逻辑。分层权威:
.claude/knowledge/backend-architecture.md(改目录前必读)。

特例(10-22 迁移):comfyui 托管包上提为 apps/backend/comfyui 平级包
(import 名 comfyui 直达),不在本域内;engines/ 其余各包仍循每引擎一
子包原则,09-09 分层裁定不变。
"""
