/**
 * Проверка правок предмета-носителя.
 *
 * Этот механизм пишет прямо в чужой предмет, поэтому цена ошибки высокая: если
 * откат не вернёт исходное значение, у игрока навсегда останется ствол с чужим
 * автоогнём или подменённым типом. Здесь на заглушках проверяется главное —
 * что применение обратимо, а повторы и наложения не портят сохранённый оригинал.
 *
 *   node tools/selftest-carrier.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const SCRIPTS = path.join(MODULE_ROOT, "scripts");
const SOURCES = path.join(MODULE_ROOT, "sources");

const warnings = [];

globalThis.game = {
  settings: { get: () => true },
  i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}` },
};
globalThis.ui = {
  notifications: {
    error: () => {},
    warn: (m) => warnings.push(m),
  },
};
// Модуль пользуется двумя утилитами Foundry; подменяем их минимальными аналогами.
globalThis.foundry = {
  utils: {
    duplicate: (o) => JSON.parse(JSON.stringify(o)),
  },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-carrier-"));
for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".js")) continue;
  const body = fs
    .readFileSync(path.join(SCRIPTS, file), "utf-8")
    .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
}
const carrier = await import(
  pathToFileURL(path.join(tmp, "carrier-changes.mjs")).href
);

/** Предмет-заглушка: хранит данные и умеет обновляться по путям через точку. */
function makeItem({ id, name, system = {}, flags = {} }) {
  return {
    id,
    name,
    system,
    flags,
    getFlag(moduleId, key) {
      return this.flags?.[moduleId]?.[key];
    },
    async update(changes) {
      for (const [pathStr, value] of Object.entries(changes)) {
        const keys = pathStr.split(".");
        const last = keys.pop();
        let node = this;
        for (const key of keys) {
          node[key] = node[key] ?? {};
          node = node[key];
        }
        node[last] = value;
      }
    },
  };
}

function makeUpgrade(id, name, changes) {
  return makeItem({
    id,
    name,
    flags: { "cpr-addenda": { carrierChanges: changes } },
  });
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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- 1. Применение и откат ---------------------------------------------------

{
  const weapon = makeItem({
    id: "weapon0000000001",
    name: "Тяжёлый пистолет",
    system: {
      fireModes: { autoFire: 0, suppressiveFire: false },
      ammoVariety: ["heavyPistol"],
      weaponType: "heavyPistol",
    },
  });
  const auto = makeUpgrade("upgrade000000001", "Автоспуск пистолета", {
    "system.fireModes.autoFire": { op: "set", value: 3 },
    "system.fireModes.suppressiveFire": { op: "set", value: true },
  });

  await carrier.applyCarrierChanges(weapon, auto);
  expect(weapon.system.fireModes.autoFire === 3, "автоогонь не выставился");
  expect(weapon.system.fireModes.suppressiveFire === true, "подавляющий огонь не выставился");

  await carrier.revertCarrierChanges(weapon, auto);
  expect(weapon.system.fireModes.autoFire === 0, "автоогонь не вернулся к нулю");
  expect(weapon.system.fireModes.suppressiveFire === false, "подавляющий огонь не вернулся");
  expect(
    deepEqual(weapon.flags["cpr-addenda"].carrierRestore, {}),
    "после отката в предмете остался мусор от сохранённых значений"
  );
}

// --- 2. Список боеприпасов дополняется, а не затирается ----------------------

{
  const rifle = makeItem({
    id: "weapon0000000002",
    name: "Штурмовая винтовка",
    system: { ammoVariety: ["rifle"] },
  });
  const ammoMod = makeUpgrade("upgrade000000002", "Модуль совместимости", {
    "system.ammoVariety": { op: "add", value: ["heavyPistol", "rifle"] },
  });

  await carrier.applyCarrierChanges(rifle, ammoMod);
  expect(
    deepEqual(rifle.system.ammoVariety, ["rifle", "heavyPistol"]),
    `список боеприпасов собран неверно: ${JSON.stringify(rifle.system.ammoVariety)}`
  );

  await carrier.revertCarrierChanges(rifle, ammoMod);
  expect(
    deepEqual(rifle.system.ammoVariety, ["rifle"]),
    "исходный список боеприпасов не восстановился"
  );
}

// --- 3. Повторная установка не затирает сохранённый оригинал -----------------

{
  const weapon = makeItem({
    id: "weapon0000000003",
    name: "Дробовик",
    system: { fireModes: { autoFire: 0, suppressiveFire: false } },
  });
  const node = makeUpgrade("upgrade000000003", "Узел автоогня", {
    "system.fireModes.autoFire": { op: "set", value: 3 },
  });

  await carrier.applyCarrierChanges(weapon, node);
  await carrier.applyCarrierChanges(weapon, node); // повтор
  await carrier.revertCarrierChanges(weapon, node);
  expect(
    weapon.system.fireModes.autoFire === 0,
    "после повторной установки откат вернул не исходное значение"
  );
}

// --- 4. Наложение двух модификаций на одно поле замечено ---------------------

{
  const weapon = makeItem({
    id: "weapon0000000004",
    name: "ПП",
    system: { fireModes: { autoFire: 3, suppressiveFire: false } },
  });
  const first = makeUpgrade("upgrade000000004", "Механизм ПП", {
    "system.fireModes.autoFire": { op: "set", value: 4 },
  });
  const second = makeUpgrade("upgrade000000005", "Другая модификация", {
    "system.fireModes.autoFire": { op: "set", value: 2 },
  });

  warnings.length = 0;
  await carrier.applyCarrierChanges(weapon, first);
  await carrier.applyCarrierChanges(weapon, second);
  expect(warnings.length > 0, "наложение правок на одно поле осталось без предупреждения");
}

// --- 5. Прибавка к числу -----------------------------------------------------

{
  const weapon = makeItem({
    id: "weapon0000000005",
    name: "Экзотика",
    system: { installedItems: { slots: 0 } },
  });
  const rail = makeUpgrade("upgrade000000006", "Рельса", {
    "system.installedItems.slots": { op: "inc", value: 1 },
  });

  await carrier.applyCarrierChanges(weapon, rail);
  expect(weapon.system.installedItems.slots === 1, "прибавка слота не сработала");
  await carrier.revertCarrierChanges(weapon, rail);
  expect(weapon.system.installedItems.slots === 0, "слот не вернулся");
}

// --- 6. Реальные модификации модуля читаются без ошибок ----------------------

{
  const dir = path.join(SOURCES, "addenda-upgrades");
  let withChanges = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    const upgrade = makeItem({
      id: data._id,
      name: data.name,
      flags: data.flags,
    });
    const changes = carrier.getCarrierChanges(upgrade);
    const declared = data.flags?.["cpr-addenda"]?.carrierChanges ?? {};
    expect(
      Object.keys(changes).length === Object.keys(declared).length,
      `«${data.name}»: часть правок отбракована при чтении`
    );
    if (Object.keys(changes).length) withChanges += 1;
  }
  console.log(`Модификаций с правками носителя: ${withChanges}`);
}

// --- 7. Замена штрафа за прицельный выстрел ---------------------------------

{
  const aimed = await import(
    pathToFileURL(path.join(tmp, "aimed-shot.mjs")).href
  );

  /** Бросок-заглушка со штрафом системы, как его собирает CPRAimedAttackRoll. */
  const makeRoll = () => ({
    mods: [
      { value: -8, source: "Aimed Shot Penalty" },
      { value: -2, source: "Раны" },
    ],
  });

  const scanner = makeItem({
    id: "upgrade000000007",
    name: "Суперсканер",
    flags: { "cpr-addenda": { aimedShotPenalty: -4 } },
  });
  const plain = makeItem({ id: "upgrade000000008", name: "Штык", flags: {} });

  const weaponWith = { type: "weapon", system: { installedUpgrades: [scanner] } };
  const weaponWithout = { type: "weapon", system: { installedUpgrades: [plain] } };

  const withScanner = makeRoll();
  aimed.__test.replaceAimedPenalty(withScanner, weaponWith);
  const replaced = withScanner.mods[0];
  expect(replaced.value === -4, `штраф прицеливания не заменён: ${replaced.value}`);
  expect(
    withScanner.mods.some((m) => m.source === "Раны" && m.value === -2),
    "посторонние модификаторы броска пострадали"
  );

  const withoutScanner = makeRoll();
  aimed.__test.replaceAimedPenalty(withoutScanner, weaponWithout);
  expect(
    withoutScanner.mods[0].value === -8,
    "без наводящей модификации штраф изменился, хотя не должен"
  );

  // Модификация не должна делать стрелку хуже, если штраф и так мягче.
  const soft = { mods: [{ value: -2, source: "Aimed Shot Penalty" }] };
  aimed.__test.replaceAimedPenalty(soft, weaponWith);
  expect(soft.mods[0].value === -2, "модификация ухудшила и без того мягкий штраф");
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
