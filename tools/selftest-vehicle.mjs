/**
 * Проверка листа транспорта.
 *
 * Лист перенесён из чужого модуля, и цена ошибки здесь высокая по двум
 * причинам. Первая: данные постов переезжают в другое пространство флагов, и
 * если перенос что-то потеряет, у мастера пропадут собранные машины. Вторая:
 * весь текст выведен в ключи локализации, а забытый ключ виден только тогда,
 * когда на листе вместо надписи стоит «CPRADDENDA.vehicle.что-то».
 *
 * Поэтому здесь три группы проверок: целостность локализации, поведение
 * переноса и разбор строк, которые мастер пишет руками (модификаторы
 * характеристик и названия навыков).
 *
 *   node tools/selftest-vehicle.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const SCRIPTS = path.join(MODULE_ROOT, "scripts");
const LANG = path.join(MODULE_ROOT, "lang");
const TEMPLATE = path.join(MODULE_ROOT, "templates", "vehicle-sheet.hbs");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

/* ------------------------------------------------------------------ */
/*  Заглушки Foundry                                                   */
/* ------------------------------------------------------------------ */

/** Разворачивает плоский словарь с точками во вложенный — как mergeObject. */
function expandFlat(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    const last = parts.pop();
    let node = out;
    for (const part of parts) {
      node[part] = node[part] ?? {};
      node = node[part];
    }
    node[last] = value;
  }
  return out;
}

/** Тот же обход, что у foundry.utils.getProperty. */
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

/** Русские названия навыков и характеристик — как их отдаёт русификация. */
const RU_TRANSLATIONS = expandFlat({
  "CPR.global.stats.ref": "РЕФ",
  "CPR.global.stats.dex": "ЛВК",
  "CPR.global.stats.body": "ТЕЛО",
  "CPR.global.stats.cool": "КРУТ",
  "CPR.global.stats.will": "ВОЛЯ",
  "CPR.global.stats.luck": "УДЧ",
  "CPR.global.stats.tech": "ТЕХ",
  "CPR.global.stats.int": "ИНТ",
  "CPR.global.stats.move": "СКО",
  "CPR.global.stats.emp": "ЭМП",
  "CPR.global.itemType.skill.evasion": "Уклонение",
  "CPR.global.itemType.skill.evasionToolTip": "Уворот от атак",
  "CPR.global.itemType.skill.driveLandVehicle": "Вождение",
  "CPR.global.itemType.skill.driveLandVehicleToolTip": "Управление наземным транспортом",
});

const EN_TRANSLATIONS = expandFlat({
  "CPR.global.stats.ref": "REF",
  "CPR.global.stats.move": "MOVE",
  "CPR.global.itemType.skill.evasion": "Evasion",
  "CPR.global.itemType.skill.evasionToolTip": "Dodging attacks",
  "CPR.global.itemType.skill.driveLandVehicle": "Drive Land Vehicle",
  "CPR.global.itemType.skill.driveLandVehicleToolTip": "Driving ground vehicles",
});

globalThis.foundry = {
  utils: {
    getProperty,
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
  },
};

globalThis.game = {
  i18n: {
    translations: RU_TRANSLATIONS,
    _fallback: EN_TRANSLATIONS,
    localize(key) {
      const own = getProperty(this.translations, key);
      if (typeof own === "string") return own;
      const fallback = getProperty(this._fallback, key);
      return typeof fallback === "string" ? fallback : key;
    },
    format(key, data) {
      return `${this.localize(key)} ${JSON.stringify(data)}`;
    },
  },
  settings: { get: () => true },
};

globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };

/**
 * Данные листа для отрисовки: по одной машине со всем, что бывает, — занятый и
 * пустой посты, разбитое стекло, перегруз, закреплённое оружие, груз, травма.
 *
 * @returns {Object}
 */
function sampleContext() {
  const weapon = {
    id: "w1",
    name: "Спаренный пулемёт",
    img: "w.png",
    type: "weapon",
    flags: { "cpr-addenda": { vehicleMountedPosition: "p1" } },
    system: {
      damage: "6d6",
      rof: 1,
      isRanged: true,
      hasAmmoLoaded: true,
      magazine: { value: 40, max: 50 },
      fireModes: { autoFire: 4, suppressiveFire: true },
    },
  };

  return {
    cssClass: "cyberpunk-red sheet actor vas-vehicle",
    editable: true,
    isOwner: true,
    actor: {
      name: "Ямаха Кайнэ",
      img: "v.png",
      flags: { "cpr-addenda": { vehicleSpeed: "120" } },
      system: {
        derivedStats: { hp: { value: 40, max: 50 } },
        externalData: {
          currentArmorBody: { value: 10, max: 10 },
          currentArmorHead: { value: 0, max: 0 },
        },
        stats: { move: { value: 8 } },
      },
    },
    positions: [
      {
        id: "p1",
        name: "Водитель",
        isFull: false,
        isCrammed: true,
        bulletproofGlass: true,
        glassHp: 0,
        glassHpMax: 10,
        hasOccupants: true,
        occupants: [
          { uuid: "Actor.a", name: "Каптёр", img: "a.png", hp: 30, hpMax: 40 },
        ],
        skillsList: ["Вождение", "Уклонение"],
        hasWeapons: true,
        weapons: [weapon],
      },
      {
        id: "p2",
        name: "Стрелок",
        isFull: false,
        hasOccupants: false,
        occupants: [],
        skillsList: [],
        hasWeapons: false,
        weapons: [],
      },
    ],
    weapons: [weapon],
    armor: [
      {
        id: "a1",
        name: "Броневые листы",
        img: "b.png",
        system: {
          equipped: "equipped",
          bodyLocation: { sp: 10 },
          headLocation: { sp: 7 },
        },
      },
    ],
    mountedUpgrades: [
      {
        id: "u1",
        name: "Турбонаддув",
        img: "u.png",
        type: "itemUpgrade",
        description: "<p>+2 СКО</p>",
      },
    ],
    cargoByCategory: [
      {
        categoryName: "Боеприпасы",
        items: [
          {
            id: "c1",
            name: "Патроны 5.56",
            img: "c.png",
            type: "ammo",
            system: { amount: 200 },
            flags: {},
          },
          {
            id: "c2",
            name: "Кибердека",
            img: "c.png",
            type: "cyberware",
            system: { amount: 1 },
            flags: { "cpr-addenda": { vehicleInstalled: true } },
          },
        ],
      },
    ],
    criticalInjuries: [
      {
        id: "i1",
        name: "Пробит радиатор",
        img: "i.png",
        system: { location: "Корпус", effect: "−2 СКО" },
      },
    ],
    information: { alias: "Kaine GT" },
    enrichedDescription: "<p>Описание</p>",
    enrichedNotes: "",
  };
}

/* ------------------------------------------------------------------ */
/*  Загрузка модулей                                                   */
/* ------------------------------------------------------------------ */

// Файлы модуля лежат с расширением .js и ссылаются друг на друга так же;
// Node без package.json читает .js как CommonJS, поэтому копируем в .mjs.
// Лист (vehicle-sheet.js) не берём: он наследует ActorSheet, которого в Node
// нет, и падает прямо на объявлении класса.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-vehicle-"));
for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".js")) continue;
  const body = fs
    .readFileSync(path.join(SCRIPTS, file), "utf-8")
    .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
}

const load = (name) =>
  import(pathToFileURL(path.join(tmp, `${name}.mjs`)).href);

const constants = await load("constants");
const effects = await load("vehicle-effects");
const skills = await load("vehicle-skills");
const migration = await load("vehicle-migration");

/* ------------------------------------------------------------------ */

console.log("Локализация: все ключи на месте");
{
  const ru = JSON.parse(fs.readFileSync(path.join(LANG, "ru.json"), "utf-8"));
  const en = JSON.parse(fs.readFileSync(path.join(LANG, "en.json"), "utf-8"));

  // Ключи, которые код и шаблон реально просят у Foundry.
  const used = new Set();
  const template = fs.readFileSync(TEMPLATE, "utf-8");
  for (const match of template.matchAll(/CPRADDENDA\.vehicle\.[a-zA-Z.]+/g)) {
    used.add(match[0]);
  }
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.startsWith("vehicle-") || !file.endsWith(".js")) continue;
    const body = fs.readFileSync(path.join(SCRIPTS, file), "utf-8");
    for (const match of body.matchAll(/localize\(\s*"(vehicle\.[a-zA-Z.]+)"/g)) {
      used.add(`CPRADDENDA.${match[1]}`);
    }
    for (const match of body.matchAll(/"(CPRADDENDA\.vehicle\.[a-zA-Z.]+)"/g)) {
      used.add(match[1]);
    }
  }

  expect(used.size > 100, `ключей найдено подозрительно мало: ${used.size}`);

  for (const key of used) {
    expect(key in ru, `нет русского перевода: ${key}`);
    expect(key in en, `нет английского текста: ${key}`);
  }

  // Обратная сторона: ключ, который никто не просит, — забытый мусор,
  // который потом принимают за рабочий.
  const declared = Object.keys(ru).filter((key) =>
    key.startsWith("CPRADDENDA.vehicle.")
  );
  for (const key of declared) {
    expect(used.has(key), `ключ объявлен, но нигде не используется: ${key}`);
  }

  expect(
    declared.length === Object.keys(en).filter((k) => k.startsWith("CPRADDENDA.vehicle.")).length,
    "число ключей транспорта в ru.json и en.json не совпадает"
  );

  // Подстановки должны совпадать: {position} в одном языке и {pos} в другом
  // дают на экране необработанную фигурную скобку.
  for (const key of declared) {
    const slots = (text) =>
      [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    expect(
      slots(ru[key]) === slots(en[key]),
      `разные подстановки в переводах ${key}: «${slots(ru[key])}» и «${slots(en[key])}»`
    );
  }
}

console.log("Шаблон и манифест");
{
  const template = fs.readFileSync(TEMPLATE, "utf-8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(MODULE_ROOT, "module.json"), "utf-8")
  );

  // Старое пространство флагов в шаблоне означало бы, что лист читает данные,
  // которых после переноса там уже нет.
  expect(
    !template.includes("mmutons-cyberpunk-red-vas"),
    "в шаблоне осталась ссылка на пространство флагов старого модуля"
  );

  // Видимый текст: между тегами не должно остаться латиницы, кроме служебных
  // конструкций Handlebars и подписей из самих данных.
  const visible = [...template.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)]
    .map((m) => m[1].trim())
    .filter((text) => text && !text.startsWith("{{"));
  expect(
    visible.length === 0,
    `в шаблоне остался непереведённый текст: ${visible.slice(0, 5).join(" | ")}`
  );

  for (const style of manifest.styles ?? []) {
    expect(
      fs.existsSync(path.join(MODULE_ROOT, style)),
      `в манифесте объявлен стиль, которого нет: ${style}`
    );
  }
  expect(
    (manifest.styles ?? []).includes("styles/vehicle-sheet.css"),
    "таблица стилей листа транспорта не объявлена в манифесте"
  );
  expect(
    fs.existsSync(path.join(MODULE_ROOT, "assets", "vehicle-effect.svg")),
    "нет картинки для активных эффектов транспорта"
  );

  // Пути, по которым лист ищет свои файлы во время работы.
  for (const file of ["scripts/vehicle-sheet.js", "scripts/vehicle-registry.js"]) {
    const body = fs.readFileSync(path.join(MODULE_ROOT, file), "utf-8");
    for (const match of body.matchAll(/modules\/\$\{MODULE_ID\}\/([\w./-]+)/g)) {
      expect(
        fs.existsSync(path.join(MODULE_ROOT, match[1])),
        `${file} ссылается на несуществующий файл: ${match[1]}`
      );
    }
  }
}

console.log("Старое пространство флагов не осталось в рабочем коде");
{
  // Упоминать старый модуль вправе только два файла: константы (где имя
  // объявлено) и перенос (который из него читает).
  const allowed = new Set(["constants.js", "vehicle-migration.js"]);
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.endsWith(".js") || allowed.has(file)) continue;
    const body = fs.readFileSync(path.join(SCRIPTS, file), "utf-8");
    const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(
      !codeOnly.includes("mmutons-cyberpunk-red-vas"),
      `${file} обращается к пространству флагов старого модуля`
    );
  }
}

console.log("Модификаторы характеристик: русские и английские сокращения");
{
  const { parseStatMods } = effects;

  const english = parseStatMods("REF:-2, DEX:+1");
  expect(english.length === 2, `английская запись разобрана не полностью: ${english.length}`);
  expect(
    english[0].key === "system.stats.ref.value" && english[0].value === "-2",
    "REF:-2 разобран неверно"
  );
  expect(english[0].mode === 2, "модификатор должен складываться, а не заменять");

  // Ради этого всё и затевалось: мастер под русским языком видит на листе
  // «РЕФ» и пишет именно так.
  const russian = parseStatMods("РЕФ:-2, ЛВК:+1, СКО:+3");
  expect(russian.length === 3, `русская запись разобрана не полностью: ${russian.length}`);
  expect(
    russian[0].key === "system.stats.ref.value",
    `РЕФ не опознан: ${russian[0]?.key}`
  );
  expect(
    russian[2].key === "system.stats.move.value" && russian[2].value === "3",
    "СКО:+3 разобран неверно"
  );

  const mixed = parseStatMods("РЕФ:-2, ерунда, ТЕЛО:+1");
  expect(mixed.length === 2, "опечатка съела соседние модификаторы");

  expect(parseStatMods("").length === 0, "пустая строка дала модификаторы");
  expect(parseStatMods(undefined).length === 0, "undefined дал модификаторы");
  expect(parseStatMods("РЕФ : -2").length === 1, "пробелы вокруг двоеточия сломали разбор");
}

console.log("Поиск навыка: все четыре сочетания языков");
{
  const { findSkill } = skills;
  const actorWith = (names) => ({
    items: names.map((name) => ({ type: "skill", name, system: { level: 4 } })),
  });

  const englishSheet = actorWith(["Evasion", "Drive Land Vehicle"]);
  const russianSheet = actorWith(["Уклонение", "Вождение"]);

  expect(
    findSkill(englishSheet, "Evasion")?.name === "Evasion",
    "английское имя + английский запрос"
  );
  expect(
    findSkill(englishSheet, "Уклонение")?.name === "Evasion",
    "английское имя + русский запрос (перевод по ключу)"
  );
  expect(
    findSkill(russianSheet, "Уклонение")?.name === "Уклонение",
    "русское имя + русский запрос"
  );
  // Самое хрупкое место: имя переведено Babele, а мастер пишет по-английски.
  expect(
    findSkill(russianSheet, "Evasion")?.name === "Уклонение",
    "русское имя + английский запрос (обратный поиск ключа)"
  );

  expect(
    findSkill(russianSheet, "вождение")?.name === "Вождение",
    "регистр не должен мешать"
  );
  expect(
    findSkill(russianSheet, "  Вождение  ")?.name === "Вождение",
    "краевые пробелы не должны мешать"
  );
  expect(
    findSkill(russianSheet, "Такого нет") === undefined,
    "несуществующий навык почему-то нашёлся"
  );
  expect(findSkill(russianSheet, "") === undefined, "пустой запрос что-то нашёл");

  // Навык мог попасть на лист из компендиума с составным именем.
  const compound = actorWith(["Drive Land Vehicle"]);
  expect(
    findSkill(compound, "Вождение")?.name === "Drive Land Vehicle",
    "составное английское имя не сопоставилось с русским переводом"
  );
}

console.log("Перенос данных из старого модуля");
{
  const { pendingFlags, FLAG_MAP } = migration.__test;
  const { VEHICLE_FLAGS } = constants;

  // Все флаги оригинала должны иметь пару. Список — из исходников VAS 2.4.
  const originalFlags = [
    "positions",
    "speed",
    "permissionsSynced",
    "mountedPosition",
    "mounted",
    "installed",
    "managedBy",
    "positionId",
    "occupantMovePos",
  ];
  for (const flag of originalFlags) {
    expect(flag in FLAG_MAP, `флаг оригинала не переносится: ${flag}`);
  }
  expect(
    Object.keys(FLAG_MAP).length === originalFlags.length,
    "в карте переноса появился лишний флаг"
  );
  // Каждый флаг должен ехать в объявленное имя, а не в выдуманное.
  const known = new Set(Object.values(VEHICLE_FLAGS));
  for (const target of Object.values(FLAG_MAP)) {
    expect(known.has(target), `перенос целится в необъявленный флаг: ${target}`);
  }

  const posts = [{ id: "abc", name: "Водитель", occupants: ["Actor.xyz"] }];
  const vehicle = {
    flags: { "mmutons-cyberpunk-red-vas": { positions: posts, speed: "120" } },
  };
  const moved = pendingFlags(vehicle);
  expect(moved !== null, "перенос не увидел данных");
  expect(
    moved[VEHICLE_FLAGS.positions][0].name === "Водитель",
    "посты переехали с потерями"
  );
  expect(moved[VEHICLE_FLAGS.speed] === "120", "скорость не переехала");
  expect(
    moved[VEHICLE_FLAGS.positions] !== posts,
    "перенос отдал ссылку на исходный массив, а не копию"
  );

  // Повторный запуск не должен затирать то, что уже правили на новом листе.
  const already = {
    flags: {
      "mmutons-cyberpunk-red-vas": { positions: posts, speed: "120" },
      "cpr-addenda": { [VEHICLE_FLAGS.positions]: [], [VEHICLE_FLAGS.speed]: "90" },
    },
  };
  expect(
    pendingFlags(already) === null,
    "повторный перенос затирает уже перенесённые данные"
  );

  // Частичный случай: посты уже перенесены, скорость — ещё нет.
  const partial = {
    flags: {
      "mmutons-cyberpunk-red-vas": { positions: posts, speed: "120" },
      "cpr-addenda": { [VEHICLE_FLAGS.positions]: [] },
    },
  };
  const rest = pendingFlags(partial);
  expect(rest !== null && VEHICLE_FLAGS.speed in rest, "недоперенесённое не добралось");
  expect(
    rest !== null && !(VEHICLE_FLAGS.positions in rest),
    "уже перенесённое переносится повторно"
  );

  expect(pendingFlags({ flags: {} }) === null, "пустые флаги дали перенос");
  expect(pendingFlags({}) === null, "документ без флагов уронил бы перенос");
  expect(pendingFlags(null) === null, "null уронил бы перенос");
  expect(
    pendingFlags({ flags: { "mmutons-cyberpunk-red-vas": { чужое: 1 } } }) === null,
    "чужой флаг из того же модуля попал в перенос"
  );
}

console.log("Отрисовка шаблона на настоящем Handlebars");
{
  // Handlebars берём из поставки Foundry: своей зависимости у модуля нет, а
  // проверка того стоит — сломанный шаблон иначе виден только в игре.
  const candidates = [
    "C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json",
    "/opt/foundryvtt/resources/app/package.json",
  ];
  let Handlebars = null;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      Handlebars = createRequire(pathToFileURL(candidate))("handlebars");
      break;
    } catch (error) {
      // Ищем дальше.
    }
  }

  if (!Handlebars) {
    console.log("  пропущено: Handlebars не найден рядом с Foundry");
  } else {
    const asked = new Set();
    Handlebars.registerHelper("localize", (value, options) => {
      asked.add(value);
      const data = options?.hash ?? {};
      return Object.keys(data).length ? `${value} ${JSON.stringify(data)}` : value;
    });
    Handlebars.registerHelper("eq", (a, b) => a === b);
    Handlebars.registerHelper("gt", (a, b) => a > b);
    Handlebars.registerHelper("editor", () => "[editor]");
    Handlebars.registerHelper("cprAddendaFireMode", () => false);

    let html = "";
    try {
      html = Handlebars.compile(fs.readFileSync(TEMPLATE, "utf-8"))(sampleContext());
      expect(html.length > 5000, `шаблон отрисовался подозрительно коротким: ${html.length}`);
    } catch (error) {
      expect(false, `шаблон не отрисовался: ${error.message}`);
    }

    if (html) {
      const ru = JSON.parse(fs.readFileSync(path.join(LANG, "ru.json"), "utf-8"));
      for (const key of asked) {
        expect(key in ru, `шаблон просит ключ, которого нет в ru.json: ${key}`);
      }

      // Данные должны доехать до разметки — иначе где-то перепутан путь.
      for (const needle of [
        "Ямаха Кайнэ",
        "Водитель",
        "Каптёр",
        "Спаренный пулемёт",
        "Вождение",
        "Турбонаддув",
        "Патроны 5.56",
        "Пробит радиатор",
      ]) {
        expect(html.includes(needle), `в разметку не попало: ${needle}`);
      }

      // Скорость лежит во флаге, и читается она через двойной lookup —
      // самое хрупкое место шаблона после переименования флагов.
      expect(html.includes('value="120"'), "скорость из флага не отрисована");
      // Ветки, которые читают флаги предметов.
      expect(html.includes("mounted-badge"), "значок закреплённого оружия не отрисован");
      expect(
        html.includes("cyberware-uninstall"),
        "флаг вживлённой кибернетики не читается в шаблоне"
      );
      // Ветки на eq/gt.
      expect(html.includes("crammed-warning"), "не отрисовано предупреждение о перегрузе");
      expect(html.includes("glass-broken"), "разбитое стекло не отмечено");
      expect(!html.includes("mmutons"), "в выводе осталось имя старого модуля");
    }
  }
}

console.log("Посадка экипажа на пост");
{
  // Лист наследует ActorSheet, которого в Node нет, — подменяем минимальной
  // заглушкой. Всё, что проверяется ниже, живёт в самом листе и от базового
  // класса не зависит.
  globalThis.ActorSheet = class {
    constructor(actor) {
      this.actor = actor;
    }
    static get defaultOptions() {
      return { classes: [], tabs: [], dragDrop: [] };
    }
  };
  globalThis.Handlebars = { escapeExpression: (v) => String(v) };
  globalThis.TextEditor = { getDragEventData: (event) => event.data };
  globalThis.Hooks = { call: () => true, on: () => {}, once: () => {} };
  globalThis.canvas = { tokens: { controlled: [] }, scene: null };
  globalThis.fromUuid = async (uuid) => ({ uuid, name: "Пилот", id: uuid.split(".")[1] });
  globalThis.foundry.utils.mergeObject = (a, b) => Object.assign({}, a, b);
  globalThis.foundry.utils.randomID = () => "aaaaaaaaaaaaaaaa";
  globalThis.game.user = { isGM: true, targets: new Set() };
  globalThis.game.users = [];
  globalThis.game.actors = [];

  const { VehicleSheet } = await load("vehicle-sheet");

  /** Актёр-транспорт на заглушках: хранит флаги и умеет их менять. */
  function makeVehicle(positions) {
    return {
      id: "vehicle000000001",
      uuid: "Actor.vehicle000000001",
      isOwner: true,
      items: [],
      effects: [],
      flags: { "cpr-addenda": { vehiclePositions: positions } },
      system: { stats: { move: { value: 0 } } },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async setFlag(scope, key, value) {
        this.flags[scope] = this.flags[scope] ?? {};
        this.flags[scope][key] = value;
      },
      ownership: {},
      prototypeToken: { ownership: {} },
      async update() {},
    };
  }

  const post = () => ({
    id: "cprAddPos0000001",
    name: "Пилот",
    order: 1,
    occupants: [],
    skills: "",
    statMods: "DEX:-1",
    maxOccupants: 1,
    canControlWeapons: true,
    grantsTokenControl: true,
  });

  // --- перетаскивание актёра на пост ---
  {
    const vehicle = makeVehicle([post()]);
    const sheet = new VehicleSheet(vehicle);
    const event = {
      target: {
        closest: (selector) =>
          selector === "[data-position-id]"
            ? { dataset: { positionId: "cprAddPos0000001" } }
            : null,
      },
      data: { type: "Actor", uuid: "Actor.pilot00000001" },
    };

    const seated = await sheet._onDropActor(event, event.data);
    expect(seated === true, "перетаскивание актёра на пост не сработало");
    const occupants =
      vehicle.flags["cpr-addenda"].vehiclePositions[0].occupants;
    expect(
      occupants.length === 1 && occupants[0] === "Actor.pilot00000001",
      `после посадки в посту ${JSON.stringify(occupants)}`
    );
  }

  // --- через общий вход _onDrop, как это делает Foundry ---
  {
    const vehicle = makeVehicle([post()]);
    const sheet = new VehicleSheet(vehicle);
    await sheet._onDrop({
      target: {
        closest: () => ({ dataset: { positionId: "cprAddPos0000001" } }),
      },
      data: { type: "Actor", uuid: "Actor.pilot00000002" },
    });
    expect(
      vehicle.flags["cpr-addenda"].vehiclePositions[0].occupants.length === 1,
      "_onDrop не довёл актёра до поста"
    );
  }

  // --- бросок мимо поста не должен ничего менять ---
  {
    const vehicle = makeVehicle([post()]);
    const sheet = new VehicleSheet(vehicle);
    const seated = await sheet._onDropActor(
      { target: { closest: () => null }, data: {} },
      { type: "Actor", uuid: "Actor.pilot00000003" }
    );
    expect(seated === false, "бросок мимо поста был принят");
    expect(
      vehicle.flags["cpr-addenda"].vehiclePositions[0].occupants.length === 0,
      "бросок мимо поста кого-то посадил"
    );
  }

  // --- сам транспорт нельзя посадить в себя ---
  {
    const vehicle = makeVehicle([post()]);
    const sheet = new VehicleSheet(vehicle);
    const seated = await sheet._onDropActor(
      { target: { closest: () => ({ dataset: { positionId: "cprAddPos0000001" } }) } },
      { type: "Actor", uuid: vehicle.uuid }
    );
    expect(seated === false, "транспорт посадили сам в себя");
  }

  // --- пересадка с поста на пост ---
  {
    const first = post();
    const second = { ...post(), id: "cprAddPos0000002", name: "Стрелок" };
    first.occupants = ["Actor.pilot00000001"];
    const vehicle = makeVehicle([first, second]);
    const sheet = new VehicleSheet(vehicle);

    await sheet._seatOccupant("Actor.pilot00000001", "cprAddPos0000002");
    const posts = vehicle.flags["cpr-addenda"].vehiclePositions;
    expect(posts[0].occupants.length === 0, "с прежнего поста пилот не снялся");
    expect(posts[1].occupants.length === 1, "на новый пост пилот не сел");
  }

  // --- пост, которого нет, не должен ронять рассадку ---
  {
    const first = post();
    first.occupants = ["Actor.pilot00000001"];
    const vehicle = makeVehicle([first]);
    const sheet = new VehicleSheet(vehicle);
    const seated = await sheet._seatOccupant("Actor.pilot00000001", "нетакого");
    expect(seated === false, "посадка на несуществующий пост удалась");
    expect(
      vehicle.flags["cpr-addenda"].vehiclePositions[0].occupants.length === 1,
      "неудачная посадка выкинула пилота с его поста"
    );
  }
}

console.log("Собранный пак актёров: предметы отдельными записями");
{
  // Проверка появилась после боевой ошибки: сборщик клал предметы внутрь
  // записи актёра, а Foundry ждёт их отдельными ключами `!actors.items!`.
  // Актёр при этом импортировался нормально, но приезжал совершенно пустым —
  // без единого сообщения об ошибке ни в консоли, ни в логе сервера.
  const packDir = path.join(MODULE_ROOT, "packs", "addenda-actors");
  const foundryCandidates = [
    "C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json",
    "/opt/foundryvtt/resources/app/package.json",
  ];
  let ClassicLevel = null;
  for (const candidate of foundryCandidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      ({ ClassicLevel } = createRequire(pathToFileURL(candidate))("classic-level"));
      break;
    } catch (error) {
      // Ищем дальше.
    }
  }

  if (!ClassicLevel || !fs.existsSync(packDir)) {
    console.log("  пропущено: пак не собран или classic-level недоступен");
  } else {
    const actors = new Map();
    const items = new Map();
    const db = new ClassicLevel(packDir, { valueEncoding: "json" });
    try {
      for await (const [key, value] of db.iterator()) {
        if (key.startsWith("!actors.items!")) {
          items.set(key.slice("!actors.items!".length), value);
        } else if (key.startsWith("!actors!")) {
          actors.set(key.slice("!actors!".length), value);
        }
      }
    } finally {
      await db.close();
    }

    // Сколько предметов должно быть — считаем по исходникам.
    const sourceDir = path.join(MODULE_ROOT, "sources", "addenda-actors");
    const expected = new Map();
    for (const file of fs.readdirSync(sourceDir)) {
      if (!file.endsWith(".json")) continue;
      const doc = JSON.parse(fs.readFileSync(path.join(sourceDir, file), "utf-8"));
      expected.set(doc._id, doc);
    }

    expect(
      actors.size === expected.size,
      `актёров в паке ${actors.size}, а исходников ${expected.size}`
    );

    let totalItems = 0;
    for (const [id, actor] of actors) {
      const source = expected.get(id);
      expect(source !== undefined, `актёр "${actor.name}" есть в паке, но не в исходниках`);
      if (!source) continue;

      // Главное: в записи актёра — идентификаторы, а не сами документы.
      expect(
        Array.isArray(actor.items) && actor.items.every((i) => typeof i === "string"),
        `"${actor.name}": предметы лежат внутри записи актёра, а не отдельными записями`
      );

      const want = (source.items ?? []).length;
      expect(
        actor.items.length === want,
        `"${actor.name}": в паке ${actor.items.length} предметов, в исходнике ${want}`
      );

      for (const itemId of actor.items) {
        const record = items.get(`${id}.${itemId}`);
        expect(record !== undefined, `"${actor.name}": нет записи предмета ${itemId}`);
        if (record) {
          expect(
            record._id === itemId,
            `"${actor.name}": предмет ${itemId} записан под чужим _id ${record._id}`
          );
          totalItems += 1;
        }
      }

      // Оружие должно остаться закреплённым за постом и после сборки.
      const postIds = new Set(
        (actor.flags?.["cpr-addenda"]?.vehiclePositions ?? []).map((p) => p.id)
      );
      for (const itemId of actor.items) {
        const record = items.get(`${id}.${itemId}`);
        if (record?.type !== "weapon") continue;
        const mount = record.flags?.["cpr-addenda"]?.vehicleMountedPosition;
        expect(
          mount && postIds.has(mount),
          `"${actor.name}": оружие "${record.name}" потеряло привязку к посту`
        );
      }
    }

    expect(
      totalItems === items.size,
      `записей предметов ${items.size}, а собрано по актёрам ${totalItems} — есть осиротевшие`
    );
    console.log(`  актёров ${actors.size}, предметов ${items.size}`);
  }
}

console.log("Несостоявшийся бросок объясняет себя");
{
  // Раньше все эти случаи молча выходили из обработчика: игрок жал «атака», и
  // на экране не происходило ничего. Догадаться, что просто некому стрелять,
  // было невозможно.
  const { VehicleSheet } = await load("vehicle-sheet");

  const said = [];
  globalThis.ui = {
    notifications: {
      warn: (m) => said.push(["warn", m]),
      error: (m) => said.push(["error", m]),
      info: () => {},
    },
  };

  function makeSheet(positions, itemFlags) {
    const item = {
      id: "weapon0000000001",
      name: "Пулемёт",
      type: "weapon",
      system: { weaponSkill: "Heavy Weapons" },
      getFlag: (scope, key) => itemFlags?.[key],
    };
    const actor = {
      id: "vehicle000000001",
      uuid: "Actor.vehicle000000001",
      isOwner: true,
      items: {
        get: (id) => (id === item.id ? item : undefined),
      },
      flags: { "cpr-addenda": { vehiclePositions: positions } },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async setFlag() {},
    };
    return [new VehicleSheet(actor), item];
  }

  const post = (extra = {}) => ({
    id: "cprAddPos0000001",
    name: "Пилот",
    occupants: [],
    maxOccupants: 1,
    ...extra,
  });

  // Оружие вообще не закреплено за постом.
  {
    said.length = 0;
    const [sheet, item] = makeSheet([post()], {});
    const gunner = await sheet._gunnerFor(item);
    expect(gunner === null, "незакреплённое оружие вернуло стрелка");
    expect(said.length === 1, `сообщений ${said.length}, а ждали одно`);
    expect(
      said[0]?.[1]?.includes("weaponNotMounted"),
      `не то сообщение: ${said[0]?.[1]}`
    );
  }

  // Пост, за которым закреплено оружие, удалён.
  {
    said.length = 0;
    const [sheet, item] = makeSheet([post()], {
      vehicleMountedPosition: "нетакогопоста",
    });
    expect(await sheet._gunnerFor(item) === null, "удалённый пост вернул стрелка");
    expect(said[0]?.[1]?.includes("postGone"), `не то сообщение: ${said[0]?.[1]}`);
  }

  // Пост есть, но на нём никого — самый частый случай.
  {
    said.length = 0;
    const [sheet, item] = makeSheet([post()], {
      vehicleMountedPosition: "cprAddPos0000001",
    });
    expect(await sheet._gunnerFor(item) === null, "пустой пост вернул стрелка");
    expect(
      said[0]?.[1]?.includes("postEmpty"),
      `не то сообщение: ${said[0]?.[1]}`
    );
    expect(said[0]?.[1]?.includes("Пилот"), "в сообщении нет имени поста");
  }

  // Актёр пассажира пропал из мира.
  {
    said.length = 0;
    globalThis.fromUuid = async () => null;
    const [sheet, item] = makeSheet(
      [post({ occupants: ["Actor.pilot00000001"] })],
      { vehicleMountedPosition: "cprAddPos0000001" }
    );
    expect(await sheet._gunnerFor(item) === null, "пропавший актёр вернул стрелка");
    expect(
      said[0]?.[1]?.includes("gunnerGone"),
      `не то сообщение: ${said[0]?.[1]}`
    );
  }

  // Всё на месте — стрелок находится и никто ни на что не жалуется.
  {
    said.length = 0;
    globalThis.fromUuid = async (uuid) => ({ uuid, name: "Пилот", items: [] });
    const [sheet, item] = makeSheet(
      [post({ occupants: ["Actor.pilot00000001"] })],
      { vehicleMountedPosition: "cprAddPos0000001" }
    );
    const gunner = await sheet._gunnerFor(item);
    expect(gunner !== null, "стрелок не найден, хотя всё на месте");
    expect(said.length === 0, `лишние жалобы: ${JSON.stringify(said)}`);
  }

  // Заглушка i18n отдаёт ключ вместо текста, поэтому выше сверяется ключ.
  // А то, что у ключа есть текст на обоих языках, проверяется здесь.
  const ru = JSON.parse(fs.readFileSync(path.join(LANG, "ru.json"), "utf-8"));
  const en = JSON.parse(fs.readFileSync(path.join(LANG, "en.json"), "utf-8"));
  for (const key of [
    "weaponNotMounted", "postGone", "postEmpty", "gunnerGone",
    "noWeaponSkill", "rollUnsupported", "rollFailed", "fireModeFailed",
  ]) {
    const full = `CPRADDENDA.vehicle.notify.${key}`;
    expect(full in ru, `нет русского текста: ${full}`);
    expect(full in en, `нет английского текста: ${full}`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
