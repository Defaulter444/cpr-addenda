/**
 * Тестовая партия: русская шестёрка от конструктора до броска атаки.
 *
 * Конструктор шестёрок (`pneuma-mook-maker`) опознаёт навыки и оружие ПО
 * НАЗВАНИЮ, а названия у нас русские. Пока это не поправили, он молча ничего не
 * делал: ключ навыка терял кириллицу целиком и не совпадал ни с чем.
 *
 * Здесь собирается настоящая шестёрка с русскими навыками и русским оружием,
 * через конструктор ей выставляют боевой показатель, а потом этими же навыками
 * бросают атаку и урон НАСТОЯЩИМИ классами бросков системы. Проверяется весь
 * путь, а не отдельные куски: разбивка -> расчёт -> лист -> бросок.
 *
 * Правки конструктора накладывает `tools/patch_mook_maker.py`. Если модуль
 * обновится и правки слетят, эта проверка упадёт — так и задумано.
 *
 *   node tools/testgame-mook.mjs
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const MODULES = path.dirname(MODULE_ROOT);
const MOOK = path.join(MODULES, "pneuma-mook-maker");
const SYSTEM = path.join(path.dirname(MODULES), "systems", "cyberpunk-red-core");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

if (!fs.existsSync(MOOK)) {
  console.log("Конструктор шестёрок не установлен — проверять нечего.");
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/*  Заглушки                                                           */
/* ------------------------------------------------------------------ */

/** Как Foundry достаёт вложенное свойство по пути. */
function getProperty(object, key) {
  if (!key || !object) return undefined;
  if (key in object) return object[key];
  let target = object;
  for (const part of key.split(".")) {
    if (!target || typeof target !== "object") return undefined;
    if (part in target) target = target[part];
    else return undefined;
  }
  return target;
}

let storedClassifications = {};
let worldActors = [];

globalThis.foundry = { utils: { getProperty } };
globalThis.game = {
  system: { id: "cyberpunk-red-core" },
  settings: {
    get: (_scope, key) => (key === "skillClassifications" ? storedClassifications : undefined),
    register() {},
    registerMenu() {},
  },
  get actors() {
    return worldActors;
  },
  i18n: { localize: (k) => k, format: (k) => k },
};

/** Копия скриптов конструктора: форму настроек подменяем пустышкой. */
function prepareMookScripts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-mook-"));
  for (const file of fs.readdirSync(path.join(MOOK, "scripts"))) {
    if (!file.endsWith(".js")) continue;
    const body = fs
      .readFileSync(path.join(MOOK, "scripts", file), "utf-8")
      .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
  }
  // Форма настроек тянет за собой Application из ядра Foundry, а нам нужны
  // только расчёты.
  fs.writeFileSync(
    path.join(tmp, "skill-classification-form.mjs"),
    "export class SkillClassificationForm {}\n"
  );
  return tmp;
}

/** Копия скриптов cpr-addenda с расширением .mjs. */
function prepareAddendaScripts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-addenda-scripts-"));
  for (const file of fs.readdirSync(path.join(MODULE_ROOT, "scripts"))) {
    if (!file.endsWith(".js")) continue;
    const body = fs
      .readFileSync(path.join(MODULE_ROOT, "scripts", file), "utf-8")
      .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
  }
  return tmp;
}

/** Шестёрка с русскими навыками и оружием — как её видит конструктор. */
function makeMook() {
  const stats = { ref: 6, dex: 5, int: 5, tech: 4, cool: 5, will: 5, body: 6 };
  const skill = (name, stat, level) => ({
    id: `skill-${name}`,
    type: "skill",
    name,
    system: { stat, level },
  });
  const weapon = (name, weaponType, equipped) => ({
    id: `wpn-${name}`,
    type: "weapon",
    name,
    system: { weaponType, equipped },
  });

  return {
    id: "mook1",
    name: "Бандит с Уотсона",
    system: { stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { value: v }])) },
    items: [
      // Боевые: по ним считается боевой показатель.
      skill("Уклонение", "dex", 4),
      skill("Драка", "dex", 3),
      skill("Короткоствольное оружие", "ref", 6),
      skill("Боевые искусства", "dex", 2),
      // Второстепенные и прочие.
      skill("Атлетика", "dex", 2),
      skill("Восприятие", "int", 3),
      skill("Взяточничество", "cool", 1),
      skill("Наука (Математика)", "int", 2),
      skill("Знание района (Уотсон)", "int", 3),
      // Оружие: природное не должно попадать в выбор.
      weapon("Тяжёлый пистолет", "heavyPistol", "equipped"),
      weapon("Боевой нож", "knife", "carried"),
      weapon("Безоружная атака", "unarmed", "owned"),
      weapon("Боевые искусства", "martialArts", "owned"),
    ],
  };
}

/* ------------------------------------------------------------------ */

console.log("Русская шестёрка: конструктор и бросок\n");

const scripts = prepareMookScripts();
const settings = await import(pathToFileURL(path.join(scripts, "skill-settings.mjs")).href);
const skills = await import(pathToFileURL(path.join(scripts, "skills.mjs")).href);
const weapons = await import(pathToFileURL(path.join(scripts, "weapons.mjs")).href);

const mook = makeMook();
worldActors = [mook];

console.log("Правки на месте");
{
  const source = fs.readFileSync(path.join(MOOK, "scripts", "skill-settings.js"), "utf-8");
  expect(
    source.includes("cpr-addenda: русские названия"),
    "правка русских названий не применена — запустите tools/patch_mook_maker.py"
  );
  const table = settings.DEFAULT_SKILL_CLASSIFICATIONS;
  expect(table["Драка"] === 1, "«Драка» не помечена боевым навыком");
  expect(table["Атлетика"] === 2, "«Атлетика» не второстепенная");
  expect(table["Взяточничество"] === 3, "«Взяточничество» не прочий");
  expect(table.Brawling === 1, "английские названия пропали из таблицы");
  console.log(`  записей в разбивке: ${Object.keys(table).length}`);
}

console.log("Кнопка «Собрать шестёрку» встаёт во вкладку актёров");
{
  // Кнопки не было видно, потому что обработчик вешался в `ready` — боковая
  // панель к тому времени уже нарисована и второй раз не рисуется. Проверяем и
  // сам факт вставки, и то, что подключение объявлено в `init`.
  const main = fs.readFileSync(path.join(MODULE_ROOT, "scripts", "main.js"), "utf-8");
  const init = main.indexOf('Hooks.once("init"');
  const ready = main.indexOf('Hooks.once("ready"');
  const call = main.indexOf("registerMookButton();");
  expect(init >= 0 && ready > init, "не нашёл хуки запуска в main.js");
  expect(
    call > init && call < ready,
    "кнопка подключается не в init — панель уже нарисована, и её не будет видно"
  );

  // Разметка вкладки актёров, как её отдаёт Foundry.
  const buttons = [];
  const headerChildren = [];
  const header = {
    className: "directory-header",
    append: (node) => headerChildren.push(node),
  };
  const root = {
    querySelector: (selector) => {
      if (selector === ".cpr-addenda-build-mook") {
        return buttons.length ? buttons[0] : null;
      }
      if (selector === ".directory-header") return header;
      return null;
    },
  };
  globalThis.document = {
    createElement: (tag) => {
      const node = {
        tag,
        className: "",
        type: "",
        title: "",
        innerHTML: "",
        children: [],
        listeners: {},
        append: (child) => node.children.push(child),
        addEventListener: (event, fn) => {
          node.listeners[event] = fn;
        },
      };
      if (tag === "button") buttons.push(node);
      return node;
    },
  };

  const stubs = {
    settings: game.settings,
    modules: game.modules,
    user: game.user,
    folders: game.folders,
  };
  game.settings = { get: () => true };
  game.modules = { get: (id) => (id === "pneuma-mook-maker" ? { active: true } : null) };
  game.user = { isGM: true };
  game.folders = [];

  const mookButton = await import(
    pathToFileURL(path.join(prepareAddendaScripts(), "mook-button.mjs")).href
  );

  expect(mookButton.injectMookButton({}, [root]), "кнопка не добавлена");
  expect(buttons.length === 1, `кнопок создано ${buttons.length}`);
  expect(
    buttons[0].className === "cpr-addenda-build-mook",
    `у кнопки класс «${buttons[0].className}»`
  );
  expect(typeof buttons[0].listeners.click === "function", "на кнопку не повешен щелчок");

  // Строкой во всю ширину, как это делают соседние модули, а не втискиванием
  // в системный ряд «Создать актёра».
  expect(headerChildren.length === 1, `в шапку добавлено узлов: ${headerChildren.length}`);
  expect(
    String(headerChildren[0].className).includes("header-actions"),
    `строка кнопки получила класс «${headerChildren[0].className}»`
  );

  // Повторная отрисовка не должна плодить вторую кнопку.
  expect(!mookButton.injectMookButton({}, [root]), "кнопка добавилась во второй раз");
  expect(buttons.length === 1, `после второй отрисовки кнопок ${buttons.length}`);

  // Без конструктора шестёрок кнопке делать нечего.
  game.modules = { get: () => ({ active: false }) };
  buttons.length = 0;
  headerChildren.length = 0;
  expect(
    !mookButton.injectMookButton({}, [root]),
    "кнопка появилась при выключенном конструкторе"
  );

  // Игроку кнопка не положена: заготовки и сцену правит мастер.
  game.modules = { get: () => ({ active: true }) };
  game.user = { isGM: false };
  expect(!mookButton.injectMookButton({}, [root]), "кнопка показана игроку");

  Object.assign(game, stubs);
  delete globalThis.document;
}

console.log("Окно растягивается, поля не налезают");
{
  const form = fs.readFileSync(path.join(MOOK, "scripts", "mook-form.js"), "utf-8");
  expect(form.includes("resizable: true"), "окно конструктора не растягивается за угол");

  const css = fs.readFileSync(path.join(MOOK, "styles", "pneuma-mook-maker.css"), "utf-8");
  // Жёсткие 360px не давали колонке ужиматься, и русское «Своё значение»
  // выталкивало поле ввода на соседнюю колонку.
  expect(
    !css.includes("grid-template-columns: 360px"),
    "колонка характеристик снова заперта в 360px — поля будут налезать"
  );
  expect(
    css.includes("minmax(320px, 1fr)"),
    "колонка характеристик не тянется за окном"
  );
  expect(
    /radio-row \{[^}]*flex: 1 1 auto[^}]*min-width: 0/s.test(css),
    "строка переключателей снова не ужимается"
  );
  expect(
    /pneuma-mook-maker-custom-choice \{[^}]*flex-wrap: wrap/s.test(css),
    "поле своего значения не переносится на новую строку"
  );

  // Скобки в стилях должны сойтись — иначе браузер бросит весь файл.
  const opens = (css.match(/\{/g) ?? []).length;
  const closes = (css.match(/\}/g) ?? []).length;
  expect(opens === closes, `в стилях ${opens} открывающих скобок и ${closes} закрывающих`);
}

console.log("Русские навыки классифицируются");
{
  const map = settings.getSkillClassifications();
  const of = (name) => map[settings.normalizeSkillKey(name)];

  expect(of("Уклонение") === 1, `«Уклонение» -> ${of("Уклонение")}`);
  expect(of("Драка") === 1, `«Драка» -> ${of("Драка")}`);
  expect(of("Боевые искусства") === 1, `«Боевые искусства» -> ${of("Боевые искусства")}`);
  expect(of("Атлетика") === 2, `«Атлетика» -> ${of("Атлетика")}`);
  expect(of("Взяточничество") === 3, `«Взяточничество» -> ${of("Взяточничество")}`);

  // Ключ больше не теряет кириллицу — иначе все русские навыки слились бы в один.
  expect(settings.normalizeSkillKey("Драка") === "драка", "ключ потерял кириллицу");
  expect(
    settings.normalizeSkillKey("Драка") !== settings.normalizeSkillKey("Атлетика"),
    "разные русские навыки дают один ключ"
  );
}

console.log("Боевой показатель считается по русским навыкам");
{
  // Уклонение 4 + ЛВК 5 = 9; Короткоствольное 6 + РЕФ 6 = 12; Драка 3 + ЛВК 5 = 8;
  // Боевые искусства 2 + ЛВК 5 = 7. Все разные — большинства нет.
  expect(skills.getCurrentCombatNumber(mook) === null,
    `при четырёх разных итогах показатель ${skills.getCurrentCombatNumber(mook)}, а должен быть неопределён`);

  // Доведём два боевых навыка до одного итога — он и станет показателем.
  const twin = JSON.parse(JSON.stringify(mook));
  twin.items.find((i) => i.name === "Драка").system.level = 4; // 4 + 5 = 9
  expect(skills.getCurrentCombatNumber(twin) === 9,
    `боевой показатель ${skills.getCurrentCombatNumber(twin)}, а ожидался 9`);
}

console.log("Конструктор выставляет уровни русским навыкам");
{
  const updates = skills.getSkillUpdates(mook, { 1: 12, 2: 10, 3: 8 }, 5);
  const byName = new Map(updates.map((u) => [u._id, u["system.level"]]));

  // Боевые доводятся до 12: уровень = 12 - характеристика.
  expect(byName.get("skill-Уклонение") === 7, `«Уклонение» -> ${byName.get("skill-Уклонение")}, ждали 7`);
  expect(byName.get("skill-Драка") === 7, `«Драка» -> ${byName.get("skill-Драка")}`);
  expect(byName.get("skill-Короткоствольное оружие") === 6,
    `«Короткоствольное оружие» -> ${byName.get("skill-Короткоствольное оружие")}, ждали 6`);
  // Второстепенные до 10, прочие до 8.
  expect(byName.get("skill-Атлетика") === 5, `«Атлетика» -> ${byName.get("skill-Атлетика")}`);
  expect(byName.get("skill-Взяточничество") === 3, `«Взяточничество» -> ${byName.get("skill-Взяточничество")}`);
  // Подвиды тоже: «Наука (Математика)» относится к семье «Наука».
  expect(byName.get("skill-Наука (Математика)") === 3,
    `«Наука (Математика)» -> ${byName.get("skill-Наука (Математика)")}, ждали 3`);
  expect(byName.get("skill-Знание района (Уотсон)") === 3,
    `«Знание района (Уотсон)» -> ${byName.get("skill-Знание района (Уотсон)")}`);

  expect(updates.length === 9, `правок навыков ${updates.length}, а навыков девять`);
  console.log(`  выставлено уровней: ${updates.length}`);
}

console.log("Русское оружие выбирается, безоружный бой прячется");
{
  const { weapons: list, selectedWeaponIds } = weapons.getWeaponInventoryChoices(mook);
  const names = list.map((w) => w.name);

  expect(names.includes("Тяжёлый пистолет"), `в выборе нет пистолета: ${names}`);
  expect(names.includes("Боевой нож"), `в выборе нет ножа: ${names}`);
  expect(!names.includes("Безоружная атака"), "безоружная атака попала в выбор оружия");
  expect(!names.includes("Боевые искусства"), "боевые искусства попали в выбор оружия");
  expect(list.length === 2, `в выборе ${list.length} стволов, а настоящих два`);
  expect(selectedWeaponIds.length === 2, `отмечено ${selectedWeaponIds.length} стволов`);

  const updates = weapons.getWeaponUpdates(mook, ["wpn-Тяжёлый пистолет"]);
  const state = new Map(updates.map((u) => [u._id, u["system.equipped"]]));
  expect(state.get("wpn-Тяжёлый пистолет") === "equipped", "выбранный ствол не надет");
  expect(state.get("wpn-Боевой нож") === "owned", "невыбранный ствол остался надетым");
  expect(!state.has("wpn-Безоружная атака"), "конструктор трогает безоружный бой");
}

console.log("Этими же навыками бросается атака и урон");
{
  // Берём НАСТОЯЩИЕ классы бросков системы: если конструктор выставил уровни
  // верно, они должны дойти до броска без единой поправки.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-mook-rolls-"));
  for (const dir of ["rolls", "utils", "extern", "dialog"]) fs.mkdirSync(path.join(tmp, dir));
  fs.copyFileSync(
    path.join(SYSTEM, "modules", "rolls", "cpr-rolls.js"),
    path.join(tmp, "rolls", "cpr-rolls.js")
  );
  fs.writeFileSync(path.join(tmp, "utils", "cpr-logger.js"),
    "export default { log(){}, debug(){}, warn(){}, error(){}, trace(){} };");
  fs.writeFileSync(path.join(tmp, "extern", "cpr-dice-handler.js"),
    "export default { async handle3dDice(){} };");
  fs.writeFileSync(path.join(tmp, "utils", "cpr-systemUtils.js"),
    "export default { Localize: (k) => k, slugify: (s) => String(s), DisplayMessage(){}, " +
    "GetEventDatum(){}, getUserTargetedOrSelected(){ return []; }, GetCoreSetting(){ return false; } };");
  fs.writeFileSync(path.join(tmp, "dialog", "cpr-roll-dialog.js"),
    "export async function ShowDialog(){ return null; }\nexport default { ShowDialog };");

  // Кости детерминированные: сравниваем поведение, а не удачу.
  let seed = 0x51f3b7;
  const next = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  };
  globalThis.Roll = class {
    constructor(formula) { this.formula = String(formula); }
    async evaluate() {
      const m = this.formula.match(/^(\d*)d(\d+)$/);
      const number = Number(m?.[1] || 1);
      const faces = Number(m?.[2] || 10);
      const results = Array.from({ length: number }, () => ({
        result: Math.floor(next() * faces) + 1,
        active: true,
      }));
      const die = {
        number, faces, results, formula: this.formula,
        total: results.reduce((s, r) => s + r.result, 0),
      };
      this.terms = [die];
      this.total = die.total;
      return this;
    }
  };

  const rolls = await import(pathToFileURL(path.join(tmp, "rolls", "cpr-rolls.js")).href);

  // Уровни — те, что выставил конструктор.
  const updates = skills.getSkillUpdates(mook, { 1: 12, 2: 10, 3: 8 }, 5);
  const levelOf = (name) =>
    updates.find((u) => u._id === `skill-${name}`)?.["system.level"];

  const shooting = levelOf("Короткоствольное оружие");
  const attack = new rolls.CPRAttackRoll(
    "Тяжёлый пистолет", "РЕФ", 6, "Короткоствольное оружие", shooting, "heavyPistol"
  );
  await attack.roll();

  expect(Number.isFinite(attack.resultTotal), `итог атаки не число: ${attack.resultTotal}`);
  // База = характеристика + навык, то есть ровно тот боевой показатель, до
  // которого доводил конструктор. Из итога вычитаем и кость, и добросок за
  // критический успех: иначе меряли бы удачу, а не сборку броска.
  const base = (roll) => roll.resultTotal - roll.initialRoll - (roll.criticalRoll ?? 0);
  expect(
    attack.statValue + attack.skillValue === 12,
    `характеристика ${attack.statValue} + навык ${attack.skillValue}, а показатель 12`
  );
  expect(base(attack) === 12, `атака собралась как ${base(attack)}, а показатель 12`);
  expect(attack.faces.length === 1, `в карточке атаки костей ${attack.faces.length}`);

  const damage = new rolls.CPRDamageRoll("Тяжёлый пистолет", "3d6", "heavyPistol");
  await damage.roll();
  expect(Number.isFinite(damage.resultTotal), `итог урона не число: ${damage.resultTotal}`);
  expect(damage.faces.length === 3, `костей урона ${damage.faces.length}, а формула 3d6`);

  // Уклонение — тоже боевой навык, и оно должно собраться так же.
  const dodge = new rolls.CPRSkillRoll("ЛВК", 5, "Уклонение", levelOf("Уклонение"));
  await dodge.roll();
  expect(base(dodge) === 12, `уклонение собралось как ${base(dodge)}, а показатель 12`);

  console.log(`  атака ${attack.resultTotal}, урон ${damage.resultTotal}, уклонение ${dodge.resultTotal}`);
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
