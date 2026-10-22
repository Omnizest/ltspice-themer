"""Validation and canonicalisation of the built-in theme catalog.

`themes/builtin.json` is the single source of truth for built-in themes.
This script validates it and enforces a canonical serialisation, so edits made
by hand (or by another tool) stay reviewable in diffs.

`--from-legacy` is an optional one-way import of an original `LTspice-themes.txt`
catalog, kept only for provenance and first-time migration. The import does not
require any additional palette file and never patches colours.

Python 3.10+, no dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
COLOR_KEYS = (
    "Grid", "InActiveAxis",
    *(f"WaveColor{i}" for i in range(14)),
    *(f"SchematicColor{i}" for i in range(14)),
    "NetlistNormalTextColor", "NetlistCommentTextColor",
    "NetlistDotcmdTextColor", "NetlistBackgroundColor", "ContinuationLineColor",
)
CATALOG_KEYS = (
    "schemaVersion", "colorEncoding", "sourceFile", "sourceSha256",
    "themes", "builtinRevision",
)
SCHEMA_VERSION = 1
COLOR_ENCODING = "COLORREF_BGR24"
BUILTIN_REVISION = 2
MAX_COLOR = 0xFFFFFF


def parse_themes(text: str) -> list[dict]:
    themes: list[dict] = []
    names: set[str] = set()
    current: dict | None = None
    pending_url: str | None = None
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith((";", "#")):
            continue
        if line.startswith(("https://", "http://")):
            if pending_url or not urlparse(line).netloc or any(c.isspace() for c in line):
                raise ValueError(f"line {number}: invalid or repeated source URL")
            pending_url = line
            continue
        section = re.fullmatch(r"\[([^\[\]]+)\]", line)
        if section:
            name = section.group(1).strip()
            if not name or name.casefold() in names:
                raise ValueError(f"line {number}: empty or duplicate theme name")
            names.add(name.casefold())
            current = {"name": name, "sourceUrl": pending_url, "colors": {}}
            themes.append(current)
            pending_url = None
            continue
        if current is None or pending_url or "=" not in line:
            raise ValueError(f"line {number}: expected theme section or color assignment")
        key, value = (part.strip() for part in line.split("=", 1))
        if key not in COLOR_KEYS or key in current["colors"]:
            raise ValueError(f"line {number}: unknown or duplicate color key {key!r}")
        if not re.fullmatch(r"[0-9]+", value) or not 0 <= int(value) <= MAX_COLOR:
            raise ValueError(f"line {number}: invalid 24-bit decimal color {value!r}")
        current["colors"][key] = int(value)
    if pending_url:
        raise ValueError("source URL has no following theme")
    if not themes:
        raise ValueError("no themes found")
    return validate_themes(themes)


def validate_themes(themes: object, *, require: bool = True) -> list[dict]:
    if not isinstance(themes, list):
        raise ValueError("'themes' must be a list")
    if require and not themes:
        raise ValueError("no themes found")
    names: set[str] = set()
    for index, theme in enumerate(themes):
        label = f"themes[{index}]"
        if not isinstance(theme, dict) or list(theme) != ["name", "sourceUrl", "colors"]:
            raise ValueError(f"{label}: expected keys name, sourceUrl, colors")
        name = theme["name"]
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"{label}: empty theme name")
        if name.casefold() in names:
            raise ValueError(f"{label}: duplicate theme name {name!r}")
        names.add(name.casefold())
        url = theme["sourceUrl"]
        if url is not None:
            if not isinstance(url, str) or urlparse(url).scheme not in ("http", "https") \
                    or not urlparse(url).netloc or any(c.isspace() for c in url):
                raise ValueError(f"{label}: sourceUrl must be null or an HTTP/HTTPS URL")
        colors = theme["colors"]
        if not isinstance(colors, dict):
            raise ValueError(f"{label}: 'colors' must be an object")
        missing = set(COLOR_KEYS) - colors.keys()
        unknown = colors.keys() - set(COLOR_KEYS)
        if missing:
            raise ValueError(f"{label} {name!r}: missing colors: {', '.join(sorted(missing))}")
        if unknown:
            raise ValueError(f"{label} {name!r}: unknown colors: {', '.join(sorted(unknown))}")
        for key in COLOR_KEYS:
            value = colors[key]
            if type(value) is not int or not 0 <= value <= MAX_COLOR:
                raise ValueError(f"{label} {name!r}: {key} must be an integer in 0..{MAX_COLOR}")
        if list(colors) != list(COLOR_KEYS):
            raise ValueError(f"{label} {name!r}: colors are not in canonical key order")
    return themes


def validate_catalog(catalog: object) -> dict:
    if not isinstance(catalog, dict) or tuple(catalog) != CATALOG_KEYS:
        raise ValueError(f"catalog keys must be exactly: {', '.join(CATALOG_KEYS)}")
    if catalog["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError(f"schemaVersion must be {SCHEMA_VERSION}")
    if catalog["colorEncoding"] != COLOR_ENCODING:
        raise ValueError(f"colorEncoding must be {COLOR_ENCODING}")
    if catalog["builtinRevision"] != BUILTIN_REVISION:
        raise ValueError(f"builtinRevision must be {BUILTIN_REVISION}")
    source_file = catalog["sourceFile"]
    if source_file is not None and (not isinstance(source_file, str) or "/" in source_file or "\\" in source_file):
        raise ValueError("sourceFile must be null or a bare file name")
    digest = catalog["sourceSha256"]
    if digest is not None and (not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)):
        raise ValueError("sourceSha256 must be null or 64 lowercase hex characters")
    validate_themes(catalog["themes"])
    return catalog


def serialize(catalog: dict) -> str:
    return json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"


def load(path: Path) -> dict:
    return validate_catalog(json.loads(path.read_bytes().decode("utf-8")))


def legacy_catalog(source: Path) -> dict:
    """One-way import of an original LTspice-themes.txt catalog."""
    raw = source.read_bytes()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "colorEncoding": COLOR_ENCODING,
        "sourceFile": source.name,
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "themes": parse_themes(raw.decode("utf-8-sig")),
        "builtinRevision": BUILTIN_REVISION,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", type=Path, default=ROOT / "themes/builtin.json",
                        help="Catalog to validate (default: themes/builtin.json)")
    parser.add_argument("--from-legacy", type=Path, metavar="TXT",
                        help="Import an original LTspice-themes.txt instead of validating --file")
    parser.add_argument("--check", action="store_true",
                        help="Validate without writing; fail if the file is not canonical")
    args = parser.parse_args()
    target: Path = args.file
    try:
        if args.from_legacy:
            if args.from_legacy.resolve() == target.resolve():
                parser.error("input and output must be different files")
            catalog = legacy_catalog(args.from_legacy)
        else:
            if not target.exists():
                parser.error(f"{target} not found; use --from-legacy to create it")
            catalog = load(target)
        result = serialize(catalog).encode("utf-8")
        if args.check:
            if target.read_bytes() != result:
                parser.error(f"{target} is not canonical; rerun without --check to rewrite it")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(result)
    except (OSError, UnicodeError, ValueError) as exc:
        parser.error(str(exc))
    print(f"{'Verified' if args.check else 'Wrote'} {len(catalog['themes'])} themes, "
          f"{len(COLOR_KEYS)} colors each -> {target}")


if __name__ == "__main__":
    main()
