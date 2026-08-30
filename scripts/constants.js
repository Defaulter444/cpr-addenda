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
  /** Комплект имплантов корпуса ПКТ: {foundations: [...], carried: [...]}. */
  pktKit: "pktKit",
  /** Метка импланта из комплекта: {frame: <id корпуса>, slot: <номер места>}. */
  pktPart: "pktPart",
};

/**
 * Флаги листа транспорта.
 *
 * Вынесены отдельно от FLAGS: те висят только на предметах, а эти — на трёх
 * разных видах документов сразу (актёр-транспорт, предмет на нём, активный
 * эффект у пассажира), и путать их между собой не стоит.
 *
 * Имена намеренно длинные, с приставкой `vehicle`. Пространство флагов у
 * модуля одно на всё, и короткое `positions` в нём означало бы «позиции
 * чего угодно» — через полгода такой флаг не опознать.
 */
export const VEHICLE_FLAGS = {
  /** Актёр: массив постов экипажа. Основное хранилище листа. */
  positions: "vehiclePositions",
  /** Актёр: скорость, свободная строка в шапке листа. */
  speed: "vehicleSpeed",
  /** Актёр: отметка времени последней сверки прав доступа. */
  synced: "vehicleSynced",
  /** Предмет-оружие: id поста, на который оно наведено. */
  mountedPosition: "vehicleMountedPosition",
  /** Предмет-модификация: стоит на транспорте, а не лежит в грузе. */
  mounted: "vehicleMounted",
  /** Предмет-кибернетика: вживлён в транспорт, а не лежит в грузе. */
  installed: "vehicleInstalled",
  /** Эффект у пассажира: id актёра-транспорта, который его выдал. */
  managedBy: "vehicleManagedBy",
  /** Эффект у пассажира: id поста, за который он выдан. */
  positionId: "vehiclePositionId",
  /** Эффект на самом транспорте: id поста, от пилота которого взят СКО. */
  occupantMovePos: "vehicleOccupantMovePos",
};

/** Идентификатор модуля, из которого перенесён лист транспорта. */
export const VAS_MODULE_ID = "mmutons-cyberpunk-red-vas";

export const SETTINGS = {
  /** Применять ли ограничения по типам оружия. */
  enforceWeaponTypes: "enforceWeaponTypes",
  /** Разрешать ли апгрейдам иметь эффекты с режимом «пока установлен». */
  installedUsage: "installedUsage",
  /** Показывать ли на листе модификации блок с типами оружия. */
  showSheetControls: "showSheetControls",
  /** Заменять ли штраф за прицельный выстрел наводящими модификациями. */
  aimedShotPatch: "aimedShotPatch",
  /** Не понижать права доступа, которые мастер выставил вручную. */
  keepGmPermissions: "keepGmPermissions",
  /** Версия выполненного переноса данных из отдельного модуля VAS. */
  vehicleMigration: "vehicleMigration",
  /** Класть ли книгу правил в мир, чтобы работали ссылки на её страницы. */
  importCorebook: "importCorebook",
  /** Ставить ли зону поражения при выстреле из взрывающегося оружия. */
  explosiveTemplates: "explosiveTemplates",
  /** Править ли на лету расхождения в данных самой системы. */
  systemFixes: "systemFixes",
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

/**
 * Приведение строки к виду, пригодному для сравнения.
 *
 * Убирает регистр и краевые пробелы, но главное — приводит юникод к форме NFC.
 * Русское «й» бывает записано и одним символом, и как «и» с комбинирующей
 * краткой: визуально одинаковые строки без нормализации не равны. Названия
 * навыков и характеристик мастер пишет руками, а приходят они из трёх разных
 * источников — книги, компендиума и файла переводов, — так что расхождение
 * встречается на практике.
 *
 * @param {String} value - произвольная строка
 * @returns {String}
 */
export function normalize(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
}
