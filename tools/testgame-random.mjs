/**
 * Проверка рандомайзера шестёрок.
 *
 * Расклад — обычный объект, Foundry для него не нужен, поэтому проверяется он
 * целиком и насквозь: все роли на всех ступенях, а не пара примеров.
 *
 * Главное, что здесь охраняется, — правило «шестёрка не бегает с РПГ». Оно
 * взято не из головы: в книге гранатомёт есть ровно у одного НИП, киберпсиха, и
 * это угроза уровня босса (с. 418).
 *
 *   node tools/testgame-random.mjs
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

const R = await import(
  pathToFileURL(path.join(MODULE_ROOT, "scripts", "mook-random.js")).href
);

/* ------------------------------------------------------------------ */
/*  Настоящие компендиумы системы                                      */
/* ------------------------------------------------------------------ */

/** Тяжёлое оружие по названиям — для проверки «шестёрка без РПГ» на листе. */
const HEAVY_NAMES = ["Grenade Launcher", "Rocket Launcher"];

/**
 * Вживлённое железо без корпусов.
 *
 * Система выдаёт каждому актёру три пустых корпуса («External (7 Option
 * Slots)» и товарищи) — это тоже предметы вида `cyberware`, но не импланты, и
 * считать их вместе с настоящими нельзя.
 *
 * @param {Object} mook - собранный актёр
 * @returns {Array<Object>}
 */
function implants(mook) {
  return mook.items.filter(
    (item) => item.type === "cyberware" && !/\(7 Option Slots\)$/.test(item._english)
  );
}

/**
 * Читает предметные компендиумы системы прямо с диска.
 *
 * Пакеты Foundry — это базы LevelDB, и открыть их можно только тем же
 * `classic-level`, что лежит в самой Foundry. Если её нет (проверку гоняют не на
 * машине мастера), возвращаем null и этот кусок пропускаем: проверка полезная,
 * но не обязана быть везде.
 *
 * @async
 * @returns {Promise<Map<String, Object>|null>} - имя -> {type, weaponType}
 */
async function packNames() {
  const DATA = path.resolve(MODULE_ROOT, "..", "..");
  const SYSTEM = path.join(DATA, "systems", "cyberpunk-red-core");
  const manifest = path.join(SYSTEM, "system.json");
  if (!fs.existsSync(manifest)) return null;

  const candidates = [
    "C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/classic-level/index.js",
    "C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/node_modules/classic-level/index.js",
    "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/node_modules/classic-level/index.js",
  ];
  const lib = candidates.find((file) => fs.existsSync(file));
  if (!lib) return null;

  let ClassicLevel;
  try {
    ({ ClassicLevel } = await import(pathToFileURL(lib).href));
  } catch {
    return null;
  }

  // Пакеты берём ИЗ МАНИФЕСТА, а не обходом папок. Обход однажды принял
  // `packs/core` за базу, а `classic-level` по умолчанию создаёт базу, которой
  // нет, — и в системных папках завелись шесть пустых баз. Манифест называет
  // ровно то, что есть, а `createIfMissing: false` не даёт создать лишнего.
  const packs = JSON.parse(fs.readFileSync(manifest, "utf-8")).packs ?? [];
  const names = new Map();

  /**
   * Вычитывает одну базу.
   *
   * @param {String} dir - папка базы
   * @returns {Promise<Boolean>} - удалось ли
   */
  const read = async (dir) => {
    const db = new ClassicLevel(dir, { valueEncoding: "json", createIfMissing: false });
    try {
      await db.open();
      for await (const [key, value] of db.iterator()) {
        if (!key.startsWith("!items!") || !value?.name) continue;
        // Ключ — ВИД и название: «Subdermal Armor» есть и среди брони, и среди
        // имплантов, и по одному названию они неразличимы.
        const id = `${value.type}|${value.name}`;
        if (names.has(id)) continue;
        names.set(id, {
          name: value.name,
          type: value.type,
          weaponType: value.system?.weaponType ?? "",
        });
      }
      return true;
    } catch {
      return false;
    } finally {
      await db.close().catch(() => {});
    }
  };

  let copies = null;
  for (const entry of packs) {
    const dir = path.resolve(SYSTEM, entry.path);
    if (!fs.existsSync(path.join(dir, "CURRENT"))) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await read(dir)) continue;

    // База занята запущенной Foundry. Это обычное дело — мастер играет, — но
    // пропускать сверку названий из-за этого нельзя: именно она ловит опечатки
    // вроде «Heavy Melee Weapon». Читаем копию: у неё свой LOCK.
    copies ??= fs.mkdtempSync(path.join(os.tmpdir(), "cpr-packs-"));
    const spare = path.join(copies, entry.name);
    try {
      fs.cpSync(dir, spare, { recursive: true });
      fs.rmSync(path.join(spare, "LOCK"), { force: true });
      // eslint-disable-next-line no-await-in-loop
      await read(spare);
    } catch {
      // Не вышло и с копией — этот пакет просто не попадёт в сверку.
    }
  }
  if (copies) fs.rmSync(copies, { recursive: true, force: true });
  return names.size ? names : null;
}

/* ------------------------------------------------------------------ */
/*  Заглушка Foundry                                                   */
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

/** Как Foundry раскладывает `{"a.b": 1}` по вложенным объектам. */
function setProperty(object, key, value) {
  const parts = key.split(".");
  let target = object;
  while (parts.length > 1) {
    const part = parts.shift();
    if (typeof target[part] !== "object" || target[part] === null) target[part] = {};
    target = target[part];
  }
  target[parts[0]] = value;
}

/**
 * Содержимое компендиумов, как в системе.
 *
 * Названия и типы сверены с настоящими пакетами (проверка выше следит, чтобы
 * они не разошлись). Оружие качества — отдельные позиции, как в системе;
 * марочный «Malorian Arms 3516» вариантов качества не имеет.
 */
function packContents() {
  const weapons = [
    ["Medium Pistol", "medPistol"], ["Heavy Pistol", "heavyPistol"],
    ["Very Heavy Pistol", "vHeavyPistol"], ["SMG", "smg"], ["Heavy SMG", "smg"],
    ["Shotgun", "shotgun"], ["Assault Rifle", "assaultRifle"],
    ["Sniper Rifle", "sniperRifle"], ["Grenade Launcher", "grenadeLauncher"],
    ["Rocket Launcher", "rocketLauncher"], ["Bow", "bow"],
    ["Combat Knife", "lightMelee"], ["Light Melee", "lightMelee"],
    ["Medium Melee", "medMelee"], ["Heavy Melee", "heavyMelee"],
    ["Very Heavy Melee", "vHeavyMelee"],
  ];
  const items = [];
  for (const [name, type] of weapons) {
    for (const suffix of ["", " (Poor)", " (Excellent)"]) {
      items.push({ name: `${name}${suffix}`, type: "weapon", system: { weaponType: type } });
    }
  }
  items.push({ name: "Malorian Arms 3516", type: "weapon", system: { weaponType: "vHeavyPistol" } });

  for (const armour of ["Leathers", "Kevlar®", "Light Armorjack", "Medium Armorjack"]) {
    for (const spot of ["Body", "Head"]) {
      items.push({ name: `${armour} (${spot})`, type: "armor", system: { equipped: "owned" } });
    }
  }
  // Ловушка из настоящих компендиумов: подкожная броня лежит и среди брони,
  // и среди имплантов. Поиск по одному названию отдавал броню — шестёрка
  // получала третий кусок брони вместо подкожки.
  items.push({ name: "Subdermal Armor", type: "armor", system: { equipped: "owned" } });

  const chrome = [
    ["Neural Link", "neuralWare", true], ["Cyberaudio Suite", "cyberAudioSuite", true],
    ["Cybereye", "cyberEye", true], ["Cyberarm", "cyberArm", true],
    ["Cyberleg", "cyberLeg", true],
    ["Subdermal Armor", "cyberwareExternal", false],
    ["Grafted Muscle and Bone Lace", "cyberwareInternal", false],
    // Опции: вид у них тот же, что у опоры, — иначе внутрь не встанут.
    ["Interface Plugs", "neuralWare", false], ["Kerenzikov", "neuralWare", false],
    ["Sandevistan", "neuralWare", false],
    ["Amplified Hearing", "cyberAudioSuite", false],
    ["Radio Communicator", "cyberAudioSuite", false],
    ["Low Light/IR/UV", "cyberEye", false], ["Image Enhance", "cyberEye", false],
    ["Targeting Scope", "cyberEye", false],
    ["Rippers", "cyberArm", false], ["Standard Hand", "cyberArm", false],
    ["Standard Foot", "cyberLeg", false], ["Jump Booster", "cyberLeg", false],
  ];
  for (const [name, kind, foundational] of chrome) {
    items.push({
      name, type: "cyberware",
      system: { type: kind, isFoundational: foundational, size: 1 },
    });
  }

  for (const role of R.ROLE_ORDER) {
    if (role === "none") continue;
    items.push({
      name: role.charAt(0).toUpperCase() + role.slice(1),
      type: "role", system: { rank: 0 },
    });
  }

  // Подвиды навыков живут в отдельных компендиумах, а не среди базовых —
  // ровно как в системе.
  for (const name of ["Science (Chemistry)", "Play Instrument (Guitar)"]) {
    items.push({ name, type: "skill", system: { level: 0, stat: "int" } });
  }
  return items;
}

/** Базовые навыки, которые система выдаёт новому актёру. */
function coreSkillNames() {
  const names = new Set();
  for (const role of R.ROLE_ORDER) {
    const plan = R.planMook({ role, tier: "mook", chrome: "none", catalogue: [] });
    for (const name of Object.keys(plan.skills)) names.add(name);
  }
  // Эти двух в `internal_skills` нет — их доносят из отдельных компендиумов.
  names.delete("Science (Chemistry)");
  names.delete("Play Instrument (Guitar)");
  return [...names];
}

/**
 * Поднимает поддельную Foundry.
 *
 * @param {Object} options - {translate} — включён ли Babele
 * @returns {Object} - {restore, createdWithSystem}
 */
function makeFoundryStub({ translate }) {
  const saved = { ...globalThis };
  const state = { createdWithSystem: false, usedBareActor: false };
  let counter = 0;
  const nextId = () => `id${(counter += 1)}`;

  const shown = (english) => (translate ? `RU:${english}` : english);

  const contents = packContents().map((entry) => ({
    ...entry,
    _id: nextId(),
    name: shown(entry.name),
    flags: translate ? { babele: { originalName: entry.name, translated: true } } : {},
  }));

  const pack = {
    collection: "cyberpunk-red-core.core",
    documentName: "Item",
    metadata: { packageName: "cyberpunk-red-core" },
    getIndex: async () => contents,
    getDocument: async (id) => {
      const entry = contents.find((item) => item._id === id);
      if (!entry) return null;
      return { toObject: () => JSON.parse(JSON.stringify(entry)) };
    },
  };

  /** Предмет на листе. */
  const makeItem = (data) => {
    // Свой id на каждый предмет: Foundry тоже раздаёт новые, а не тянет id из
    // компендиума. Если сборка пришлёт две копии с одним `_id`, две киберруки
    // окажутся одной — проверка опций это увидит.
    const item = {
      ...data,
      id: nextId(),
      system: JSON.parse(JSON.stringify(data.system ?? {})),
      _english: data.flags?.babele?.originalName ?? data.name,
    };
    item._id = item.id;
    if (item.type === "cyberware" && item.system.isFoundational) {
      item.system.installedItems = item.system.installedItems ?? { list: [], usedSlots: 0, slots: 7 };
      item.installItems = async (list) => {
        for (const other of list) {
          if (!item.system.installedItems.list.includes(other.id)) {
            item.system.installedItems.list.push(other.id);
          }
        }
        return true;
      };
    }
    return item;
  };

  class FakeActor {
    constructor(data) {
      // Свой id у каждого актёра — как в Foundry. Без него «новый актёр»
      // неотличим от старого, и сборка не находит того, кого только что
      // создала.
      this.id = nextId();
      this._id = this.id;
      this.name = data.name;
      this.type = data.type;
      this.folder = data.folder;
      this.items = [];
      this.system = {
        stats: Object.fromEntries(
          ["int", "ref", "dex", "tech", "cool", "will", "luck", "move", "body", "emp"]
            .map((key) => [key, { value: 6 }])
        ),
        derivedStats: { hp: { max: 0, value: 0 } },
        roleInfo: { activeRole: "", activeNetRole: "" },
        installedItems: { list: [] },
      };
    }

    static async create(data) {
      // Система раздаёт базовые навыки и корпуса ТОЛЬКО актёру без `system`.
      if (data.system !== undefined) state.createdWithSystem = true;
      const actor = new FakeActor(data);
      const core = coreSkillNames().map((name) => ({
        _id: nextId(), name, type: "skill", system: { level: 0, stat: "int" },
      }));
      const frames = [
        ["External (7 Option Slots)", "cyberwareExternal"],
        ["Internal (7 Option Slots)", "cyberwareInternal"],
        ["Fashionware (7 Option Slots)", "fashionware"],
      ].map(([name, kind]) => ({
        _id: nextId(), name, type: "cyberware",
        system: { type: kind, isFoundational: true, size: 1, installedItems: { list: [], usedSlots: 0, slots: 7 } },
      }));
      await actor.createEmbeddedDocuments("Item", [...core, ...frames]);
      const ids = actor.items
        .filter((item) => item.type === "cyberware")
        .map((item) => item.id);
      actor.system.installedItems.list = ids;
      globalThis.game.actors.push(actor);

      // Ловушка один в один как на столе. Во-первых, `CPRActor.create`
      // заканчивается на `actor.update({...installedItems.list})`, а
      // `Document#update` отдаёт `updates.shift()` — пустоту, когда менять
      // нечего; список уже правильный, и создание возвращает НИЧЕГО при
      // созданном актёре. Во-вторых, хук `createActor` здесь намеренно НЕ
      // зовётся: у мастера он тоже не выручил, и сборка не должна на него
      // рассчитывать. Остаётся единственный надёжный признак — актёр,
      // которого в мире не было.
      return actor.update({ "system.installedItems.list": ids });
    }

    async createEmbeddedDocuments(kind, list) {
      const made = list.map(makeItem);
      this.items.push(...made);
      return made;
    }

    async updateEmbeddedDocuments(kind, updates) {
      for (const update of updates) {
        const item = this.items.find((candidate) => candidate.id === update._id);
        if (!item) continue;
        for (const [key, value] of Object.entries(update)) {
          if (key !== "_id") setProperty(item, key, value);
        }
      }
      return updates;
    }

    async update(changes) {
      let touched = false;
      for (const [key, value] of Object.entries(changes)) {
        const before = JSON.stringify(getProperty(this, key));
        if (before === JSON.stringify(value)) continue;
        setProperty(this, key, value);
        touched = true;
      }
      // Как Foundry: менять нечего — возвращать нечего.
      return touched ? this : undefined;
    }

    get sheet() {
      return { render: () => {} };
    }
  }

  // Глобальный `Actor` — БАЗОВЫЙ класс Foundry, и системной раздачи навыков в
  // нём нет: систему подключают через `CONFIG.Actor.documentClass`. Здесь это
  // воспроизведено буквально — подсовываем пустышку. Если сборка снова полезет
  // в глобальный `Actor`, шестёрка выйдет без навыков и проверка это увидит.
  class BareActor extends FakeActor {
    static async create(data) {
      state.usedBareActor = true;
      return new BareActor(data);
    }
  }
  globalThis.Actor = BareActor;
  globalThis.getDocumentClass = (name) => {
    if (name === "Actor") return FakeActor;
    if (name === "Folder") return globalThis.Folder;
    return null;
  };
  globalThis.Folder = {
    create: async (data) => {
      const folder = { ...data, id: `folder-${data.name}` };
      globalThis.game.folders.push(folder);
      return folder;
    },
  };
  globalThis.foundry = {
    utils: {
      getProperty,
      deepClone: (value) => JSON.parse(JSON.stringify(value)),
    },
  };
  globalThis.game = {
    system: { id: "cyberpunk-red-core" },
    folders: [],
    actors: [],
    i18n: {
      localize: (key) => key,
      format: (key, data) => `${key} ${JSON.stringify(data)}`,
    },
    packs: Object.assign([pack], { get: (id) => (id === pack.collection ? pack : null) }),
  };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };

  const listeners = new Map();
  let hookId = 0;
  globalThis.Hooks = {
    on: (event, fn) => {
      hookId += 1;
      listeners.set(hookId, { event, fn });
      return hookId;
    },
    off: (event, id) => listeners.delete(id),
    callAll: (event, ...args) => {
      for (const entry of listeners.values()) {
        if (entry.event === event) entry.fn(...args);
      }
    },
  };
  state.hooks = listeners;

  return {
    get createdWithSystem() {
      return state.createdWithSystem;
    },
    get usedBareActor() {
      return state.usedBareActor;
    },
    get danglingHooks() {
      return state.hooks ? state.hooks.size : 0;
    },
    restore() {
      for (const key of ["Actor", "Folder", "getDocumentClass", "Hooks", "foundry", "game", "ui"]) {
        if (key in saved) globalThis[key] = saved[key];
        else delete globalThis[key];
      }
    },
  };
}

/** Повторяемый источник случайности: сравниваем поведение, а не удачу. */
function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Оружие, какое лежит в компендиумах системы. */
const CATALOGUE = [
  { name: "Medium Pistol", type: "medPistol" },
  { name: "Heavy Pistol", type: "heavyPistol" },
  { name: "Very Heavy Pistol", type: "vHeavyPistol" },
  { name: "SMG", type: "smg" },
  { name: "Heavy SMG", type: "heavySmg" },
  { name: "Shotgun", type: "shotgun" },
  { name: "Assault Rifle", type: "assaultRifle" },
  { name: "Sniper Rifle", type: "sniperRifle" },
  { name: "Grenade Launcher", type: "grenadeLauncher" },
  { name: "Rocket Launcher", type: "rocketLauncher" },
  { name: "Combat Knife", type: "lightMelee" },
  { name: "Medium Melee Weapon", type: "medMelee" },
  { name: "Heavy Melee Weapon", type: "heavyMelee" },
];

const every = [];
for (const tier of R.TIER_ORDER) {
  for (const role of R.ROLE_ORDER) {
    for (const chrome of R.CHROME_ORDER) {
      every.push({ tier, role, chrome });
    }
  }
}

console.log("Рандомайзер шестёрок\n");
console.log(`Разобрано сочетаний: ${every.length} (${R.TIER_ORDER.length} ступеней × ` +
  `${R.ROLE_ORDER.length} ролей × ${R.CHROME_ORDER.length} степеней железа)`);

console.log("\nШестёрка не бегает с РПГ");
{
  // Ради этого правила всё и затевалось. Проверяем ИСЧЕРПЫВАЮЩЕ: каждую роль на
  // каждой ступени, много раз, потому что оружие выбирается случайно.
  let heavyBelowBoss = 0;
  let heavySeen = 0;
  const random = seeded(4242);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const { tier, role, chrome } of every) {
      const plan = R.planMook({ role, tier, chrome, random, catalogue: CATALOGUE });
      for (const weapon of plan.weapons) {
        if (!R.HEAVY_TYPES.includes(weapon.type)) continue;
        heavySeen += 1;
        if (tier !== "boss") {
          heavyBelowBoss += 1;
          expect(false, `${role}/${tier} получил «${weapon.name}» — тяжёлое ниже босса`);
        }
      }
    }
  }
  expect(heavyBelowBoss === 0, `тяжёлое оружие ниже босса выдано ${heavyBelowBoss} раз`);
  console.log(`  проверено раскладов: ${60 * every.length}, тяжёлого ниже босса: ${heavyBelowBoss}`);

  // И обратная сторона: разрешённый список босса тяжёлое всё-таки содержит,
  // иначе правило соблюдалось бы просто потому, что его негде нарушить.
  const bossAllows = R.TIER_WEAPONS.boss.filter((t) => R.HEAVY_TYPES.includes(t));
  expect(bossAllows.length > 0, "у босса в списке нет ни одного тяжёлого — проверка пустая");
  for (const tier of ["mook", "lieutenant", "miniboss"]) {
    const leak = R.TIER_WEAPONS[tier].filter((t) => R.HEAVY_TYPES.includes(t));
    expect(leak.length === 0, `ступень «${tier}» разрешает тяжёлое: ${leak.join(", ")}`);
  }
}

console.log("\nОчки здоровья сходятся с книжными образцами");
{
  // Бустер 20, дорожный бандит 25; сотрудник СБ 30, телохранитель 35;
  // шеф восстановителей 40; офицер СБ 40, киберпсих 40 (с. 414-418).
  const book = {
    mook: [20, 25], lieutenant: [30, 35], miniboss: [35, 40], boss: [40, 45],
  };
  const random = seeded(99);
  for (const tier of R.TIER_ORDER) {
    let low = Infinity;
    let high = -Infinity;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      for (const role of R.ROLE_ORDER) {
        const plan = R.planMook({ role, tier, chrome: "none", random, catalogue: CATALOGUE });
        low = Math.min(low, plan.hp);
        high = Math.max(high, plan.hp);
      }
    }
    const [least, most] = book[tier];
    expect(low >= least, `у ступени «${tier}» ПЗ падают до ${low}, а книга держит ${least}`);
    expect(high <= most, `у ступени «${tier}» ПЗ доходят до ${high}, а книга держит ${most}`);
    console.log(`  ${tier.padEnd(11)} ПЗ ${low}–${high}, книга ${least}–${most}`);
  }
}

console.log("\nРоль слышна в характеристиках");
{
  const random = seeded(31337);
  for (const role of R.ROLE_ORDER) {
    const plan = R.planMook({ role, tier: "miniboss", chrome: "none", random, catalogue: CATALOGUE });
    const priority = R.ROLES[role].stats;
    for (const key of priority) {
      // ТЕЛО и ВОЛЮ задаёт ступень, а не роль: из них считаются очки здоровья,
      // а те у книжных образцов растут ровно со ступенью. Роль здесь слышна
      // иначе — она поднимает значение к верху полосы ступени.
      if (key === "body" || key === "will") {
        expect(
          plan.stats[key] === R.TIERS.miniboss[key][1],
          `у роли «${role}» приоритетная ${key} вышла ${plan.stats[key]}, ` +
            `а верх полосы ступени ${R.TIERS.miniboss[key][1]}`
        );
        continue;
      }
      expect(
        plan.stats[key] >= 5,
        `у роли «${role}» приоритетная ${key} вышла ${plan.stats[key]}`
      );
    }
    // УДЧ у шестёрок нет (с. 414).
    expect(plan.stats.luck === 0, `у роли «${role}» появилась УДЧ ${plan.stats.luck}`);
  }
}

console.log("\nРоль слышна в навыках и оружии");
{
  const random = seeded(2024);
  const netrunner = R.planMook({ role: "netrunner", tier: "boss", chrome: "none", random, catalogue: CATALOGUE });
  const solo = R.planMook({ role: "solo", tier: "boss", chrome: "none", random, catalogue: CATALOGUE });

  expect(netrunner.skills.Cryptography > netrunner.skills.Athletics,
    "у нетраннера криптография не выше атлетики");
  expect(netrunner.skills["Electronics/Security Tech"] >= 10,
    `у нетраннера-босса электроника ${netrunner.skills["Electronics/Security Tech"]}`);
  expect(
    !netrunner.weapons.some((w) => w.type === "assaultRifle"),
    "нетраннеру досталась штурмовая винтовка — не его оружие по книге"
  );

  expect(solo.skills.Autofire >= 10, `у соло-босса автоогонь ${solo.skills.Autofire}`);
  expect(solo.skills.Tactics >= 10, `у соло-босса тактика ${solo.skills.Tactics}`);
  expect(
    solo.weapons.some((w) => w.type === "assaultRifle"),
    "соло остался без штурмовой винтовки, хотя книга даёт её ему"
  );

  // Каждый хоть чем-то вооружён: безоружная шестёрка на столе бесполезна.
  const random2 = seeded(555);
  for (const { tier, role } of every) {
    const plan = R.planMook({ role, tier, chrome: "none", random: random2, catalogue: CATALOGUE });
    expect(plan.weapons.length > 0, `${role}/${tier} остался без оружия`);
  }
}

console.log("\nСтупень поднимает профессиональные навыки, а не все подряд");
{
  const random = seeded(808);
  const low = R.planMook({ role: "solo", tier: "mook", chrome: "none", random, catalogue: CATALOGUE });
  const high = R.planMook({ role: "solo", tier: "boss", chrome: "none", random, catalogue: CATALOGUE });

  expect(high.skills.Autofire > low.skills.Autofire, "автоогонь не вырос со ступенью");
  expect(high.skills.Tactics > low.skills.Tactics, "тактика не выросла со ступенью");
  // Базовые остаются базовыми: разница между бустером и офицером СБ в книге —
  // в профессиональных навыках, а не в умении плавать.
  expect(
    high.skills.Athletics === low.skills.Athletics,
    `атлетика выросла со ступенью: ${low.skills.Athletics} -> ${high.skills.Athletics}`
  );
  expect(high.skills.Concentration === low.skills.Concentration, "концентрация выросла со ступенью");

  // Потолок навыка — 10: выше в книге у шестёрок не встречается.
  for (const { tier, role } of every) {
    const plan = R.planMook({ role, tier, chrome: "none", random, catalogue: CATALOGUE });
    const over = Object.entries(plan.skills).filter(([, value]) => value > 10);
    expect(over.length === 0, `${role}/${tier}: навыки выше 10 — ${over.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
}

console.log("\nЖелезо по выбранной степени");
{
  const random = seeded(77);
  const counts = {};
  const options = {};
  for (const chrome of R.CHROME_ORDER) {
    const plan = R.planMook({ role: "solo", tier: "boss", chrome, random, catalogue: CATALOGUE });
    counts[chrome] = plan.cyberware.length;
    options[chrome] = plan.cyberware.reduce((sum, part) => sum + part.options.length, 0);
  }
  expect(counts.none === 0, `«без имплантов» дал ${counts.none} штук`);
  expect(counts.minimal > 0 && counts.minimal < counts.serious,
    `минимум ${counts.minimal}, серьёзный ${counts.serious} — порядок нарушен`);
  expect(counts.serious < counts.fullborg,
    `серьёзный ${counts.serious}, полная конверсия ${counts.fullborg}`);
  console.log(
    `  имплантов по степеням: ${R.CHROME_ORDER.map((c) => `${c} ${counts[c]} (опций ${options[c]})`).join(", ")}`
  );
  expect(options.none === 0, `«без имплантов» дал ${options.none} опций`);
  expect(options.minimal > 0, "у минимального набора нет ни одной опции");
  expect(options.fullborg > options.serious, `опций: серьёзный ${options.serious}, борг ${options.fullborg}`);

  // Полная конверсия — это обе руки и обе ноги, иначе она не полная.
  const full = R.planMook({ role: "solo", tier: "boss", chrome: "fullborg", random, catalogue: CATALOGUE });
  const arms = full.cyberware.filter((part) => part.name === "Cyberarm").length;
  const legs = full.cyberware.filter((part) => part.name === "Cyberleg").length;
  expect(arms === 2 && legs === 2, `у полной конверсии рук ${arms}, ног ${legs}`);

  // Голая киберрука ничего не делает — весь смысл в том, что в неё вставлено.
  // Пустые опоры и были жалобой: «отсутствуют опции имплантов».
  for (const level of ["minimal", "serious", "fullborg"]) {
    const plan = R.planMook({ role: "solo", tier: "boss", chrome: level, random, catalogue: CATALOGUE });
    const bare = plan.cyberware.filter((part) => !part.options.length);
    const named = bare.map((part) => part.name);
    // Подкожная броня и мышцы опций не имеют по своей природе — они не корпуса.
    const allowedBare = ["Subdermal Armor", "Grafted Muscle and Bone Lace"];
    const wrong = named.filter((name) => !allowedBare.includes(name));
    expect(wrong.length === 0, `на степени «${level}» без опций остались: ${wrong.join(", ")}`);
  }
}

console.log("\nУ рядовой шестёрки нет роли");
{
  const random = seeded(1);
  for (const role of R.ROLE_ORDER) {
    const plan = R.planMook({ role, tier: "mook", chrome: "none", random, catalogue: CATALOGUE });
    expect(plan.roleRank === 0, `${role} на нижней ступени получил ранг роли ${plan.roleRank}`);
  }
  // А у босса — есть, если роль вообще выбрана.
  const boss = R.planMook({ role: "solo", tier: "boss", chrome: "none", random, catalogue: CATALOGUE });
  expect(boss.roleRank > 0, "у босса с ролью не оказалось ранга");
  const plain = R.planMook({ role: "none", tier: "boss", chrome: "none", random, catalogue: CATALOGUE });
  expect(plain.roleRank === 0, "бандит без роли получил ранг роли");
}

console.log("\nОдин и тот же посев даёт один и тот же расклад");
{
  const one = R.planMook({ role: "fixer", tier: "miniboss", chrome: "serious", random: seeded(500), catalogue: CATALOGUE });
  const two = R.planMook({ role: "fixer", tier: "miniboss", chrome: "serious", random: seeded(500), catalogue: CATALOGUE });
  expect(JSON.stringify(one) === JSON.stringify(two), "два прогона с одним посевом разошлись");
}

console.log("\nБроня растёт со ступенью");
{
  const random = seeded(11);
  const armour = R.TIER_ORDER.map(
    (tier) => R.planMook({ role: "none", tier, chrome: "none", random, catalogue: CATALOGUE }).armor
  );
  expect(new Set(armour).size === armour.length, `броня повторяется по ступеням: ${armour.join(", ")}`);
  expect(armour[0] === "Leathers", `у шестёрки броня «${armour[0]}», а в книге кожа`);
  expect(armour[1] === "Kevlar®", `у лейтенанта броня «${armour[1]}», а в книге кевлар`);
  console.log(`  ${R.TIER_ORDER.map((t, i) => `${t}: ${armour[i]}`).join(", ")}`);
}

console.log("\nВсё, что просит раскладчик, есть в компендиумах");
{
  // Самая частая поломка — название мимо: в книге «тяжёлое оружие ближнего
  // боя», в компендиуме предмет зовётся «Heavy Melee», а в раскладчике было
  // написано «Heavy Melee Weapon» — и шестёрка выходила безоружной, молча.
  //
  // Поэтому сверяемся с НАСТОЯЩИМИ компендиумами системы, а не со списком,
  // переписанным сюда руками: переписанный список разъедется вместе с ошибкой.
  const names = await packNames();
  if (!names) {
    console.log("  компендиумы системы не прочитались — пропускаем");
  } else {
    console.log(`  прочитано записей: ${names.size}`);

    const asked = new Map();
    const ask = (type, name) => asked.set(`${type}|${name}`, `${name} (${type})`);

    for (const role of Object.values(R.ROLES)) {
      for (const weapon of role.weapons) ask("weapon", weapon);
      if (role.melee) ask("weapon", role.melee);
      for (const skill of Object.keys(role.skills)) ask("skill", skill);
    }
    for (const chrome of Object.values(R.CHROME)) {
      for (const part of chrome.parts) {
        ask("cyberware", part.name);
        // Опции — половина смысла импланта, и промах в их названии виден так же
        // плохо, как промах в самом импланте: гнездо просто останется пустым.
        for (const option of part.options) ask("cyberware", option);
      }
    }
    for (const tier of Object.values(R.TIERS)) {
      ask("armor", `${tier.armor} (Body)`);
      ask("armor", `${tier.armor} (Head)`);
      // Оружие качества — тоже отдельные позиции в компендиуме.
      for (const role of Object.values(R.ROLES)) {
        for (const weapon of role.weapons) {
          if (tier.quality === "poor") ask("weapon", `${weapon} (Poor)`);
          if (tier.quality === "excellent") ask("weapon", `${weapon} (Excellent)`);
        }
      }
    }
    for (const role of R.ROLE_ORDER) {
      if (role === "none") continue;
      ask("role", role.charAt(0).toUpperCase() + role.slice(1));
    }

    const gone = [...asked.entries()]
      .filter(([key]) => !names.has(key))
      .map(([, label]) => label)
      .sort();
    expect(gone.length === 0, `нет в компендиумах: ${gone.join(", ")}`);
    console.log(`  проверено названий: ${asked.size}, ненайденных: ${gone.length}`);

    // Ловушка, ради которой ключ стал парой: подкожная броня существует в двух
    // видах сразу, и раньше поиск по имени отдавал броню вместо импланта.
    expect(
      names.has("armor|Subdermal Armor") && names.has("cyberware|Subdermal Armor"),
      "подкожной брони нет в обоих видах — проверка на путаницу видов пустая"
    );

    // И типы оружия: список разрешённого по ступеням должен описывать то, что
    // в системе действительно есть, иначе ступень запрещает пустоту.
    const types = new Set(
      [...names.values()].filter((e) => e.type === "weapon").map((e) => e.weaponType)
    );
    for (const [tier, allowed] of Object.entries(R.TIER_WEAPONS)) {
      const real = allowed.filter((t) => types.has(t));
      expect(real.length > 0, `у ступени «${tier}» ни один разрешённый тип не встречается в системе`);
    }
    // Тяжёлое оружие в системе есть — значит, запрет не пустой.
    const heavyReal = R.HEAVY_TYPES.filter((t) => types.has(t));
    expect(heavyReal.length > 0, "в системе нет ни одного тяжёлого типа — правило про РПГ не о чем");
    console.log(`  тяжёлые типы в системе: ${heavyReal.join(", ")}`);
  }
}

console.log("\nСборка актёра: имена ищутся по-английски даже под Babele");
{
  // Babele переводит имена в компендиумах, и `pack.getIndex()` отдаёт
  // «Штурмовая винтовка». Искать по русскому названию нельзя — перевод правят.
  // Проверяем, что сборка находит вещи по `flags.babele.originalName`.
  const stub = makeFoundryStub({ translate: true });
  const create = await import(
    pathToFileURL(path.join(MODULE_ROOT, "scripts", "mook-create.js")).href
  );

  const index = await create.itemIndex();
  expect(create.lookup(index, "weapon", "Assault Rifle"), "по английскому названию винтовка не нашлась");
  expect(!create.lookup(index, "weapon", "Штурмовая винтовка"), "в указатель попало переведённое имя");

  // Одно название, два вида: подкожная броня. Указатель обязан различать их,
  // иначе имплант подменяется бронёй.
  expect(create.lookup(index, "armor", "Subdermal Armor"), "подкожная броня не нашлась как броня");
  const asChrome = create.lookup(index, "cyberware", "Subdermal Armor");
  expect(asChrome, "подкожная броня не нашлась как имплант");
  expect(asChrome?.type === "cyberware", `по виду «cyberware» вернулся «${asChrome?.type}»`);

  const catalogue = create.weaponCatalogue(index);
  expect(catalogue.length > 0, "список оружия пуст");
  expect(
    !catalogue.some((w) => /\((?:Poor|Excellent)\)$/.test(w.name)),
    "в список оружия попали позиции качества — жребий вытянет один ствол трижды"
  );

  expect(
    create.qualityName(index, "Assault Rifle", "poor") === "Assault Rifle (Poor)",
    "дрянное качество не подобралось"
  );
  expect(
    create.qualityName(index, "Assault Rifle", "standard") === "Assault Rifle",
    "обычное качество зачем-то получило приставку"
  );
  // У марочного оружия вариантов качества нет — возвращаем как есть, а не
  // выдумываем несуществующую позицию.
  expect(
    create.qualityName(index, "Malorian Arms 3516", "excellent") === "Malorian Arms 3516",
    "для марочного оружия придумана несуществующая позиция качества"
  );

  // Сборка обязана дожить до конца. Один раз она падала здесь с «создание
  // актёра вернуло пусто»: система возвращает пустоту из `create`, когда её
  // завершающему `update` нечего менять, — а актёр при этом создан. Ловим это
  // проверкой, а не обвалом всего прогона.
  let built = null;
  try {
    built = await create.createMooks({
      role: "solo", tier: "boss", chrome: "fullborg", count: 1, name: "Тест",
    });
  } catch (error) {
    expect(false, `сборка сорвалась: ${error.message}`);
    built = { actors: [], missing: [] };
  }
  const { actors, missing } = built;
  if (!actors.length) expect(false, "сборка не вернула ни одного актёра");
  const mookOk = actors.length > 0;
  expect(missing.length === 0, `не нашлось: ${missing.join(", ")}`);
  expect(actors.length === 1, `собрано актёров ${actors.length}`);

  const mook = mookOk ? actors[0] : null;
  if (mookOk) {
  expect(mook.type === "mook", `тип актёра «${mook.type}»`);

  // Главное: актёр создан классом СИСТЕМЫ. Глобальный `Actor` — базовый класс
  // Foundry, и раздача 63 базовых навыков с корпусами под импланты живёт не в
  // нём. Один раз сборка пошла мимо — шестёрки вышли вообще без навыков.
  expect(!stub.usedBareActor, "актёр создан через глобальный `Actor` — мимо раздачи системы");
  // Актёр найден, хотя создание вернуло пустоту, — и слушатель за собой убран.
  expect(stub.danglingHooks === 0, `после сборки осталось висеть слушателей: ${stub.danglingHooks}`);
  const allSkills = mook.items.filter((i) => i.type === "skill");
  expect(
    allSkills.length >= coreSkillNames().length,
    `навыков на листе ${allSkills.length}, а система раздаёт ${coreSkillNames().length}`
  );
  const frames = mook.items.filter(
    (i) => i.type === "cyberware" && /\(7 Option Slots\)$/.test(i._english)
  );
  expect(frames.length === 3, `корпусов под импланты ${frames.length}`);
  expect(mook.folder === "folder-MookMaker", `актёр положен в «${mook.folder}»`);

  // Актёр создан БЕЗ ключа `system` — иначе система примет его за копию и не
  // выдаст ни базовых навыков, ни корпусов для имплантов.
  expect(
    stub.createdWithSystem === false,
    "актёр создан с ключом system — базовых навыков и корпусов не будет"
  );

  // Характеристики и здоровье прописаны.
  expect(mook.system.stats.body.value >= 6, `ТЕЛО ${mook.system.stats.body.value}`);
  expect(
    mook.system.derivedStats.hp.max === mook.system.derivedStats.hp.value,
    "текущие ПЗ разошлись с наибольшими"
  );
  expect(mook.system.derivedStats.hp.max >= 40, `ПЗ босса ${mook.system.derivedStats.hp.max}`);

  // Навыки: базовые лежали на актёре с английскими именами, им проставили
  // уровни; те, которых не было, донесены из отдельных компендиумов.
  const autofire = mook.items.find((i) => i.type === "skill" && i._english === "Autofire");
  expect(autofire?.system.level >= 10, `автоогонь ${autofire?.system.level}`);
  const swim = mook.items.find((i) => i.type === "skill" && i._english === "Athletics");
  expect(swim?.system.level === 2, `атлетика ${swim?.system.level} — ступень задела базовый навык`);
  // Навык, которого нет среди базовых, донесён из отдельного компендиума.
  const chem = mook.items.find((i) => i.type === "skill" && i._english === "Science (Chemistry)");
  expect(!chem || chem.system.level >= 0, "подвид навыка пришёл сломанным");

  // Оружие: в руках два ствола, остальное числится в снаряжении.
  const weapons = mook.items.filter((i) => i.type === "weapon");
  const inHands = weapons.filter((i) => i.system.equipped === "equipped");
  expect(weapons.length >= 2, `оружия выдано ${weapons.length}`);
  expect(inHands.length <= 2, `в руках оказалось стволов: ${inHands.length}`);
  expect(inHands.length > 0, "оружие выдано, но ни один ствол не в руках");
  // Качество босса — отличное.
  expect(
    weapons.some((i) => /\(Excellent\)$/.test(i._english)),
    `боссу досталось оружие без отличного качества: ${weapons.map((i) => i._english).join(", ")}`
  );

  // Броня: две позиции, на корпус и на голову, обе надеты.
  const armour = mook.items.filter((i) => i.type === "armor");
  expect(
    armour.length === 2,
    `брони выдано ${armour.length}: ${armour.map((i) => i._english).join(", ")}`
  );
  expect(
    armour.every((i) => i.system.equipped === "equipped"),
    "броня выдана, но не надета"
  );

  // Импланты: полная конверсия и все вживлены, а не лежат в рюкзаке.
  // Полная конверсия: десять опор плюс их опции.
  const chrome = implants(mook);
  const plannedParts = R.CHROME.fullborg.parts;
  const plannedOptions = plannedParts.reduce((sum, part) => sum + part.options.length, 0);
  expect(
    chrome.length === plannedParts.length + plannedOptions,
    `имплантов с опциями ${chrome.length}, ждали ${plannedParts.length + plannedOptions}`
  );

  // Подкожная броня пришла имплантом, а не третьим куском брони.
  expect(
    chrome.some((i) => i._english === "Subdermal Armor"),
    "подкожной брони нет среди имплантов — её снова подменили бронёй"
  );

  // И опции стоят ВНУТРИ своих опор, а не лежат рядом в рюкзаке.
  // Опор с одинаковым названием бывает две (две руки, два глаза) с РАЗНОЙ
  // начинкой, поэтому каждой запланированной опоре подбираем СВОЮ и больше её
  // не трогаем. Иначе обе проверки сойдутся на первой руке и вторая, пустая,
  // останется незамеченной — а именно на пустые гнёзда и была жалоба.
  const taken = new Set();
  const contentsOf = (item) =>
    (item.system?.installedItems?.list ?? [])
      .map((id) => chrome.find((other) => other.id === id)?._english)
      .filter(Boolean);

  for (const part of plannedParts) {
    if (!part.options.length) continue;
    const match = chrome.find((item) => {
      if (taken.has(item.id) || item._english !== part.name) return false;
      const inside = contentsOf(item);
      return part.options.every((option) => inside.includes(option));
    });
    if (match) {
      taken.add(match.id);
      continue;
    }
    const same = chrome
      .filter((item) => item._english === part.name)
      .map((item) => `[${contentsOf(item).join(", ") || "пусто"}]`)
      .join(" ");
    expect(false, `в «${part.name}» нет набора ${part.options.join(", ")}; есть: ${same}`);
  }
  const inBody = new Set(mook.system.installedItems.list);
  const foundations = chrome.filter((i) => i.system.isFoundational);
  expect(
    foundations.every((i) => inBody.has(i.id)),
    "опорные импланты не вживлены в актёра"
  );
  const optional = chrome.filter((i) => !i.system.isFoundational);
  const inHosts = new Set(
    mook.items.flatMap((i) => i.system?.installedItems?.list ?? [])
  );
  expect(
    optional.every((i) => inHosts.has(i.id)),
    `не вживлены: ${optional.filter((i) => !inHosts.has(i.id)).map((i) => i._english).join(", ")}`
  );

  // Роль: предмет с нужным рангом, и она объявлена активной ПЕРЕВЕДЁННЫМ
  // именем — по нему система ищет роль на листе.
  const role = mook.items.find((i) => i.type === "role");
  expect(role?.system.rank === 6, `ранг роли ${role?.system.rank}`);
  expect(
    mook.system.roleInfo.activeRole === role?.name,
    `активной ролью записано «${mook.system.roleInfo.activeRole}», а предмет зовётся «${role?.name}»`
  );
  expect(
    mook.system.roleInfo.activeRole !== "Solo",
    "активной ролью записано английское имя — система не найдёт её на переведённом листе"
  );

  }
  stub.restore();
}

console.log("\nУ рядовой шестёрки нет ни роли, ни железа");
{
  const stub = makeFoundryStub({ translate: false });
  const create = await import(
    pathToFileURL(path.join(MODULE_ROOT, "scripts", "mook-create.js")).href
  );
  const { actors } = await create.createMooks({
    role: "none", tier: "mook", chrome: "none", count: 3, name: "Бандит",
  });

  expect(actors.length === 3, `собрано ${actors.length}`);
  expect(
    actors.every((a) => a.name.startsWith("Бандит ")),
    `имена вышли: ${actors.map((a) => a.name).join(", ")}`
  );
  for (const mook of actors) {
    expect(!mook.items.some((i) => i.type === "role"), `${mook.name} получил роль`);
    expect(implants(mook).length === 0, `${mook.name} получил импланты`);
    expect(mook.system.roleInfo.activeRole === "", `${mook.name}: активная роль не пуста`);
    expect(
      mook.system.derivedStats.hp.max <= 25,
      `${mook.name}: ПЗ ${mook.system.derivedStats.hp.max}`
    );
    const weapons = mook.items.filter((i) => i.type === "weapon");
    expect(
      weapons.every((i) => !/\((?:Excellent)\)$/.test(i._english)),
      `${mook.name} вооружён отличным оружием`
    );
    expect(
      weapons.every((i) => !HEAVY_NAMES.some((n) => i._english.startsWith(n))),
      `${mook.name} бегает с тяжёлым оружием: ${weapons.map((i) => i._english).join(", ")}`
    );
  }
  stub.restore();
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
