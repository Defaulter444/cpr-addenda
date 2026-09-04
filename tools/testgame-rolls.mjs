/**
 * Тестовая партия: настоящие броски системы с модулем и без него.
 *
 * Модуль оборачивает `CPRRoll.prototype.roll` и `_processFormula`, а через них
 * идёт ВСЁ: навыки, характеристики, ролевые способности, атаки, урон,
 * спасброски от смерти. Ошибка в обёртке ломает не одну кнопку, а всю игру, и
 * заметить это по коду трудно — надо бросать.
 *
 * Поэтому здесь берутся НАСТОЯЩИЕ классы бросков системы
 * (`systems/cyberpunk-red-core/modules/rolls/cpr-rolls.js`) и прогоняются
 * дважды: без модуля и с ним. Кости при этом одинаковые — генератор
 * детерминированный и переставляется в исходное состояние перед каждым
 * прогоном. Значит, любое расхождение между прогонами — работа модуля, а не
 * случайность.
 *
 * Такой замер не зависит от того, насколько точно здешний `Roll` повторяет
 * настоящий: обе стороны сравнения пользуются одним и тем же. От `Roll` нужна
 * только та поверхность, которую трогают система и модуль:
 * `evaluate()`, `total`, `terms[].formula/total/results`, вложенные `rolls`.
 *
 *   node tools/testgame-rolls.mjs
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const SCRIPTS = path.join(MODULE_ROOT, "scripts");
const DATA_ROOT = path.resolve(MODULE_ROOT, "..", "..");
const SYSTEM = path.join(DATA_ROOT, "systems", "cyberpunk-red-core");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

/* ------------------------------------------------------------------ */
/*  Кости                                                              */
/* ------------------------------------------------------------------ */

/**
 * Детерминированный генератор: одна и та же последовательность в обоих
 * прогонах, иначе сравнивать было бы нечего.
 */
let seed = 0;
function reseed() {
  seed = 0x2f6e2b1;
}
function next() {
  // xorshift32 — короткий и повторяемый.
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x100000000;
}
function rollDie(faces) {
  return Math.floor(next() * faces) + 1;
}

/* ------------------------------------------------------------------ */
/*  Разбор формулы                                                     */
/* ------------------------------------------------------------------ */

const FUNCTIONS = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
};

function tokenize(formula) {
  const tokens = [];
  const source = String(formula).replace(/\s+/g, "");
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    let match = rest.match(/^(\d*)d(\d+)/i);
    if (match) {
      tokens.push({ kind: "die", number: Number(match[1] || 1), faces: Number(match[2]), text: match[0] });
      i += match[0].length;
      continue;
    }
    match = rest.match(/^\d+(?:\.\d+)?/);
    if (match) {
      tokens.push({ kind: "number", value: Number(match[0]), text: match[0] });
      i += match[0].length;
      continue;
    }
    match = rest.match(/^[a-zA-Z]+/);
    if (match) {
      tokens.push({ kind: "name", value: match[0], text: match[0] });
      i += match[0].length;
      continue;
    }
    tokens.push({ kind: "symbol", value: source[i], text: source[i] });
    i += 1;
  }
  return tokens;
}

/** Разбор в дерево: сложение, умножение, скобки, вызовы функций. */
function parse(tokens) {
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];

  function primary() {
    const token = take();
    if (!token) throw new Error("формула оборвалась");
    if (token.kind === "die") return { type: "die", number: token.number, faces: token.faces, text: token.text };
    if (token.kind === "number") return { type: "number", value: token.value, text: token.text };
    if (token.kind === "name") {
      if (peek()?.value !== "(") throw new Error(`неизвестное имя ${token.value}`);
      take();
      const args = [additive()];
      while (peek()?.value === ",") {
        take();
        args.push(additive());
      }
      if (peek()?.value !== ")") throw new Error("не закрыта скобка функции");
      take();
      return { type: "call", name: token.value, args };
    }
    if (token.value === "(") {
      const inner = additive();
      if (peek()?.value !== ")") throw new Error("не закрыта скобка");
      take();
      return { type: "group", inner };
    }
    if (token.value === "-") return { type: "negate", inner: primary() };
    throw new Error(`неожиданный символ ${token.text}`);
  }

  function multiplicative() {
    let left = primary();
    while (peek()?.value === "*" || peek()?.value === "/") {
      const operator = take().value;
      left = { type: "binary", operator, left, right: primary() };
    }
    return left;
  }

  function additive() {
    let left = multiplicative();
    while (peek()?.value === "+" || peek()?.value === "-") {
      const operator = take().value;
      left = { type: "binary", operator, left, right: multiplicative() };
    }
    return left;
  }

  const tree = additive();
  if (at !== tokens.length) throw new Error("формула разобрана не до конца");
  return tree;
}

/* ------------------------------------------------------------------ */
/*  Roll — та часть, которой пользуются система и модуль                */
/* ------------------------------------------------------------------ */

class Die {
  constructor(number, faces, text) {
    this.number = number;
    this.faces = faces;
    this.formula = text;
    this.results = [];
    for (let i = 0; i < number; i += 1) {
      this.results.push({ result: rollDie(faces), active: true });
    }
    this.total = this.results.reduce((sum, r) => sum + r.result, 0);
  }
}

class NumericTerm {
  constructor(value, text) {
    this.number = value;
    this.total = value;
    this.formula = text ?? String(value);
  }
}

class OperatorTerm {
  constructor(operator) {
    this.operator = operator;
    this.formula = operator;
    this.total = undefined;
  }
}

/**
 * Вызов функции. Foundry кладёт кубики аргументов во вложенные броски, и
 * модуль ищет их именно там — повторяем это устройство.
 */
class FunctionTerm {
  constructor(name, rolls, total, formula) {
    this.fn = name;
    this.rolls = rolls;
    this.total = total;
    this.formula = formula;
    this.terms = [];
  }
}

class Roll {
  constructor(formula) {
    this.formula = String(formula);
    this._evaluated = false;
    this.terms = [];
    this.total = undefined;
  }

  async evaluate() {
    const tree = parse(tokenize(this.formula));
    const built = build(tree);
    this.terms = built.terms;
    this.total = built.value;
    this.result = String(built.value);
    this._evaluated = true;
    return this;
  }
}

/** Считает дерево и попутно собирает члены верхнего уровня, как это делает Foundry. */
function build(node) {
  if (node.type === "binary") {
    const left = build(node.left);
    const right = build(node.right);
    const value =
      node.operator === "+" ? left.value + right.value
        : node.operator === "-" ? left.value - right.value
          : node.operator === "*" ? left.value * right.value
            : left.value / right.value;
    return {
      value,
      terms: [...left.terms, new OperatorTerm(node.operator), ...right.terms],
    };
  }
  if (node.type === "die") {
    const die = new Die(node.number, node.faces, node.text);
    return { value: die.total, terms: [die] };
  }
  if (node.type === "number") {
    return { value: node.value, terms: [new NumericTerm(node.value, node.text)] };
  }
  if (node.type === "negate") {
    const inner = build(node.inner);
    return { value: -inner.value, terms: [new OperatorTerm("-"), ...inner.terms] };
  }
  if (node.type === "group") {
    const inner = build(node.inner);
    // Скобка у Foundry — тоже вложенный бросок.
    const nested = new Roll("(...)");
    nested.terms = inner.terms;
    nested.total = inner.value;
    const term = new FunctionTerm("", [nested], inner.value, "(...)");
    return { value: inner.value, terms: [term] };
  }
  if (node.type === "call") {
    const fn = FUNCTIONS[node.name];
    if (!fn) throw new Error(`нет функции ${node.name}`);
    const rolls = [];
    const values = [];
    for (const argument of node.args) {
      const built = build(argument);
      const nested = new Roll("arg");
      nested.terms = built.terms;
      nested.total = built.value;
      rolls.push(nested);
      values.push(built.value);
    }
    const value = fn(...values);
    return { value, terms: [new FunctionTerm(node.name, rolls, value, `${node.name}(...)`)] };
  }
  throw new Error(`неизвестный узел ${node.type}`);
}

/* ------------------------------------------------------------------ */
/*  Заглушки Foundry и системы                                         */
/* ------------------------------------------------------------------ */

function stubGlobals() {
  globalThis.Roll = Roll;
  globalThis.game = {
    system: { id: "cyberpunk-red-core" },
    settings: { get: () => false },
    i18n: { localize: (k) => k, format: (k) => k },
    user: { isGM: true, targets: new Set() },
    users: { get: () => null },
    modules: { get: () => ({ active: true, api: {} }) },
  };
  globalThis.CONFIG = { Item: { documentClass: class {} } };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.Hooks = { on() {}, once() {}, callAll() {} };
  globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }) } };
}

/** Копия системного модуля бросков с подменёнными зависимостями. */
function prepareSystemRolls() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-testgame-"));
  fs.mkdirSync(path.join(tmp, "rolls"));
  fs.mkdirSync(path.join(tmp, "utils"));
  fs.mkdirSync(path.join(tmp, "extern"));
  fs.mkdirSync(path.join(tmp, "dialog"));

  fs.copyFileSync(
    path.join(SYSTEM, "modules", "rolls", "cpr-rolls.js"),
    path.join(tmp, "rolls", "cpr-rolls.js")
  );

  fs.writeFileSync(
    path.join(tmp, "utils", "cpr-logger.js"),
    "export default { log(){}, debug(){}, warn(){}, error(){}, trace(){} };"
  );
  fs.writeFileSync(
    path.join(tmp, "extern", "cpr-dice-handler.js"),
    "export default { async handle3dDice(){} };"
  );
  fs.writeFileSync(
    path.join(tmp, "utils", "cpr-systemUtils.js"),
    `export default {
       Localize: (k) => k,
       slugify: (s) => String(s).toLowerCase().replace(/\\s+/g, "-"),
       DisplayMessage(){},
       GetEventDatum(){ return undefined; },
       getUserTargetedOrSelected(){ return []; },
       GetCoreSetting(){ return false; },
     };`
  );
  fs.writeFileSync(
    path.join(tmp, "dialog", "cpr-roll-dialog.js"),
    "export async function ShowDialog(){ return null; }\nexport default { ShowDialog };"
  );

  return path.join(tmp, "rolls", "cpr-rolls.js");
}

/** Копия скриптов модуля с расширением .mjs — они ссылаются друг на друга как .js. */
function prepareModule() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-testgame-mod-"));
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.endsWith(".js")) continue;
    const body = fs
      .readFileSync(path.join(SCRIPTS, file), "utf-8")
      .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
  }
  return tmp;
}

/** Маленький libWrapper: только то, чем пользуется модуль. */
function stubLibWrapper() {
  const registered = [];
  globalThis.libWrapper = {
    register(moduleId, target, handler, type) {
      const parts = target.split(".");
      const name = parts.pop();
      let holder = globalThis;
      for (const part of parts) holder = holder[part];
      const original = holder[name];
      holder[name] = function wrapper(...args) {
        return handler.call(this, original.bind(this), ...args);
      };
      registered.push({ holder, name, original, type });
    },
    unregisterAll() {
      for (const entry of registered.reverse()) entry.holder[entry.name] = entry.original;
      registered.length = 0;
    },
  };
  return () => globalThis.libWrapper.unregisterAll();
}

/* ------------------------------------------------------------------ */
/*  Партия                                                             */
/* ------------------------------------------------------------------ */

/**
 * Броски, какие бывают за столом.
 *
 * Каждый — отложенная сборка, а не готовый объект: без модуля составная формула
 * валит САМ КОНСТРУКТОР, и общий список не дожил бы до партии. А так падение
 * одного броска остаётся падением одного броска.
 *
 * Сигнатуры взяты из `cpr-rolls.js` дословно. Перепутанный порядок аргументов
 * здесь не «мелочь в тесте», а способ проверить не то, что играют за столом.
 */
function buildRolls(rolls) {
  const {
    CPRStatRoll, CPRSkillRoll, CPRRoleRoll, CPRAttackRoll,
    CPRAimedAttackRoll, CPRAutofireRoll, CPRSuppressiveFireRoll,
    CPRDamageRoll, CPRDeathSaveRoll, CPRHumanityLossRoll,
    CPRFacedownRoll, CPRInitiative, CPRProgramStatRoll,
  } = rolls;

  const made = [];
  /** mods — как их принимает система: массив объектов со value и source. */
  const add = (name, build, mods = []) => {
    made.push({
      name,
      build: () => {
        const roll = build();
        if (mods.length) {
          roll.addMod(mods.map((value, i) => ({ value, source: `проверка ${i + 1}` })));
        }
        return roll;
      },
    });
  };

  // Характеристики — все девять.
  for (const [stat, value] of [
    ["Внимательность", 6], ["ТЕЛО", 8], ["РЕФ", 7], ["ЛОВКОСТЬ", 5],
    ["ТЕХ", 4], ["РАЗУМ", 6], ["КРУТ", 7], ["ЭМП", 5], ["УДАЧА", 3],
  ]) {
    add(`характеристика ${stat}`, () => new CPRStatRoll(stat, value));
  }

  // Навыки: разные основы, разные уровни, разные модификаторы.
  for (const [name, stat, statValue, skillValue, mods] of [
    ["Восприятие", "Внимательность", 6, 4, []],
    ["Атлетика", "ЛОВКОСТЬ", 5, 2, [2]],
    ["Уклонение", "РЕФ", 7, 6, [-2]],
    ["Скрытность", "ЛОВКОСТЬ", 5, 3, [1, 1]],
    ["Электроника/безопасность", "ТЕХ", 4, 5, [-4, 2]],
    ["Первая помощь", "ТЕХ", 4, 2, []],
    ["Убеждение", "КРУТ", 7, 4, [3]],
    ["Уличные знания", "РАЗУМ", 6, 6, []],
    ["Человеческое восприятие", "ЭМП", 5, 3, [-1]],
    ["Дальнобойное оружие", "РЕФ", 7, 8, [1]],
    ["Навык без уровня", "РЕФ", 7, 0, []],
    ["Навык с нулевой основой", "ТЕХ", 0, 4, []],
  ]) {
    add(
      `навык ${name}`,
      () => new CPRSkillRoll(stat, statValue, name, skillValue),
      mods
    );
  }

  // Ролевые способности — все девять ролей.
  // CPRRoleRoll(roleName, roleValue, skillName, skillValue, statName, statValue, skillList)
  for (const [role, roleValue, skill, skillValue, stat, statValue] of [
    ["Рокербой", 4, "Выступление", 3, "КРУТ", 7],
    ["Соло", 6, "Боевое чутьё", 0, "РЕФ", 7],
    ["Нетраннер", 5, "Интерфейс", 0, "ТЕХ", 4],
    ["Техник", 4, "Мастер на все руки", 5, "ТЕХ", 4],
    ["Медтех", 3, "Хирургия", 4, "ТЕХ", 4],
    ["Медиа", 4, "Расследование", 3, "РАЗУМ", 6],
    ["Менеджер", 5, "Команда", 2, "КРУТ", 7],
    ["Законник", 4, "Прикрытие", 3, "КРУТ", 7],
    ["Фиксер", 6, "Связи", 4, "ЭМП", 5],
  ]) {
    add(
      `ролевая ${role}/${skill}`,
      () => new CPRRoleRoll(role, roleValue, skill, skillValue, stat, statValue, [])
    );
  }

  // Программа нетраннера — отдельный класс броска.
  add("программа: ВСП", () => new CPRProgramStatRoll("Скорость", 4));

  // Атаки. CPRAttackRoll(attackName, statName, statValue, skillName, skillValue, weaponType)
  add(
    "атака дальнобойная",
    () => new CPRAttackRoll("Дробовик", "РЕФ", 7, "Длинноствольное оружие", 8, "shotgun"),
    [2]
  );
  add(
    "атака прицельная",
    () => new CPRAimedAttackRoll("Пистолет", "РЕФ", 7, "Короткоствольное оружие", 6, "pistol")
  );
  add(
    "атака очередью",
    () => new CPRAutofireRoll("ПП", "РЕФ", 7, "Автоматический огонь", 5, "smg")
  );
  add(
    "подавляющий огонь",
    () => new CPRSuppressiveFireRoll("Винтовка", "РЕФ", 7, "Автоматический огонь", 5, "assaultRifle")
  );

  // Урон. CPRDamageRoll(rollTitle, formula, weaponType)
  add("урон 2d6", () => new CPRDamageRoll("Нож", "2d6", "knife"));
  add("урон 5d6", () => new CPRDamageRoll("Дробовик", "5d6", "shotgun"));
  add("урон 3d6", () => new CPRDamageRoll("Тяжёлый пистолет", "3d6", "heavyPistol"));

  // Прочее.
  add("спасбросок от смерти", () => new CPRDeathSaveRoll(2, 1, 8));
  add("потеря человечности", () => new CPRHumanityLossRoll("Киберрука", "2d6"));
  add("противостояние", () => new CPRFacedownRoll("КРУТ", 7, 3));
  add("инициатива", () => new CPRInitiative({ id: "combatant" }, "1d10", "РЕФ", 7));

  // Составная формула — ради неё модуль и вмешивается в броски.
  add("урон составной", () => new CPRDamageRoll("Ракета", "6d6 + ceil(2d6/2)", "rocketLauncher"));

  return made;
}

/** Снимок результата броска — по нему и сравниваем прогоны. */
function snapshot(roll) {
  return JSON.stringify({
    formula: roll.formula ?? null,
    die: roll.die ?? null,
    initial: roll.initialRoll ?? null,
    mods: typeof roll.totalMods === "function" ? roll.totalMods() : null,
    total: roll.resultTotal ?? null,
    faces: roll.faces ?? null,
    critical: roll.criticalRoll ?? null,
    wasCritical: typeof roll.wasCritical === "function" ? roll.wasCritical() : null,
    wasCritFail: typeof roll.wasCritFail === "function" ? roll.wasCritFail() : null,
  });
}

/** Одна партия: собрать и бросить всё подряд, запоминая падения. */
async function playRound(rolls) {
  reseed();
  const played = [];
  for (const entry of buildRolls(rolls)) {
    let roll = null;
    try {
      roll = entry.build();
    } catch (problem) {
      played.push({
        name: entry.name,
        error: `конструктор: ${String(problem?.message ?? problem)}`,
        state: null,
      });
      continue;
    }
    let error = null;
    try {
      await roll.roll();
    } catch (problem) {
      error = String(problem?.message ?? problem);
    }
    played.push({ name: entry.name, error, state: error ? null : snapshot(roll) });
  }
  return played;
}

/* ------------------------------------------------------------------ */

console.log("Тестовая партия: броски системы с модулем и без\n");

stubGlobals();
const rollsPath = prepareSystemRolls();
const rolls = await import(pathToFileURL(rollsPath).href);
expect(typeof rolls.CPRSkillRoll === "function", "классы бросков системы не загрузились");

console.log("Партия без модуля");
const before = await playRound(rolls);
for (const round of before) {
  if (round.error) expect(false, `без модуля бросок «${round.name}» упал: ${round.error}`);
}
console.log(`  бросков сделано: ${before.length}`);

console.log("Партия с модулем");
const restore = stubLibWrapper();
globalThis.cprAddendaRollClass = rolls.CPRRoll;
const modulePath = prepareModule();
const formula = await import(pathToFileURL(path.join(modulePath, "roll-formula.mjs")).href);

// Регистрируем ровно те две обёртки, что ставит модуль, но без загрузки
// системы по сети: классы уже в руках.
libWrapper.register(
  "cpr-addenda",
  "cprAddendaRollClass.prototype._processFormula",
  function wrapProcess(wrapped, text) {
    if (!formula.isCompoundFormula(text)) return wrapped(text);
    const die = String(text).match(/d\d+/);
    this.die = die ? die[0] : null;
    return String(text);
  },
  "MIXED"
);
libWrapper.register(
  "cpr-addenda",
  "cprAddendaRollClass.prototype.roll",
  async function wrapRoll(wrapped, ...args) {
    if (!formula.isCompoundFormula(this.formula)) return wrapped(...args);
    this._roll = await new Roll(this.formula).evaluate();
    this.initialRoll = this._roll.total;
    this.resultTotal = this.initialRoll + this.totalMods();
    this.faces = formula.collectFaces(this._roll);
    this.criticalRoll = 0;
    this._computeResult();
    return this;
  },
  "MIXED"
);

const after = await playRound(rolls);
for (const round of after) {
  if (round.error) expect(false, `с модулем бросок «${round.name}» упал: ${round.error}`);
}
console.log(`  бросков сделано: ${after.length}`);

console.log("\nСравнение: обычные броски модуль трогать не должен");
{
  expect(before.length === after.length, "число бросков разошлось");
  for (let i = 0; i < before.length; i += 1) {
    const was = before[i];
    const now = after[i];
    // Составная формула — единственное, что модуль обязан изменить.
    if (was.name === "урон составной") continue;
    expect(
      was.state === now.state,
      `модуль изменил обычный бросок «${was.name}»:\n      было: ${was.state}\n      стало: ${now.state}`
    );
  }
  console.log(`  сверено бросков: ${before.length - 1}`);
}

console.log("\nСоставная формула: без модуля ломается, с модулем работает");
{
  const was = before.find((r) => r.name === "урон составной");
  const now = after.find((r) => r.name === "урон составной");

  const brokenBefore = Boolean(
    was.error || JSON.parse(was.state).total === null || Number.isNaN(JSON.parse(was.state).total)
  );
  expect(brokenBefore, `без модуля составная формула отработала штатно — патч больше не нужен? ${was.state}`);

  expect(!now.error, `с модулем составная формула упала: ${now.error}`);
  if (!now.error) {
    const state = JSON.parse(now.state);
    expect(Number.isFinite(state.total), `итог составного броска не число: ${state.total}`);
    // 6d6 + ceil(2d6/2): все восемь костей должны попасть в карточку.
    expect(
      Array.isArray(state.faces) && state.faces.length === 8,
      `граней собрано ${state.faces?.length}, а костей в формуле восемь`
    );
    expect(state.die === "d6", `тип кости определён как ${state.die}`);
  }
}

console.log("\nОпознание составной формулы");
{
  // Обычные формулы системы НЕ должны уходить по ветке модуля: иначе все
  // броски навыков потеряют разбор модификаторов.
  for (const plain of [
    "1d10", "1d6", "2d6", "5d6", "3d10", "1d10+2", "1d10 + 2", "1d10-4",
    "10", "0", "1d100", "2d6+1d6", "(1d10)", "1d10*2",
  ]) {
    expect(!formula.isCompoundFormula(plain), `обычная формула «${plain}» принята за составную`);
  }
  for (const compound of [
    "6d6 + ceil(2d6/2)", "ceil(1d10/2)", "floor(2d6/2)", "min(1d6,3)", "max(1d6,2)",
    "round(1d10/3)", "2d6 + FLOOR(1d6/2)",
  ]) {
    expect(formula.isCompoundFormula(compound), `составная формула «${compound}» не опознана`);
  }
}

console.log("\nВсе настоящие формулы из паков системы и модуля");
{
  // Собраны обходом system.* во всех паках: и damage, и humanityLoss.roll.
  // Пересобрать: см. комментарий в конце файла.
  const REAL = [
  "10d6 + ceil(2d6/2)",
  "10d6 + ceil(3d6/2)",
  "13d6 + ceil(3d6/2)",
  "15d6 + ceil(1d6/2)",
  "15d6 + ceil(2d6/2)",
  "18d6 + ceil(3d6/2)",
  "19d6 + ceil(2d6/2)",
  "19d6 + ceil(3d6/2)",
  "1d3",
  "1d6",
  "22d6 + ceil(1d6/2)",
  "2d6",
  "3d6",
  "4d6",
  "5d6",
  "6d6",
  "8d6",
  "9d6 + ceil(1d6/2)"
  ];

  const compound = REAL.filter((f) => formula.isCompoundFormula(f));
  const plain = REAL.filter((f) => !formula.isCompoundFormula(f));
  console.log(`  формул ${REAL.length}: простых ${plain.length}, составных ${compound.length}`);

  expect(plain.length > 0 && compound.length > 0,
    "в паках не нашлось формул обоих видов — сравнивать нечего");

  // Простая формула обязана остаться за системой: её разбор нужен, чтобы
  // прибавки были видны в карточке отдельной строкой.
  for (const f of plain) {
    expect(/^[0-9]*d[0-9]+/.test(f), `простая формула странного вида: «${f}»`);
  }

  // Каждая формула должна ПОСЧИТАТЬСЯ и дать целое число. Потеря человечности
  // пишется в целочисленное поле: дробь роняет установку с «humanity: value
  // must be an integer» — именно с этого патч и начался.
  for (const f of REAL) {
    reseed();
    let roll = null;
    let error = null;
    try {
      roll = new rolls.CPRHumanityLossRoll("проверка", f);
      await roll.roll();
    } catch (problem) {
      error = String(problem?.message ?? problem);
    }
    expect(!error, `формула «${f}» не бросилась: ${error}`);
    if (error) continue;

    expect(Number.isFinite(roll.resultTotal), `у «${f}» итог не число: ${roll.resultTotal}`);
    expect(Number.isInteger(roll.resultTotal),
      `у «${f}» итог дробный (${roll.resultTotal}) — поле человечности целочисленное`);
    expect(roll.resultTotal > 0, `у «${f}» итог ${roll.resultTotal}, а потеря человечности положительна`);

    // Все кости формулы должны попасть в карточку, иначе игрок не увидит броска.
    const expected = [...f.matchAll(/([0-9]*)d[0-9]+/g)]
      .reduce((sum, m) => sum + Number(m[1] || 1), 0);
    expect(roll.faces.length === expected,
      `у «${f}» в карточке ${roll.faces.length} костей из ${expected}`);
  }
}

restore();
console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);

/*
 * Список REAL пересобирается обходом system.* во всех паках системы и модуля —
 * ищутся строки вида «NdM …». Если в паках появятся формулы нового вида,
 * добавьте их сюда: смысл проверки в том, чтобы гонять то, что реально лежит у
 * предметов, а не придуманные примеры.
 */
