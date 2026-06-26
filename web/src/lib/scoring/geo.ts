// Great-circle distance, mirrored verbatim from the Python feature pipeline
// (sentinel_ml/geo.py). A parity test asserts the two implementations agree so
// the online scorer can never silently drift from the offline training features.

const EARTH_RADIUS_KM = 6371.0;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const rlat1 = toRad(lat1);
  const rlat2 = toRad(lat2);
  const dlat = toRad(lat2 - lat1);
  const dlon = toRad(lon2 - lon1);
  const a =
    Math.sin(dlat / 2) ** 2 + Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1.0, Math.sqrt(a)));
}
