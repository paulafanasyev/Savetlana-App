/**
 * Карта выбора города: проекция Меркатора, как у тайлов OpenStreetMap.
 * Россия целиком помещается в кусок мира на масштабе 3 (тайлы 256×256).
 */

export const MAP_ZOOM = 3;
const TILE = 256;
const WORLD = TILE * 2 ** MAP_ZOOM; // 2048 px на весь мир

/** Видимое окно карты в пикселях мира (от Калининграда до Чукотки). */
export const MAP_VIEW = { x: 1120, y: 270, width: 928, height: 520 } as const;

/** Пиксель мира для широты и долготы. */
export function project(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon + 180) / 360) * WORLD;
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * WORLD;
  return { x, y };
}

/** Точка на карте внутри окна MAP_VIEW (0,0 в левом верхнем углу окна). */
export function mapPoint(lat: number, lon: number): { x: number; y: number } {
  const p = project(lat, lon);
  return { x: p.x - MAP_VIEW.x, y: p.y - MAP_VIEW.y };
}

/** Какие тайлы нужны, чтобы закрыть окно, и где каждый лежит внутри окна. */
export function mapTiles(): { url: string; x: number; y: number }[] {
  const tiles: { url: string; x: number; y: number }[] = [];
  const max = 2 ** MAP_ZOOM - 1;
  for (let ty = Math.floor(MAP_VIEW.y / TILE); ty <= Math.floor((MAP_VIEW.y + MAP_VIEW.height - 1) / TILE); ty++) {
    for (let tx = Math.floor(MAP_VIEW.x / TILE); tx <= Math.min(max, Math.floor((MAP_VIEW.x + MAP_VIEW.width - 1) / TILE)); tx++) {
      tiles.push({ url: `https://tile.openstreetmap.org/${MAP_ZOOM}/${tx}/${ty}.png`, x: tx * TILE - MAP_VIEW.x, y: ty * TILE - MAP_VIEW.y });
    }
  }
  return tiles;
}
