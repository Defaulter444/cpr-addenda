import { MODULE_ID } from "./constants.js";

export function isVictoria(item) {
  return item?.type === "weapon" && (item.getFlag?.(MODULE_ID, "weaponRule") === "victoria" ||
    item.id === "cprAddWp00050000" ||
    /(?:cpr-addenda\.addenda-weapons\.(?:Item\.)?)cprAddWp00050000$/.test(item.flags?.core?.sourceId || "") ||
    item.name === "Пулемёт MetaCorp «Victoria»");
}

// Mixins are installed on each item; the common loadMixins wrapper calls this.
export function applyWeaponRules(item) {
  if (!isVictoria(item)) return;
  const consume = item.bulletConsumption;
  if (consume) item.bulletConsumption = function (roll) {
    const base = consume.call(this, roll);
    return base === 10 ? 20 : base;
  };
  const attack = item._createAttackRoll;
  if (attack) item._createAttackRoll = function (type, ...args) {
    if (!["autofire", "suppressive"].includes(type)) {
      ui.notifications.warn(game.i18n.localize("CPRADDENDA.weapons.victoriaModes"));
      return null;
    }
    return attack.call(this, type, ...args);
  };
}
