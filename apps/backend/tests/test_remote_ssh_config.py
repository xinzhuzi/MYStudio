"""remote_ssh.config 契约测(11-03 sidecar-ssh-module S1)。

矩阵(PRD 测试矩阵 config 行):读默认 / 读损坏回退(坏 JSON+非对象) /
原子写(tmp+replace) / 写后触发 service 重载 / host 空预填远端引擎 hostname /
令牌真源默认两条。全密封 comfyui 家,机器级真值不渗入。
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from remote_ssh import config as ssh_config


class RemoteSshConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._home = Path(self._tmp.name)
        # 机器级 ssh-remote.json 真值隔离:一切读写密封进临时 comfyui 家
        self._seal = patch("comfyui.manifest.comfy_home", return_value=self._home)
        self._seal.start()
        self.addCleanup(self._seal.stop)

    def test_missing_file_returns_defaults_silently(self) -> None:
        cfg = ssh_config.load_config()
        self.assertEqual(cfg["host"], "")  # 空=未配置(常态)
        self.assertEqual(cfg["port"], 22)
        self.assertTrue(cfg["tunnelEnabled"])
        self.assertEqual(cfg["tunnelLocalPort"], 17596)
        self.assertEqual(cfg["tokenConfigPaths"], [])

    def test_corrupt_json_falls_back_to_defaults_with_warning(self) -> None:
        (self._home / "ssh-remote.json").write_text("{oops", encoding="utf-8")
        cfg = ssh_config.load_config()
        self.assertEqual(cfg, ssh_config.default_config())

    def test_non_object_json_falls_back_to_defaults(self) -> None:
        (self._home / "ssh-remote.json").write_text('["not", "an", "object"]', encoding="utf-8")
        cfg = ssh_config.load_config()
        self.assertEqual(cfg, ssh_config.default_config())

    def test_valid_file_round_trips_known_fields(self) -> None:
        payload = {
            "host": "192.168.0.101", "port": 22, "user": "zbj",
            "keyPath": "", "tunnelEnabled": True, "tunnelLocalPort": 17596,
            "tokenConfigPaths": ["E:/IP/漫影工作室/python/profiles/image-gen/config.json"],
        }
        (self._home / "ssh-remote.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
        cfg = ssh_config.load_config()
        self.assertEqual(cfg["host"], "192.168.0.101")
        self.assertEqual(cfg["user"], "zbj")
        self.assertEqual(
            cfg["tokenConfigPaths"],
            ["E:/IP/漫影工作室/python/profiles/image-gen/config.json"],
        )

    def test_invalid_field_values_fall_back_to_defaults(self) -> None:
        # 宽进严出:端口越界/类型不对回默认,不炸读取方
        (self._home / "ssh-remote.json").write_text(
            json.dumps({"host": "h", "port": 99999, "tunnelLocalPort": "x",
                        "tunnelEnabled": "yes", "tokenConfigPaths": [1, "  "]}),
            encoding="utf-8",
        )
        cfg = ssh_config.load_config()
        self.assertEqual(cfg["port"], 22)
        self.assertEqual(cfg["tunnelLocalPort"], 17596)
        self.assertTrue(cfg["tunnelEnabled"])  # 非 bool 不吸收=保持默认 True
        self.assertEqual(cfg["tokenConfigPaths"], [])

    def test_save_config_writes_atomically_and_notifies_service_reload(self) -> None:
        with patch("remote_ssh.service.notify_config_changed") as notify:
            saved = ssh_config.save_config({"host": "192.168.0.101", "user": "zbj"})
        notify.assert_called_once_with()  # 写后触发 service 重载
        self.assertEqual(saved["host"], "192.168.0.101")
        written = json.loads((self._home / "ssh-remote.json").read_text(encoding="utf-8"))
        self.assertEqual(written, saved)
        # 原子写:无 .tmp 残留
        self.assertFalse((self._home / "ssh-remote.json.tmp").exists())

    def test_save_config_prefills_host_from_remote_engine_url(self) -> None:
        # R1 默认值注入:UI 保存 host 空 → 预填远端引擎 URL 的 hostname(同源)
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value="http://192.168.0.101:17000",
        ), patch("remote_ssh.service.notify_config_changed"):
            saved = ssh_config.save_config({"host": "", "user": "zbj"})
        self.assertEqual(saved["host"], "192.168.0.101")

    def test_save_config_without_remote_engine_saves_unconfigured(self) -> None:
        # 引擎也没配:host 保持空(=未配置态,SSH 链 fail-open)
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=None,
        ), patch("remote_ssh.service.notify_config_changed"):
            saved = ssh_config.save_config({"host": ""})
        self.assertEqual(saved["host"], "")

    def test_save_config_preserves_hand_edited_token_paths(self) -> None:
        # R1 契约:tokenConfigPaths 是落盘字段但 UI 保存体(ComfySshConfigInput
        # 五字段)永不携带——payload 未给时继承旧档,手编辑的自定义令牌真源
        # 不被设置页一次「保存」静默清空
        (self._home / "ssh-remote.json").write_text(
            json.dumps(
                {"host": "192.168.0.101", "user": "zbj",
                 "tokenConfigPaths": ["D:/custom/token-config.json"]},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        with patch("remote_ssh.service.notify_config_changed"):
            saved = ssh_config.save_config({"host": "192.168.0.101", "user": "zbj"})
        self.assertEqual(saved["tokenConfigPaths"], ["D:/custom/token-config.json"])
        written = json.loads((self._home / "ssh-remote.json").read_text(encoding="utf-8"))
        self.assertEqual(written["tokenConfigPaths"], ["D:/custom/token-config.json"])

    def test_save_config_explicit_token_paths_payload_still_wins(self) -> None:
        # payload 显式给了列表(含空表=有意清回默认两条,effective 层口径):
        # 尊重 payload,不从旧档偷继承
        (self._home / "ssh-remote.json").write_text(
            json.dumps({"host": "192.168.0.101",
                        "tokenConfigPaths": ["D:/old/config.json"]}),
            encoding="utf-8",
        )
        with patch("remote_ssh.service.notify_config_changed"):
            saved = ssh_config.save_config(
                {"host": "192.168.0.101", "tokenConfigPaths": []}
            )
        self.assertEqual(saved["tokenConfigPaths"], [])

    def test_default_token_config_paths_are_two_candidates(self) -> None:
        # 令牌真源默认两条:安装位主路径 + %APPDATA% 同构(deploy-dual 注释链)
        paths = ssh_config.default_token_config_paths("zbj")
        self.assertEqual(paths[0], "E:/IP/漫影工作室/python/profiles/image-gen/config.json")
        self.assertEqual(
            paths[1],
            "C:/Users/zbj/AppData/Roaming/漫影工作室/python/profiles/image-gen/config.json",
        )
        # user 空:只给安装位一条(不瞎拼用户名)
        self.assertEqual(len(ssh_config.default_token_config_paths("")), 1)

    def test_effective_paths_prefer_explicit_config(self) -> None:
        cfg = ssh_config.default_config()
        cfg["tokenConfigPaths"] = ["D:/custom/config.json"]
        self.assertEqual(
            ssh_config.effective_token_config_paths(cfg), ["D:/custom/config.json"]
        )
        cfg["tokenConfigPaths"] = []
        cfg["user"] = "zbj"
        self.assertEqual(
            ssh_config.effective_token_config_paths(cfg),
            ssh_config.default_token_config_paths("zbj"),
        )


if __name__ == "__main__":
    unittest.main()
