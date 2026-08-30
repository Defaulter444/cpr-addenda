/**
 * Достаёт из компендиумов системы предметы, которые несёт силовая броня.
 *
 * Бортовое оружие и импланты в Data Pool названы своими словами, а в
 * компендиумах у них другие имена. Соответствие ниже выверено вручную по
 * индексу: нечёткий автоподбор здесь показал себя плохо — «рельсотрон
 * Deathwind» он уверенно приводил к «Tsunami Arms Helix», а «выдвижной щит»
 * к «Выдвижному дробовику». Поэтому только точные пары, и только те, в
 * которых нет сомнений.
 *
 * Чего в компендиумах нет вовсе — то и не подставляем: это оружие самого
 * Data Pool, и придумывать ему характеристики нельзя.
 *
 *   node tools/extract-pa-items.js
 *
 * Результат — docs/power-armor-items.json, его читает import_power_armor.py.
 */

const fs = require("fs");
const path = require("path");

const MODULE_ROOT = path.resolve(__dirname, "..");
const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop";
const CLASSIC_LEVEL = path.join(
  FOUNDRY_APP,
  "resources/app/node_modules/classic-level"
);
const SYSTEM_PACKS = path.join(
  path.dirname(path.dirname(MODULE_ROOT)),
  "systems/cyberpunk-red-core/packs"
);

const { ClassicLevel } = require(CLASSIC_LEVEL);

/**
 * Соответствие «как названо в Data Pool» -> «как называется в компендиуме».
 * Ключ — то, что написано в описании комплекта; по нему подставляется предмет.
 */
const WEAPONS = {
  "Kendachi Mono-Three": ["core/weapons", "Kendachi Mono-Three"],
  "Tsunami Arms Helix (CitrusEdition) с коннектором смартлинка":
    ["core/weapons", "Tsunami Arms Helix"],
  "Tsunami Arms Type-18-S": ["core/weapons-branded", "Tsunami Arms Type-18"],
  "электрошоковая дубинка": ["core/weapons", "Stun Baton"],
  "Техтроника Россия BMG-500 (Silver Edition)":
    ["black-chrome/weapons", "Techtronika Russia BMG-500"],
  "ОК снайперская винтовка с барабанным магазином и перекалибровкой снайперской винтовки":
    ["core/weapons", "Sniper Rifle"],
  "ОК ракетница с барабанным магазином и длинной трубой":
    ["core/weapons", "Rocket Launcher"],
  "ОК ракетница с расширенным магазином и коннектором смартлинка":
    ["core/weapons", "Rocket Launcher"],
};

/**
 * Заготовки для оружия Data Pool, которого нет в компендиумах.
 *
 * Свои характеристики документ задаёт полностью, но не говорит ни про
 * боеприпасы, ни про иконку, ни про то, какие приспособления в ствол
 * вставляются. Поэтому берём системное оружие того же класса как основу и
 * переписываем поверх только то, что задано документом.
 */
const BASES = {
  "База: тяжёлый ПП": ["core/weapons", "Heavy SMG"],
  "База: дробовик": ["core/weapons", "Shotgun"],
  "База: снайперская винтовка": ["core/weapons", "Sniper Rifle"],
  "База: штурмовая винтовка": ["core/weapons", "Assault Rifle"],
  "База: очень тяжёлый пистолет": ["core/weapons", "Very Heavy Pistol"],
};

const CYBERWARE = {
  "внутренний агент": ["core/cyberware", "Internal Agent"],
  "прицельный модуль": ["core/cyberware", "Targeting Scope"],
  "усилитель прыжка": ["core/cyberware", "Jump Booster"],
  "телеоптика": ["core/cyberware", "TeleOptics"],
  "теле-оптика": ["core/cyberware", "TeleOptics"],
  "выдвижной щит (x2)": ["core/cyberware", "Popup Shield"],
  "низкая освещённость/ИК/УФ": ["core/cyberware", "Low Light/IR/UV"],
  "рация": ["core/cyberware", "Radio Communicator"],
  "шифратор/дешифратор": ["core/cyberware", "Scrambler/Descrambler"],
  "Цепкая стопа": ["core/cyberware", "Grip Foot"],
  "интерфейсный разъём": ["core/cyberware", "Interface Plugs"],
  "роликовые стопы": ["core/cyberware", "Skate Foot"],
};

/**
 * Читает пак компендиума целиком.
 *
 * @param {String} pack - путь пака относительно packs/, например "core/weapons"
 * @returns {Promise<Array<Object>>}
 */
async function readPack(pack) {
  const dir = path.join(SYSTEM_PACKS, pack);
  if (!fs.existsSync(dir)) {
    throw new Error(`пак не найден: ${dir}`);
  }
  const db = new ClassicLevel(dir, { valueEncoding: "json" });
  const docs = [];
  try {
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith("!items!")) docs.push(value);
    }
  } finally {
    await db.close();
  }
  return docs;
}

(async () => {
  const caches = new Map();
  const result = {};
  const missing = [];

  for (const [group, table] of [
    ["weapon", WEAPONS],
    ["cyberware", CYBERWARE],
    ["weapon", BASES],
  ]) {
    for (const [label, [pack, name]] of Object.entries(table)) {
      if (!caches.has(pack)) caches.set(pack, await readPack(pack));
      const doc = caches.get(pack).find((d) => d.name === name);
      if (!doc) {
        missing.push(`${label} -> "${name}" в ${pack}`);
        continue;
      }
      if (doc.type !== group) {
        missing.push(`${label} -> "${name}": тип ${doc.type}, а ожидался ${group}`);
        continue;
      }
      result[label] = { pack, matched: name, doc };
    }
  }

  if (missing.length) {
    console.error("Не нашлось в компендиумах:");
    missing.forEach((m) => console.error(`  ${m}`));
    throw new Error("Соответствие устарело — правьте таблицу в этом файле.");
  }

  const out = path.join(MODULE_ROOT, "docs", "power-armor-items.json");
  fs.writeFileSync(out, JSON.stringify(result, null, 1) + "\n", "utf-8");
  console.log(
    `Извлечено предметов: ${Object.keys(result).length} ` +
      `(оружие ${Object.keys(WEAPONS).length}, импланты ${Object.keys(CYBERWARE).length}, ` +
      `заготовок ${Object.keys(BASES).length})`
  );
  for (const [label, entry] of Object.entries(result)) {
    console.log(`  ${label}  ->  ${entry.doc.name}`);
  }
})().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
