export const ANTWERP = { lat: 51.2213, lon: 4.3997 };

export interface SkyState {
  elevation: number; // rad above the horizon, negative at night
  azimuth: number; // rad clockwise from north
  cloud: number; // 0 clear … 1 overcast
  rain: number; // 0 dry … 1 heavy
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// NOAA low-precision almanac (~0.01°); uses the absolute instant, so the machine's timezone is irrelevant.
export function sunPosition(date: Date, lat = ANTWERP.lat, lon = ANTWERP.lon): { elevation: number; azimuth: number } {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const meanLong = (280.46 + 0.9856474 * n) * rad;
  const meanAnom = (357.528 + 0.9856003 * n) * rad;
  const eclLong = meanLong + (1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * rad;
  const obliquity = 23.439 * rad;
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclLong));
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLong), Math.cos(eclLong));
  const gmst = (280.46061837 + 360.98564736629 * n) * rad;
  const hourAngle = gmst + lon * rad - ra;
  const latr = lat * rad;
  const elevation = Math.asin(Math.sin(latr) * Math.sin(dec) + Math.cos(latr) * Math.cos(dec) * Math.cos(hourAngle));
  // atan2 measures from south; + π gives a bearing from north.
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(latr) - Math.tan(dec) * Math.cos(latr)) + Math.PI;
  return { elevation, azimuth };
}

const antwerpParts = (date: Date, options: Intl.DateTimeFormatOptions) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Brussels', hour12: false, ...options }).formatToParts(date).map((x) => [x.type, x.value]),
);

function atAntwerpHour(hour: number): Date {
  const now = new Date();
  const p = antwerpParts(now, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  const offsetMs = asIfUtc - now.getTime();
  const h = Math.floor(hour), m = Math.round((hour - h) * 60);
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, h, m, 0) - offsetMs);
}

function clockDate(params: URLSearchParams): Date {
  const t = params.get('time');
  return t !== null && t !== '' && Number.isFinite(+t) ? atAntwerpHour(+t) : new Date();
}

export interface Clock {
  hour: number; // 0–23, Antwerp local
  weekend: boolean;
}

export function antwerpClock(params: URLSearchParams): Clock {
  const p = antwerpParts(clockDate(params), { hour: '2-digit', weekday: 'short' });
  return { hour: +p.hour % 24, weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
}

const WEATHER_PRESETS: Record<string, { cloud: number; rain: number }> = {
  clear: { cloud: 0, rain: 0 }, fair: { cloud: 0.25, rain: 0 }, cloudy: { cloud: 0.55, rain: 0 },
  overcast: { cloud: 0.95, rain: 0 }, rain: { cloud: 1, rain: 0.7 }, storm: { cloud: 1, rain: 1 },
};

export function initialSky(params: URLSearchParams): SkyState {
  const sun = sunPosition(clockDate(params));
  let cloud = 0, rain = 0;
  const preset = params.get('weather');
  if (preset && WEATHER_PRESETS[preset]) ({ cloud, rain } = WEATHER_PRESETS[preset]);
  else if (params.has('clouds') || params.has('rain')) {
    cloud = clamp01(+(params.get('clouds') ?? '0'));
    rain = clamp01(+(params.get('rain') ?? '0'));
  }
  return { ...sun, cloud: Math.max(cloud, rain * 0.9), rain };
}

export function useLiveWeather(params: URLSearchParams): boolean {
  return !params.get('weather') && !params.has('clouds') && !params.has('rain');
}

/** Open-Meteo (free, no key); null on failure. */
export async function liveWeather(): Promise<{ cloud: number; rain: number } | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${ANTWERP.lat}&longitude=${ANTWERP.lon}&current=cloud_cover,precipitation`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { current?: { cloud_cover?: number; precipitation?: number } };
    return { cloud: clamp01((j.current?.cloud_cover ?? 0) / 100), rain: clamp01((j.current?.precipitation ?? 0) / 2.5) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
