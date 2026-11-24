export interface WellRecord {
  id: string;
  distance_m: number;
  depth_m: number | null;
  completed_year: number | null;
  recorded_status: string | null;
  recorded_use: string | null;
}

export interface NearbyWells {
  radius_m: number;
  total_records: number;
  records: WellRecord[];
  complete: boolean;
  retrieved_at: string;
}
