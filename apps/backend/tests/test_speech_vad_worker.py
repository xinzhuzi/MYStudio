"""speech_vad.worker 失败语义与换算口径测试。

要点:QC 侧把 VAD 当「语音段的唯一真源」,所以任何失败都必须以
`status=needs-runtime|failed` 的 JSON 单行 + 退出码 0 交出——
worker 崩掉/非零退出会让 TS 侧只拿到异常,丢掉「为什么没证据」这句话。
"""

import io
import json
import subprocess
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from speech_vad import worker


def call_main(argv):
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = worker.main(argv)
    return code, buffer.getvalue()


class SpeechVadWorkerTest(unittest.TestCase):
    def test_frames_convert_to_seconds_with_three_decimals(self):
        stamps = [{"start": 1600, "end": 9600}, {"start": 0, "end": 1568}]
        self.assertEqual(
            worker.segments_to_seconds(stamps),
            [{"startS": 0.1, "endS": 0.6}, {"startS": 0.0, "endS": 0.098}],
        )

    def test_speech_seconds_sums_and_clamps_negative_segments(self):
        segments = [
            {"startS": 1.0, "endS": 3.5},
            {"startS": 7.0, "endS": 6.0},  # 倒挂:非法段不计负数
        ]
        self.assertEqual(worker.speech_seconds(segments), 2.5)

    def test_missing_silero_reports_needs_runtime_instead_of_crashing(self):
        error = ImportError("No module named 'silero_vad'")
        with patch.object(worker, "media_duration", return_value=197.12), patch.object(
            worker, "run_vad", side_effect=error
        ):
            code, out = call_main(["--video", "/tmp/whatever.mp4", "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual(payload["status"], "needs-runtime")
        self.assertEqual(payload["code"], "module-missing")
        self.assertEqual(payload["segments"], [])
        self.assertEqual(payload["speechSeconds"], 0.0)

    def test_ffmpeg_extract_failure_is_needs_runtime_av_tool_failed(self):
        error = subprocess.CalledProcessError(1, ["ffmpeg"], stderr=b"Invalid data found")
        with patch.object(worker, "media_duration", return_value=9.417), patch.object(
            worker, "run_vad", side_effect=error
        ):
            code, out = call_main(["--video", "/tmp/whatever.mp4", "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual(payload["status"], "needs-runtime")
        self.assertEqual(payload["code"], "av-tool-failed")

    def test_unexpected_error_is_failed_not_ok(self):
        with patch.object(worker, "media_duration", side_effect=RuntimeError("boom")):
            code, out = call_main(["--video", "/tmp/whatever.mp4", "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["code"], "vad-error")

    def test_ok_payload_carries_model_tag_and_speech_total(self):
        stamps = [{"start": 1568, "end": 97920}]
        with patch.object(worker, "media_duration", return_value=197.12), patch.object(
            worker, "run_vad", return_value=(worker.segments_to_seconds(stamps), "6.2.3")
        ):
            code, out = call_main(["--video", "/tmp/whatever.mp4", "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["model"], "silero-vad@6.2.3")
        self.assertEqual(payload["sampleRate"], 16000)
        self.assertAlmostEqual(payload["speechSeconds"], 6.022)


if __name__ == "__main__":
    unittest.main()
