/**
 * Проверка логики ограничений без запуска Foundry.
 *
 * `checkUpgradeFit` написана чистой функцией именно ради этого: она ничего не
 * меняет и не зовёт ничего, кроме локализации, — значит её можно прогнать на
 * заглушках и убедиться, что глушитель встаёт на винтовку и не встаёт на
 * дробовик, не поднимая сервер и не открывая мир.
 *
 *   node tools/selftest.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, "..", "scripts");

// --- Заглушки окружения Foundry -------------------------------------------
// Ставим до импорта: модули читают game/ui в момент вызова, но настройки
// запрашиваются сразу, а ui.notifications — при отказе.

const notifications = [];

globalThis.game = {
  settings: { get: () => true },
  i18n: {
    localize: (key) => key,
    format: (key, data) => `${key} ${JSON.stringify(data)}`,
  },
};
globalThis.ui = { notifications: { error: (m) => notifications.push(m) } };

// --- Загрузка тестируемого модуля -----------------------------------------
// Файлы модуля — ES-модули с расширением .js, а Node без package.json считает
// такие файлы CommonJS. Копируем в .mjs, переписав относительные импорты.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-selftest-"));
for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".js")) continue;
  const body = fs
    .readFileSync(path.join(SCRIPTS, file), "utf-8")
    .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
}

// На Windows абсолютный путь надо отдавать импорту как file:// URL,
// иначе загрузчик примет букву диска за протокол.
const { checkUpgradeFit } = await import(
  pathToFileURL(path.join(tmp, "install-restrictions.mjs")).href
);

// --- Заглушки документов ---------------------------------------------------

function makeUpgrade(name, flags = {}) {
  return {
    name,
    type: "itemUpgrade",
    getFlag: (moduleId, key) => flags[moduleId]?.[key],
  };
}

function makeWeapon(name, weaponType) {
  return {
    name,
    documentName: "Item",
    type: "weapon",
    system: { weaponType },
  };
}

function makeArmor(name) {
  return { name, documentName: "Item", type: "armor", system: {} };
}

// --- Тесты -----------------------------------------------------------------

const SILENCER_FLAGS = {
  "cpr-addenda": {
    allowedWeaponTypes: [
      "medPistol",
      "heavyPistol",
      "vHeavyPistol",
      "smg",
      "heavySmg",
      "sniperRifle",
      "assaultRifle",
    ],
    deniedWeaponTypes: [],
  },
};

const cases = [
  {
    what: "глушитель встаёт на снайперскую винтовку",
    upgrade: makeUpgrade("Silencer", SILENCER_FLAGS),
    target: makeWeapon("Nomad Sniper", "sniperRifle"),
    expect: true,
  },
  {
    what: "глушитель встаёт на средний пистолет",
    upgrade: makeUpgrade("Silencer", SILENCER_FLAGS),
    target: makeWeapon("Militech Bullpup", "medPistol"),
    expect: true,
  },
  {
    what: "глушитель НЕ встаёт на дробовик",
    upgrade: makeUpgrade("Silencer", SILENCER_FLAGS),
    target: makeWeapon("Street Sweeper", "shotgun"),
    expect: false,
  },
  {
    what: "глушитель НЕ встаёт на гранатомёт",
    upgrade: makeUpgrade("Silencer", SILENCER_FLAGS),
    target: makeWeapon("Malorian 3516", "grenadeLauncher"),
    expect: false,
  },
  {
    what: "модификация без разметки ведёт себя как раньше",
    upgrade: makeUpgrade("Smartgun Link"),
    target: makeWeapon("Street Sweeper", "shotgun"),
    expect: true,
  },
  {
    what: "пустые списки не создают ограничения",
    upgrade: makeUpgrade("Empty", {
      "cpr-addenda": { allowedWeaponTypes: [], deniedWeaponTypes: [] },
    }),
    target: makeWeapon("Street Sweeper", "shotgun"),
    expect: true,
  },
  {
    what: "чёрный список запрещает свой тип",
    upgrade: makeUpgrade("No Shotguns", {
      "cpr-addenda": { deniedWeaponTypes: ["shotgun"] },
    }),
    target: makeWeapon("Street Sweeper", "shotgun"),
    expect: false,
  },
  {
    what: "чёрный список пропускает остальные типы",
    upgrade: makeUpgrade("No Shotguns", {
      "cpr-addenda": { deniedWeaponTypes: ["shotgun"] },
    }),
    target: makeWeapon("Nomad Sniper", "sniperRifle"),
    expect: true,
  },
  {
    what: "разметка по оружию не мешает установке в броню",
    upgrade: makeUpgrade("Silencer", SILENCER_FLAGS),
    target: makeArmor("Light Armorjack"),
    expect: true,
  },
  {
    what: "оружие без указанного типа отсекается белым списком",
    upgrade: makeUpgrade("Silencer", SILENCER_FLAGS),
    target: makeWeapon("Homemade Zip Gun", ""),
    expect: false,
  },
];

let failed = 0;
for (const test of cases) {
  const verdict = checkUpgradeFit(test.upgrade, test.target);
  const ok = verdict.allowed === test.expect;
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${test.what}`);
  if (!ok) {
    console.log(
      `        ожидалось allowed=${test.expect}, получено ${verdict.allowed}`
    );
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(
  `\nПройдено ${cases.length - failed} из ${cases.length}.` +
    (failed ? " Есть провалы." : "")
);
process.exit(failed ? 1 : 0);
