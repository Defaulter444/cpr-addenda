/**
 * Поиск навыка по названию, написанному руками.
 *
 * У поста транспорта есть строка навыков: мастер пишет туда «Вождение», и на
 * листе появляется кнопка броска. Бросок при этом делает не транспорт, а тот,
 * кто сидит на посту, — значит, по названию надо найти предмет-навык на чужом
 * листе. И вот тут русская локализация всё усложняет.
 *
 * Названия навыков приезжают к персонажу двумя разными путями. Системные
 * навыки создаются с английскими именами, а на экране переводятся ключом
 * `CPR.global.itemType.skill.<навык>`. Навыки же, затянутые из компендиума при
 * включённом Babele, приходят уже с русскими именами — перевод въелся в сам
 * предмет. На одном и том же листе спокойно лежат и «Evasion», и «Уклонение».
 *
 * Поэтому сравниваем не строки, а множества написаний. Для каждого навыка
 * собираем всё, чем он может называться: собственное имя предмета, перевод на
 * текущий язык и английский оригинал из запасного словаря Foundry. Мастер
 * попадает в кнопку, как бы он ни написал — и его запись не сломается, если
 * язык мира потом переключат.
 */

import { normalize } from "./constants.js";

/** Префикс ключей локализации, под которыми система держит названия навыков. */
const SKILL_PREFIX = "CPR.global.itemType.skill.";

/**
 * Имя предмета в тот вид, в каком система хранит ключ навыка.
 *
 * «Air Vehicle Tech» → «airVehicleTech». Для русского имени вернёт бессмыслицу,
 * и это нормально: такого ключа просто не найдётся, а имя сравнится напрямую.
 *
 * @param {String} name - имя предмета-навыка
 * @returns {String}
 */
function toCamel(name) {
  return String(name ?? "")
    .split(" ")
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join("");
}

/**
 * Словарь навыков системы: ключ → перевод на текущий язык.
 *
 * Берётся из живого словаря Foundry, потому что перевод может прийти от какого
 * угодно модуля русификации, а не только от системы.
 *
 * @returns {Object<String, String>}
 */
function currentSkillLabels() {
  return foundry.utils.getProperty(game.i18n.translations, SKILL_PREFIX.slice(0, -1)) ?? {};
}

/**
 * Тот же словарь, но по-английски.
 *
 * Foundry держит английские строки отдельно, чтобы подставлять их вместо
 * недостающих переводов. Под английским языком мира этот словарь пуст — там
 * английские названия и так лежат в основном.
 *
 * @returns {Object<String, String>}
 */
function fallbackSkillLabels() {
  return foundry.utils.getProperty(game.i18n._fallback ?? {}, SKILL_PREFIX.slice(0, -1)) ?? {};
}

/**
 * Все написания навыка по его системному ключу.
 *
 * @param {String} camelKey - ключ навыка, например "driveLandVehicle"
 * @returns {Set<String>} - нормализованные написания
 */
function spellingsOfKey(camelKey) {
  const spellings = new Set();
  if (!camelKey) return spellings;
  spellings.add(normalize(camelKey));

  const current = currentSkillLabels()[camelKey];
  if (typeof current === "string") spellings.add(normalize(current));

  const fallback = fallbackSkillLabels()[camelKey];
  if (typeof fallback === "string") spellings.add(normalize(fallback));

  return spellings;
}

/**
 * Системный ключ навыка по любому его написанию.
 *
 * Нужен для обратного хода: имя предмета уже переведено Babele, а мастер
 * написал английское название. Ключ находим по русскому имени предмета, а
 * дальше через него добираемся до английского написания.
 *
 * @param {String} label - написание навыка
 * @returns {String|null} - ключ навыка или null
 */
function keyByLabel(label) {
  const wanted = normalize(label);
  if (!wanted) return null;

  for (const dict of [currentSkillLabels(), fallbackSkillLabels()]) {
    for (const [key, value] of Object.entries(dict)) {
      // В словаре рядом с названиями лежат подсказки с тем же ключом плюс
      // «ToolTip» — сравнивать с ними нечего.
      if (key.endsWith("ToolTip")) continue;
      if (typeof value === "string" && normalize(value) === wanted) return key;
    }
  }
  return null;
}

/**
 * Все написания, под которыми может быть известен данный предмет-навык.
 *
 * @param {CPRItem} item - предмет типа "skill"
 * @returns {Set<String>}
 */
export function skillSpellings(item) {
  const spellings = new Set([normalize(item.name)]);

  // Прямой ход: имя английское, ключ выводится из него.
  for (const spelling of spellingsOfKey(toCamel(item.name))) {
    spellings.add(spelling);
  }
  // Обратный ход: имя уже переведено, ключ ищем по самому имени.
  for (const spelling of spellingsOfKey(keyByLabel(item.name))) {
    spellings.add(spelling);
  }

  return spellings;
}

/**
 * Ищет навык на листе персонажа по названию из настроек поста.
 *
 * @param {CPRActor} actor - тот, кто сидит на посту
 * @param {String} title - название навыка, как его написал мастер
 * @returns {CPRItem|undefined}
 */
export function findSkill(actor, title) {
  const wanted = normalize(title);
  if (!wanted) return undefined;
  return actor.items.find(
    (item) => item.type === "skill" && skillSpellings(item).has(wanted)
  );
}

/**
 * Названия навыков персонажа на языке интерфейса — для подсказки в сообщении
 * об ошибке. Мастер видит, что именно можно написать, и не гадает.
 *
 * @param {CPRActor} actor - владелец навыков
 * @param {Number} limit - сколько названий показывать
 * @returns {String}
 */
export function skillNamesHint(actor, limit = 12) {
  const names = actor.items
    .filter((item) => item.type === "skill" && (item.system?.level ?? 0) > 0)
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown}…` : shown;
}
