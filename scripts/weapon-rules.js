import { weaponRule, hasShotgunAutoControl, setWeaponDvTable, getAttackRules, isShotAttack, installedWeaponUpgrades, weaponUpgradeFamily, addendaFlag } from "./weapon-dv.js";
import { normalizeCarrierRestore } from "./carrier-data.js";

export function isVictoria(item) {
  return item?.type === "weapon" && weaponRule(item) === "victoria";
}

// Mixins are installed on each item; the common loadMixins wrapper calls this.
export function applyWeaponRules(item) {
  if (item?.type !== "weapon") return;
  // Existing worlds may contain an autosear installed by an earlier Addenda
  // version which always wrote 3. Correct derived data using the saved original.
  for (const upgrade of installedWeaponUpgrades(item)) {
    if (!["pistolAutosear", "shotgunAutoControl"].includes(weaponUpgradeFamily(upgrade))) continue;
    const original = normalizeCarrierRestore(addendaFlag(item, "carrierRestore")?.[upgrade.id])["system.fireModes.autoFire"];
    if (item.system.quality === "excellent" || Number(original) > 0) item.system.fireModes.autoFire = 4;
  }
  if (item._setDvTable) item._setDvTable = function (actor, table) {
    return setWeaponDvTable(this, actor, table);
  };
  const consume = item.bulletConsumption;
  if (consume) item.bulletConsumption = function (roll) {
    const base = consume.call(this, roll);
    if (isVictoria(this) && base === 10) return 20;
    if (hasShotgunAutoControl(this) && base === 10 &&
      /cpr-autofire-rollcard\.hbs$/.test(roll?.rollCard ?? "")) return 4;
    return base;
  };
  const attack = item._createAttackRoll;
  if (attack) item._createAttackRoll = function (type, actor, ...args) {
    if (isVictoria(this) && !["autofire", "suppressive"].includes(type)) {
      ui.notifications.warn(game.i18n.localize("CPRADDENDA.weapons.victoriaModes"));
      return null;
    }
    if (type === "aimed" && (weaponRule(this) === "deathwind" || isShotAttack(this))) {
      ui.notifications.warn(game.i18n.localize(weaponRule(this) === "deathwind"
        ? "CPRADDENDA.weapons.deathwindAimed" : "CPRADDENDA.weapons.shotAimed"));
      return null;
    }
    // 0.92.4 checks suppressiveFire even for an Autofire attack. An autosear
    // or shotgun control group may permit Autofire independently. Restore the
    // field in finally: the core method is synchronous and nothing is saved.
    const modes = this.system.fireModes;
    if (type === "autofire" && Number(modes?.autoFire) > 0 && !modes.suppressiveFire) {
      const suppressive = modes.suppressiveFire;
      modes.suppressiveFire = true;
      try { return attack.call(this, type, actor, ...args); }
      finally { modes.suppressiveFire = suppressive; }
    }
    return attack.call(this, type, actor, ...args);
  };
  const damage = item._createDamageRoll;
  if (damage) item._createDamageRoll = function (type, actor, ...args) {
    const rules = getAttackRules(this, type);
    if (!rules.shot) return damage.call(this, type, actor, ...args);
    // The original method retains the ammunition's special overrides and all
    // normal damage modifiers. The shell base is 3d6 and has no Autofire multiplier.
    const baseDamage = this.system.damage;
    this.system.damage = "3d6";
    try { return damage.call(this, rules.damageType, actor, ...args); }
    finally { this.system.damage = baseDamage; }
  };
}
