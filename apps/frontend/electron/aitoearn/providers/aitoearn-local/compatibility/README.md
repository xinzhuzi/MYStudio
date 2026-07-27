# AiToEarn local compatibility

This directory is owned by MYStudio. It contains the compatibility matrix and
named adapter shims required to translate the read-only AiToEarn snapshot into
the `self-media/v1` contract.

Never edit files under `electron/aitoearn/vendor/aitoearn-core/` to fix an
integration issue. Add a small shim here, reference the upstream source path,
and cover the behavior with a regression test instead.
