"""Cinematic color grading presets for video-use.

Each preset maps to an FFmpeg filter chain applied during the preview/grade
stage. The presets use standard FFmpeg video filters (curves, colorbalance,
eq, hue) to produce film-grade looks without external LUT files.

Usage in the video-use adapter:
    grade_filter = CINEMATIC_GRADES.get(grade_name, CINEMATIC_GRADES["auto"])
    ffmpeg_args += ["-vf", grade_filter]
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Preset definitions
# ---------------------------------------------------------------------------

# "auto" = no grade (passthrough)
CINEMATIC_GRADES: dict[str, str] = {
    "auto": "null",

    # --- Hollywood standard looks ---
    "cinematic-teal-orange":
        # Push shadows toward teal, highlights toward orange
        "colorbalance=rs=-0.08:gs=0.02:bs=0.12:rm=0.10:gm=-0.02:bm=-0.08:"
        "rh=0.08:gh=-0.02:bh=-0.06,"
        "curves=preset=increase_contrast,"
        "eq=saturation=1.15:contrast=1.05",

    "cinematic-bleach-bypass":
        # High-contrast desaturated (Saving Private Ryan / Steven Spielberg look)
        "eq=contrast=1.35:saturation=0.35:brightness=-0.02,"
        "curves=preset=increase_contrast,"
        "colorbalance=rs=0.02:bs=0.04:rh=0.04:bh=-0.02",

    "cinematic-filmic":
        # Film-like S-curve with warm midtones
        "curves=preset=filmic,"
        "colorbalance=rs=0.03:gs=-0.01:bs=-0.02:rm=0.02:gm=-0.01,"
        "eq=saturation=1.08:contrast=1.08:gamma=0.95",

    "cinematic-noir":
        # Black-and-white film noir with high contrast
        "hue=s=0,"
        "eq=contrast=1.45:saturation=0:brightness=-0.05:gamma=0.9,"
        "curves=preset=increase_contrast,"

    "cinematic-warm-golden":
        # Warm golden hour glow
        "colorbalance=rs=0.08:gs=0.02:bs=-0.06:rm=0.06:gm=0.02:bm=-0.04:"
        "rh=0.04:gh=0.01:bh=-0.06,"
        "eq=saturation=1.12:brightness=0.02:gamma=1.05,"
        "curves=preset=lighter",

    "cinematic-cool-blue":
        # Cold blue/teal cinematic look
        "colorbalance=rs=-0.04:gs=0.02:bs=0.08:rm=-0.03:gm=0.01:bm=0.06:"
        "rh=-0.04:gh=0.01:bh=0.05,"
        "eq=saturation=1.05:contrast=1.06,"
        "curves=preset=increase_contrast",

    # --- Film emulation extras ---
    "cinematic-halation":
        # Light bloom / halation (red glow around highlights, classic film artifact)
        # Uses a duplicate layer blended with screen mode
        "split[m][b];[b]geq=r='gt(r(X,Y),200)*r(X,Y)*0.5':g='gt(g(X,Y),200)*g(X,Y)*0.3':b='gt(b(X,Y),200)*b(X,Y)*0.2'[bl];[m][bl]blend=all_mode:screen",

    "cinematic-faded":
        # Faded vintage film (lifted blacks, reduced contrast)
        "eq=contrast=0.85:brightness=0.04:saturation=0.85:gamma=1.1,"
        "colorbalance=rs=0.02:bs=0.03:rm=0.01:bm=0.02",
}

# List of available preset names (for UI dropdowns)
CINEMATIC_GRADE_NAMES = list(CINEMATIC_GRADES.keys())


def get_grade_filter(grade_name: str) -> str:
    """Return the FFmpeg filter chain for a grade preset.

    Falls back to "null" (passthrough) for unknown names.
    """
    return CINEMATIC_GRADES.get(grade_name, CINEMATIC_GRADES["auto"])


def is_valid_grade(grade_name: str) -> bool:
    """Check if a grade name is a known preset."""
    return grade_name in CINEMATIC_GRADES
