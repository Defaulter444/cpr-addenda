/**
 * Поддержка составных формул броска.
 *
 * Формулы вида «15d6 + ceil(2d6/2)» — обычная запись в книге, но система с
 * ними не работает, и мешают этому две вещи сразу.
 *
 * Первая: разбор формулы рассчитан ровно на один член «XdY», о чём сказано в
 * комментарии к конструктору. Всё, что стоит рядом, она пытается превратить в
 * плоский модификатор через `Number()`, поэтому от составной формулы до броска
 * доходит только первый кубик, а остаток становится `NaN`.
 *
 * Вторая: собирая выпавшие грани для карточки, система лезет в `terms[0]` и
 * ждёт там кубик. Когда в формуле есть функция, разбор Foundry может положить
 * первым другой член — и всё падает на `results.map` с «Cannot read properties
 * of undefined».
 *
 * Поэтому для составных формул модуль берёт бросок на себя: отдаёт формулу
 * Foundry целиком (её математику он понимает прекрасно) и собирает грани со
 * всех кубиков, какие в ней нашлись. Простые формулы остаются за системой —
 * её разбор нужен, чтобы прибавки вроде «+2» были видны в карточке отдельной
 * строкой.
 */

import { MODULE_ID, SYSTEM_ID } from "./constants.js";

/** Составная формула — та, где есть вызов функции: ceil, floor, min и прочие. */
const COMPOUND = /[a-zа-я]+\s*\(/i;

/** Первый кубик формулы — по нему система подписывает тип кости. */
const FIRST_DIE = /d\d+/;

/**
 * Можно ли отдать формулу Foundry целиком, минуя разбор системы.
 *
 * @param {String} formula - формула броска
 * @returns {Boolean}
 */
export function isCompoundFormula(formula) {
  return COMPOUND.test(String(formula ?? ""));
}

/**
 * Собирает выпавшие грани со всех кубиков броска.
 *
 * Система смотрит только на первый член формулы; здесь берём каждый, у кого
 * есть результаты, — тогда в карточке видно все кости, включая те, что
 * попали внутрь функции.
 *
 * @param {Roll} roll - вычисленный бросок Foundry
 * @returns {Array<Number>}
 */
export function collectFaces(roll) {
  const faces = [];

  const walk = (terms) => {
    for (const term of terms ?? []) {
      if (Array.isArray(term?.results) && term.results.length) {
        faces.push(...term.results.map((r) => r.result));
      }
      // Кубики внутри функций и скобок лежат во вложенных бросках.
      if (Array.isArray(term?.terms)) walk(term.terms);
      if (Array.isArray(term?.rolls)) {
        for (const nested of term.rolls) walk(nested?.terms);
      }
    }
  };

  walk(roll?.terms);
  return faces;
}

/**
 * Учит систему не ломаться на составных формулах.
 *
 * @async
 */
export async function registerFormulaPatch() {
  let rolls;
  let diceHandler;
  try {
    rolls = await import(`/systems/${SYSTEM_ID}/modules/rolls/cpr-rolls.js`);
    const handlerModule = await import(
      `/systems/${SYSTEM_ID}/modules/extern/cpr-dice-handler.js`
    );
    diceHandler = handlerModule.default ?? handlerModule.DiceHandler;
  } catch (err) {
    console.warn(
      `${MODULE_ID} | Не удалось подключиться к броскам системы: составные формулы работать не будут.`,
      err
    );
    return;
  }

  const CPRRoll = rolls.CPRRoll ?? rolls.default;
  if (!CPRRoll?.prototype?._processFormula) return;

  // libWrapper работает с путями от globalThis, а классы системы наружу
  // не выставлены — публикуем ссылку под своим именем.
  globalThis.cprAddendaRollClass = CPRRoll;

  // 1. Не даём разбору искалечить формулу.
  libWrapper.register(
    MODULE_ID,
    "cprAddendaRollClass.prototype._processFormula",
    function cprAddendaProcessFormula(wrapped, formula) {
      if (!isCompoundFormula(formula)) return wrapped(formula);

      const die = String(formula).match(FIRST_DIE);
      this.die = die ? die[0] : null;
      return String(formula);
    },
    "MIXED"
  );

  // 2. Сам бросок для таких формул выполняем самостоятельно: системная
  //    сборка граней рассчитана на единственный кубик в начале формулы.
  libWrapper.register(
    MODULE_ID,
    "cprAddendaRollClass.prototype.roll",
    async function cprAddendaRoll(wrapped, ...args) {
      if (!isCompoundFormula(this.formula)) return wrapped(...args);

      this._roll = await new Roll(this.formula).evaluate();
      await diceHandler.handle3dDice(this._roll);

      this.initialRoll = this._roll.total;
      this.resultTotal = this.initialRoll + this.totalMods();
      this.faces = collectFaces(this._roll);

      // Критические события считаются по одной кости, а в составной формуле
      // их много: сама система в таких случаях тоже ничего не решает.
      this.criticalRoll = 0;

      this._computeResult();
      return this;
    },
    "MIXED"
  );

  console.log(`${MODULE_ID} | Составные формулы броска поддерживаются`);
}
