/**
 * Перенос журнала из мира в исходники модуля.
 *
 * Книга правил собиралась вручную в мире: разбита по главам, у каждой главы
 * выставлено своё смещение страниц, чтобы номер в PDF совпадал с номером в
 * книге. Эта работа ценнее самих файлов, и именно её имеет смысл переносить
 * в модуль.
 *
 * Сами PDF не трогаем: это коммерческая книга. В исходниках остаются только
 * ссылки на файлы — каждый подставляет свои.
 *
 *   node tools/export-journal.js <мир> "<часть имени журнала>"
 *   node tools/export-journal.js biletiki "Основная книга правил"
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const MODULE_ROOT = path.resolve(__dirname, "..");
const DATA_ROOT = path.resolve(MODULE_ROOT, "..", "..");
const OUT_DIR = path.join(MODULE_ROOT, "sources", "addenda-journals");
const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop";

let ClassicLevel;
try {
  ({ ClassicLevel } = require(
    path.join(FOUNDRY_APP, "resources/app/node_modules/classic-level")
  ));
} catch {
  console.error("Не найден classic-level. Укажите FOUNDRY_APP.");
  process.exit(1);
}

/**
 * Читает базу через копию, чтобы не мешать запущенному Foundry.
 *
 * @async
 * @param {String} dbPath
 * @returns {Promise<Array<[String, Object]>>}
 */
async function readDb(dbPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-journal-"));
  try {
    for (const file of fs.readdirSync(dbPath)) {
      if (file === "LOCK") continue;
      fs.copyFileSync(path.join(dbPath, file), path.join(tmp, file));
    }
    const db = new ClassicLevel(tmp, { valueEncoding: "json" });
    const rows = [];
    for await (const entry of db.iterator()) rows.push(entry);
    await db.close();
    return rows;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Приводит идентификатор к виду, пригодному для компендиума модуля.
 *
 * Идентификаторы из мира переиспользовать нельзя: они уникальны в пределах
 * мира и могут столкнуться с чужими. Собираем свои, стабильные — при
 * повторном экспорте они получатся теми же, и ссылки на страницы не побьются.
 *
 * @param {String} prefix - метка вида документа
 * @param {Number} index - порядковый номер
 * @returns {String} - ровно 16 буквенно-цифровых символов
 */
function makeId(prefix, index) {
  return (`cprAdd${prefix}${String(index).padStart(4, "0")}` + "0".repeat(16)).slice(0, 16);
}

function slug(text) {
  const translit = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return [...text.toLowerCase()]
    .map((ch) => translit[ch] ?? (/[a-z0-9]/.test(ch) ? ch : "-"))
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

(async () => {
  const [, , worldName, namePart] = process.argv;
  if (!worldName || !namePart) {
    console.error(
      'Укажите мир и часть имени журнала:\n  node tools/export-journal.js biletiki "Основная книга правил"'
    );
    process.exit(1);
  }

  const dbPath = path.join(DATA_ROOT, "worlds", worldName, "data", "journal");
  if (!fs.existsSync(dbPath)) {
    console.error(`Нет базы журналов в мире «${worldName}»: ${dbPath}`);
    process.exit(1);
  }

  const rows = await readDb(dbPath);
  const journals = rows
    .filter(([key]) => key.startsWith("!journal!"))
    .map(([, value]) => value)
    .filter((doc) => doc?.name?.includes(namePart));

  if (!journals.length) {
    console.error(`В мире «${worldName}» нет журнала с «${namePart}» в имени.`);
    process.exit(1);
  }
  if (journals.length > 1) {
    console.error("Под условие подходит несколько журналов, уточните имя:");
    journals.forEach((j) => console.error(`  ${j.name}`));
    process.exit(1);
  }

  const [journal] = journals;
  const pages = rows
    .filter(([key]) => key.startsWith(`!journal.pages!${journal._id}.`))
    .map(([, value]) => value)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  const exported = pages.map((page, index) => ({
    _id: makeId("Jp", index + 1),
    name: page.name,
    type: page.type,
    title: page.title ?? { show: true, level: 1 },
    image: page.image ?? {},
    text: page.text ?? {},
    video: page.video ?? {},
    src: page.src ?? null,
    system: page.system ?? {},
    sort: page.sort ?? (index + 1) * 100,
    ownership: { default: -1 },
    flags: page.flags ?? {},
  }));

  const doc = {
    _id: makeId("Jn", 1),
    name: journal.name,
    pages: exported,
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    flags: journal.flags ?? {},
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${slug(journal.name)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf-8");

  const kinds = exported.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Журнал: ${journal.name}`);
  console.log(`Страниц перенесено: ${exported.length} ${JSON.stringify(kinds)}`);

  const files = exported.filter((p) => p.src).map((p) => p.src);
  if (files.length) {
    console.log(`\nСсылки на файлы (сами файлы НЕ переносятся):`);
    files.forEach((f) => console.log(`  ${f}`));
  }
  console.log(`\nЗаписано: ${outPath}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
