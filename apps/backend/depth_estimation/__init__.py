"""Depth estimation sidecar package for MYStudio.

Produces normalized grayscale depth-map PNGs from single static images,
driving the @remotion/three CinematicVisualClip 3D parallax/DoF effects.

Follows the same sidecar pattern as video_use: argparse CLI with --probe / --run,
file-based JSON I/O, reuses the shared managed Python 3.12 runtime.
"""

__version__ = "0.1.0"
