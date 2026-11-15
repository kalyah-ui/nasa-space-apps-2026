import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from extract_field_crop_budgets import EXPECTED_HEADERS, extract_budgets


class ExtractBudgetTests(unittest.TestCase):
    def extract(self, text: str):
        document = MagicMock()
        document.__enter__.return_value.pages = [MagicMock(extract_text=lambda: text)]
        with patch("extract_field_crop_budgets.pdfplumber.open", return_value=document):
            return extract_budgets(Path("budget.pdf"))

    def test_extracts_costs_and_converts_acres(self):
        text = (
            "2026 Crop Comparison Summary Table for Selected Field Crops ($/acre)*\n"
            f"{EXPECTED_HEADERS}\n"
            "Total Costs 875.05 651.60 455.30 421.85 909.35 758.50 555.50 490.40 521.05\n"
        )
        rows = self.extract(text)
        self.assertEqual(len(rows), 9)
        self.assertEqual(rows[0]["crop"], "corn")
        self.assertEqual(rows[0]["cost_cad_per_acre"], "875.05")
        self.assertEqual(rows[0]["cost_cad_per_hectare"], "2162.30")
        self.assertEqual(rows[-1]["crop"], "spring wheat")
        self.assertEqual(rows[-1]["cost_cad_per_acre"], "521.05")

    def test_rejects_missing_or_changed_table(self):
        with self.assertRaises(ValueError):
            self.extract("2026 Crop Comparison Summary Table for Selected Field Crops ($/acre)*")

    def test_rejects_wrong_number_of_values(self):
        text = (
            "2026 Crop Comparison Summary Table for Selected Field Crops ($/acre)*\n"
            f"{EXPECTED_HEADERS}\nTotal Costs 1.00 2.00\n"
        )
        with self.assertRaises(ValueError):
            self.extract(text)


if __name__ == "__main__":
    unittest.main()