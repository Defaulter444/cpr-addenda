/**
 * Поддержка составных формул броска.
 *
 * Разбор формул в системе рассчитан ровно на один член вида «XdY» — это
 * записано прямо в комментарии к её конструктору. Всё, что стоит рядом, она
 * пытается превратить в плоские модификаторы через `Number()`, поэтому запись
 * из книги вида «15d6 + [2d6/2 округлить вверх]» разваливается: до броска
 * доходит только `2d6`, а остаток становится `NaN`. У корпусов ПКТ это
 * заканчивалось ошибкой «humanity: value must be an integer» — потеря
 * человечности считалась нечислом, и имплант не вставал.
 *
 * При этом сам Foundry такие формулы считает прекрасно: `ceil()` — его штатная
 * функция. Ломается именно предварительный разбор.
 *
 * Поэтому здесь для составных формул разбор пропускается: формула уходит в
 * Foundry целиком, как есть. Простые формулы обрабатывает сама система —
 * её логика с превращением «+2» в модификатор броска нужна, чтобы прибавки
 * были видны в карточке отдельной строкой.
 *
 * Требование к записи одно: кубик должен стоять первым слагаемым
 * («15d6 + ceil(2d6/2)», а не наоборот). Система берёт первый член формулы,
 * чтобы показать выпавшие грани, и если там окажется функция, показывать
 * будет нечего.
 */

import { MODULE_ID, SYSTEM_ID } from "./constants.js";

/** Составная формула — та, где есть вызов функции: ceil, floor, min и прочие. */
const COMPOUND = /[a-zа-я]+\s*\(/i;

/** Первый кубик формулы — по нему система подписывает тип кости. */
const FIRST_DIE = /d\d+/;

/**
 * Проверяет, что формулу можно отдать Foundry целиком.
 *
 * @param {String} formula - формула броска
 * @returns {Boolean}
 */
export function isCompoundFormula(formula) {
  return COMPOUND.test(String(formula ?? ""));
}

/**
 * Учит систему не ломать составные формулы.
 *
 * @async
 */
export async function registerFormulaPatch() {
  let rolls;
  try {
    rolls = await import(`/systems/${SYSTEM_ID}/modules/rolls/cpr-rolls.js`);
  } catch (err) {
    console.warn(
      `${MODULE_ID} | Не удалось подключиться к броскам системы: составные формулы работать не будут.`,
      err
    );
    return;
  }

  const CPRRoll = rolls.CPRRoll ?? rolls.default;
  if (!CPRRoll?.prototype?._processFormula) return;

  // libWrapper работает с путями от globalThis, а класс системы наружу
  // не выставлен — публикуем ссылку на него под своим именем.
  globalThis.cprAddendaRollClass = CPRRoll;

  libWrapper.register(
    MODULE_ID,
    "cprAddendaRollClass.prototype._processFormula",
    function cprAddendaProcessFormula(wrapped, formula) {
      if (!isCompoundFormula(formula)) return wrapped(formula);

      // Тип кости система выставляет сама внутри разбора; раз мы его
      // пропускаем, проставляем здесь — иначе карточка броска останется
      // без подписи.
      const die = String(formula).match(FIRST_DIE);
      this.die = die ? die[0] : null;

      return String(formula);
    },
    "MIXED"
  );

  console.log(`${MODULE_ID} | Составные формулы броска поддерживаются`);
}
