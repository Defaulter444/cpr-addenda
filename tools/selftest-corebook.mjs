/**
 * Проверка книги правил в мире.
 *
 * Ссылки на страницы источников держатся на цепочке из трёх звеньев:
 * `cpr-source-links` зовёт `ui.pdfpager.openPDFByCode("Core", {page})`,
 * pdf-pager ищет страницу с флагом `pdf-pager.code === "Core"` **среди
 * журналов мира**, и только найдя — показывает PDF.
 *
 * Слабое звено — второе. Компендиумы pdf-pager не смотрит вовсе, поэтому книга,
 * лежащая только в паке модуля, ссылок не оживляет: в одном мире всё работает
 * (книгу туда когда-то втащили руками), а в соседнем — молчит. Причём молчит
 * буквально: `openPDFByCode` пишет о ненайденном коде только в консоль.
 *
 * Здесь проверяется и сама книга в исходниках, и логика её появления в мире.
 *
 *   node tools/selftest-corebook.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const SCRIPTS = path.join(MODULE_ROOT, "scripts");
const LANG = path.join(MODULE_ROOT, "lang");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

/* ------------------------------------------------------------------ */

console.log("Книга в исходниках пригодна для ссылок");
let coreJournal;
{
  const dir = path.join(MODULE_ROOT, "sources", "addenda-journals");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const docs = files.map((f) =>
    JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))
  );

  coreJournal = docs.find((d) =>
    (d.pages ?? []).some((p) => p.flags?.["pdf-pager"]?.code === "Core")
  );
  expect(
    coreJournal !== undefined,
    "ни в одном журнале нет страницы с кодом «Core» — ссылки будет некому открыть"
  );

  if (coreJournal) {
    // Идентификатор зашит в scripts/corebook.js: по нему книга достаётся из пака.
    const source = fs.readFileSync(path.join(SCRIPTS, "corebook.js"), "utf-8");
    const declared = source.match(/CORE_JOURNAL_ID = "([^"]+)"/)?.[1];
    expect(
      declared === coreJournal._id,
      `corebook.js берёт книгу по id "${declared}", а в исходниках она "${coreJournal._id}"`
    );

    const coded = coreJournal.pages.filter(
      (p) => p.flags?.["pdf-pager"]?.code === "Core"
    );
    expect(coded.length === 1, `страниц с кодом «Core»: ${coded.length}, а нужна одна`);

    const page = coded[0];
    expect(page.type === "pdf", `страница с кодом имеет тип "${page.type}", а нужен pdf`);
    expect(
      typeof page.src === "string" && page.src.startsWith("modules/cpr-addenda/"),
      `путь к PDF ведёт мимо модуля: "${page.src}"`
    );
    expect(
      fs.existsSync(path.join(MODULE_ROOT, page.src.replace("modules/cpr-addenda/", ""))),
      `файла PDF нет на диске: ${page.src}`
    );

    // Смещение отвечает за то, на какую страницу попадёт ссылка.
    expect(
      Number.isInteger(page.flags["pdf-pager"].pageOffset),
      "у страницы с кодом не задано смещение pageOffset"
    );

    // Остальные страницы книги тоже должны указывать на существующие файлы.
    let missing = 0;
    for (const p of coreJournal.pages) {
      if (p.type !== "pdf" || typeof p.src !== "string") continue;
      const file = path.join(MODULE_ROOT, p.src.replace("modules/cpr-addenda/", ""));
      if (!fs.existsSync(file)) {
        missing += 1;
        expect(false, `нет файла для страницы "${p.name}": ${p.src}`);
      }
    }
    if (!missing) {
      console.log(`  страниц PDF: ${coreJournal.pages.filter((p) => p.type === "pdf").length}, все файлы на месте`);
    }
  }
}

console.log("Появление книги в мире");
{
  // Заглушки ровно те, что нужны corebook.js.
  const created = [];
  let journals = [];

  globalThis.game = {
    user: { isGM: true },
    // Заглушка отдаёт ключ вместо текста: проверять надо, что сообщение вообще
    // показано, а наличие переводов сверяется отдельно, в конце файла.
    i18n: {
      localize: (key) => key,
      format: (key, data) => `${key} ${JSON.stringify(data)}`,
    },
    settings: { get: () => true },
    modules: { get: (id) => ({ active: id === "pdf-pager" }) },
    packs: {
      get: () => ({
        getDocument: async (id) => ({
          _id: id,
          name: "Книга правил",
          toObject: () => ({ _id: id, name: "Книга правил" }),
        }),
      }),
    },
    get journal() {
      return journals;
    },
  };
  const said = [];
  globalThis.ui = {
    notifications: {
      info: (m) => said.push(m),
      warn: (m) => said.push(m),
      error: (m) => said.push(m),
    },
  };
  globalThis.JournalEntry = {
    create: async (data) => {
      created.push(data);
      // Созданный журнал приезжает со страницами книги — иначе следующий
      // запуск не увидит её и создаст вторую.
      const entry = {
        ...data,
        pages: [
          {
            type: "pdf",
            parent: { name: data.name },
            getFlag: (scope, key) =>
              scope === "pdf-pager" && key === "code" ? "Core" : undefined,
          },
        ],
      };
      journals.push(entry);
      return entry;
    },
  };

  // Файлы модуля лежат с расширением .js и ссылаются друг на друга так же.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-corebook-"));
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.endsWith(".js")) continue;
    const body = fs
      .readFileSync(path.join(SCRIPTS, file), "utf-8")
      .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
  }
  const corebook = await import(
    pathToFileURL(path.join(tmp, "corebook.mjs")).href
  );

  /** Журнал-заглушка со страницей нужного вида. */
  const withCode = (code) => ({
    name: "Чужая книга",
    pages: [
      {
        type: "pdf",
        parent: { name: "Чужая книга" },
        getFlag: (scope, key) =>
          scope === "pdf-pager" && key === "code" ? code : undefined,
      },
    ],
  });

  // Пустой мир: книги нет, значит её надо создать.
  journals = [];
  created.length = 0;
  said.length = 0;
  expect(corebook.findCorebookPage() === null, "в пустом мире нашлась книга");
  await corebook.importCorebook();
  expect(created.length === 1, `создано журналов ${created.length}, а ждали один`);
  expect(said.length === 1, "добавление книги прошло молча");

  // Повторный запуск ничего не создаёт — иначе книга размножалась бы.
  created.length = 0;
  await corebook.importCorebook({ silent: true });
  expect(created.length === 0, "повторный запуск создал вторую книгу");

  // Книга, принесённая мастером руками, тоже считается: не дублируем.
  journals = [withCode("Core")];
  created.length = 0;
  await corebook.importCorebook({ silent: true });
  expect(
    created.length === 0,
    "модуль добавил свою книгу поверх принесённой мастером"
  );
  expect(
    corebook.findCorebookPage() !== null,
    "чужая книга с кодом «Core» не опознана"
  );

  // Чужой код — не наша книга.
  journals = [withCode("BlackChrome")];
  expect(
    corebook.findCorebookPage() === null,
    "книга с чужим кодом принята за нашу"
  );

  // Без pdf-pager класть книгу бессмысленно — предупреждаем и выходим.
  journals = [];
  created.length = 0;
  said.length = 0;
  game.modules.get = () => ({ active: false });
  await corebook.checkCorebook();
  expect(created.length === 0, "книга добавлена, хотя pdf-pager выключен");
  expect(said.length === 1, "про выключенный pdf-pager не предупредили");

  // Выключенная настройка запрещает вмешательство.
  game.modules.get = (id) => ({ active: id === "pdf-pager" });
  game.settings.get = () => false;
  created.length = 0;
  await corebook.checkCorebook();
  expect(created.length === 0, "настройка выключена, а книга всё равно добавлена");

  // Не мастер не трогает мир вовсе.
  game.settings.get = () => true;
  game.user.isGM = false;
  created.length = 0;
  await corebook.checkCorebook();
  expect(created.length === 0, "игрок добавил книгу в мир");

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("Тексты сообщений");
{
  const ru = JSON.parse(fs.readFileSync(path.join(LANG, "ru.json"), "utf-8"));
  const en = JSON.parse(fs.readFileSync(path.join(LANG, "en.json"), "utf-8"));
  for (const key of [
    "CPRADDENDA.corebook.imported",
    "CPRADDENDA.corebook.alreadyHere",
    "CPRADDENDA.corebook.failed",
    "CPRADDENDA.corebook.needPdfPager",
    "CPRADDENDA.settings.importCorebook.name",
    "CPRADDENDA.settings.importCorebook.hint",
  ]) {
    expect(key in ru, `нет русского текста: ${key}`);
    expect(key in en, `нет английского текста: ${key}`);
  }
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
