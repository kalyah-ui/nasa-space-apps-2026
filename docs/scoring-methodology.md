# Scoring Methodology

## Score Contract

All component scores use a 0–100 scale, where higher is more favourable. In particular, a high flood score means lower flood susceptibility; invert hazard scores before passing them into a farm composite. Data adapters are responsible for converting source measurements into these normalized scores. The scoring library combines scores but does not invent agronomic thresholds or weights.

Every component has a score, a relative weight, optional data coverage, and an optional source label. A missing score is `null`, never zero. Composite scores average only available components, report weighted coverage against all expected components, and list missing components. A partial score must be displayed with its coverage so it is not mistaken for a fully supported result.

## Score Definitions and Candidate Inputs

| Output | Candidate inputs | Notes |
| --- | --- | --- |
| Soil | SSURGO/STATSGO2 soil texture, drainage, organic matter, pH, and water-holding capacity | Score crop-specific soil fit; required crop tolerances are not yet modeled. |
| Water | GPM/IMERG precipitation, SMAP or NLDAS/GLDAS moisture, POWER weather, ECOSTRESS or OpenET evapotranspiration | Separate water stress from irrigation supply. OpenET coverage is regional, and SMAP is not field-scale. |
| Flood and erosion | SRTM terrain, SSURGO drainage/hydrologic group, and GPM extreme rainfall | These are susceptibility indicators, not a substitute for authoritative flood maps. |
| Climate | PRISM/POWER history and normals, ERA5, plus crop-specific heat, frost, and growing-season needs | Use dated observations and documented crop-specific thresholds. |
| Farm | Weighted soil, water, flood, and climate scores | Weights must reflect agreed project priorities; no default weights are prescribed. |
| Crop rotation | Crop suitability, crop-family labels, and crop history from CDL; optionally yields from NASS and market context from AMS | The initial recommender is a heuristic, not a nutrient-cycle, pest, yield, or profit model. |

Use the finest-resolution source available for the parcel, and preserve source, date, and coverage when preparing component scores. The scoring input uses `sourceDate` for the source observation or product date; recommendations retain the component breakdown so these inputs remain explainable. Coarse or incomplete inputs should reduce reported coverage, not silently produce false precision.

## Initial Implementation

`lib/scoring` provides weighted composition for farm and crop-suitability scores. Callers supply normalized component scores and explicit weights. Weights are relative and need not sum to 100.

`lib/recommendations` ranks crops with a computed suitability score and reports unscored crops separately. Its first rotation heuristic greedily ranks crop suitability while avoiding the same crop family in consecutive years. The returned rotation value is average crop suitability, **not** a validated rotation-resilience score. Improve it only after the team agrees on crop traits and agronomic rules (for example, water demand, nutrient effects, cover-crop benefits, and local planting constraints).

## Rotation Planner Field-Fit Screen (Prototype)

The rotation planner shows a preliminary crop-to-field soil screen, not an overall planting recommendation. It uses the area-weighted SLC surface pH, sand, and clay estimates for the selected field and a crop profile in `lib/recommendations/field-fit.ts`. For each available attribute, a value inside the crop's broad screening interval scores 100; values outside decline linearly to zero at the configured margin. The displayed crop fit is the unweighted mean of available pH, sand, and clay checks. Coverage reports how many of those three checks are present, scaled by mapped soil coverage. Unsupported crops or missing soil measurements are unscored, not zero.

Because SLC is a 1:1,000,000 landscape dataset, these values are coarse screening signals only. The screen does not evaluate drainage codes, water-holding capacity, field sampling, cultivar, climate, planting window, pests, rotation disease risk, or management. The UI must retain this limitation beside the result and must not label a crop definitively safe or unsuitable based on this screen alone. Crop profiles and intervals require agronomist review before operational recommendations.

Rotation comparisons report component indicators rather than a single composite: average soil screen and coverage, crop-family diversity, farmer-declared relative water demand, and estimated gross revenue where the farmer supplies yield and price. Gross revenue excludes costs. Do not combine these into a composite rotation score until the team agrees on objective weights and validation evidence.

## Relative Crop Water Demand

The planner's lower, moderate, and higher categories are preliminary crop-comparison heuristics, not field-specific water use or irrigation requirements. Farmers can override them, and unsupported crops remain unknown. Apple and pear use a provisional moderate category consistent with the existing peach estimate: [FAO Irrigation and Drainage Paper 56, Table 12](https://www.fao.org/4/x0490e/x0490e0b.htm) reports similar crop coefficients for these orchard crops. FAO does not define the planner's three categories; the mapping is an app heuristic and requires agronomic validation. Orchard ground cover, climate, tree age, variety, soil, and management affect actual water use.