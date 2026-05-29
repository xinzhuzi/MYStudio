from __future__ import annotations

import math
import struct
import wave
from pathlib import Path


def generate_mock_wav(output: Path, text: str, sample_rate: int = 24000) -> float:
    output.parent.mkdir(parents=True, exist_ok=True)
    duration = max(1.2, min(12.0, len(text) * 0.08))
    frames = int(sample_rate * duration)
    amplitude = 0.18

    with wave.open(str(output), "wb") as wav:
      wav.setnchannels(1)
      wav.setsampwidth(2)
      wav.setframerate(sample_rate)
      for index in range(frames):
          t = index / sample_rate
          envelope = min(1.0, index / max(1, sample_rate // 8)) * min(1.0, (frames - index) / max(1, sample_rate // 8))
          tone = math.sin(2 * math.pi * 220 * t) + 0.35 * math.sin(2 * math.pi * 330 * t)
          sample = int(max(-1.0, min(1.0, tone * amplitude * envelope)) * 32767)
          wav.writeframes(struct.pack("<h", sample))

    return duration
