"""托管引擎域(09-09 裁定:engines 独立抽离,不止 image 概念)。

每引擎一个子包(照 Jan extensions/ 一引擎一包先例);本域只管引擎实例
生命周期(安装/更新/launch/守卫/插件策展),零业务生成逻辑。分层权威:
.claude/knowledge/backend-architecture.md(改目录前必读)。
"""
