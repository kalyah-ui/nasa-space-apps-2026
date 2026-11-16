import type {
  PreparedSoilRegionProperties,
  SoilCropId,
  SoilSuitabilityRating,
} from "./types";
import type { SoilSampleRecord, SoilUploadAssessment } from "./upload-types";

export const soilSuitabilitySources = {
  slc: "https://sis.agr.gc.ca/cansis/nsdb/slc/v3.2/index.html",
  model: "https://sis.agr.gc.ca/cansis/nsdb/slc/v3.2/model.html",
  drainage: "https://sis.agr.gc.ca/cansis/nsdb/soil/v2/snt/drainage.html",
  rootDepth: "https://sis.agr.gc.ca/cansis/nsdb/slc/v3.2/crt/depth.html",
  omafraGuide:
    "https://www.ontario.ca/files/2022-10/omafra-agronomy-guide-for-field-crops-en-2022-10-13.pdf",
  omafraFertility:
    "https://files.ontario.ca/omafra-soil-fertility-handbook-en-2022-10-13.pdf",
  lsrsManual:
    "https://sis.agr.gc.ca/cansis/publications/manuals/1995-lsrs/index.html",
} as const;

export const soilCropLabels: Record<SoilCropId, string> = {
  corn: "Corn",
  soybean: "Soybean",
  "winter-wheat": "Winter wheat",
  canola: "Canola",
  forage: "Forage",
};

// Rule provenance:
// - pH thresholds come from OMAFRA Publication 811 table 9-4.
// - canola drainage/pH and winter-wheat drainage interactions come from the
//   crop chapters in Publication 811.
// - forage drainage reflects Publication 811 figure 3-1 across common species.
// - drainage and root-depth codes use the official CanSIS definitions above.
// These are conservative categorical screening rules, not official LSRS,
// yield predictions, or substitutes for an accredited field soil test.

type Severity = 0 | 1 | 2;
type Limitation = { severity: Severity; message: string };

function textureGroup(properties: PreparedSoilRegionProperties) {
  if (properties.sand === null || properties.clay === null) return null;
  if (properties.clay >= 35) return "fine" as const;
  return "coarse-medium" as const;
}

function phThreshold(crop: SoilCropId, texture: "fine" | "coarse-medium") {
  if (texture === "fine") {
    if (crop === "corn" || crop === "forage") return 5.1;
    return 5.6;
  }
  if (crop === "corn" || crop === "soybean" || crop === "forage") return 5.6;
  return 6.1;
}

export function rateUploadedComposite(sample: SoilSampleRecord, crop: SoilCropId): SoilUploadAssessment {
  const ph = sample.ph?.value ?? null;
  const sand = sample.sand?.value ?? null;
  const clay = sample.clay?.value ?? null;
  const texture = sand !== null && clay !== null ? (clay >= 35 ? "fine" : "coarse-medium") : null;
  const limitations: Limitation[] = [];
  const dataGaps: string[] = [];
  const informedBy: string[] = [];
  if (ph !== null && texture) {
    const threshold = phThreshold(crop, texture);
    informedBy.push("whole-field composite pH (" + ph.toFixed(1) + ")", "measured sand/clay texture group");
    if (ph < threshold - 0.6) limitations.push({ severity: 2, message: "Measured composite pH " + ph.toFixed(1) + " is well below the documented liming threshold (" + threshold.toFixed(1) + ")." });
    else if (ph < threshold) limitations.push({ severity: 1, message: "Measured composite pH " + ph.toFixed(1) + " is below the documented liming threshold (" + threshold.toFixed(1) + ")." });
  } else {
    if (ph === null) dataGaps.push("No compatible pH measurement was supplied.");
    if (!texture) dataGaps.push("Sand and clay are both needed to apply the texture-specific pH rule.");
  }
  dataGaps.push("Drainage and rooting depth remain regional CanSIS background unless measured separately.");
  const maximumSeverity = limitations.reduce<Severity>((maximum, limitation) => Math.max(maximum, limitation.severity) as Severity, 0);
  return {
    crop,
    rating: informedBy.length === 0 ? "Insufficient data" : maximumSeverity === 2 ? "Limited" : maximumSeverity === 1 ? "Moderate" : "Good",
    limitingFactors: limitations.map((limitation) => limitation.message),
    dataGaps,
    informedBy,
    uncertainty: "This assessment uses only a confirmed whole-field composite and documented pH/texture rules. It is not a yield prediction.",
  };
}

function drainageLimitation(crop: SoilCropId, code: string): Limitation | null {
  if (code === "#") {
    return { severity: 2, message: "Drainage is not applicable to this component." };
  }
  if (code === "P" || code === "VP") {
    return {
      severity: 2,
      message: `${code === "VP" ? "Very poorly" : "Poorly"} drained regional soil.`,
    };
  }
  if (code === "I") {
    return {
      severity: crop === "forage" ? 1 : 2,
      message: "Imperfect drainage may leave soil wet during the growing season.",
    };
  }
  if (code === "VR") {
    return {
      severity: crop === "forage" ? 2 : 1,
      message: "Very rapid drainage indicates low available-water storage.",
    };
  }
  if (code === "R") {
    return {
      severity: 1,
      message: "Rapid drainage can limit available-water storage.",
    };
  }
  if (code === "MW" && crop === "canola") {
    return {
      severity: 1,
      message: "Canola guidance prefers well-drained soil.",
    };
  }
  return null;
}

function rootDepthLimitation(code: string): Limitation | null {
  if (code === "1") {
    return {
      severity: 2,
      message: "Root-restricting layer is less than 25 cm deep.",
    };
  }
  if (code === "2") {
    return {
      severity: 2,
      message: "Root-restricting layer is 25–49 cm deep.",
    };
  }
  if (code === "3") {
    return {
      severity: 1,
      message: "Root-restricting layer is 50–74 cm deep.",
    };
  }
  return null;
}

export function rateSoilRegion(
  properties: PreparedSoilRegionProperties,
  crop: SoilCropId,
): { rating: SoilSuitabilityRating; limitingFactors: string[] } {
  const texture = textureGroup(properties);
  if (
    properties.ph === null ||
    properties.drainageCode === null ||
    properties.rootDepthCode === null ||
    texture === null
  ) {
    return {
      rating: "Insufficient data",
      limitingFactors: [
        "CanSIS does not contain all required pH, texture, drainage and rooting-depth values for this region.",
      ],
    };
  }

  const limitations: Limitation[] = [];
  const threshold = phThreshold(crop, texture);
  if (properties.ph < threshold - 0.6) {
    limitations.push({
      severity: 2,
      message: `Regional pH ${properties.ph.toFixed(1)} is well below the OMAFA liming threshold (${threshold.toFixed(1)}) for this crop and texture group.`,
    });
  } else if (properties.ph < threshold) {
    limitations.push({
      severity: 1,
      message: `Regional pH ${properties.ph.toFixed(1)} is below the OMAFA liming threshold (${threshold.toFixed(1)}) for this crop and texture group.`,
    });
  }

  const drainage = drainageLimitation(crop, properties.drainageCode);
  if (drainage) limitations.push(drainage);
  const depth = rootDepthLimitation(properties.rootDepthCode);
  if (depth) limitations.push(depth);

  if (
    crop === "canola" &&
    properties.sand !== null &&
    properties.sand >= 85
  ) {
    limitations.push({
      severity: 1,
      message: "Very sandy texture may have low moisture-holding capacity for canola.",
    });
  }
  if (
    crop === "winter-wheat" &&
    properties.clay !== null &&
    properties.clay >= 40 &&
    ["MW", "I", "P", "VP"].includes(properties.drainageCode)
  ) {
    limitations.push({
      severity: 1,
      message: "Heavy texture combined with restricted drainage increases winter-wheat frost-heaving risk.",
    });
  }

  const highest = limitations.reduce<Severity>(
    (severity, limitation) => Math.max(severity, limitation.severity) as Severity,
    0,
  );
  return {
    rating: highest === 2 ? "Limited" : highest === 1 ? "Moderate" : "Good",
    limitingFactors:
      limitations.length > 0
        ? limitations.map((limitation) => limitation.message)
        : ["No limitation was identified from the available regional attributes."],
  };
}

