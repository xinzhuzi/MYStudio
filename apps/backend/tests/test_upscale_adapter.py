from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from upscale import model_cache
from upscale.adapter import UpscaleError, _build_network, _tile_forward, probe_model, upscale_image
from upscale.model_cache import file_sha256
from upscale.rrdbnet import RRDBNet
from upscale.srvgg import SRVGGNetCompact

try:
    import torch  # noqa: F401

    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

TINY_RRDB = "test-tiny-rrdb"


def _tiny_specs() -> dict:
    return {
        TINY_RRDB: {
            "label": "测试小模型",
            "description": "单元测试用",
            "file": "tiny-rrdb.pth",
            "url": "https://example.invalid/tiny-rrdb.pth",
            "sources": (),
            "sha256": "0" * 64,
            "size_mb": 1,
            "arch": {
                "kind": "rrdbnet",
                "num_in_ch": 3,
                "num_out_ch": 3,
                "num_feat": 8,
                "num_block": 1,
                "num_grow_ch": 4,
                "scale": 4,
            },
            "scale": 4,
            "license": "test",
        }
    }


def _write_tiny_checkpoint(directory: Path, spec: dict) -> None:
    network = _build_network_from_arch(spec["arch"])
    state = {"params_ema": network.state_dict()}
    checkpoint = directory / spec["file"]
    torch.save(state, checkpoint)
    spec["sha256"] = file_sha256(checkpoint)


def _build_network_from_arch(arch: dict):
    from upscale.rrdbnet import RRDBNet as _RRDBNet

    parameters = dict(arch)
    parameters.pop("kind")
    return _RRDBNet(**parameters)


@unittest.skipUnless(TORCH_AVAILABLE, "torch not installed")
class UpscaleAdapterTest(unittest.TestCase):
    def _tiny_env(self, temp: str):
        return patch.dict(
            model_cache.UPSCALE_MODELS,
            _tiny_specs(),
        ), patch.dict("os.environ", {"MYSTUDIO_UPSCALE_MODEL_DIR": temp})

    def test_build_network_dispatches_by_arch_kind(self) -> None:
        with patch.dict(model_cache.UPSCALE_MODELS, _tiny_specs()):
            self.assertIsInstance(_build_network(TINY_RRDB), RRDBNet)
        self.assertIsInstance(
            _build_network("realesr-general-x4v3"),
            SRVGGNetCompact,
        )
        self.assertIsInstance(
            _build_network("realesrgan-x4plus-anime-6b"),
            RRDBNet,
        )

    def test_tile_forward_quantizes_normalized_output_to_eight_bit(self) -> None:
        class NearestNetwork:
            def __call__(self, tensor):
                return torch.nn.functional.interpolate(tensor, scale_factor=4, mode="nearest")

        tensor = torch.full((1, 3, 2, 2), 0.33, dtype=torch.float32)
        output = _tile_forward(NearestNetwork(), tensor, scale=4, tile=2, tile_pad=0)
        self.assertEqual(output.dtype, torch.uint8)
        self.assertEqual(output.shape, (1, 3, 8, 8))
        self.assertEqual(set(output.unique().tolist()), {84})

    def test_tile_forward_places_each_tile_at_its_global_output_position(self) -> None:
        class NearestNetwork:
            def __call__(self, tensor):
                return torch.nn.functional.interpolate(tensor, scale_factor=2, mode="nearest")

        tensor = torch.tensor(
            [[[[0.1, 0.1, 0.2, 0.2], [0.1, 0.1, 0.2, 0.2],
               [0.3, 0.3, 0.4, 0.4], [0.3, 0.3, 0.4, 0.4]]]],
            dtype=torch.float32,
        ).repeat(1, 3, 1, 1)
        output = _tile_forward(NearestNetwork(), tensor, scale=2, tile=2, tile_pad=0)
        expected = torch.nn.functional.interpolate(tensor, scale_factor=2, mode="nearest")
        expected = expected.mul(255.0).round().to(torch.uint8)
        self.assertTrue(torch.equal(output, expected))

    def test_upscale_image_accepts_and_preserves_alpha(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            registry_patch, env_patch = self._tiny_env(temp)
            with registry_patch, env_patch:
                spec = model_cache.UPSCALE_MODELS[TINY_RRDB]
                _write_tiny_checkpoint(Path(temp), spec)
                source = Path(temp) / "in.png"
                destination = Path(temp) / "out.png"
                Image.new("RGBA", (40, 24), (10, 200, 30, 128)).save(source)
                result = upscale_image(str(source), str(destination), TINY_RRDB)
                self.assertEqual(result["scale"], 4)
                self.assertEqual(result["width"], 160)
                self.assertEqual(result["height"], 96)
                self.assertGreater(result["outputBytes"], 0)
                self.assertEqual(result["outputBytes"], destination.stat().st_size)
                self.assertEqual(len(result["outputSha256"]), 64)
                with Image.open(destination) as output:
                    self.assertEqual(output.mode, "RGBA")
                    self.assertEqual(output.size, (160, 96))
                    corner = output.getpixel((2, 2))
                    self.assertEqual(corner[3], 128)

    def test_upscale_image_rgb_has_no_alpha(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            registry_patch, env_patch = self._tiny_env(temp)
            with registry_patch, env_patch:
                spec = model_cache.UPSCALE_MODELS[TINY_RRDB]
                _write_tiny_checkpoint(Path(temp), spec)
                source = Path(temp) / "in.png"
                destination = Path(temp) / "out.png"
                Image.new("RGB", (24, 16), (200, 10, 30)).save(source)
                with patch("upscale.adapter._tile_forward", return_value=torch.full((1, 3, 64, 96), 84, dtype=torch.uint8)):
                    upscale_image(str(source), str(destination), TINY_RRDB)
                with Image.open(destination) as output:
                    self.assertEqual(output.mode, "RGB")
                    self.assertEqual(output.size, (96, 64))

    def test_upscale_image_rejects_near_black_output_for_visible_input(self) -> None:
        from PIL import Image

        class BlackNetwork:
            def __call__(self, tensor):
                return torch.zeros(
                    (tensor.shape[0], tensor.shape[1], tensor.shape[2] * 4, tensor.shape[3] * 4),
                    device=tensor.device,
                )

        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "bright.png"
            destination = Path(temp) / "out.png"
            Image.new("RGB", (8, 8), (120, 90, 60)).save(source)
            spec = {"scale": 4}
            with patch("upscale.adapter._load_model", return_value=(BlackNetwork(), "cpu", spec)):
                with self.assertRaises(UpscaleError) as ctx:
                    upscale_image(str(source), str(destination), TINY_RRDB, tile=8, tile_pad=0)
            self.assertEqual(ctx.exception.code, "output-quality-failed")
            self.assertFalse(destination.exists())

    def test_upscale_image_allows_intentionally_dark_input(self) -> None:
        from PIL import Image

        class BlackNetwork:
            def __call__(self, tensor):
                return torch.zeros(
                    (tensor.shape[0], tensor.shape[1], tensor.shape[2] * 4, tensor.shape[3] * 4),
                    device=tensor.device,
                )

        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "dark.png"
            destination = Path(temp) / "out.png"
            Image.new("RGB", (8, 8), (0, 0, 0)).save(source)
            with patch("upscale.adapter._load_model", return_value=(BlackNetwork(), "cpu", {"scale": 4})):
                result = upscale_image(str(source), str(destination), TINY_RRDB, tile=8, tile_pad=0)
            self.assertEqual(result["width"], 32)
            self.assertTrue(destination.exists())

    def test_corrupt_checkpoint_fails_before_inference(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            registry_patch, env_patch = self._tiny_env(temp)
            with registry_patch, env_patch:
                spec = model_cache.UPSCALE_MODELS[TINY_RRDB]
                _write_tiny_checkpoint(Path(temp), spec)
                (Path(temp) / spec["file"]).write_bytes(b"tampered")
                source = Path(temp) / "in.png"
                destination = Path(temp) / "out.png"
                Image.new("RGB", (8, 8), (120, 90, 60)).save(source)
                with self.assertRaises(UpscaleError) as ctx:
                    upscale_image(str(source), str(destination), TINY_RRDB)
                self.assertEqual(ctx.exception.code, "model-corrupt")
                self.assertFalse(destination.exists())

    def test_model_not_downloaded_fails_closed(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            registry_patch, env_patch = self._tiny_env(temp)
            with registry_patch, env_patch:
                source = Path(temp) / "in.png"
                Image.new("RGB", (8, 8)).save(source)
                with self.assertRaises(UpscaleError) as ctx:
                    upscale_image(str(source), str(Path(temp) / "out.png"), TINY_RRDB)
                self.assertEqual(ctx.exception.code, "model-not-downloaded")

    def test_input_not_found(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            registry_patch, env_patch = self._tiny_env(temp)
            with registry_patch, env_patch:
                with self.assertRaises(UpscaleError) as ctx:
                    upscale_image(str(Path(temp) / "missing.png"), str(Path(temp) / "out.png"), TINY_RRDB)
                self.assertEqual(ctx.exception.code, "input-not-found")

    def test_input_above_4k_rejected(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            registry_patch, env_patch = self._tiny_env(temp)
            with registry_patch, env_patch:
                spec = model_cache.UPSCALE_MODELS[TINY_RRDB]
                _write_tiny_checkpoint(Path(temp), spec)
                source = Path(temp) / "big.png"
                Image.new("RGB", (4097, 512)).save(source)
                with self.assertRaises(UpscaleError) as ctx:
                    upscale_image(str(source), str(Path(temp) / "out.png"), TINY_RRDB)
                self.assertEqual(ctx.exception.code, "input-too-large")
                self.assertFalse((Path(temp) / "out.png").exists())

    def test_probe_blocked_without_model(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            registry_patch, env_patch = self._tiny_env(temp)
            with registry_patch, env_patch:
                payload = probe_model(TINY_RRDB)
                self.assertEqual(payload["status"], "blocked")
                self.assertEqual(payload["code"], "model-not-downloaded")

    def test_probe_blocks_corrupt_model(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict("os.environ", {"MYSTUDIO_UPSCALE_MODEL_DIR": temp}):
                spec = model_cache.UPSCALE_MODELS["realesrgan-x4plus-anime-6b"]
                (Path(temp) / spec["file"]).write_bytes(b"corrupt")
                payload = probe_model("realesrgan-x4plus-anime-6b")
                self.assertEqual(payload["status"], "blocked")
                self.assertEqual(payload["code"], "model-corrupt")

    def test_probe_unknown_model(self) -> None:
        payload = probe_model("not-a-model")
        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["code"], "unknown-model")


if __name__ == "__main__":
    unittest.main()
