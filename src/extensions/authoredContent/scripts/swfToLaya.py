#!/usr/bin/env python3
"""Stable executable for the provider-owned SWF evidence module."""

from __future__ import annotations

import sys
from pathlib import Path

PYTHON_TOOLING_ROOT = Path(__file__).resolve().parents[1] / "tooling" / "python"
if str(PYTHON_TOOLING_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_TOOLING_ROOT))

from laya_authored_swf import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
