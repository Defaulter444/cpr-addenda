/**
 * Проверка разбора составных формул броска.
 *
 * Здесь воспроизведён разбор формулы системы — ровно тот код, из-за которого
 * установка корпуса ПКТ падала с «humanity: value must be an integer». На нём
 * видно, что происходит без патча, и что меняется с ним.
 *
 * Foundry для этого не нужен: проверяется решение о том, разбирать формулу или
 * отдать целиком, а сам бросок считает уже Foundry, который функции понимает.
 *
 *   node tools/selftest-formula.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, "..", "scripts");
const SOURCES = path.join(HERE, "..", "sources", "addenda-cyberware");

// --- Разбор формулы, как он устроен в системе -------------------------------
// Скопирован с cpr-rolls.js (_processFormula), чтобы проверять на нём, а не
// на предположениях о его поведении.

function systemProcessFormula(formula, mods) {
  if (!Number.isNaN(+formula)) return formula;

  const dice = /[0-9][0-9]*d[0-9][0-9]*/;
  const die = /d[0-9][0-9]*/;

  let rollMods = formula.replace(dice, "");
  if (rollMods !== "") {
    rollMods = rollMods.replace("+", " +");
    rollMods = rollMods.replace("-", " -");
    for (const mod of rollMods.split(" ")) {
      if (mod !== "") mods.push(Number(mod));
    }
  }
  const dieMatch = formula.match(die);
  const diceMatch = formula.match(dice);
  return {
    formula: diceMatch ? diceMatch[0] : null,
    die: dieMatch ? dieMatch[0] : null,
  };
}

const { isCompoundFormula, collectFaces } = await import(
  pathToFileURL(path.join(prepare(), "roll-formula.mjs")).href
);

function prepare() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-formula-"));
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.endsWith(".js")) continue;
    const body = fs
      .readFileSync(path.join(SCRIPTS, file), "utf-8")
      .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
  }
  return tmp;
}

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`  ПРОВАЛ  ${message}`);
  }
}

// --- 1. Что делает система без патча ----------------------------------------

{
  const mods = [];
  systemProcessFormula("ceil(2d6/2) + 15d6", mods);
  expect(
    mods.some((m) => Number.isNaN(m)),
    "разбор системы неожиданно справился с составной формулой — патч может быть не нужен"
  );

  const simpleMods = [];
  const simple = systemProcessFormula("10d6+4", simpleMods);
  expect(simple.formula === "10d6", `простая формула разобрана неверно: ${simple.formula}`);
  expect(
    simpleMods.length === 1 && simpleMods[0] === 4,
    `модификатор простой формулы потерян: ${JSON.stringify(simpleMods)}`
  );
}

// --- 2. Что решает патч -----------------------------------------------------

{
  expect(isCompoundFormula("15d6 + ceil(2d6/2)"), "составная формула не распознана");
  expect(isCompoundFormula("ceil(1d6/2)"), "одиночная функция не распознана");
  expect(!isCompoundFormula("10d6"), "простой бросок принят за составной");
  expect(!isCompoundFormula("10d6+4"), "бросок с прибавкой принят за составной");
  expect(!isCompoundFormula("4d6-2"), "бросок с вычетом принят за составной");
}

// --- 3. Сбор выпавших граней ------------------------------------------------
// Система смотрит только на первый член формулы и падает, если там оказалась
// функция. Наш сбор обходит бросок целиком, включая кубики внутри функций.

{
  // Так Foundry раскладывает «15d6 + ceil(2d6/2)»: кубик, оператор, функция
  // с вложенным броском.
  const rollLike = {
    terms: [
      { results: [{ result: 4 }, { result: 6 }] },
      {},
      { rolls: [{ terms: [{ results: [{ result: 3 }] }] }] },
    ],
  };
  const faces = collectFaces(rollLike);
  expect(
    JSON.stringify(faces) === JSON.stringify([4, 6, 3]),
    `грани собраны неверно: ${JSON.stringify(faces)}`
  );

  // Случай, на котором падала система: первым идёт функция без результатов.
  const functionFirst = {
    terms: [{ formula: "ceil(2d6/2)" }, {}, { results: [{ result: 5 }] }],
  };
  expect(
    JSON.stringify(collectFaces(functionFirst)) === JSON.stringify([5]),
    "сбор граней спотыкается о функцию в начале формулы"
  );

  expect(collectFaces(undefined).length === 0, "пустой бросок должен давать пустой список граней");
}

// --- 4. Формулы предметов модуля --------------------------------------------

{
  let compound = 0;
  let plain = 0;
  for (const file of fs.readdirSync(SOURCES)) {
    if (!file.endsWith(".json")) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(SOURCES, file), "utf-8"));
    const formula = doc.system?.humanityLoss?.roll ?? "";

    if (isCompoundFormula(formula)) {
      compound += 1;
      // Кубик обязан идти первым: по нему система показывает выпавшие грани.
      expect(
        /^\d+d\d+/.test(formula),
        `«${doc.name}»: формула «${formula}» начинается не с кубика`
      );
    } else {
      plain += 1;
      const mods = [];
      const parsed = systemProcessFormula(formula.toLowerCase(), mods);
      expect(
        parsed.formula !== null && !mods.some((m) => Number.isNaN(m)),
        `«${doc.name}»: простая формула «${formula}» ломает разбор системы`
      );
    }
  }
  console.log(`Формул: составных ${compound}, простых ${plain}`);
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
