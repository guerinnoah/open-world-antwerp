import type { CityData, LogoRect, Operator } from './cityData';

export interface OperatorLogo {
  image: HTMLImageElement;
  rect: LogoRect;
}

let atlas: Promise<HTMLImageElement | undefined> | undefined;

export function logoAtlas(): Promise<HTMLImageElement | undefined> {
  atlas ??= new URLSearchParams(location.search).has('nologos') ? Promise.resolve(undefined) : decode('/map/logos.webp');
  return atlas;
}

function decode(src: string): Promise<HTMLImageElement | undefined> {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image, () => undefined);
}

export async function operatorLogo(city: CityData, key: Operator): Promise<OperatorLogo | undefined> {
  const index = city.operators?.[key];
  const rect = index === undefined ? undefined : city.logos?.[index];
  const image = rect && (await logoAtlas());
  return image && rect ? { image, rect } : undefined;
}

export function logoSize({ rect: [, , w, h] }: OperatorLogo, height: number, maxWidth: number): [number, number] {
  const dh = Math.min(height, (maxWidth * h) / w);
  return [(dh * w) / h, dh];
}

export function drawLogo(g: CanvasRenderingContext2D, { image, rect: [x, y, w, h] }: OperatorLogo, cx: number, [dw, dh]: [number, number]) {
  g.drawImage(image, x + 0.5, y + 0.5, w - 1, h - 1, cx - dw / 2, (g.canvas.height - dh) / 2, dw, dh); // inset: neighbours bleed
}
