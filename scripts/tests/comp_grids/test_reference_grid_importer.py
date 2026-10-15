"""Unit tests for scripts/comp_grids/reference_grid_importer.py (stdlib unittest; synthetic data only).

Run: python3 scripts/tests/comp_grids/test_reference_grid_importer.py
"""
from __future__ import annotations

import contextlib
import csv
import hashlib
import io
import json
import random
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.dont_write_bytecode = True  # keep the checkout clean (no __pycache__ beside the importer)
sys.path.insert(0, str(ROOT / "scripts" / "comp_grids"))
import reference_grid_importer as importer  # noqa: E402

FIXTURE = ROOT / "supabase/tests/fixtures/commission_grids/synthetic_reference_grid.csv"
LEVEL_COLUMNS = [str(level) for level in importer.LEVELS]


def row(**cells: str) -> list[str]:
    base = {"category": "Term", "carrier": "Synthetic Carrier Test", "product": "Test Term", "variant": "10 yr",
            "min_age": "18", "max_age": "60", "term_years": "10", "source": "", "notes": ""}
    base.update({column: "" for column in LEVEL_COLUMNS})
    base["100"] = "50"
    base.update(cells)
    return [base[column] for column in importer.HEADER]


def csv_bytes(*rows: list[str], header: tuple[str, ...] | list[str] = importer.HEADER, line_end: str = "\r\n") -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator=line_end)
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def run(*argv: str) -> tuple[int, dict]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = importer.main(list(argv))
    text = out.getvalue()
    return code, (json.loads(text) if text.strip() else {})


class TempCsv:
    def __init__(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name)

    def write(self, data: bytes, name: str = "source.csv") -> str:
        target = self.path / name
        target.write_bytes(data)
        return str(target)

    def close(self) -> None:
        self.directory.cleanup()


class ImporterTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TempCsv()

    def tearDown(self) -> None:
        self.temp.close()

    def validate(self, data: bytes, *extra: str) -> tuple[int, dict]:
        return run("validate", "--csv", self.temp.write(data), *extra)

    def rules(self, data: bytes) -> list[tuple[int, str, str]]:
        code, result = self.validate(data)
        self.assertEqual(code, 1, result)
        return [(a["row"], a["column"], a["rule"]) for a in result["anomalies"]]

    def assertRule(self, data: bytes, row_number: int, column: str, fragment: str) -> None:
        found = self.rules(data)
        self.assertTrue(any(r == row_number and c == column and fragment in rule for r, c, rule in found),
                        f"expected ({row_number}, {column}, ...{fragment}...) in {found}")


class FixtureAndArtifactTests(ImporterTestCase):
    def test_synthetic_fixture_validates_with_expected_inventory(self) -> None:
        code, result = run("validate", "--csv", str(FIXTURE), "--expect-products", "6", "--expect-variants", "9",
                           "--expect-carriers", "4")
        self.assertEqual(code, 0, result)
        self.assertEqual(result["counts"], {"products": 6, "variants": 9, "carriers": 4, "rate_cells": 138, "references": 6})
        self.assertEqual(result["source"]["sha256"], hashlib.sha256(FIXTURE.read_bytes()).hexdigest())

    def test_inventory_mismatch_is_reported(self) -> None:
        code, result = run("validate", "--csv", str(FIXTURE), "--expect-products", "7")
        self.assertEqual(code, 1)
        self.assertIn("expected 7 products, found 6", result["anomalies"][0]["rule"])

    def test_build_is_deterministic_and_verifiable(self) -> None:
        outputs = []
        for name in ("one.comp_reference_grid.json", "two.comp_reference_grid.json"):
            target = self.temp.path / name
            code, result = run("build", "--csv", str(FIXTURE), "--grid-name", "Synthetic Reference Grid",
                               "--effective-date", "2025-01-15", "--out", str(target))
            self.assertEqual(code, 0, result)
            data = target.read_bytes()
            self.assertFalse(data.endswith(b"\n"), "the artifact must not end with a newline (psql strips it)")
            self.assertEqual(result["artifact_sha256"], hashlib.sha256(data).hexdigest())
            outputs.append((data, result))
        self.assertEqual(outputs[0][0], outputs[1][0], "same source and version must give a byte-identical artifact")
        result = outputs[0][1]
        self.assertEqual(result["grid"]["id"], str(uuid.uuid5(importer.ID_NAMESPACE, "grid\x1fSynthetic Reference Grid\x1f2025-01-15")))
        self.assertEqual(result["counts"]["rate_cells"], 138)
        code, verified = run("verify", "--artifact", str(self.temp.path / "one.comp_reference_grid.json"))
        self.assertEqual(code, 0, verified)
        self.assertEqual(verified["content_sha256"], result["content_sha256"])

    def test_artifact_keeps_source_text_exactly(self) -> None:
        target = self.temp.path / "a.comp_reference_grid.json"
        run("build", "--csv", str(FIXTURE), "--grid-name", "Synthetic Reference Grid", "--effective-date", "2025-01-15",
            "--out", str(target))
        artifact = json.loads(target.read_text(encoding="utf-8"))
        rates = {r["rate_percent"] for r in artifact["rates"]}
        self.assertTrue({"87.50", "87.5", "0", "0.5"} <= rates, "scale and explicit zeros are kept as written")
        self.assertEqual(len([r for r in artifact["rates"] if r["rate_percent"] == "0"]), 2)
        notes = [x["notes"] for x in artifact["references"] if x["notes"]]
        self.assertIn("Synthetic line one\nSynthetic line two — not a real carrier", notes)
        dual = [p for p in artifact["products"] if p["product_name"] == "Gamma Dual Plan"]
        self.assertEqual(sorted(p["category"] for p in dual), ["term", "whole_life"])
        self.assertEqual(artifact["expected"]["references"], 6)

    def test_verify_detects_a_tampered_artifact(self) -> None:
        target = self.temp.path / "t.comp_reference_grid.json"
        run("build", "--csv", str(FIXTURE), "--grid-name", "Synthetic Reference Grid", "--effective-date", "2025-01-15",
            "--out", str(target))
        artifact = json.loads(target.read_text(encoding="utf-8"))
        artifact["rates"][0]["rate_percent"] = "1"
        target.write_text(json.dumps(artifact), encoding="utf-8")
        code, result = run("verify", "--artifact", str(target))
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "mismatch")

    def test_fingerprint_is_order_independent_and_value_sensitive(self) -> None:
        target = self.temp.path / "f.comp_reference_grid.json"
        run("build", "--csv", str(FIXTURE), "--grid-name", "Synthetic Reference Grid", "--effective-date", "2025-01-15",
            "--out", str(target))
        a = json.loads(target.read_text(encoding="utf-8"))
        parts = (a["grid"], a["products"], a["variants"], a["rates"], a["references"])
        baseline = importer.content_sha256(*parts)
        self.assertEqual(baseline, a["expected"]["content_sha256"])
        shuffled = [list(x) for x in parts[1:]]
        for items in shuffled:
            random.Random(7).shuffle(items)
        self.assertEqual(importer.content_sha256(a["grid"], *shuffled), baseline)
        changed = json.loads(json.dumps(a["rates"]))
        target_rate = next(r for r in changed if r["rate_percent"] == "87.50")
        target_rate["rate_percent"] = "87.5"
        self.assertNotEqual(importer.content_sha256(a["grid"], a["products"], a["variants"], changed, a["references"]), baseline,
                            "87.50 and 87.5 are different source text and must fingerprint differently")

    def test_bad_build_arguments(self) -> None:
        out = str(self.temp.path / "x.comp_reference_grid.json")
        self.assertEqual(run("build", "--csv", str(FIXTURE), "--grid-name", " Padded", "--effective-date", "2025-01-15", "--out", out)[0], 2)
        self.assertEqual(run("build", "--csv", str(FIXTURE), "--grid-name", "Grid", "--effective-date", "20250115", "--out", out)[0], 2)
        self.assertFalse(Path(out).exists())


class StructureRuleTests(ImporterTestCase):
    def test_header_must_match_exactly(self) -> None:
        header = list(importer.HEADER)
        for broken in (header[:-1], header + ["extra"], [header[1], header[0], *header[2:]],
                       ["Category", *header[1:]], [*header[:7], "150", *header[8:]]):
            with self.subTest(broken=broken[:3]):
                self.assertRule(csv_bytes(row(), header=broken), 1, "*", "header must be exactly")

    def test_line_endings_and_bom(self) -> None:
        for line_end in ("\r\n", "\n"):
            code, result = self.validate(csv_bytes(row(), line_end=line_end))
            self.assertEqual(code, 0, result)
        code, result = self.validate(importer.BOM + csv_bytes(row()))
        self.assertEqual(code, 0, result)
        self.assertEqual(result["notes"], ["utf8_bom"])

    def test_encoding_and_csv_shape(self) -> None:
        self.assertRule(csv_bytes(row()) + b"Term,\xff\xfe\r\n", 0, "*", "not valid UTF-8")
        self.assertRule(csv_bytes(row(), row(variant="20 yr", term_years="20")[:-1]), 3, "*", "expected 26 fields")
        self.assertRule(csv_bytes(row(), row(variant="20 yr", term_years="20") + ["x"]), 3, "*", "expected 26 fields")
        self.assertRule(csv_bytes(row()) + b"\r\n", 3, "*", "empty row")
        self.assertRule(csv_bytes(row()) + b'Term,"Bad"quote' + b"\r\n", 3, "*", "malformed CSV")
        self.assertRule(csv_bytes(row(carrier="Syn\x00thetic")), 2, "carrier", "control or invisible")
        self.assertRule(csv_bytes(row(notes="note\x00")), 2, "notes", "control or invisible")

    def test_header_only_file_is_empty_inventory(self) -> None:
        code, result = self.validate(csv_bytes())
        self.assertEqual(code, 0)
        self.assertEqual(result["counts"]["variants"], 0)


class FieldRuleTests(ImporterTestCase):
    def test_category_is_exact(self) -> None:
        for value in ("term", "Whole life", "Annuity", ""):
            with self.subTest(value=value):
                self.assertRule(csv_bytes(row(category=value)), 2, "category", "Term, Whole Life or IUL")
        for value in ("Term", "Whole Life", "IUL"):
            terms = "10" if value == "Term" else ""
            self.assertEqual(self.validate(csv_bytes(row(category=value, term_years=terms)))[0], 0)

    def test_text_is_never_repaired(self) -> None:
        self.assertRule(csv_bytes(row(carrier="")), 2, "carrier", "required value is blank")
        self.assertRule(csv_bytes(row(product="")), 2, "product", "required value is blank")
        self.assertRule(csv_bytes(row(carrier=" Synthetic")), 2, "carrier", "leading or trailing whitespace")
        self.assertRule(csv_bytes(row(product="Plan ")), 2, "product", "leading or trailing whitespace")
        self.assertRule(csv_bytes(row(variant="  ")), 2, "variant", "leading or trailing whitespace")
        self.assertRule(csv_bytes(row(notes="note ")), 2, "notes", "leading or trailing whitespace")
        self.assertRule(csv_bytes(row(carrier="Syn​thetic")), 2, "carrier", "control or invisible")
        self.assertRule(csv_bytes(row(variant="a\nb")), 2, "variant", "control or invisible")
        self.assertRule(csv_bytes(row(product="x" * 161)), 2, "product", "longer than 160")
        self.assertRule(csv_bytes(row(carrier="x" * 121)), 2, "carrier", "longer than 120")
        self.assertRule(csv_bytes(row(notes="x" * 4001)), 2, "notes", "longer than 4000")
        self.assertEqual(self.validate(csv_bytes(row(notes="line one\nline two\ttabbed", source="p. 3")))[0], 0)

    def test_ages(self) -> None:
        for value in ("-1", "18.5", "101", "018", "1e1", " 18", "eighteen"):
            with self.subTest(value=value):
                self.assertRule(csv_bytes(row(min_age=value)), 2, "min_age", "whole number from 0 to 100")
        self.assertRule(csv_bytes(row(min_age="50", max_age="40")), 2, "max_age", "greater than max_age")
        for low, high in (("0", "100"), ("", ""), ("", "70"), ("71", ""), ("40", "40")):
            with self.subTest(low=low, high=high):
                self.assertEqual(self.validate(csv_bytes(row(min_age=low, max_age=high)))[0], 0)

    def test_term_lengths(self) -> None:
        self.assertRule(csv_bytes(row(term_years="10|10")), 2, "term_years", "listed twice")
        self.assertRule(csv_bytes(row(term_years="0")), 2, "term_years", "outside 1-100")
        self.assertRule(csv_bytes(row(term_years="101")), 2, "term_years", "outside 1-100")
        for value in ("10, 15", "10||15", "10|", "|10", "10;15", "ten"):
            with self.subTest(value=value):
                self.assertRule(csv_bytes(row(term_years=value)), 2, "term_years", "whole numbers separated by |")
        self.assertRule(csv_bytes(row(term_years="|".join(str(n) for n in range(1, 22)))), 2, "term_years", "more than 20")
        self.assertEqual(self.validate(csv_bytes(row(term_years="10|15|20")))[0], 0)

    def test_rates_exact_never_rounded(self) -> None:
        self.assertRule(csv_bytes(row(**{"100": "87.555"})), 2, "100", "more than two decimal places")
        self.assertRule(csv_bytes(row(**{"145": "300.01"})), 2, "145", "above 300")
        self.assertRule(csv_bytes(row(**{"145": "1000"})), 2, "145", "above 300")
        for value in ("-1", "1e2", "087", "87.5%", "NaN", "Infinity", " 5", "5 ", "87.", ".5", "+5", "87,5", "$5"):
            with self.subTest(value=value):
                self.assertRule(csv_bytes(row(**{"100": value})), 2, "100", "plain non-negative decimal")
        code, result = self.validate(csv_bytes(row(**{"145": "0", "140": "300", "135": "300.00", "130": "0.01", "65": "87.5"})))
        self.assertEqual(code, 0, result)
        self.assertEqual(result["counts"]["rate_cells"], 6)

    def test_anomaly_output_never_echoes_values(self) -> None:
        marker = "SyntheticMarkerValue"
        _, result = self.validate(csv_bytes(row(carrier=marker + " ", **{"100": marker})))
        self.assertNotIn(marker, json.dumps(result))


class ProductRuleTests(ImporterTestCase):
    def test_duplicate_and_blank_labels(self) -> None:
        self.assertRule(csv_bytes(row(), row(term_years="20")), 3, "variant", "duplicate variant label")
        self.assertRule(csv_bytes(row(variant=""), row(variant="20 yr", term_years="20")), 2, "variant", "blank variant label")
        self.assertEqual(self.validate(csv_bytes(row(variant="")))[0], 0, "a single-row product may leave the label blank")

    def test_mixed_term_definitions_need_clarification(self) -> None:
        found = self.rules(csv_bytes(row(), row(variant="no term", term_years="", min_age="61", max_age="80")))
        self.assertEqual({(r, c) for r, c, _ in found}, {(2, "term_years"), (3, "term_years")})

    def test_overlapping_variants(self) -> None:
        self.assertRule(csv_bytes(row(), row(variant="b", min_age="60", max_age="70")), 3, "variant", "same age and term as row 2")
        self.assertRule(csv_bytes(row(term_years="10|15"), row(variant="b", term_years="15|20")), 3, "variant", "same age and term")
        self.assertRule(csv_bytes(row(min_age="", max_age=""), row(variant="b", min_age="99", max_age="")), 3, "variant", "same age and term")
        self.assertRule(csv_bytes(row(category="IUL", term_years=""), row(category="IUL", variant="b", term_years="")),
                        3, "variant", "same age and term")
        ok = [csv_bytes(row(), row(variant="b", min_age="61", max_age="80")),
              csv_bytes(row(), row(variant="b", term_years="20")),
              csv_bytes(row(category="IUL", term_years="", max_age="17", min_age="0"),
                        row(category="IUL", variant="b", term_years="", min_age="18", max_age=""))]
        for data in ok:
            self.assertEqual(self.validate(data)[0], 0)

    def test_same_product_in_two_categories_is_two_products(self) -> None:
        code, result = self.validate(csv_bytes(row(variant=""), row(category="Whole Life", variant="", term_years="")))
        self.assertEqual(code, 0, result)
        self.assertEqual(result["counts"]["products"], 2)
        self.assertEqual(result["counts"]["carriers"], 1)


class PrivatePathTests(ImporterTestCase):
    def test_outputs_inside_the_repository_must_be_ignored(self) -> None:
        if importer.repository_root() is None:
            self.skipTest("not inside a Git checkout")
        tracked = ROOT / "supabase/tests/fixtures/commission_grids/artifact.json"
        code, _ = run("build", "--csv", str(FIXTURE), "--grid-name", "Synthetic Reference Grid",
                      "--effective-date", "2025-01-15", "--out", str(tracked))
        self.assertEqual(code, 2)
        self.assertFalse(tracked.exists())
        importer.require_private(ROOT / "private/commission-grids/ffl.comp_reference_grid.json", "test")  # ignored: allowed
        with self.assertRaises(importer.ImporterError):
            importer.require_private(ROOT / "supabase/seed-data/rates.csv", "test")
        importer.require_private(ROOT / "supabase/seed-data/ffl_comp_rates.csv", "test")  # ignored by name: allowed


if __name__ == "__main__":
    unittest.main(verbosity=1)
