import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ApiProvider } from "./api-provider";

describe("ApiProvider", () => {
  test("exposes the configured live map layers", async () => {
    const provider = new ApiProvider();
    const layers = await provider.listLayers();

    assert.ok(layers.length > 0);
    assert.ok(layers.some((layer) => layer.id === "satellite" && layer.available));
    assert.ok(layers.some((layer) => layer.id === "ndvi" && layer.available));
    assert.ok(layers.some((layer) => layer.id === "ndre" && !layer.available));
    assert.ok(layers.some((layer) => layer.id === "msavi" && !layer.available));
    assert.ok(!layers.some((layer) => String(layer.id) === "reci"));
  });
});
