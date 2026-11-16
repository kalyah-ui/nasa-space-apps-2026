# Ontario Field Crop Budgets

`ontario-field-crop-budgets-2026.csv` contains the nine scenarios from the
comparison table on printed page 2 of Ontario Publication 60. Costs are sample
estimates in Canadian dollars; the per-hectare values convert the source's
per-acre amounts using 1 acre = 0.40468564224 hectares and round to cents.
Crop practices are kept separate. The source leaves land rent and some
farm-specific overhead costs blank, so add those costs before estimating profit.
The source projected market and input prices as of November 2025. These are
not actual costs for a particular farm or a forecast of future prices.

The script deliberately accepts only the 2026 comparison table and its expected
column layout. It fails instead of guessing when the PDF changes. For other
years or crops, update and verify the extraction against the source.

To regenerate from the official PDF, from the repository root:

```bash
python -m pip install -r scripts/ontario/requirements.txt
curl -fL 'https://www.ontario.ca/files/2026-01/omafa-field-crop-budgets-pub-60-en-2026-01-14.pdf' -o /tmp/ontario-field-crop-budgets-2026.pdf
python scripts/ontario/extract_field_crop_budgets.py /tmp/ontario-field-crop-budgets-2026.pdf /tmp/ontario-field-crop-budgets-2026.csv
python -m unittest discover -s scripts/ontario -p 'test_*.py'
```

Upload the original PDF to `raw/ontario/field-crop-budgets/publication-60/`
and the CSV to `processed/ontario/field-crop-budgets/` in your GCS bucket.
The application does not currently load this file automatically.