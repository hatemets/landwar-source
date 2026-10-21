import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { assetUrl } from "@openfront/shared/AssetUrls";

/** Menu-only artwork follows the map selected in game setup. */
export function setMenuMap(map: GameMapType): void {
  const key = Object.keys(GameMapType).find(
    (key) => GameMapType[key as keyof typeof GameMapType] === map,
  );
  if (!key) return;
  const image = assetUrl(`maps/${key.toLowerCase()}/thumbnail.webp`);
  const root = document.documentElement;
  root.style.setProperty("--menu-active-map", `url("${image}")`);
  const preload = new Image();
  preload.decoding = "async";
  preload.src = image;
  if (typeof preload.decode === "function") {
    void preload.decode().catch(() => undefined);
  }
}
