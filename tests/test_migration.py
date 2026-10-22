import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from migrate_themes import (
    COLOR_KEYS, CATALOG_KEYS, BUILTIN_REVISION, COLOR_ENCODING,
    load, parse_themes, serialize, validate_catalog,
)

CATALOG = ROOT / "themes/builtin.json"
LEGACY = ROOT / "legacy/LTspice-themes.txt"


def catalog_to_text(catalog: dict) -> str:
    """Render a catalog as the original LTspice-themes.txt dialect."""
    lines = []
    for theme in catalog["themes"]:
        if theme["sourceUrl"]:
            lines.append(theme["sourceUrl"])
        lines.append(f"[{theme['name']}]")
        lines.extend(f"{key}={theme['colors'][key]}" for key in COLOR_KEYS)
    return "\n".join(lines) + "\n"


class CatalogTests(unittest.TestCase):
    """themes/builtin.json is the single source of truth for built-in themes."""

    def setUp(self):
        self.catalog = load(CATALOG)
        self.text = catalog_to_text(self.catalog)

    def test_checked_in_catalog_is_canonical(self):
        self.assertEqual(CATALOG.read_bytes(), serialize(self.catalog).encode("utf-8"))
        self.assertEqual(tuple(self.catalog), CATALOG_KEYS)
        self.assertEqual(self.catalog["colorEncoding"], COLOR_ENCODING)
        self.assertEqual(self.catalog["builtinRevision"], BUILTIN_REVISION)
        self.assertEqual(len(self.catalog["themes"]), 9)

    def test_every_theme_has_the_full_color_contract(self):
        self.assertEqual(len(COLOR_KEYS), 35)
        self.assertEqual(len(COLOR_KEYS), len(set(COLOR_KEYS)))
        names = [theme["name"] for theme in self.catalog["themes"]]
        self.assertEqual(len(names), len({name.casefold() for name in names}))
        for theme in self.catalog["themes"]:
            self.assertEqual(list(theme["colors"]), list(COLOR_KEYS))
            self.assertTrue(all(type(value) is int and 0 <= value <= 0xFFFFFF
                                for value in theme["colors"].values()))

    def test_catalog_round_trips_through_txt_dialect(self):
        self.assertEqual(parse_themes(self.text), self.catalog["themes"])

    @unittest.skipUnless(LEGACY.exists(), "legacy snapshot not present")
    def test_recorded_source_digest_matches_legacy_snapshot(self):
        digest = hashlib.sha256(LEGACY.read_bytes()).hexdigest()
        self.assertEqual(self.catalog["sourceSha256"], digest)
        self.assertEqual(self.catalog["sourceFile"], LEGACY.name)
        source = parse_themes(LEGACY.read_text(encoding="utf-8-sig"))
        self.assertEqual([theme["name"] for theme in source],
                         [theme["name"] for theme in self.catalog["themes"]])
        for before, after in zip(source, self.catalog["themes"]):
            self.assertEqual(before["sourceUrl"], after["sourceUrl"])

    def test_rejects_invalid_catalog(self):
        base = self.catalog

        def mutate(change):
            catalog = copy.deepcopy(base)
            change(catalog)
            return catalog

        drop_color = lambda catalog: catalog["themes"][0]["colors"].pop("Grid")
        cases = {
            "missing color": mutate(drop_color),
            "unknown color": mutate(lambda c: c["themes"][0]["colors"].__setitem__("GridX", 1)),
            "negative color": mutate(lambda c: c["themes"][0]["colors"].__setitem__("Grid", -1)),
            "color above 24 bits": mutate(lambda c: c["themes"][0]["colors"].__setitem__("Grid", 0x1000000)),
            "float color": mutate(lambda c: c["themes"][0]["colors"].__setitem__("Grid", 1.5)),
            "duplicate name": mutate(lambda c: c["themes"].append(copy.deepcopy(c["themes"][0]))),
            "case-folded duplicate": mutate(lambda c: c["themes"][1].__setitem__("name", c["themes"][0]["name"].upper())),
            "blank name": mutate(lambda c: c["themes"][0].__setitem__("name", "  ")),
            "bad url": mutate(lambda c: c["themes"][0].__setitem__("sourceUrl", "ftp://example.com/x")),
            "empty themes": mutate(lambda c: c.__setitem__("themes", [])),
            "wrong revision": mutate(lambda c: c.__setitem__("builtinRevision", 1)),
            "wrong encoding": mutate(lambda c: c.__setitem__("colorEncoding", "RGB")),
            "missing key": mutate(lambda c: c.pop("sourceSha256")),
            "extra key": mutate(lambda c: c.__setitem__("extra", True)),
        }
        for label, catalog in cases.items():
            with self.subTest(label), self.assertRaises(ValueError):
                validate_catalog(catalog)

    def test_parse_themes_rejects_ambiguous_txt(self):
        grid = f"Grid={self.catalog['themes'][0]['colors']['Grid']}"
        bad_inputs = [
            "", "Grid=0",
            self.text.replace(grid, "Grid=-1", 1),
            self.text.replace(grid, "Grid=16777216", 1),
            self.text.replace(grid, "Grid=1.0", 1),
            self.text.replace(grid, "Grid=1\nGrid=2", 1),
            self.text.replace(grid, "Unknown=1", 1),
            self.text.replace(grid, "", 1),
            self.text.replace("[sakabug]", "[DEFAULT]", 1),
            self.text.replace("[sakabug]", f"[{self.catalog['themes'][0]['name']}]", 1),
            self.text + "\nhttps://example.com/orphan",
            self.text + "\nhttps://example.com/a\nhttps://example.com/b\n[dup]",
        ]
        for text in bad_inputs:
            with self.subTest(text=text[:60]), self.assertRaises(ValueError):
                parse_themes(text)


if __name__ == "__main__":
    unittest.main()
