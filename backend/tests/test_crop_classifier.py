import unittest
from unittest.mock import patch

from backend.models.crops import CropClassificationRequest
from backend.services.crop_classifier import classify_crops


class CropClassifierTests(unittest.TestCase):
    @patch.dict("os.environ", {"GEMINI_API_KEY": ""})
    def test_reference_estimates_apple_and_pear_water_demand(self) -> None:
        result = classify_crops(CropClassificationRequest(crop_names=["apple", "Apples", "pear", "pears", "unknown crop"]))

        for classification in result.classifications[:4]:
            self.assertEqual(classification.water_demand, "moderate")
            self.assertEqual(classification.water_method, "crop-reference")
        self.assertEqual(result.classifications[4].water_demand, "unknown")

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("backend.services.crop_classifier._gemini_classify")
    def test_unknown_gemini_water_uses_available_reference(self, gemini_mock) -> None:
        gemini_mock.return_value = [{"crop_name": "apple", "family": "Rosaceae", "water_demand": "unknown"}]

        result = classify_crops(CropClassificationRequest(crop_names=["apple"]))

        self.assertEqual(result.classifications[0].water_demand, "moderate")
        self.assertEqual(result.classifications[0].water_method, "crop-reference")

    @patch.dict("os.environ", {"GEMINI_API_KEY": ""})
    def test_reference_fallback_recognizes_peaches_and_pumpkins(self) -> None:
        result = classify_crops(CropClassificationRequest(crop_names=["peaches", "pumpkins"]))

        self.assertEqual(result.provider, "crop-reference")
        self.assertEqual(result.classifications[0].family, "Rosaceae")
        self.assertEqual(result.classifications[0].water_demand, "moderate")
        self.assertEqual(result.classifications[1].family, "Cucurbitaceae")
        self.assertEqual(result.classifications[1].water_demand, "moderate")

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("backend.services.crop_classifier._gemini_classify")
    def test_gemini_classification_is_returned_for_allowed_categories(self, gemini_mock) -> None:
        gemini_mock.return_value = [
            {
                "crop_name": "Peaches",
                "family": "Rosaceae",
                "water_demand": "moderate",
                "confidence": "medium",
                "note": "Relative crop reference estimate.",
            }
        ]

        result = classify_crops(CropClassificationRequest(crop_names=["Peaches"]))

        self.assertEqual(result.provider, "gemini")
        self.assertEqual(result.classifications[0].family, "Rosaceae")
        self.assertEqual(result.classifications[0].family_method, "gemini")
        self.assertEqual(result.classifications[0].water_demand, "moderate")

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("backend.services.crop_classifier._gemini_classify", side_effect=TimeoutError)
    def test_gemini_failure_falls_back_to_crop_reference(self, _gemini_mock) -> None:
        result = classify_crops(CropClassificationRequest(crop_names=["pumpkin"]))

        self.assertEqual(result.provider, "crop-reference")
        self.assertEqual(result.classifications[0].family, "Cucurbitaceae")
        self.assertEqual(result.classifications[0].water_method, "crop-reference")

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("backend.services.crop_classifier._gemini_classify")
    def test_invalid_gemini_categories_are_not_accepted(self, gemini_mock) -> None:
        gemini_mock.return_value = [
            {
                "crop_name": "Peaches",
                "family": "Fruit",
                "water_demand": "extreme",
                "note": "Invalid values should be ignored.",
            }
        ]

        result = classify_crops(CropClassificationRequest(crop_names=["Peaches"]))

        self.assertEqual(result.classifications[0].family, "Rosaceae")
        self.assertEqual(result.classifications[0].water_demand, "moderate")
        self.assertEqual(result.classifications[0].family_method, "crop-reference")


if __name__ == "__main__":
    unittest.main()
