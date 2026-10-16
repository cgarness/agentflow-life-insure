#!/usr/bin/env python3
"""AgentFlow reference compensation grid importer: exact validator and deterministic artifact builder.

Private reference-import workflow (docs/plans/2026-10-15-commission-calculator/reference-import-runbook.md):
  validate  check a source CSV exactly; report anomalies by row and column (never cell values); no output
  build     validate, then write the deterministic import artifact (JSON) to a PRIVATE path
  verify    recompute an artifact's checksum, counts and content fingerprint

The artifact is loaded by private.comp_import_reference_grid(artifact_text, artifact_sha256), which
re-verifies counts and the same content fingerprint inside one transaction. Nothing here connects to a
database or the network, and nothing is ever repaired: every questionable value is reported and stops
the import (no rounding, trimming, renaming, filling or reordering of source values).

Source rules: exact header (category, carrier, product, variant, min_age, max_age, term_years, 145..65 in
steps of 5, source, notes); category Term / Whole Life / IUL -> term / whole_life / iul; product identity
= category + carrier + product; text without leading/trailing whitespace or control characters; ages
whole numbers 0-100 (blank = unbounded side) with min <= max; term lengths pipe-delimited distinct whole
numbers 1-100 (blank = not applicable, never "all terms"); rate cells blank (= no rate row) or plain
decimals 0-300 with at most two places (explicit 0 kept as a zero rate); variant labels unique per
product, blank only on a single-row product; no product mixing rows with and without term lengths; no two
variants of a product matching the same age and term.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import subprocess
import sys
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path

IMPORTER_VERSION = "1.0.0"
ARTIFACT_FORMAT = "agentflow.comp_reference_grid.v1"
LEVELS = tuple(range(145, 64, -5))
HEADER = ("category", "carrier", "product", "variant", "min_age", "max_age", "term_years",
          *(str(level) for level in LEVELS), "source", "notes")
CATEGORIES = {"Term": "term", "Whole Life": "whole_life", "IUL": "iul"}
MAX_LENGTH = {"carrier": 120, "product": 160, "variant": 120, "source": 2000, "notes": 4000}
ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "urn:agentflow:comp-reference-grid:v1")
WHOLE = re.compile(r"0|[1-9][0-9]*")
DECIMAL = re.compile(r"(0|[1-9][0-9]*)(\.[0-9]+)?")
BOM = b"\xef\xbb\xbf"
SYNTHETIC_FIXTURES = Path("supabase/tests/fixtures/commission_grids")


class ImporterError(Exception):
    """Usage or I/O problem (exit 2), as opposed to source anomalies (exit 1)."""


@dataclass
class Report:
    anomalies: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def add(self, row: int, column: str, rule: str) -> None:
        self.anomalies.append({"row": row, "column": column, "rule": rule})


@dataclass
class Variant:
    row: int
    category: str
    carrier: str
    product: str
    label: str
    min_age: int | None
    max_age: int | None
    term_years: list[int] | None
    rates: list[tuple[int, str]]
    source: str | None
    notes: str | None


# ── Field checks ────────────────────────────────────────────────────────────────────────────────────
def check_text(value: str, column: str, row: int, report: Report, *, required: bool, multiline: bool = False) -> bool:
    if value == "":
        if required:
            report.add(row, column, "required value is blank")
        return not required
    ok = True
    if value != value.strip():
        report.add(row, column, "leading or trailing whitespace")
        ok = False
    allowed = {"\n", "\r", "\t"} if multiline else set()
    if any(unicodedata.category(ch) in ("Cc", "Cf") and ch not in allowed for ch in value):
        report.add(row, column, "control or invisible formatting character")
        ok = False
    if len(value) > MAX_LENGTH[column]:
        report.add(row, column, f"longer than {MAX_LENGTH[column]} characters")
        ok = False
    return ok


def parse_age(value: str, column: str, row: int, report: Report) -> tuple[bool, int | None]:
    if value == "":
        return True, None
    if not WHOLE.fullmatch(value) or int(value) > 100:
        report.add(row, column, "age must be a whole number from 0 to 100 (blank = unbounded)")
        return False, None
    return True, int(value)


def parse_terms(value: str, row: int, report: Report) -> tuple[bool, list[int] | None]:
    if value == "":
        return True, None
    parts = value.split("|")
    if not all(WHOLE.fullmatch(part) for part in parts):
        report.add(row, "term_years", "term lengths must be whole numbers separated by | (blank = not applicable)")
        return False, None
    terms = [int(part) for part in parts]
    ok = True
    if any(term < 1 or term > 100 for term in terms):
        report.add(row, "term_years", "term length outside 1-100")
        ok = False
    if len(set(terms)) != len(terms):
        report.add(row, "term_years", "the same term length is listed twice")
        ok = False
    if len(terms) > 20:
        report.add(row, "term_years", "more than 20 term lengths")
        ok = False
    return ok, terms if ok else None


def parse_rate(value: str, column: str, row: int, report: Report) -> tuple[bool, str | None]:
    if value == "":
        return True, None
    match = DECIMAL.fullmatch(value)
    if not match:
        report.add(row, column, "rate must be a plain non-negative decimal without sign, exponent, symbol or leading zeros (blank = no rate)")
        return False, None
    if match.group(2) and len(match.group(2)) - 1 > 2:
        report.add(row, column, "rate has more than two decimal places (never rounded)")
        return False, None
    if Decimal(value) > 300:
        report.add(row, column, "rate is above 300")
        return False, None
    return True, value


# ── CSV reading ─────────────────────────────────────────────────────────────────────────────────────
def read_source(raw: bytes, report: Report) -> list[Variant]:
    if raw.startswith(BOM):
        report.notes.append("utf8_bom")
        raw = raw[len(BOM):]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        report.add(0, "*", f"file is not valid UTF-8 (byte {error.start})")
        return []
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    variants: list[Variant] = []
    try:
        header = next(reader, None)
        if header is None:
            report.add(1, "*", "file is empty")
            return []
        if tuple(header) != HEADER:
            report.add(1, "*", "header must be exactly: " + ",".join(HEADER))
            return []
        for row_number, record in enumerate(reader, start=2):
            variant = read_row(record, row_number, report)
            if variant is not None:
                variants.append(variant)
    except csv.Error as error:
        report.add(reader.line_num, "*", f"malformed CSV ({error})")
    return variants


def read_row(record: list[str], row: int, report: Report) -> Variant | None:
    if not record or all(cell == "" for cell in record):
        report.add(row, "*", "empty row")
        return None
    if len(record) != len(HEADER):
        report.add(row, "*", f"expected {len(HEADER)} fields, found {len(record)}")
        return None
    cell = dict(zip(HEADER, record))
    ok = cell["category"] in CATEGORIES
    if not ok:
        report.add(row, "category", "category must be exactly Term, Whole Life or IUL")
    ok &= check_text(cell["carrier"], "carrier", row, report, required=True)
    ok &= check_text(cell["product"], "product", row, report, required=True)
    ok &= check_text(cell["variant"], "variant", row, report, required=False)
    ok &= check_text(cell["source"], "source", row, report, required=False, multiline=True)
    ok &= check_text(cell["notes"], "notes", row, report, required=False, multiline=True)
    age_ok, min_age = parse_age(cell["min_age"], "min_age", row, report)
    ok &= age_ok
    age_ok, max_age = parse_age(cell["max_age"], "max_age", row, report)
    ok &= age_ok
    if min_age is not None and max_age is not None and min_age > max_age:
        report.add(row, "max_age", "min_age is greater than max_age")
        ok = False
    terms_ok, terms = parse_terms(cell["term_years"], row, report)
    ok &= terms_ok
    rates: list[tuple[int, str]] = []
    for level in LEVELS:
        rate_ok, rate = parse_rate(cell[str(level)], str(level), row, report)
        ok &= rate_ok
        if rate is not None:
            rates.append((level, rate))
    if not ok:
        return None
    return Variant(row, CATEGORIES[cell["category"]], cell["carrier"], cell["product"], cell["variant"],
                   min_age, max_age, terms, rates, cell["source"] or None, cell["notes"] or None)


# ── Product-level rules ─────────────────────────────────────────────────────────────────────────────
def overlaps(a: Variant, b: Variant) -> bool:
    lo_a, hi_a = (0 if a.min_age is None else a.min_age), (100 if a.max_age is None else a.max_age)
    lo_b, hi_b = (0 if b.min_age is None else b.min_age), (100 if b.max_age is None else b.max_age)
    if max(lo_a, lo_b) > min(hi_a, hi_b):
        return False
    if a.term_years is None and b.term_years is None:
        return True
    return a.term_years is not None and b.term_years is not None and bool(set(a.term_years) & set(b.term_years))


def check_products(variants: list[Variant], report: Report) -> dict[tuple[str, str, str], list[Variant]]:
    products: dict[tuple[str, str, str], list[Variant]] = {}
    for variant in variants:
        products.setdefault((variant.category, variant.carrier, variant.product), []).append(variant)
    for rows in products.values():
        labels: dict[str, int] = {}
        for variant in rows:
            if variant.label in labels:
                report.add(variant.row, "variant", f"duplicate variant label for this product (row {labels[variant.label]})")
            labels.setdefault(variant.label, variant.row)
            if variant.label == "" and len(rows) > 1:
                report.add(variant.row, "variant", "blank variant label on a product with several rows")
        if any(v.term_years is None for v in rows) and any(v.term_years is not None for v in rows):
            for variant in rows:
                report.add(variant.row, "term_years", "product mixes rows with and without term lengths (needs clarification)")
        for i, first in enumerate(rows):
            for second in rows[i + 1:]:
                if overlaps(first, second):
                    report.add(second.row, "variant", f"matches the same age and term as row {first.row}")
    return products


# ── Artifact ────────────────────────────────────────────────────────────────────────────────────────
def stable_id(*parts: str) -> str:
    return str(uuid.uuid5(ID_NAMESPACE, "\x1f".join(parts)))


def hexed(value: str) -> str:
    return value.encode("utf-8").hex()


def content_sha256(grid: dict, products: list[dict], variants: list[dict], rates: list[dict], references: list[dict]) -> str:
    """Same canonical fingerprint as private.comp_grid_content_sha256() (see that function)."""
    product_by_id = {p["id"]: p for p in products}
    variant_by_id = {v["id"]: v for v in variants}

    def key(variant: dict) -> list[str]:
        product = product_by_id[variant["product_id"]]
        return [product["category"], hexed(product["carrier"]), hexed(product["product_name"]), hexed(variant["label"])]

    def text_or_dash(value: object) -> str:
        return "-" if value is None else str(value)

    lines = ["|".join(["G", hexed(grid["name"]), grid["effective_date"],
                       ",".join(str(level) for level in grid["contract_levels"]), "t"])]
    lines += ["|".join(["P", p["category"], hexed(p["carrier"]), hexed(p["product_name"]), "t" if p["is_active"] else "f"])
              for p in products]
    lines += ["|".join(["V", *key(v), text_or_dash(v["min_age"]), text_or_dash(v["max_age"]),
                        "-" if v["term_years"] is None else ",".join(str(t) for t in v["term_years"])])
              for v in variants]
    lines += ["|".join(["R", *key(variant_by_id[r["variant_id"]]), str(r["contract_level"]), r["rate_percent"]])
              for r in rates]
    lines += ["|".join(["N", *key(variant_by_id[x["variant_id"]]),
                        "-" if x["source"] is None else hexed(x["source"]),
                        "-" if x["notes"] is None else hexed(x["notes"])])
              for x in references]
    return hashlib.sha256("\n".join(sorted(lines)).encode("utf-8")).hexdigest()


def build_artifact(products: dict[tuple[str, str, str], list[Variant]], source: dict, name: str, effective_date: str) -> dict:
    grid_id = stable_id("grid", name, effective_date)
    grid = {"id": grid_id, "name": name, "effective_date": effective_date, "contract_levels": list(LEVELS)}
    out_products, out_variants, out_rates, out_references = [], [], [], []
    for (category, carrier, product), rows in products.items():
        product_id = stable_id("product", grid_id, category, carrier, product)
        out_products.append({"id": product_id, "category": category, "carrier": carrier, "product_name": product,
                             "is_active": True})
        for variant in rows:
            variant_id = stable_id("variant", product_id, variant.label)
            out_variants.append({"id": variant_id, "product_id": product_id, "label": variant.label,
                                 "min_age": variant.min_age, "max_age": variant.max_age, "term_years": variant.term_years})
            out_rates += [{"variant_id": variant_id, "contract_level": level, "rate_percent": rate}
                          for level, rate in variant.rates]
            if variant.source is not None or variant.notes is not None:
                out_references.append({"variant_id": variant_id, "source": variant.source, "notes": variant.notes})
    expected = counts(out_products, out_variants, out_rates, out_references)
    expected["content_sha256"] = content_sha256(grid, out_products, out_variants, out_rates, out_references)
    return {"format": ARTIFACT_FORMAT, "importer_version": IMPORTER_VERSION, "source": source, "grid": grid,
            "products": out_products, "variants": out_variants, "rates": out_rates, "references": out_references,
            "expected": expected}


def counts(products: list[dict], variants: list[dict], rates: list[dict], references: list[dict]) -> dict:
    return {"products": len(products), "variants": len(variants), "carriers": len({p["carrier"] for p in products}),
            "rate_cells": len(rates), "references": len(references)}


def artifact_text(artifact: dict) -> str:
    # No trailing newline: the exact text (and its SHA-256) is what the database function verifies.
    return json.dumps(artifact, ensure_ascii=False, indent=1)


# ── Paths: private outputs only ─────────────────────────────────────────────────────────────────────
def repository_root() -> Path | None:
    try:
        result = subprocess.run(["git", "-C", str(Path(__file__).resolve().parent), "rev-parse", "--show-toplevel"],
                                capture_output=True, text=True, check=False)
    except OSError:
        return None
    return Path(result.stdout.strip()).resolve() if result.returncode == 0 else None


def git_ignored(repo: Path, path: Path) -> bool:
    result = subprocess.run(["git", "-C", str(repo), "check-ignore", "-q", "--no-index", str(path.relative_to(repo))],
                            capture_output=True, check=False)
    return result.returncode == 0


def require_private(path: Path, purpose: str, allow_synthetic: bool = False) -> None:
    repo = repository_root()
    path = path.resolve()
    if repo is None or not path.is_relative_to(repo):
        return
    if allow_synthetic and path.is_relative_to(repo / SYNTHETIC_FIXTURES):
        return
    if not git_ignored(repo, path):
        raise ImporterError(f"refusing {purpose} inside the repository at a path Git does not ignore: "
                            f"{path.relative_to(repo)} (keep private compensation data outside Git)")


# ── Commands ────────────────────────────────────────────────────────────────────────────────────────
def load_and_validate(csv_path: Path, expect: dict[str, int | None]) -> tuple[Report, dict, dict]:
    require_private(csv_path, "to read a source CSV", allow_synthetic=True)
    try:
        raw = csv_path.read_bytes()
    except OSError as error:
        raise ImporterError(f"cannot read {csv_path}: {error.strerror}") from error
    report = Report()
    variants = read_source(raw, report)
    products = check_products(variants, report)  # also on partial input, so one run reports more at once
    source = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "data_rows": len(variants)}
    found = {"products": len(products), "variants": sum(len(rows) for rows in products.values()),
             "carriers": len({carrier for (_, carrier, _) in products})}
    for name, wanted in expect.items():
        if wanted is not None and not report.anomalies and found[name] != wanted:
            report.add(0, "*", f"expected {wanted} {name}, found {found[name]}")
    return report, products, source


def summary(report: Report, source: dict, extra: dict | None = None) -> dict:
    result = {"status": "ok" if not report.anomalies else "anomalies", "importer_version": IMPORTER_VERSION,
              "source": source, "notes": report.notes, "anomalies": report.anomalies}
    result.update(extra or {})
    return result


def command_validate(args: argparse.Namespace) -> int:
    report, products, source = load_and_validate(Path(args.csv), expectations(args))
    rows = [v for rows in products.values() for v in rows]
    extra = {"counts": {"products": len(products), "variants": len(rows),
                        "carriers": len({carrier for (_, carrier, _) in products}),
                        "rate_cells": sum(len(v.rates) for v in rows),
                        "references": sum(1 for v in rows if v.source is not None or v.notes is not None)}}
    print(json.dumps(summary(report, source, extra if not report.anomalies else None), indent=1))
    return 0 if not report.anomalies else 1


def command_build(args: argparse.Namespace) -> int:
    try:
        effective = date.fromisoformat(args.effective_date).isoformat()
    except ValueError as error:
        raise ImporterError("--effective-date must be YYYY-MM-DD") from error
    if args.effective_date != effective:
        raise ImporterError("--effective-date must be YYYY-MM-DD")
    name = args.grid_name
    if name != name.strip() or not 1 <= len(name) <= 120:
        raise ImporterError("--grid-name must be 1-120 characters without leading or trailing whitespace")
    out = Path(args.out)
    require_private(out, "to write an import artifact")
    report, products, source = load_and_validate(Path(args.csv), expectations(args))
    if report.anomalies:
        print(json.dumps(summary(report, source), indent=1))
        return 1
    artifact = build_artifact(products, source, name, effective)
    text = artifact_text(artifact)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8", newline="\n")
    print(json.dumps(summary(report, source, manifest_fields(artifact, text)), indent=1))
    return 0


def manifest_fields(artifact: dict, text: str) -> dict:
    return {"artifact_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "grid": {key: artifact["grid"][key] for key in ("id", "name", "effective_date")},
            "counts": {key: value for key, value in artifact["expected"].items() if key != "content_sha256"},
            "content_sha256": artifact["expected"]["content_sha256"]}


def command_verify(args: argparse.Namespace) -> int:
    path = Path(args.artifact)
    require_private(path, "to read an import artifact")
    try:
        text = path.read_bytes().decode("utf-8")
        artifact = json.loads(text)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ImporterError(f"cannot read artifact: {error}") from error
    problems = []
    if artifact.get("format") != ARTIFACT_FORMAT:
        problems.append("unknown artifact format")
    else:
        recomputed = counts(artifact["products"], artifact["variants"], artifact["rates"], artifact["references"])
        recomputed["content_sha256"] = content_sha256(artifact["grid"], artifact["products"], artifact["variants"],
                                                      artifact["rates"], artifact["references"])
        if recomputed != artifact["expected"]:
            problems.append("counts or content fingerprint do not match the artifact's expected values")
    print(json.dumps({"status": "ok" if not problems else "mismatch", "problems": problems,
                      **(manifest_fields(artifact, text) if not problems else {})}, indent=1))
    return 0 if not problems else 1


def expectations(args: argparse.Namespace) -> dict[str, int | None]:
    return {"products": args.expect_products, "variants": args.expect_variants, "carriers": args.expect_carriers}


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("validate", "build"):
        command = commands.add_parser(name)
        command.add_argument("--csv", required=True, help="source CSV (outside Git or at an ignored path)")
        command.add_argument("--expect-products", type=int)
        command.add_argument("--expect-variants", type=int)
        command.add_argument("--expect-carriers", type=int)
        if name == "build":
            command.add_argument("--grid-name", required=True)
            command.add_argument("--effective-date", required=True, help="YYYY-MM-DD")
            command.add_argument("--out", required=True, help="artifact path (outside Git or at an ignored path)")
    verify = commands.add_parser("verify")
    verify.add_argument("--artifact", required=True)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return {"validate": command_validate, "build": command_build, "verify": command_verify}[args.command](args)
    except ImporterError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
