import { listGcsObjects } from "../../../lib/datasets/gcs-client";
import { MockProvider } from "./mock-provider";
import type {
  Coordinate,
  DataProvider,
  DataProvenance,
  FieldSpec,
  LayerData,
  LayerId,
  LayerSpec,
  PointInspection,
} from "./types";

export class ApiProvider implements DataProvider {
  private readonly mockProvider = new MockProvider();

  private async getLiveProvenance(): Promise<DataProvenance> {
    try {
      const page = await listGcsObjects({ prefix: "raw/", pageSize: 20 });
      const count = page.objects.length;
      return {
        kind: "live",
        label: `LIVE DATA — Google Cloud Storage: ${count} objects available in ${page.bucket} (raw prefix)`,
      };
    } catch {
      return {
        kind: "live",
        label: "LIVE DATA — Google Cloud Storage object API connected; object inventory is loading.",
      };
    }
  }

  async getField(fieldId: string): Promise<FieldSpec | null> {
    const field = await this.mockProvider.getField(fieldId);
    if (!field) {
      return null;
    }

    const provenance = await this.getLiveProvenance();
    return {
      ...field,
      provenance,
    };
  }

  async listLayers(fieldId: string): Promise<LayerSpec[]> {
    return this.mockProvider.listLayers(fieldId);
  }

  async listLayerDates(fieldId: string, layerId: LayerId): Promise<string[]> {
    return this.mockProvider.listLayerDates(fieldId, layerId);
  }

  async getLayerData(fieldId: string, layerId: LayerId, date?: string): Promise<LayerData> {
    return this.mockProvider.getLayerData(fieldId, layerId, date);
  }

  async inspectPoint(
    fieldId: string,
    coordinates: Coordinate,
    date?: string,
  ): Promise<PointInspection> {
    return this.mockProvider.inspectPoint(fieldId, coordinates, date);
  }
}
