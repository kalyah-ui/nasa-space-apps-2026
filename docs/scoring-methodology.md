# Scoring Methodology

## Score contract

All component scores use a 0–100 scale where higher is more favorable. In particular, a high flood score means lower flood susceptibility; do not pass an un-inverted hazard score into a farm composite. Data adapters are responsible for converting source measurements into these normalized scores. The scoring library combines scores but does not invent agronomic thresholds or weights.

Every component has a score, a relative weight, optional data coverage, and an optional source label. A missing score is `null`, never zero. Composite scores average only available components, report weighted coverage against all expected components, and list missing components. A partial score must be displayed with its coverage so it is not mistaken for a fully supported result.

## Score definitions and candidate inputs

| Output | Candidate inputs | Notes |
| --- | --- | --- |
| Soil | SSURGO/STATSGO2 soil texture, drainage, organic matter, pH, and water-holding capacity | Score crop-specific soil fit; required crop tolerances are not yet modeled. |
| Water | GPM/IMERG precipitation, SMAP or NLDAS/GLDAS moisture, POWER weather, ECOSTRESS or OpenET evapotranspiration | Separate water stress from irrigation supply. OpenET coverage is regional, and SMAP is not field-scale. |
| Flood and erosion | SRTM terrain, SSURGO drainage/hydrologic group, and GPM extreme rainfall | These are susceptibility indicators, not a substitute for authoritative flood maps. |
| Climate | PRISM/POWER history and normals, ERA5, plus crop-specific heat, frost, and growing-season needs | Historical suitability is distinct from future projections. |
| Farm | Weighted soil, water, flood, and climate scores | Weights must reflect agreed project priorities; no default weights are prescribed. |
| Future Farm | The same dimensions evaluated under a named future scenario | Requires climate projections and documented assumptions. Historical or current-condition datasets alone cannot support a future claim. |
| Crop rotation | Crop suitability, crop-family labels, and crop history from CDL; optionally yields from NASS and market context from AMS | The initial recommender is a heuristic, not a nutrient-cycle, pest, yield, or profit model. |

Use the finest-resolution source available for the parcel, and preserve source, date, and coverage when preparing component scores. The scoring input uses `sourceDate` for the source observation or product date; recommendations retain the component breakdown so these inputs remain explainable. Coarse or incomplete inputs should reduce reported coverage, not silently produce false precision.

## Initial implementation

`lib/scoring` provides weighted composition for farm, crop-suitability, and future-farm scores. Callers supply normalized component scores and explicit weights. Weights are relative and need not sum to 100.

`lib/recommendations` ranks crops with a computed suitability score and reports unscored crops separately. Its first rotation heuristic greedily ranks crop suitability while avoiding the same crop family in consecutive years. The returned rotation value is average crop suitability, **not** a validated rotation-resilience score. Improve it only after the team agrees on crop traits and agronomic rules (for example, water demand, nutrient effects, cover-crop benefits, and local planting constraints).