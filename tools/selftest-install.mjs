/**
 * Проверка установки: прогон реальных предметов модуля через реальную логику.
 *
 * `validate-items.js` проверяет, что предмет правильно устроен. Здесь другое:
 * каждая модификация из `sources/` берётся как есть и прогоняется через ту же
 * функцию, которую вызывает система при установке, — против всех восемнадцати
 * типов оружия. Так видно не «данные корректны», а «глушитель встаёт на
 * пистолет и не встаёт на дробовик».
 *
 * Проверяется три вещи:
 *  1. На каждом разрешённом типе оружия модификация устанавливается.
 *  2. На каждом остальном — отклоняется, и отказ сопровождается текстом.
 *  3. Модификация без ограничений и модификация не для оружия проходят везде,
 *     то есть модуль не мешает штатному поведению системы.
 *
 *   node tools/selftest-install.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const SOURCES = path.join(MODULE_ROOT, "sources");
const SCRIPTS = path.join(MODULE_ROOT, "scripts");

const ALL_WEAPON_TYPES = [
  "assaultRifle", "bow", "grenadeLauncher", "heavyMelee", "heavyPistol",
  "heavySmg", "lightMelee", "martialArts", "medMelee", "medPistol",
  "rocketLauncher", "shotgun", "smg", "sniperRifle", "thrownWeapon",
  "unarmed", "vHeavyMelee", "vHeavyPistol",
];

// --- Окружение Foundry в объёме, который нужен проверяемому коду ------------

const notifications = [];
globalThis.game = {
  settings: { get: () => true },
  i18n: {
    localize: (key) => key,
    format: (key, data) => `${key} ${JSON.stringify(data)}`,
  },
};
globalThis.ui = { notifications: { error: (m) => notifications.push(m) } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-install-"));
for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".js")) continue;
  const body = fs
    .readFileSync(path.join(SCRIPTS, file), "utf-8")
    .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
}
const { checkUpgradeFit } = await import(
  pathToFileURL(path.join(tmp, "install-restrictions.mjs")).href
);

// --- Заглушки документов ----------------------------------------------------

/** Оборачивает данные предмета в объект с интерфейсом документа Foundry. */
function asDocument(data) {
  return {
    ...data,
    documentName: "Item",
    getFlag: (moduleId, key) => data.flags?.[moduleId]?.[key],
  };
}

function makeWeapon(weaponType) {
  return {
    name: `Оружие (${weaponType})`,
    documentName: "Item",
    type: "weapon",
    system: { weaponType },
  };
}

function makeCarrier(type) {
  return { name: `Носитель (${type})`, documentName: "Item", type, system: {} };
}

// --- Прогон -----------------------------------------------------------------

const upgrades = [];
const upgradeDir = path.join(SOURCES, "addenda-upgrades");
if (fs.existsSync(upgradeDir)) {
  for (const file of fs.readdirSync(upgradeDir)) {
    if (!file.endsWith(".json")) continue;
    upgrades.push(
      JSON.parse(fs.readFileSync(path.join(upgradeDir, file), "utf-8"))
    );
  }
}

let checks = 0;
let failures = 0;

function report(ok, message) {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`  ПРОВАЛ  ${message}`);
  }
}

console.log(`Модификаций в проверке: ${upgrades.length}\n`);

for (const raw of upgrades) {
  const upgrade = asDocument(raw);
  const allowed = raw.flags?.["cpr-addenda"]?.allowedWeaponTypes ?? [];
  const carrierType = raw.system.type;

  if (carrierType === "weapon" && allowed.length) {
    // Разрешённые типы — должны проходить.
    for (const type of allowed) {
      const verdict = checkUpgradeFit(upgrade, makeWeapon(type));
      report(
        verdict.allowed,
        `«${raw.name}» не встала на разрешённый тип ${type}`
      );
    }

    // Остальные — должны отклоняться, и с внятной причиной.
    for (const type of ALL_WEAPON_TYPES.filter((t) => !allowed.includes(t))) {
      const verdict = checkUpgradeFit(upgrade, makeWeapon(type));
      report(
        !verdict.allowed,
        `«${raw.name}» встала на запрещённый тип ${type}`
      );
      report(
        !verdict.allowed && Boolean(verdict.reason),
        `«${raw.name}»: отказ по типу ${type} без объяснения`
      );
    }
  } else {
    // Без ограничений: модуль не должен вмешиваться вообще.
    const carrier =
      carrierType === "weapon"
        ? makeWeapon("heavyPistol")
        : makeCarrier(carrierType);
    const verdict = checkUpgradeFit(upgrade, carrier);
    report(
      verdict.allowed,
      `«${raw.name}» (${carrierType}) отклонена, хотя ограничений не задано`
    );
  }

  // Модификация не для оружия не должна отсеиваться оружейной проверкой.
  if (carrierType !== "weapon") {
    const verdict = checkUpgradeFit(upgrade, makeCarrier(carrierType));
    report(
      verdict.allowed,
      `«${raw.name}» не встала в носитель типа ${carrierType}`
    );
  }
}

// Отдельно: чужие модификации без наших флагов должны работать как раньше.
const systemLike = asDocument({
  name: "Системная модификация без разметки",
  type: "itemUpgrade",
  system: { type: "weapon" },
  flags: {},
});
for (const type of ALL_WEAPON_TYPES) {
  const verdict = checkUpgradeFit(systemLike, makeWeapon(type));
  report(
    verdict.allowed,
    `неразмеченная модификация заблокирована на типе ${type}`
  );
}

fs.rmSync(tmp, { recursive: true, force: true });

const byCarrier = upgrades.reduce((acc, u) => {
  acc[u.system.type] = (acc[u.system.type] ?? 0) + 1;
  return acc;
}, {});
console.log("Модификации по носителю:");
for (const [type, n] of Object.entries(byCarrier).sort()) {
  console.log(`  ${type.padEnd(12)} ${n}`);
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
