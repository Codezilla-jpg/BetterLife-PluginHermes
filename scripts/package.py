#!/usr/bin/env python3
"""Build a deterministic Hermes Desktop plugin archive and SHA-256 sidecar."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent
RELEASE = json.loads((ROOT / "release.json").read_text(encoding="utf-8"))
PLUGIN_ID = "statusline-workspaces"
VERSION = RELEASE["version"]
FILES = ("plugin.js", "release.json", "README.md", "CHANGELOG.md", "LICENSE")
DIST = ROOT / "dist"
ARCHIVE = DIST / f"{PLUGIN_ID}-hermes-desktop-v{VERSION}.zip"
FIXED_TIME = (2020, 1, 1, 0, 0, 0)


def archive_entry(name: str) -> ZipInfo:
    info = ZipInfo(f"{PLUGIN_ID}/{name}", FIXED_TIME)
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    return info


def validate_metadata() -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if RELEASE.get("id") != PLUGIN_ID:
        raise SystemExit("release.json id does not match the archive root")
    if package.get("version") != VERSION:
        raise SystemExit("package.json and release.json versions differ")


def validate_archive() -> list[str]:
    expected = [f"{PLUGIN_ID}/{name}" for name in FILES]
    with ZipFile(ARCHIVE) as bundle:
        names = bundle.namelist()
    if names != expected:
        raise SystemExit(f"unexpected archive contents: {names!r}")
    for name in names:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe archive path: {name}")
        lowered = name.lower()
        if any(part in lowered for part in ("tests/", "scripts/", ".env", "secret")):
            raise SystemExit(f"development or secret-bearing path included: {name}")
    return names


def main() -> None:
    validate_metadata()
    DIST.mkdir(parents=True, exist_ok=True)
    with ZipFile(ARCHIVE, "w", compression=ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in FILES:
            source = ROOT / name
            bundle.writestr(archive_entry(name), source.read_bytes(), compresslevel=9)

    files = validate_archive()
    digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
    sidecar = ARCHIVE.with_suffix(f"{ARCHIVE.suffix}.sha256")
    sidecar.write_text(f"{digest}  {ARCHIVE.name}\n", encoding="ascii")
    print(json.dumps({
        "archive": f"dist/{ARCHIVE.name}",
        "sha256": digest,
        "files": files,
    }, indent=2))


if __name__ == "__main__":
    main()
