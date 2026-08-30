/**
 * Сборка компендиумов модуля из JSON-исходников.
 *
 * Foundry v12 хранит компендиумы в LevelDB — двоичном формате, который нельзя
 * ни прочитать глазами, ни положить в систему контроля версий. Поэтому предметы
 * живут в `sources/<имя пака>/*.json`, по файлу на позицию, а этот скрипт
 * собирает из них базу.
 *
 * Запускать при закрытом Foundry: пока сервер держит базу открытой, LOCK не даст
 * записать в неё ничего.
 *
 *   node tools/build-packs.js              — собрать все паки
 *   node tools/build-packs.js addenda-upgrades  — собрать только указанные
 */

const fs = require("fs");
const path = require("path");

const MODULE_ROOT = path.resolve(__dirname, "..");
const SOURCES_DIR = path.join(MODULE_ROOT, "sources");
const PACKS_DIR = path.join(MODULE_ROOT, "packs");

/**
 * classic-level поставляется вместе с Foundry, отдельно ставить не нужно.
 * Путь можно переопределить переменной окружения, если Foundry стоит не там.
 */
const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop";
const CLASSIC_LEVEL = path.join(
  FOUNDRY_APP,
  "resources/app/node_modules/classic-level"
);

let ClassicLevel;
try {
  ({ ClassicLevel } = require(CLASSIC_LEVEL));
} catch (err) {
  console.error(
    `Не найден classic-level по пути:\n  ${CLASSIC_LEVEL}\n` +
      "Укажите установку Foundry через переменную FOUNDRY_APP."
  );
  process.exit(1);
}

/**
 * Служебные поля, которые Foundry ждёт у каждого документа в компендиуме.
 * Проставляем их сами, чтобы в исходниках оставались только содержательные данные.
 *
 * @param {Object} doc - документ из JSON-исходника
 * @returns {Object} - он же, дополненный служебными полями
 */
function withStats(doc) {
  const now = Date.now();
  return {
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    ...doc,
    _stats: {
      coreVersion: "12.343",
      systemId: "cyberpunk-red-core",
      systemVersion: "v0.92.4",
      createdTime: now,
      modifiedTime: now,
      lastModifiedBy: null,
      compendiumSource: null,
      duplicateSource: null,
      ...(doc._stats ?? {}),
    },
  };
}

/**
 * Проверяет то, что Foundry молча проглотит, а потом покажет пустой список.
 *
 * @param {Object} doc - документ
 * @param {String} file - имя файла, для внятного сообщения об ошибке
 * @param {String} packType - тип пака: от него зависит набор обязательных полей
 * @returns {Array<String>} - список замечаний
 */
function validate(doc, file, packType = "Item") {
  const problems = [];
  if (!doc._id) problems.push("нет поля _id");
  else if (!/^[a-zA-Z0-9]{16}$/.test(doc._id))
    problems.push(`_id должен быть ровно 16 буквенно-цифровых символов: "${doc._id}"`);
  if (!doc.name) problems.push("нет поля name");
  // Поле `type` есть у предметов (оружие, броня, модификация), а у таблиц
  // бросков его нет вовсе: там тип задан самим документом.
  if ((packType === "Item" || packType === "Actor") && !doc.type) {
    problems.push("нет поля type");
  }
  if (packType === "RollTable" && !Array.isArray(doc.results))
    problems.push("у таблицы нет строк (results)");
  if (packType === "JournalEntry" && !Array.isArray(doc.pages))
    problems.push("у журнала нет страниц (pages)");
  for (const effect of doc.effects ?? []) {
    if (!/^[a-zA-Z0-9]{16}$/.test(effect._id ?? ""))
      problems.push(`эффект "${effect.name}": _id должен быть 16 символов`);
  }
  for (const result of doc.results ?? []) {
    if (!/^[a-zA-Z0-9]{16}$/.test(result._id ?? ""))
      problems.push(`строка таблицы "${result.text}": _id должен быть 16 символов`);
  }
  for (const page of doc.pages ?? []) {
    if (!/^[a-zA-Z0-9]{16}$/.test(page._id ?? ""))
      problems.push(`страница "${page.name}": _id должен быть 16 символов`);
  }
  return problems.map((p) => `  ${file}: ${p}`);
}

/**
 * Раскладывает документ по записям базы.
 *
 * Предмет — это одна запись. Таблица бросков — несколько: сама таблица плюс
 * каждая её строка отдельно, а в самой таблице вместо строк остаются только их
 * идентификаторы. Так устроены и системные компендиумы.
 *
 * @param {Object} doc - документ из исходника
 * @param {String} type - тип пака из манифеста
 * @returns {Array<[String, Object]>} - пары «ключ базы -> значение»
 */
function toEntries(doc, type) {
  if (type === "RollTable") {
    const results = doc.results ?? [];
    const table = { ...doc, results: results.map((r) => r._id) };
    return [
      [`!tables!${doc._id}`, table],
      ...results.map((r) => [`!tables.results!${doc._id}.${r._id}`, r]),
    ];
  }

  if (type === "JournalEntry") {
    // Страницы журнала хранятся отдельными записями, а в самом журнале
    // остаются только их идентификаторы — как и у таблиц бросков.
    const pages = doc.pages ?? [];
    const journal = { ...doc, pages: pages.map((p) => p._id) };
    return [
      [`!journal!${doc._id}`, journal],
      ...pages.map((p) => [`!journal.pages!${doc._id}.${p._id}`, p]),
    ];
  }

  if (type === "Actor") {
    // Предметы и эффекты актёра хранятся отдельными записями, а в самом
    // актёре остаются только их идентификаторы — так же, как страницы у
    // журнала и строки у таблицы бросков.
    //
    // Это не косметика: положенный внутрь записи актёра массив предметов
    // Foundry молча игнорирует. Актёр импортируется, а всё его снаряжение
    // пропадает без единого сообщения об ошибке.
    const items = doc.items ?? [];
    const effects = doc.effects ?? [];
    const actor = {
      ...doc,
      items: items.map((i) => i._id),
      effects: effects.map((e) => e._id),
    };
    return [
      [`!actors!${doc._id}`, actor],
      ...items.map((i) => [`!actors.items!${doc._id}.${i._id}`, i]),
      ...effects.map((e) => [`!actors.effects!${doc._id}.${e._id}`, e]),
    ];
  }

  return [[`!items!${doc._id}`, doc]];
}

/**
 * Собирает один пак из своей папки исходников.
 *
 * @async
 * @param {String} packName - имя пака, оно же имя папки в sources/
 * @param {String} packType - тип пака: Item, Actor, RollTable или JournalEntry
 */
async function buildPack(packName, packType = "Item") {
  const srcDir = path.join(SOURCES_DIR, packName);
  const dbDir = path.join(PACKS_DIR, packName);

  const files = fs.existsSync(srcDir)
    ? fs.readdirSync(srcDir).filter((f) => f.endsWith(".json"))
    : [];

  const docs = [];
  const problems = [];
  const seenIds = new Set();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(srcDir, file), "utf-8");
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      problems.push(`  ${file}: не разбирается как JSON — ${err.message}`);
      continue;
    }
    problems.push(...validate(doc, file, packType));
    if (seenIds.has(doc._id)) {
      problems.push(`  ${file}: _id "${doc._id}" уже занят другим файлом`);
    }
    seenIds.add(doc._id);
    docs.push(withStats(doc));
  }

  if (problems.length) {
    console.error(`\n[${packName}] исходники с ошибками:`);
    problems.forEach((p) => console.error(p));
    throw new Error(`Пак ${packName} не собран.`);
  }

  fs.mkdirSync(dbDir, { recursive: true });
  const db = new ClassicLevel(dbDir, { valueEncoding: "json" });

  // Полная пересборка: старое содержимое стираем, иначе удалённый из
  // исходников предмет остался бы в паке навсегда.
  await db.clear();
  const batch = db.batch();
  let records = 0;
  for (const doc of docs) {
    for (const [key, value] of toEntries(doc, packType)) {
      batch.put(key, value);
      records += 1;
    }
  }
  await batch.write();
  await db.close();

  const detail = records === docs.length ? "" : ` (записей в базе: ${records})`;
  console.log(`[${packName}] собрано документов: ${docs.length}${detail}`);
}

(async () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(MODULE_ROOT, "module.json"), "utf-8")
  );
  const types = Object.fromEntries(manifest.packs.map((p) => [p.name, p.type]));

  const requested = process.argv.slice(2);
  const packNames = requested.length ? requested : Object.keys(types);

  for (const name of packNames) {
    await buildPack(name, types[name] ?? "Item");
  }
  console.log("\nГотово. Перезапустите Foundry, чтобы увидеть изменения.");
})().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
