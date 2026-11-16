import { ApiProvider } from "./api-provider";
import { MockProvider } from "./mock-provider";
import type { DataProvider } from "./types";

export const regionalSoilProviderConfig = {
  endpoint: "/api/soil-regions",
  source: "AAFC CanSIS SLC v3.2",
  scale: "1:1,000,000",
  title: "Regional soil suitability — not measured productivity",
} as const;

function createDataProvider(): DataProvider {
  const providerName = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? "api";

  if (providerName === "mock") {
    return new MockProvider();
  }

  if (providerName === "api") {
    return new ApiProvider({ soilRegions: regionalSoilProviderConfig });
  }

  throw new Error(
    `Unsupported NEXT_PUBLIC_DATA_PROVIDER "${providerName}". Expected "mock" or "api".`,
  );
}

export const fieldDataProvider = createDataProvider();
