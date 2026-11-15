import io
import unittest
from unittest.mock import patch

from backend.services.crop_budgets import load_crop_budgets


class CropBudgetTests(unittest.TestCase):
    def test_reads_quoted_csv_and_costs(self):
        content = (b'crop,practice,cost_cad_per_hectare,cost_category,publication_year,source_page,source_url\n'
                   b'soybeans,"non-GMO, no till",1125.07,excludes land rent,2026,2,https://example.com\n')
        with patch("backend.services.crop_budgets.get_bucket") as bucket:
            blob = bucket.return_value.blob.return_value
            blob.size = len(content)
            blob.open.return_value = io.BytesIO(content)
            rows = load_crop_budgets()
        self.assertEqual(rows[0]["practice"], "non-GMO, no till")
        self.assertEqual(rows[0]["cost_cad_per_hectare"], 1125.07)

    def test_rejects_nonfinite_cost(self):
        content = (b'crop,practice,cost_cad_per_hectare,cost_category,publication_year,source_page,source_url\n'
                   b'corn,tillage,nan,excludes rent,2026,2,https://example.com\n')
        with patch("backend.services.crop_budgets.get_bucket") as bucket:
            blob = bucket.return_value.blob.return_value
            blob.size = len(content)
            blob.open.return_value = io.BytesIO(content)
            with self.assertRaises(ValueError):
                load_crop_budgets()


if __name__ == "__main__":
    unittest.main()