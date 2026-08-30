/**
 * Мост к конфигурации системы.
 *
 * Система Cyberpunk RED держит справочники (типы оружия, категории цен и прочее)
 * в модуле `system/config.js` и наружу их не отдаёт: ни `CONFIG.CPR`, ни
 * `game.cpr.config` не существует. Поэтому справочник берём импортом напрямую,
 * а если система когда-нибудь переедет — падаем на встроенную копию, чтобы
 * модуль не рассыпался целиком из-за одного списка.
 */

import { SYSTEM_ID } from "./constants.js";

/**
 * Запасная копия ключей типов оружия. Это ключи правил, а не тексты, — они
 * стабильны между версиями системы. Значения — ключи локализации системы.
 */
const FALLBACK_WEAPON_TYPES = {
  assaultRifle: "CPR.global.weaponType.assaultRifle",
  bow: "CPR.global.weaponType.bowsAndCrossbows",
  grenadeLauncher: "CPR.global.weaponType.grenadeLauncher",
  heavyMelee: "CPR.global.weaponType.heavyMeleeWeapon",
  heavyPistol: "CPR.global.weaponType.heavyPistol",
  heavySmg: "CPR.global.weaponType.heavySmg",
  lightMelee: "CPR.global.weaponType.lightMeleeWeapon",
  martialArts: "CPR.global.weaponType.martialArts",
  medMelee: "CPR.global.weaponType.mediumMeleeWeapon",
  medPistol: "CPR.global.weaponType.mediumPistol",
  rocketLauncher: "CPR.global.weaponType.rocketLauncher",
  shotgun: "CPR.global.weaponType.shotgun",
  smg: "CPR.global.weaponType.smg",
  sniperRifle: "CPR.global.weaponType.sniperRifle",
  thrownWeapon: "CPR.global.weaponType.thrownWeapon",
  unarmed: "CPR.global.weaponType.unarmed",
  vHeavyMelee: "CPR.global.weaponType.veryHeavyMeleeWeapon",
  vHeavyPistol: "CPR.global.weaponType.veryHeavyPistol",
};

let systemConfig = null;

/**
 * Подтягивает конфиг системы один раз за сессию.
 *
 * @async
 * @returns {Object|null}
 */
export async function loadSystemConfig() {
  if (systemConfig) return systemConfig;
  try {
    const mod = await import(
      `/systems/${SYSTEM_ID}/modules/system/config.js`
    );
    systemConfig = mod.default ?? mod.CPR ?? null;
  } catch (err) {
    console.warn(
      "cpr-addenda | Не удалось прочитать config.js системы, используется встроенный справочник.",
      err
    );
    systemConfig = null;
  }
  return systemConfig;
}

/**
 * Справочник типов оружия: ключ правила -> ключ локализации.
 *
 * @returns {Object<String, String>}
 */
export function getWeaponTypes() {
  return systemConfig?.weaponTypes ?? FALLBACK_WEAPON_TYPES;
}

/**
 * Читаемое название типа оружия на языке интерфейса.
 *
 * @param {String} key - ключ типа, например "sniperRifle"
 * @returns {String}
 */
export function weaponTypeLabel(key) {
  if (!key) return "—";
  const dict = getWeaponTypes();
  return game.i18n.localize(dict[key] ?? key);
}

/**
 * Запасной справочник типов предметов: ключ типа -> ключ локализации.
 * Совпадает с `CPR.objectTypes` системы; нужен на случай, если импорт конфига
 * не удался.
 */
const FALLBACK_OBJECT_TYPES = {
  ammo: "CPR.global.itemTypes.ammo",
  armor: "CPR.global.itemTypes.armor",
  clothing: "CPR.global.itemTypes.clothing",
  criticalInjury: "CPR.global.itemTypes.criticalInjury",
  cyberdeck: "CPR.global.itemTypes.cyberdeck",
  cyberware: "CPR.global.itemTypes.cyberware",
  drug: "CPR.global.itemTypes.drug",
  gear: "CPR.global.itemTypes.gear",
  itemUpgrade: "CPR.global.itemTypes.itemUpgrade",
  netarch: "CPR.global.itemTypes.netArchitecture",
  program: "CPR.global.itemTypes.program",
  role: "CPR.global.itemTypes.role",
  skill: "CPR.global.itemTypes.skill",
  vehicle: "CPR.global.itemTypes.vehicle",
  weapon: "CPR.global.itemTypes.weapon",
};

/**
 * Читаемое название типа предмета на языке интерфейса.
 *
 * Нужно там, где предметы группируются по типу: у типа есть только внутренний
 * ключ (`itemUpgrade`), а игроку надо показать «Улучшения». Неизвестный тип
 * возвращаем как есть — лучше английское слово, чем пустая графа.
 *
 * @param {String} type - тип предмета, например "cyberware"
 * @returns {String}
 */
export function objectTypeLabel(type) {
  if (!type) return "—";
  const dict = systemConfig?.objectTypes ?? FALLBACK_OBJECT_TYPES;
  const key = dict[type];
  return key ? game.i18n.localize(key) : type;
}
