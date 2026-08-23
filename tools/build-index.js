/**
 * Индекс всего, что уже есть в мире.
 *
 * Собирает в один JSON каждый предмет из каждого Item-компендиума: системного,
 * из любого установленного модуля и из самого модуля Addenda. К каждой записи
 * подтягивается русское название из каталогов Babele, так что искать потом можно
 * и по «Глушитель», и по «Silencer».
 *
 * Нужен, чтобы перед добавлением позиции из книги за секунду увидеть: её нет,
 * она есть, или она есть, но с другими характеристиками.
 *
 * Запускать при закрытом Foundry — читаем базы напрямую.
 *
 *   node tools/build-index.js                     — собрать индекс
 *   node tools/build-index.js --out путь.json     — положить в другое место
 *   node tools/build-index.js --all               — вместе с чужими системами
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_ROOT =
  process.env.FOUNDRY_DATA ??
  path.join(os.homedir(), "AppData/Local/FoundryVTT/Data");
const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop";

let ClassicLevel;
try {
  ({ ClassicLevel } = require(
    path.join(FOUNDRY_APP, "resources/app/node_modules/classic-level")
  ));
} catch (err) {
  console.error(
    "Не найден classic-level. Укажите установку Foundry через FOUNDRY_APP."
  );
  process.exit(1);
}

/**
 * Читает базу компендиума через копию.
 *
 * Работаем на копии по двум причинам: чтобы случайная запись не испортила
 * оригинал и чтобы файл LOCK от когда-то незакрытой сессии не мешал чтению.
 *
 * @async
 * @param {String} dbPath - путь к папке компендиума
 * @returns {Promise<Array<Object>>}
 */
async function readPack(dbPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-index-"));
  try {
    for (const file of fs.readdirSync(dbPath)) {
      if (file === "LOCK") continue;
      fs.copyFileSync(path.join(dbPath, file), path.join(tmp, file));
    }
    const db = new ClassicLevel(tmp, { valueEncoding: "json" });
    const docs = [];
    for await (const [, value] of db.iterator()) docs.push(value);
    await db.close();
    return docs;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Собирает словарь русских названий из всех каталогов Babele.
 *
 * @returns {Map<String, Object>} - ключ «packId::EnglishName»
 */
function collectTranslations() {
  const translations = new Map();
  const modulesDir = path.join(DATA_ROOT, "modules");
  if (!fs.existsSync(modulesDir)) return translations;

  for (const moduleName of fs.readdirSync(modulesDir)) {
    const babeleDir = path.join(modulesDir, moduleName, "babele", "ru");
    if (!fs.existsSync(babeleDir)) continue;

    for (const file of fs.readdirSync(babeleDir)) {
      if (!file.endsWith(".json")) continue;
      const packId = file.replace(/\.json$/, "");
      let data;
      try {
        data = JSON.parse(fs.readFileSync(path.join(babeleDir, file), "utf-8"));
      } catch {
        continue;
      }
      for (const [enName, entry] of Object.entries(data.entries ?? {})) {
        translations.set(`${packId}::${enName}`, entry);
      }
    }
  }
  return translations;
}

/**
 * Убирает разметку и лишние пробелы из описания.
 *
 * @param {String} html
 * @returns {String}
 */
function stripHtml(html) {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Перечисляет все Item-компендиумы: системный и все модульные.
 *
 * @returns {Array<{packId: String, label: String, dbPath: String}>}
 */
function listItemPacks(includeForeign = false) {
  const packs = [];

  const manifests = [];
  const systemManifest = path.join(
    DATA_ROOT,
    "systems/cyberpunk-red-core/system.json"
  );
  if (fs.existsSync(systemManifest)) {
    manifests.push({
      manifest: systemManifest,
      root: path.dirname(systemManifest),
    });
  }

  const modulesDir = path.join(DATA_ROOT, "modules");
  if (fs.existsSync(modulesDir)) {
    for (const moduleName of fs.readdirSync(modulesDir)) {
      const manifest = path.join(modulesDir, moduleName, "module.json");
      if (fs.existsSync(manifest)) {
        manifests.push({ manifest, root: path.dirname(manifest) });
      }
    }
  }

  for (const { manifest, root } of manifests) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(manifest, "utf-8"));
    } catch {
      continue;
    }
    const owner = data.id ?? data.name;
    for (const pack of data.packs ?? []) {
      if (pack.type !== "Item") continue;
      // Отсекаем компендиумы чужих систем: у пользователя стоят модули для
      // других систем, и их предметы в индексе Cyberpunk RED только мешают.
      if (!includeForeign && pack.system && pack.system !== "cyberpunk-red-core")
        continue;
      const dbPath = path.join(root, pack.path);
      if (!fs.existsSync(dbPath)) continue;
      packs.push({
        packId: `${owner}.${pack.name}`,
        label: pack.label ?? pack.name,
        dbPath,
      });
    }
  }

  return packs;
}

(async () => {
  const outFlag = process.argv.indexOf("--out");
  const outPath =
    outFlag >= 0
      ? process.argv[outFlag + 1]
      : path.resolve(__dirname, "index.json");

  const translations = collectTranslations();
  const records = [];
  let packCount = 0;

  const includeForeign = process.argv.includes("--all");
  for (const pack of listItemPacks(includeForeign)) {
    let docs;
    try {
      docs = await readPack(pack.dbPath);
    } catch (err) {
      console.warn(`  пропущен ${pack.packId}: ${err.message}`);
      continue;
    }
    packCount += 1;

    for (const doc of docs) {
      if (!doc?.name) continue;
      const translation = translations.get(`${pack.packId}::${doc.name}`);
      records.push({
        name: doc.name,
        nameRu: translation?.name ?? null,
        type: doc.type,
        upgradeType: doc.system?.type ?? null,
        weaponType: doc.system?.weaponType ?? null,
        price: doc.system?.price?.market ?? null,
        size: doc.system?.size ?? null,
        source: doc.system?.source ?? null,
        description: stripHtml(doc.system?.description?.value),
        // Русское описание из Babele: без него сверять русский материал с
        // английскими описаниями системы бессмысленно.
        descriptionRu: stripHtml(translation?.description),
        pack: pack.packId,
        packLabel: pack.label,
        uuid: `Compendium.${pack.packId}.Item.${doc._id}`,
      });
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(records, null, 2), "utf-8");

  const byType = records.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Компендиумов прочитано: ${packCount}`);
  console.log(`Предметов в индексе   : ${records.length}`);
  console.log(`С русским названием   : ${records.filter((r) => r.nameRu).length}`);
  console.log(`С русским описанием   : ${records.filter((r) => r.descriptionRu).length}`);
  console.log("По типам:");
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(16)} ${count}`);
  }
  console.log(`\nИндекс записан: ${outPath}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
