"""ComfyUI 引擎适配器(现唯一引擎;第二引擎平级入驻 engines/ 下)。

manifest=实例目录单源;engine_manager=安装/更新链/launch/守卫/端口;
plugin_manager=插件安装/差分/策展;execute=子图执行(经引擎 HTTP)。
裁定:引擎永不 import 进 sidecar,交互面=subprocess git/pip + HTTP。
"""
