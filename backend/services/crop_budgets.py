import csv
import io
import math

from backend.services.gcs import get_bucket

BUDGET_OBJECT = "processed/ontario-field-crop-budgets-2026.csv"
MAX_BUDGET_BYTES = 100_000


def load_crop_budgets() -> list[dict[str, object]]:
    blob = get_bucket().blob(BUDGET_OBJECT)
    blob.reload()
    if blob.size is None or blob.size > MAX_BUDGET_BYTES:
        raise ValueError("Crop budget file exceeds the allowed size or has no size metadata.")
    with blob.open("rb") as source:
        content = source.read(MAX_BUDGET_BYTES + 1)
    if len(content) > MAX_BUDGET_BYTES:
        raise ValueError("Crop budget file exceeds the allowed size.")
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig"), newline=""))
    required = {"crop", "practice", "cost_cad_per_hectare", "cost_category", "publication_year", "source_page", "source_url"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValueError("Crop budget CSV is missing required columns.")
    budgets = []
    for row in reader:
        cost = float(row["cost_cad_per_hectare"])
        year = int(row["publication_year"])
        if not row["crop"].strip() or not row["cost_category"].strip() or not math.isfinite(cost) or cost < 0 or year != 2026:
            raise ValueError("Crop budget CSV contains invalid data.")
        budgets.append({
            "crop": row["crop"].strip(),
            "practice": row["practice"].strip(),
            "cost_cad_per_hectare": cost,
            "cost_category": row["cost_category"].strip(),
            "publication_year": year,
            "source_page": row["source_page"].strip(),
            "source_url": row["source_url"].strip(),
        })
    if not budgets:
        raise ValueError("Crop budget CSV contains no budgets.")
    return budgets