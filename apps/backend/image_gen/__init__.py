"""Local image generation sidecar package for MYStudio.

Runs an OpenAI-compatible HTTP server (default 127.0.0.1:17595) exposing
POST /v1/images/generations backed by local diffusion models (SDXL Turbo /
FLUX.1-schnell via diffusers). Model downloads are explicit and user-triggered
from the settings panel; inference NEVER auto-downloads.
"""

__version__ = "0.1.0"

LOCAL_IMAGE_PORT = 17595
