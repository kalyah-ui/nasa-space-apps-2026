import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ApiProvider } from "./api-provider";

describe("ApiProvider", () => {
  test("uses the demo field metadata while marking the provenance as live", async () => {
    const provider = new ApiProvider();
    const field = await provider.getField("demo-field-01");

    assert.ok(field !== null);
    assert.equal(field?.provenance.kind, "live");
    assert.match(field?.provenance.label ?? "", /Google Cloud Storage/i);
  });

  test("preserves the mock layer schema for the UI", async () => {
    const provider = new ApiProvider();
    const layers = await provider.listLayers("demo-field-01");

    assert.ok(layers.length > 0);
    assert.ok(layers.some((layer) => layer.id === "productivity"));
  });
});
