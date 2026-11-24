import json
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from backend.models.data_centers import NearbyDataCenterRequest
from backend.services.data_centers import EXPOSURE_WEIGHTS, lookup_nearby_data_centers

SOURCE_URL = "https://example.com/official-data-center-record"


def report_payload(*, facilities=None, complete_factors=True):
    return {
        "existing_data_centers": facilities or [],
        "planned_data_centers": [],
        "water_concerns": [],
        "energy_concerns": [],
        "land_use_concerns": [],
        "environmental_concerns": [],
        "exposure_factors": [
            {
                "factor": factor,
                "score": 30 if complete_factors else (30 if index < 3 else None),
                "rationale": "Cited assessment factor.",
                "source_urls": [SOURCE_URL] if complete_factors or index < 3 else [],
            }
            for index, (factor, _weight) in enumerate(EXPOSURE_WEIGHTS.items())
        ],
        "score_confidence": "medium",
        "purchase_recommendation": "Routine due diligence recommended",
        "key_findings": [{"finding": "A cited finding.", "source_urls": [SOURCE_URL]}],
        "recommended_due_diligence": ["Review municipal planning records."],
        "data_gaps": ["Water permits were not located."],
        "sources": [{"title": "Official record", "url": SOURCE_URL, "publication_date": "2025-03-10"}],
    }


def grounded_interaction(report, *, search_performed=True, citations=True):
    steps = []
    if search_performed:
        steps.append({"type": "google_search_call", "arguments": {"queries": ["data center municipal application"]}})
    annotation = [{"type": "url_citation", "url": SOURCE_URL, "title": "Official record"}] if citations else []
    steps.append({
        "type": "model_output",
        "content": [{"type": "text", "text": json.dumps(report), "annotations": annotation}],
    })
    return {"interaction": {"steps": steps}}


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class NearbyDataCenterTests(unittest.TestCase):
    def test_request_defaults_to_ontario_canada_and_25_km(self):
        request = NearbyDataCenterRequest(latitude=45.4, longitude=-75.7)
        self.assertEqual(request.radius_km, 25)
        self.assertEqual(request.province, "Ontario")
        self.assertEqual(request.country, "Canada")

    def test_request_restricts_radius_and_coordinates(self):
        with self.assertRaises(ValidationError):
            NearbyDataCenterRequest(latitude=91, longitude=0)
        with self.assertRaises(ValidationError):
            NearbyDataCenterRequest(latitude=45, longitude=-75, radius_km=250)

    @patch.dict("os.environ", {"GEMINI_API_KEY": ""})
    def test_missing_key_returns_full_unavailable_assessment_not_zero_score(self):
        request = NearbyDataCenterRequest(latitude=45.4, longitude=-75.7)
        result = lookup_nearby_data_centers(request)

        self.assertEqual(result.assessment_status, "unavailable")
        self.assertEqual(result.exposure_score, None)
        self.assertEqual(result.purchase_recommendation, "Insufficient evidence to assess")
        self.assertEqual(result.key_findings, [])
        self.assertIn("No claim is made", result.data_gaps[0])
        self.assertEqual(result.farm_location.province, "Ontario")

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("backend.services.data_centers.urlopen")
    def test_includes_cited_in_radius_facilities_and_calculates_distance(self, urlopen_mock):
        facility = {
            "name": "North Valley Data Centre",
            "developer_or_operator": "Example Compute",
            "status": "under_construction",
            "facility_type": "hyperscale",
            "latitude": 45.5,
            "longitude": -75.7,
            "address_or_location": "North Valley, Ontario",
            "announcement_date": "2025-03-10",
            "expected_construction_date": "2026",
            "expected_completion_date": "2028",
            "municipal_approvals": ["Zoning amendment approved"],
            "power_information": "Substation application cited.",
            "cooling_and_water_information": "Water details not published.",
            "evidence_summary": "Official record confirms construction.",
            "source_urls": [SOURCE_URL],
        }
        far_facility = {**facility, "name": "Outside Radius", "latitude": 47.0}
        uncited_facility = {**facility, "name": "Uncited", "source_urls": ["https://uncited.example"]}
        report = report_payload(facilities=[facility, far_facility, uncited_facility])
        urlopen_mock.return_value = FakeResponse(grounded_interaction(report))

        result = lookup_nearby_data_centers(NearbyDataCenterRequest(
            latitude=45.4,
            longitude=-75.7,
            radius_km=25,
            farm_address="Demo road",
            is_demo_location=True,
        ))

        self.assertEqual(result.assessment_status, "reported")
        self.assertEqual(len(result.planned_data_centers), 1)
        self.assertEqual(result.planned_data_centers[0].status, "under_construction")
        self.assertAlmostEqual(result.planned_data_centers[0].distance_km, 11.1, delta=0.3)
        self.assertEqual(result.closest_verified_facility_km, result.planned_data_centers[0].distance_km)
        self.assertEqual(result.exposure_score, 30)
        self.assertEqual(result.score_confidence, "medium")
        self.assertEqual(result.farm_location.address, "Demo road")
        self.assertTrue(result.farm_location.is_demo_location)
        self.assertEqual(result.planned_data_centers[0].sources[0].url, SOURCE_URL)

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("backend.services.data_centers.urlopen")
    def test_score_is_null_when_any_weighted_factor_lacks_cited_evidence(self, urlopen_mock):
        urlopen_mock.return_value = FakeResponse(grounded_interaction(report_payload(complete_factors=False)))
        result = lookup_nearby_data_centers(NearbyDataCenterRequest(latitude=45.4, longitude=-75.7))

        self.assertIsNone(result.exposure_score)
        self.assertEqual(result.score_confidence, "insufficient")
        self.assertIsNone(result.exposure_factors[-1].score)

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("backend.services.data_centers.urlopen")
    def test_empty_grounded_search_does_not_claim_facility_absence(self, urlopen_mock):
        report = report_payload()
        report["key_findings"] = []
        report["sources"] = []
        urlopen_mock.return_value = FakeResponse(grounded_interaction(report))
        result = lookup_nearby_data_centers(NearbyDataCenterRequest(latitude=45.4, longitude=-75.7))

        self.assertEqual(result.assessment_status, "no_reports_found")
        self.assertIsNone(result.exposure_score)
        self.assertEqual(result.purchase_recommendation, "Insufficient evidence to assess")
        self.assertIn("does not confirm", result.data_gaps[0])

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("backend.services.data_centers.urlopen")
    def test_ungrounded_response_is_unavailable(self, urlopen_mock):
        urlopen_mock.return_value = FakeResponse(grounded_interaction(report_payload(), search_performed=False))
        result = lookup_nearby_data_centers(NearbyDataCenterRequest(latitude=45.4, longitude=-75.7))

        self.assertEqual(result.assessment_status, "unavailable")
        self.assertIsNone(result.exposure_score)


if __name__ == "__main__":
    unittest.main()
