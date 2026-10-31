export const ORIGIN = { lat: 51.2213, lon: 4.3997 }; // Brabo fountain, Grote Markt; +x = east, +z = south

const RAD = Math.PI / 180;
const phi = ORIGIN.lat * RAD;
const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_PER_DEG_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

export function project(lat: number, lon: number): [number, number] {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
}
