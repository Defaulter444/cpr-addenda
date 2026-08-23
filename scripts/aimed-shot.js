/**
 * Замена штрафа за прицельный выстрел.
 *
 * Система вшивает −8 прямо в конструктор прицельной атаки
 * (`CPRAimedAttackRoll`) и больше нигде его не спрашивает: ни настройки, ни
 * модификатора, ни поля у оружия. Поэтому «наводящая» модификация вроде
 * Суперсканера не может уменьшить этот штраф штатным способом — любой
 * модификатор она только добавит сверху, и вместо −4 выйдет −12.
 *
 * Здесь штраф именно заменяется: после того как система собрала бросок, мы
 * находим в нём строку штрафа и подменяем значение. Остальные модификаторы —
 * дальность, раны, бонусы роли — остаются нетронутыми.
 *
 * Что заменять, объявляет сама модификация во флаге `aimedShotPenalty`:
 *
 *   "flags": { "cpr-addenda": { "aimedShotPenalty": -4 } }
 *
 * Если наводящих модификаций на стволе несколько, берётся самая выгодная для
 * стрелка — то есть наименьший по модулю штраф.
 */

import { MODULE_ID, localize } from "./constants.js";

/** Флаг на модификации: во что превращается штраф прицеливания. */
export const AIMED_FLAG = "aimedShotPenalty";

/**
 * Источник, которым система подписывает свой штраф. Строка задана в коде
 * системы литералом и не переводится, поэтому по ней можно искать.
 */
const SYSTEM_SOURCE = "Aimed Shot Penalty";

/**
 * Ищет среди установленных модификаций самую выгодную замену штрафа.
 *
 * @param {Item} weapon - оружие, которым целятся
 * @returns {{value: Number, source: String}|null}
 */
function findAimedOverride(weapon) {
  const installed = weapon?.system?.installedUpgrades ?? [];
  let best = null;

  for (const upgrade of installed) {
    const value = upgrade.getFlag?.(MODULE_ID, AIMED_FLAG);
    if (typeof value !== "number") continue;
    // Штрафы отрицательные, выгоднее тот, что ближе к нулю.
    if (!best || value > best.value) {
      best = { value, source: upgrade.name };
    }
  }
  return best;
}

/**
 * Подменяет штраф прицеливания в уже собранном броске.
 *
 * @param {CPRRoll} roll - бросок, созданный системой
 * @param {Item} weapon - оружие, которым целятся
 */
function replaceAimedPenalty(roll, weapon) {
  if (!Array.isArray(roll?.mods)) return;

  const penalty = roll.mods.find((mod) => mod.source === SYSTEM_SOURCE);
  if (!penalty) return;

  const override = findAimedOverride(weapon);
  if (!override) return;

  // Если штраф системы и так мягче — не делаем стрелку хуже.
  if (penalty.value >= override.value) return;

  penalty.value = override.value;
  penalty.source = localize("aimed.replacedSource", {
    upgrade: override.source,
  });
}

/** Внутренности, открытые для автопроверки без запуска Foundry. */
export const __test = { replaceAimedPenalty, findAimedOverride };

/**
 * Вешает подмену на создание броска.
 *
 * `createRoll` — метод класса предмета, а не функция миксина, поэтому его
 * можно обернуть напрямую, без плясок вокруг `loadMixins`.
 */
export function registerAimedShotPatch() {
  libWrapper.register(
    MODULE_ID,
    "CONFIG.Item.documentClass.prototype.createRoll",
    function cprAddendaCreateRoll(wrapped, type, actor, extraData = []) {
      const roll = wrapped(type, actor, extraData);
      try {
        if (this.type === "weapon") replaceAimedPenalty(roll, this);
      } catch (err) {
        console.error(
          `${MODULE_ID} | Не удалось заменить штраф прицеливания у «${this?.name}»`,
          err
        );
      }
      return roll;
    },
    "WRAPPER"
  );
}
