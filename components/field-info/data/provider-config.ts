import { ApiProvider } from "./api-provider";
import { MockProvider } from "./mock-provider";
import type { DataProvider } from "./types";

function createDataProvider(): DataProvider {
  const providerName = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? "mock";

  if (providerName === "mock") {
    return new MockProvider();
  }

  if (providerName === "api") {
    return new ApiProvider();
  }

  throw new Error(
    `Unsupported NEXT_PUBLIC_DATA_PROVIDER "${providerName}". Expected "mock" or "api".`,
  );
}

export const fieldDataProvider = createDataProvider();
