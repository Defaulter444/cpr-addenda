/**
 * Общие константы модуля.
 */

export const MODULE_ID = "cpr-addenda";
export const SYSTEM_ID = "cyberpunk-red-core";

/**
 * Имена флагов, которые модуль вешает на предметы.
 *
 * Все флаги живут в `item.flags["cpr-addenda"]`. Флаг, которого нет, означает
 * «ограничения нет» — поэтому модуль никогда не меняет поведение чужих предметов,
 * пока их явно не разметили.
 */
export const FLAGS = {
  /** Массив ключей CPR.weaponTypes, в оружие которых модификацию ставить МОЖНО. */
  allowedWeaponTypes: "allowedWeaponTypes",
  /** Массив ключей CPR.weaponTypes, в оружие которых модификацию ставить НЕЛЬЗЯ. */
  deniedWeaponTypes: "deniedWeaponTypes",
  /** Строка-источник: книга и страница, откуда взята позиция. */
  source: "source",
};

export const SETTINGS = {
  /** Применять ли ограничения по типам оружия. */
  enforceWeaponTypes: "enforceWeaponTypes",
  /** Разрешать ли апгрейдам иметь эффекты с режимом «пока установлен». */
  installedUsage: "installedUsage",
  /** Показывать ли на листе модификации блок с типами оружия. */
  showSheetControls: "showSheetControls",
  /** Заменять ли штраф за прицельный выстрел наводящими модификациями. */
  aimedShotPatch: "aimedShotPatch",
};

/**
 * Помощник: короткая запись для получения флага модуля.
 *
 * @param {Document} doc - документ Foundry
 * @param {String} flag - ключ из FLAGS
 * @returns {*} значение флага или undefined
 */
export function getFlag(doc, flag) {
  return doc?.getFlag?.(MODULE_ID, flag);
}

/**
 * Помощник: локализация с префиксом модуля.
 *
 * @param {String} key - ключ без префикса, например "notify.wrongWeaponType"
 * @param {Object} data - данные для подстановки
 * @returns {String}
 */
export function localize(key, data = null) {
  const full = `CPRADDENDA.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}
