import { UnitType } from "../../../../core/game/Game";
import { translateText } from "../../../Utils";

/**
 * `unit_type.*` name key per unit type, so the HUD never shows the engine's
 * raw enum value (an OpenFront "Trade Ship" where the player knows a
 * Freighter). Types without a key fall back to that raw value.
 */
export const UNIT_NAME_KEYS: Partial<Record<UnitType, string>> = {
  [UnitType.AtomBomb]: "atom_bomb",
  [UnitType.City]: "city",
  [UnitType.DefensePost]: "defense_post",
  [UnitType.Factory]: "factory",
  [UnitType.HydrogenBomb]: "hydrogen_bomb",
  [UnitType.MIRV]: "mirv",
  [UnitType.MIRVWarhead]: "mirv_warhead",
  [UnitType.MissileSilo]: "missile_silo",
  [UnitType.Port]: "port",
  [UnitType.Projectile]: "projectile",
  [UnitType.SAMLauncher]: "sam_launcher",
  [UnitType.SAMMissile]: "sam_missile",
  [UnitType.Shell]: "shell",
  [UnitType.ShieldArray]: "shield_array",
  [UnitType.Stargate]: "stargate",
  [UnitType.TradeShip]: "trade_ship",
  [UnitType.Train]: "train",
  [UnitType.TransportShip]: "boat",
  [UnitType.Warship]: "warship",
};

/** The player-facing name of a unit type, in the viewer's language. */
export function unitTypeName(type: UnitType): string {
  const key = UNIT_NAME_KEYS[type];
  return key === undefined ? type : translateText(`unit_type.${key}`);
}
