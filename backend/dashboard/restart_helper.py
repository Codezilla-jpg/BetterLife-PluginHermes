#!/usr/bin/env python3
"""Terminate one Hermes backend process from a detached helper.

The helper first requests a graceful shutdown and escalates to SIGKILL only
when the backend is still alive after the grace period.
"""
from __future__ import annotations

import os
import signal
import sys
import time


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def terminate(pid: int, delay: float = 1.0, grace: float = 5.0) -> None:
    time.sleep(max(0.0, delay))
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    deadline = time.monotonic() + max(0.0, grace)
    while time.monotonic() < deadline:
        if not process_exists(pid):
            return
        time.sleep(0.1)

    if process_exists(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 4):
        return 2
    pid = int(argv[1])
    delay = float(argv[2]) if len(argv) == 4 else 1.0
    grace = float(argv[3]) if len(argv) == 4 else 5.0
    if pid <= 1:
        return 2
    terminate(pid, delay, grace)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
