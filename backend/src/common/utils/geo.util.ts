export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Coarse rounding so a public post never leaks an exact position (~1.1 km). */
export function fuzzCoords(lat: number, lng: number, decimals = 2) {
  const f = 10 ** decimals;
  return { latitude: Math.round(lat * f) / f, longitude: Math.round(lng * f) / f };
}

export const AMS_ALERT_ALTITUDE_M = 3000;
