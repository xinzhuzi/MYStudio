"""Entry point for the local image generation sidecar.

Usage:
  python -m image_gen.main --host 127.0.0.1 --port 17595
"""

from .server import main, run, Handler  # noqa: F401

if __name__ == "__main__":
    main()
