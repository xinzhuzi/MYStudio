"""MYStudio's video-use worker boundary.

The upstream browser-use/video-use repository is intentionally not imported at
module import time. The application supplies a managed Python interpreter and
an independent profile marker; this package only validates the worker protocol
and fails closed until the pinned upstream implementation is prepared.
"""

__all__ = ["__version__"]
__version__ = "mystudio-video-use-boundary-v1"
