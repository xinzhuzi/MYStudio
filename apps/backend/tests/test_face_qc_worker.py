from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from face_qc import worker


class FaceQcWorkerContractTests(unittest.TestCase):
    """face_qc/worker.py 的降级契约(1102 吸收件①)。

    这组跑在系统 python3(backend_unittest 域),而产线用的是托管 Python——
    所以这里只钉「没有依赖时也必须好好说话」这一半:退出码恒 0、状态用 JSON 表达、
    算不出来的量发 null。检出数值本身由 `chapter-qc-face.test.ts` 用真机原文钉死。
    """

    def capture_main(self, argv: list[str]) -> tuple[int, dict]:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(io.StringIO()):
            code = worker.main(argv)
        lines = [line for line in buffer.getvalue().splitlines() if line.strip()]
        return code, json.loads(lines[-1])

    def test_explicit_model_path_is_checked_for_existence(self):
        # 不验存在的话 cv2 会抛图形引擎内部的 -215,读起来像「检测器坏了」而不是「文件没了」
        with self.assertRaises(FileNotFoundError) as ctx:
            worker.resolve_model_path("/tmp/does-not-exist-1102.onnx")
        self.assertIn("模型文件不存在", str(ctx.exception))

    def test_missing_model_reports_needs_runtime_not_crash(self):
        code, payload = self.capture_main(["--video", "/tmp/nope.mp4", "--model", "/tmp/does-not-exist-1102.onnx"])
        self.assertEqual(code, 0, "侧车任何失败都靠 JSON 状态说话,不许用退出码砸编排器")
        self.assertEqual(payload["schemaVersion"], 1)
        self.assertEqual(payload["status"], "needs-runtime")
        if importlib.util.find_spec("cv2") is None:
            # 这台机器没装 OpenCV:必须先说 cv2-missing,而不是假装能扫
            self.assertEqual(payload["code"], "cv2-missing")
        else:
            self.assertEqual(payload["code"], "model-not-downloaded")
            self.assertEqual(payload["model"], "yunet-face")

    def test_unopenable_video_is_scan_failed(self):
        if importlib.util.find_spec("cv2") is None:
            self.skipTest("无 cv2 时到不了扫描阶段")
        code, payload = self.capture_main(["--video", "/tmp/nope-1102.mp4"])
        self.assertEqual(code, 0)
        self.assertEqual(payload["status"], "needs-runtime")
        self.assertEqual(payload["code"], "scan-failed")

    def test_detected_faces_produce_evidence_without_geometry_verdict(self):
        frame = SimpleNamespace(shape=(512, 512, 3))
        cap = Mock()
        cap.isOpened.return_value = True
        cap.read.return_value = (True, frame)
        detector = Mock()
        detector.detect.return_value = (None, [[10, 20, 80, 100] + [0] * 10 + [0.9]])
        cv2 = SimpleNamespace(
            VideoCapture=Mock(return_value=cap),
            FaceDetectorYN=SimpleNamespace(create=Mock(return_value=detector)),
            resize=Mock(return_value=frame), INTER_AREA=1, CAP_PROP_POS_MSEC=0,
        )
        with patch.object(worker, "media_duration", return_value=2.0), patch.object(
            worker, "face_descriptor", return_value=[1.0, 0.0]
        ):
            result = worker.scan_video(cv2, "model.onnx", "fixture.mp4", 2, 0.6)
        self.assertEqual(result["faceCount"], 2)
        self.assertEqual(result["readableFaceCount"], 2)
        self.assertEqual(result["medianFaceShortSidePx"], 80.0)
        self.assertEqual(result["driftPairs"], 1)
        self.assertNotIn("geometryAnomalyFlags", result)
        cap.release.assert_called_once()

    def test_readability_uses_only_the_visible_part_of_the_face_box(self):
        frame = SimpleNamespace(shape=(512, 512, 3))
        cap = Mock()
        cap.isOpened.return_value = True
        cap.read.return_value = (True, frame)
        detector = Mock()
        detector.detect.return_value = (None, [[-12, -12, 32, 32] + [0] * 10 + [0.9]])
        cv2 = SimpleNamespace(
            VideoCapture=Mock(return_value=cap),
            FaceDetectorYN=SimpleNamespace(create=Mock(return_value=detector)),
            resize=Mock(return_value=frame), INTER_AREA=1, CAP_PROP_POS_MSEC=0,
        )
        with patch.object(worker, "media_duration", return_value=2.0), patch.object(
            worker, "face_descriptor", return_value=None
        ):
            result = worker.scan_video(cv2, "model.onnx", "fixture.mp4", 1, 0.6)
        self.assertEqual(result["faceCount"], 1)
        self.assertEqual(result["readableFaceCount"], 0)
        self.assertEqual(result["readableRatio"], 0)
        self.assertEqual(result["medianFaceShortSidePx"], 20)

    def test_descriptor_clips_a_partly_outside_face_box(self):
        if importlib.util.find_spec("cv2") is None:
            self.skipTest("requires OpenCV")
        import cv2
        import numpy as np

        image = np.full((32, 32, 3), 128, dtype=np.uint8)
        self.assertIsNotNone(worker.face_descriptor(cv2, image, (-5, -8, 24, 24)))
        self.assertIsNone(worker.face_descriptor(cv2, image, (-50, 0, 10, 10)))

    def test_percentile_of_empty_is_none_not_zero(self):
        # 零脸章发 null:TS 侧把 null 与 0 分流(0=真没检到可辨脸,null=无从计算)
        self.assertIsNone(worker.percentile([], 0.5))
        self.assertEqual(worker.percentile([1.0, 2.0, 3.0], 0.5), 2.0)

    def test_cosine_distance_is_bounded(self):
        same = [1.0] + [0.0] * 63
        flipped = [-1.0] + [0.0] * 63
        self.assertEqual(worker.cosine_distance(same, same), 0.0)
        self.assertAlmostEqual(worker.cosine_distance(same, flipped), 2.0)
        # 非归一化向量能把点积推过 ±1,距离必须夹在 [0,2] 里
        self.assertEqual(worker.cosine_distance([2.0], [2.0]), 0.0)
        self.assertEqual(worker.cosine_distance([2.0], [-2.0]), 2.0)


class FaceCropContractTests(unittest.TestCase):
    """裁片模式契约(1107 吸收件②)。

    这里钉的是「台账形状」:每个请求时间点恰一条、状态分四类、放大与夹取口径可复算。
    TS 侧 `runChapterQcFaceCrops` 拿 `len(crops) == len(timestamps)` 当硬门,
    少一条就会把整批读成缺证——所以这条等式必须在 Python 侧先钉死。
    """

    class Frame:
        """够用的假帧:只需要 shape 与矩形切片(不引 numpy,系统 python3 未必有)。"""

        def __init__(self, height: int, width: int) -> None:
            self.shape = (height, width, 3)

        def __getitem__(self, key):
            rows, cols = key
            return FaceCropContractTests.Frame(rows.stop - rows.start, cols.stop - cols.start)

    def fake_cv2(self, rows_by_call, write_ok=True):
        cap = Mock()
        cap.isOpened.return_value = True
        reads = []
        for rows in rows_by_call:
            if rows == "unreadable":
                reads.append((False, None))
            else:
                reads.append((True, self.Frame(700, 1280)))
        cap.read.side_effect = reads
        detector = Mock()
        detector.detect.side_effect = [(None, rows) for rows in rows_by_call if rows != "unreadable"]
        imwrite = Mock(return_value=write_ok)
        return SimpleNamespace(
            VideoCapture=Mock(return_value=cap),
            FaceDetectorYN=SimpleNamespace(create=Mock(return_value=detector)),
            resize=lambda image, size, interpolation=None: self.Frame(size[1], size[0]),
            imwrite=imwrite,
            INTER_AREA=1,
            INTER_LANCZOS4=4,
            CAP_PROP_POS_MSEC=0,
            IMWRITE_JPEG_QUALITY=1,
            error=Exception,
        )

    def test_crop_mode_never_runs_the_evidence_scan(self):
        fake = self.fake_cv2([[]])
        with patch.dict(sys.modules, {"cv2": fake}), patch.object(
            worker, "resolve_model_path", return_value="model.onnx"
        ), patch.object(worker, "crop_faces", return_value={"mode": "crops", "crops": []}) as crop_spy, patch.object(
            worker, "scan_video", return_value={}
        ) as scan_spy:
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(io.StringIO()):
                code = worker.main(["--video", "/tmp/f.mp4", "--at", "0.5,1.5", "--crop-out", "/tmp/out", "--json"])
        payload = json.loads([line for line in buffer.getvalue().splitlines() if line.strip()][-1])
        self.assertEqual((code, payload["status"], payload["mode"]), (0, "ok", "crops"))
        crop_spy.assert_called_once()
        scan_spy.assert_not_called()
        self.assertEqual(crop_spy.call_args.args[3], [0.5, 1.5], "时间点顺序即台账 index,不许重排")

    def test_crop_out_dir_is_required_when_timestamps_given(self):
        code, payload = self.capture_main(["--video", "/tmp/nope.mp4", "--at", "0.5,1.0"])
        self.assertEqual(code, 0)
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["code"], "crop-out-required")

    capture_main = FaceQcWorkerContractTests.capture_main

    def test_bad_timestamp_list_is_rejected_wholesale(self):
        # 静默丢掉一个时间点 = 那一镜没有特写证据,而台账上看不出来
        with self.assertRaises(ValueError):
            worker.parse_timestamps("0.5,abc")
        with self.assertRaises(ValueError):
            worker.parse_timestamps("-1")
        self.assertEqual(worker.parse_timestamps(" 0.5 , 1.500 "), [0.5, 1.5])

    def test_one_ledger_entry_per_timestamp_with_status(self):
        rows = [[200, 100, 100, 200] + [0.0] * 10 + [0.9], [10, 10, 20, 20] + [0.0] * 10 + [0.7]]
        fake = self.fake_cv2([rows, [], "unreadable"])
        result = worker.crop_faces(fake, "model.onnx", "/tmp/f.mp4", [0.633, 1.898, 99.5], "/tmp/out")
        self.assertEqual([crop["index"] for crop in result["crops"]], [0, 1, 2], "台账条数必须等长于请求,否则 TS 侧整批缺证")
        self.assertEqual([crop["status"] for crop in result["crops"]], ["crop", "no-face", "read-failed"])
        self.assertEqual(result["cropCount"], 1)
        # framesRead 数「读到的帧」,无脸帧也算——它读成功了,只是画面里没有脸
        self.assertEqual(result["framesRead"], 2)
        self.assertEqual(result["framesWithoutFace"], 1)
        self.assertEqual(result["cropErrors"], 1)

    def test_crop_uses_the_largest_face_at_native_resolution(self):
        # 检测在 512 方框空间,裁片回到原始分辨率:1280×700 上 x/y 缩放系数不同,
        # 方框在原生帧里会变成长方形——这条必须钉住,否则裁片会把脸裁歪。
        # 脸取小(原生 100×54.7):这正是 1102 标定过的 1080P 贴片尺寸,必须走 Lanczos 放大。
        rows = [[10, 10, 20, 20] + [0.0] * 10 + [0.7], [50, 40, 40, 40] + [0.0] * 10 + [0.9]]
        fake = self.fake_cv2([rows])
        result = worker.crop_faces(fake, "model.onnx", "/tmp/f.mp4", [0.633], "/tmp/out")
        crop = result["crops"][0]
        sx, sy = 1280 / worker.INPUT_SIZE, 700 / worker.INPUT_SIZE
        self.assertEqual(crop["box"], [round(50 * sx, 1), round(40 * sy, 1), round(40 * sx, 1), round(40 * sy, 1)])
        self.assertEqual(crop["faceShortSidePx"], round(40 * sy, 1))
        self.assertEqual(crop["facesInFrame"], 2, "同一帧里有第二张脸也要留痕:裁片只取最大那张")
        self.assertEqual(crop["file"], "face-crop-000-t0.633.jpg")
        self.assertTrue(crop["upscaled"])
        self.assertEqual(crop["cropPx"], [worker.CROP_MIN_SIDE, worker.CROP_MIN_SIDE])
        written = fake.imwrite.call_args.args[0]
        self.assertTrue(str(written).endswith(crop["file"]))
        self.assertEqual(fake.imwrite.call_args.args[2], [fake.IMWRITE_JPEG_QUALITY, worker.CROP_JPEG_QUALITY])

    def test_crop_is_clamped_into_the_frame(self):
        # 贴边脸:方形框按中心展开后必须夹回画面内,不许裁出负坐标
        rows = [[0, 0, 200, 200] + [0.0] * 10 + [0.9]]
        fake = self.fake_cv2([rows])
        crop = worker.crop_faces(fake, "model.onnx", "/tmp/f.mp4", [1.0], "/tmp/out")["crops"][0]
        self.assertEqual(crop["status"], "crop")
        self.assertGreaterEqual(crop["cropPx"][0], crop["box"][2])
        self.assertLessEqual(crop["box"][0] + crop["box"][2], 1280)

    def test_degenerate_or_unwritable_crop_is_recorded_not_dropped(self):
        zero = self.fake_cv2([[[10, 10, 0, 0] + [0.0] * 10 + [0.9]]])
        self.assertEqual(worker.crop_faces(zero, "m", "/tmp/f.mp4", [1.0], "/tmp/out")["crops"][0]["status"], "write-failed")
        failing = self.fake_cv2([[[10, 10, 100, 100] + [0.0] * 10 + [0.9]]], write_ok=False)
        result = worker.crop_faces(failing, "m", "/tmp/f.mp4", [1.0], "/tmp/out")
        self.assertEqual(result["crops"][0]["status"], "write-failed")
        self.assertEqual(result["cropErrors"], 1)

    def test_unopenable_crop_video_raises_for_the_caller_to_report(self):
        cv2 = SimpleNamespace(VideoCapture=Mock(return_value=Mock(isOpened=Mock(return_value=False))))
        with self.assertRaises(RuntimeError):
            worker.crop_faces(cv2, "m", "/tmp/nope.mp4", [1.0], "/tmp/out")


if __name__ == "__main__":
    unittest.main()
