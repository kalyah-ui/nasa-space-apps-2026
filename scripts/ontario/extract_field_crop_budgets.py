#!/usr/bin/env python3
"""Extract the nine-crop comparison table from Ontario Publication 60 (2026)."""

import argparse
import csv
import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import pdfplumber

SOURCE_URL = "https://www.ontario.ca/files/2026-01/omafa-field-crop-budgets-pub-60-en-2026-01-14.pdf"
EXPECTED_HEADERS = (
    "Corn Tolerant Non-GMO Ready White/ Winter Red\n"
    "Conventional Spring Soybeans Soybeans Coloured Black Wheat Spring\n"
    "Expense Tillage Canola No Till No Till Beans Beans No Till Oats Wheat"
)
CROPS = (
    ("corn", "conventional tillage"),
    ("spring canola", "herbicide tolerant"),
    ("soybeans", "non-GMO, no till"),
    ("soybeans", "Roundup Ready, no till"),
    ("coloured beans", "white/coloured"),
    ("black beans", ""),
    ("winter wheat", "soft red, no till"),
    ("oats", ""),
    ("spring wheat", "hard red"),
)


def extract_budgets(pdf_path: Path) -> list[dict[str, str]]:
    with pdfplumber.open(pdf_path) as document:
        pages = [page.extract_text() or "" for page in document.pages]

    summaries = [
        text for text in pages
        if "2026 Crop Comparison Summary Table for Selected Field Crops ($/acre)*" in text
    ]
    if len(summaries) != 1 or EXPECTED_HEADERS not in summaries[0]:
        raise ValueError("Expected 2026 crop comparison table and column headings not found.")

    total_lines = re.findall(r"^Total Costs\s+(.+)$", summaries[0], re.MULTILINE)
    if len(total_lines) != 1:
        raise ValueError("Expected exactly one Total Costs row in the comparison table.")
    costs = total_lines[0].split()
    if len(costs) != len(CROPS) or any(not re.fullmatch(r"\d+\.\d{2}", cost) for cost in costs):
        raise ValueError("Expected nine numeric Total Costs values in the comparison table.")

    rows = []
    for (crop, practice), cost in zip(CROPS, costs, strict=True):
        per_hectare = (Decimal(cost) / Decimal("0.40468564224")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        rows.append({
            "crop": crop,
            "practice": practice,
            "cost_cad_per_acre": cost,
            "cost_cad_per_hectare": str(per_hectare),
            "cost_category": "total costs; excludes land rent and unspecified farm overhead",
            "publication_year": "2026",
            "source_page": "2",
            "source_url": SOURCE_URL,
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, help="Path to the 2026 Publication 60 PDF")
    parser.add_argument("output", type=Path, help="Output CSV path")
    args = parser.parse_args()

    rows = extract_budgets(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} crop budgets to {args.output}")


if __name__ == "__main__":
    main()