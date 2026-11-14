import { MockProvider } from "./mock-provider";
import type { DataProvider } from "./types";

function createDataProvider(): DataProvider {
  const providerName = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? "mock";

  if (providerName === "mock") {
    return new MockProvider();
  }

  if (providerName === "api") {
    throw new Error(
      'NEXT_PUBLIC_DATA_PROVIDER is "api", but ApiProvider is not implemented yet. Use "mock" until the API-provider step.',
    );
  }

  throw new Error(
    `Unsupported NEXT_PUBLIC_DATA_PROVIDER "${providerName}". Expected "mock" or "api".`,
  );
}

export const fieldDataProvider = createDataProvider();
