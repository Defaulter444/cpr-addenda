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

// Дальше эти трое нужны и следующим разделам, поэтому живут снаружи блока.
let journals = [];
let tmp;
let corebook;

console.log("Появление книги в мире");
{
  // Заглушки ровно те, что нужны corebook.js.
  const created = [];

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-corebook-"));
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.endsWith(".js")) continue;
    const body = fs
      .readFileSync(path.join(SCRIPTS, file), "utf-8")
      .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
  }
  corebook = await import(
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
}

console.log("Ссылки оглавления в исходнике");
{
  const toc = (coreJournal?.pages ?? []).find(
    (p) => p.type === "text" && (p.text?.content ?? "").includes("@UUID[")
  );
  expect(toc !== undefined, "в книге нет страницы-оглавления со ссылками");

  if (toc) {
    const html = toc.text.content;

    // Абсолютная ссылка намертво прибита к журналу одного мира. При импорте в
    // любой другой она мертва — так и было: все 101 ссылка вели на журнал того
    // мира, где книгу когда-то собирали руками.
    const absolute = html.match(/@UUID\[JournalEntry\./g) ?? [];
    expect(
      absolute.length === 0,
      `в оглавлении ${absolute.length} ссылок, прибитых к чужому журналу`
    );

    const targets = [...html.matchAll(/@UUID\[\.([A-Za-z0-9]+)/g)].map((m) => m[1]);
    expect(targets.length > 50, `относительных ссылок всего ${targets.length}`);

    const own = new Set(coreJournal.pages.map((p) => p._id));
    const stray = targets.filter((id) => !own.has(id));
    expect(stray.length === 0, `ссылки ведут мимо книги: ${[...new Set(stray)].join(", ")}`);

    // Номер страницы в ссылке должен остаться: движок отрезает хвост «#page=»
    // до разбора, и без него ссылка откроет книгу на первой странице.
    const anchored = html.match(/@UUID\[\.[A-Za-z0-9]+#page=\d+/g) ?? [];
    expect(anchored.length > 50, `ссылок с номером страницы всего ${anchored.length}`);
  }
}

console.log("Пересчёт ссылок оглавления");
{
  const pages = [
    { _id: "src1", name: "Введение" },
    { _id: "src2", name: "Перестрелка" },
    { _id: "src3", name: "Нетраннинг" },
  ];
  const live = [
    { id: "w1", name: "Введение" },
    { id: "w2", name: "Перестрелка" },
    { id: "w3", name: "Нетраннинг" },
  ];

  // Относительные ссылки исходника переезжают на страницы мира.
  const html = "@UUID[.src2#page=175]{Рукопашный бой} и @UUID[.src3#page=200]{Сеть}";
  const fixed = corebook.relinkContents(html, pages, live);
  expect(fixed.includes("@UUID[.w2#page=175]"), `вышло: ${fixed}`);
  expect(fixed.includes("@UUID[.w3#page=200]"), `вышло: ${fixed}`);
  expect(fixed.includes("{Рукопашный бой}"), "подпись ссылки потерялась");

  // Старая запись, прибитая к чужому журналу, тоже чинится.
  const old = "@UUID[JournalEntry.Imv8ZTFi8ITnah3S.JournalEntryPage.src1#page=4]{Введение}";
  expect(
    corebook.relinkContents(old, pages, live).includes("@UUID[.w1#page=4]"),
    "ссылка на чужой журнал не переехала"
  );

  // Страницу, которой в книге нет, не трогаем: пусть остаётся видимо битой.
  const unknown = "@UUID[.qqqq0000qqqq0000#page=9]{Ничто}";
  expect(
    corebook.relinkContents(unknown, pages, live) === unknown,
    "неизвестная цель молча уехала на чужую главу"
  );

  // Сопоставление идёт по названию: переставленные страницы не путаются.
  const shuffled = [
    { id: "wB", name: "Нетраннинг" },
    { id: "wA", name: "Перестрелка" },
  ];
  const byName = corebook.relinkContents("@UUID[.src2]{П} @UUID[.src3]{Н}", pages, shuffled);
  expect(byName.includes("@UUID[.wA]") && byName.includes("@UUID[.wB]"), `вышло: ${byName}`);

  // Мусор на входе не должен ронять пересчёт.
  expect(corebook.relinkContents(undefined, pages, live) === undefined, "undefined уронил пересчёт");
  expect(corebook.linkTargets(undefined).length === 0, "цели у пустоты");
  expect(corebook.linkTargets("текст без ссылок").length === 0, "цели там, где ссылок нет");
  expect(
    corebook.linkTargets("@UUID[.abc#page=7]{x}").join() === "abc",
    "номер страницы попал в идентификатор"
  );
}

console.log("Битые ссылки оглавления опознаются");
{
  const book = (contents) => ({
    pages: [
      { id: "p1", name: "Содержание", type: "text", text: { content: contents } },
      { id: "p2", name: "Перестрелка", type: "pdf" },
      { id: "p3", name: "Нетраннинг", type: "pdf" },
    ],
  });

  expect(
    !corebook.contentsLinksBroken(book("@UUID[.p2]{П} @UUID[.p3]{Н}")),
    "целые ссылки объявлены битыми"
  );
  expect(
    corebook.contentsLinksBroken(book("@UUID[.zzzz9999zzzz9999]{П}")),
    "ссылка на несуществующую страницу сошла за целую"
  );
  expect(
    corebook.contentsLinksBroken(
      book("@UUID[JournalEntry.Imv8ZTFi8ITnah3S.JournalEntryPage.rah0emtTbIkRUh9s]{П}")
    ),
    "ссылка на чужой журнал сошла за целую"
  );
  // Книга без оглавления — не повод чинить.
  expect(!corebook.contentsLinksBroken({ pages: [] }), "у пустой книги нашлись битые ссылки");
  expect(!corebook.contentsLinksBroken(undefined), "undefined уронил проверку");

  // Оглавление ищем по ссылкам, а не по названию: мастер мог переименовать.
  const renamed = book("@UUID[.p2]{П}");
  renamed.pages[0].name = "Как читать книгу";
  expect(corebook.findContentsPage(renamed)?.id === "p1", "оглавление не нашлось после переименования");
  expect(corebook.findContentsPage({ pages: [{ id: "x", type: "pdf" }] }) === null,
    "оглавлением объявлена страница PDF");
}

console.log("Починка оглавления в мире");
{
  const updates = [];
  const livePages = [
    {
      id: "p1", name: "Содержание", type: "text",
      text: { content: "@UUID[JournalEntry.Imv8ZTFi8ITnah3S.JournalEntryPage.src2#page=175]{Бой}" },
      update: async (data) => updates.push(data),
    },
    { id: "p2", name: "Перестрелка", type: "pdf" },
  ];
  const journal = { pages: livePages };

  const sourceDoc = {
    pages: {
      contents: [
        {
          id: "src1", name: "Содержание", type: "text",
          text: { content: "@UUID[.src2#page=175]{Бой}" },
        },
        { id: "src2", name: "Перестрелка", type: "pdf" },
      ],
    },
  };
  const realPacks = globalThis.game.packs;
  globalThis.game.packs = { get: () => ({ getDocument: async () => sourceDoc }) };

  expect(await corebook.repairContents(journal), "битое оглавление не починилось");
  expect(updates.length === 1, `обновлений страницы: ${updates.length}`);
  expect(
    updates[0]["text.content"] === "@UUID[.p2#page=175]{Бой}",
    `записано: ${updates[0]["text.content"]}`
  );

  // Целое оглавление трогать нельзя: у мастера там могут быть свои пометки.
  updates.length = 0;
  livePages[0].text.content = "@UUID[.p2#page=175]{Бой}";
  expect(!(await corebook.repairContents(journal)), "целое оглавление всё равно переписали");
  expect(updates.length === 0, "целую страницу зря обновили");

  globalThis.game.packs = realPacks;
}

console.log("Импорт пересчитывает ссылки");
{
  const source = fs.readFileSync(path.join(SCRIPTS, "corebook.js"), "utf-8");
  const created = source.indexOf("await JournalEntry.create(");
  const relinked = source.indexOf("await relinkImported(");
  expect(created > 0 && relinked > created, "после создания книги ссылки не пересчитываются");
  // Чинить надо и книгу, которая уже лежит в мире со времён старого выпуска.
  expect(source.includes("await repairContents(existing.parent)"),
    "уже стоящая в мире книга не чинится при входе");
}

console.log("Номера страниц: из английского издания в русское");
{
  const pages = await import(pathToFileURL(path.join(tmp, "corebook-pages.mjs")).href);
  const map = pages.PAGE_MAP;
  const numbers = Object.keys(map).map(Number).sort((a, b) => a - b);

  expect(numbers.length > 0, "таблица страниц пуста");

  // Таблица должна быть сплошной: пропущенная английская страница уехала бы в
  // хвостовое правило и села бы мимо всего каталога.
  for (let page = numbers[0]; page <= numbers[numbers.length - 1]; page += 1) {
    expect(map[page] !== undefined, `в таблице нет английской страницы ${page}`);
  }

  // Русские номера не идут вспять — иначе ссылка отправляла бы читателя назад.
  let previous = 0;
  for (const page of numbers) {
    expect(
      Number.isInteger(map[page]) && map[page] >= previous,
      `${page} ведёт на ${map[page]}, а предыдущая страница вела на ${previous}`
    );
    previous = map[page];
  }

  // Русская книга в каталоге идёт ВПЕРЕДИ английской, и заметно.
  for (const page of numbers) {
    const shift = map[page] - page;
    expect(shift >= 3 && shift <= 7, `у страницы ${page} неправдоподобный сдвиг ${shift}`);
  }

  // Правила книги совпадают постранично — их трогать нельзя.
  for (const page of [1, 45, 131, 150, 163, 164, 175, 177, 187, 188, 190, 191, 226, 339]) {
    expect(pages.bookPage(page) === page, `правила: ${page} уехала на ${pages.bookPage(page)}`);
  }

  // Разделы каталога — по указателю, напечатанному в самой книге на стр. 346.
  // Это прямая истина, а не измерение: если строка разойдётся с указателем,
  // ссылка уведёт в чужой раздел.
  const sections = [
    [340, 346, "холодное оружие"],
    [341, 347, "дальнобойное оружие"],
    [342, 348, "качества оружия"],
    [343, 349, "приспособления для оружия"],
    [345, 351, "боеприпасы"],
    [348, 353, "экзотическое оружие"],
    [350, 356, "броня"],
    [352, 358, "общее снаряжение"],
    [356, 362, "мода"],
    [357, 363, "уличные наркотики"],
    [358, 364, "киберимпланты"],
    [368, 371, "железо для кибердеки"],
  ];
  for (const [english, russian, what] of sections) {
    expect(
      pages.bookPage(english) === russian,
      `«Core, ${english}» (${what}) ведёт на ${pages.bookPage(english)}, а надо на ${russian}`
    );
  }

  // Отдельные страницы, сверенные по содержимому.
  const anchors = [
    [359, 365, "нейроимпланты"],
    [360, 366, "кибероптика"],
    [362, 367, "внутренний агент (кибераудио)"],
    [363, 368, "внутренние импланты"],
    [364, 369, "киберконечности"],
    [366, 371, "опции киберноги"],
    [369, 373, "атакующие программы"],
    [370, 374, "программы «чёрный лёд»"],
  ];
  for (const [english, russian, what] of anchors) {
    expect(
      pages.bookPage(english) === russian,
      `«Core, ${english}» (${what}) ведёт на ${pages.bookPage(english)}, а надо на ${russian}`
    );
  }

  // За таблицей держится последний известный сдвиг, и на границе нет обрыва.
  const last = numbers[numbers.length - 1];
  expect(
    pages.bookPage(last + 1) >= pages.bookPage(last),
    `сразу за таблицей ссылка прыгает назад: ${last} → ${pages.bookPage(last)}, ` +
      `${last + 1} → ${pages.bookPage(last + 1)}`
  );

  // По всей книге номера идут не убывая и не вылезают за её последнюю страницу.
  let seen = 0;
  for (let page = 1; page <= pages.LAST_PAGE; page += 1) {
    const mapped = pages.bookPage(page);
    expect(mapped >= seen, `после ${seen} страница ${page} ведёт назад, на ${mapped}`);
    expect(mapped <= pages.LAST_PAGE, `страница ${page} ведёт за конец книги, на ${mapped}`);
    seen = mapped;
  }

  // Мусор на входе возвращается как есть: лучше открыть книгу не там, чем никак.
  for (const bad of [0, -5, null, undefined, "", "abc"]) {
    expect(pages.bookPage(bad) === bad, `на "${bad}" карта выдала ${pages.bookPage(bad)}`);
  }
}

console.log("Поправка применяется только к своей книге");
{
  /** Страница книги с флагами. */
  const book = (flags) => ({
    src: "modules/cpr-addenda/pdfs/cyberpunk-red-core-ru-v13.pdf",
    parent: { name: "Книга" },
    type: "pdf",
    getFlag: (scope, key) => flags?.[scope]?.[key],
  });
  const ours = book({ "pdf-pager": { code: "Core" }, "cpr-addenda": { edition: "ru-v13" } });
  const foreign = book({ "pdf-pager": { code: "Core" } });

  journals = [{ name: "Книга", pages: [ours] }];
  expect(corebook.isRussianEdition(ours), "своя книга не опознана");
  expect(!corebook.isRussianEdition(foreign), "чужая книга принята за свою");
  expect(!corebook.isRussianEdition(null), "отсутствие книги сошло за свою");

  // Своя книга: страница каталога переводится.
  expect(corebook.correctPage("Core", { page: 341 }).page === 347, "страница не поправлена");
  // Правила не трогаем.
  expect(corebook.correctPage("Core", { page: 187 }).page === 187, "правила зря сдвинуты");
  // Чужие книги не наше дело: у них свои номера.
  expect(corebook.correctPage("BC", { page: 341 }).page === 341, "поправка залезла в другую книгу");
  // Вызов без страницы — просто «открой книгу».
  expect(corebook.correctPage("Core", {}).page === undefined, "появилась страница из ниоткуда");

  // Исходные настройки менять нельзя: их передали нам на время.
  const options = { page: 341, uuid: "x" };
  const fixed = corebook.correctPage("Core", options);
  expect(options.page === 341, "поправка испортила чужой объект настроек");
  expect(fixed.uuid === "x", "поправка потеряла остальные настройки");

  // Английский корбук в мире: сдвигать нечего, там номера совпадают.
  journals = [{ name: "Чужая", pages: [foreign] }];
  expect(corebook.correctPage("Core", { page: 341 }).page === 341, "чужое издание сдвинуто");
}

console.log("Подключение к pdf-pager");
{
  const calls = [];
  globalThis.ui.pdfpager = {
    openPDFByCode: (code, options) => calls.push([code, options?.page]),
  };
  journals = [
    {
      name: "Книга",
      pages: [
        {
          src: "modules/cpr-addenda/pdfs/cyberpunk-red-core-ru-v13.pdf",
          type: "pdf",
          parent: { name: "Книга" },
          getFlag: (scope, key) =>
            ({ "pdf-pager": { code: "Core" }, "cpr-addenda": { edition: "ru-v13" } })[scope]?.[key],
        },
      ],
    },
  ];

  expect(corebook.registerPageMap(), "не удалось подключиться к готовому pdf-pager");
  ui.pdfpager.openPDFByCode("Core", { page: 341 });
  expect(calls.length === 1 && calls[0][1] === 347, `в pdf-pager ушло ${JSON.stringify(calls[0])}`);

  // Повторное подключение не должно наматывать обёртку на обёртку.
  const wrapped = ui.pdfpager.openPDFByCode;
  expect(corebook.registerPageMap(), "повторное подключение вернуло отказ");
  expect(ui.pdfpager.openPDFByCode === wrapped, "обёртка навернулась второй раз");

  // Упавшая поправка не должна отменять открытие книги: она удобство, не условие.
  calls.length = 0;
  const broken = {};
  Object.defineProperty(broken, "pages", {
    get() {
      throw new Error("сломанный журнал");
    },
  });
  journals = [broken];
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args);
  ui.pdfpager.openPDFByCode("Core", { page: 341 });
  console.error = realError;
  expect(calls.length === 1, "ссылка не открылась из-за упавшей поправки");
  expect(errors.length === 1, "падение поправки прошло без записи в консоль");

  // pdf-pager ещё не создал свой объект: подключаемся не сразу, а дождавшись.
  delete globalThis.ui.pdfpager;
  expect(!corebook.registerPageMap(1), "подключение к отсутствующему pdf-pager удалось");
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(globalThis.ui.pdfpager === undefined, "ожидание создало чужой объект");
}

console.log("Пометка своей книги в мире");
{
  const stamped = [];
  const page = (src) => ({
    src,
    type: "pdf",
    getFlag: () => undefined,
    setFlag: async (scope, key, value) => stamped.push([scope, key, value]),
  });

  expect(
    await corebook.markEdition(page("modules/cpr-addenda/pdfs/cyberpunk-red-core-ru-v13.pdf")),
    "своя книга не помечена"
  );
  expect(
    stamped.length === 1 && stamped[0][2] === "ru-v13",
    `поставлен флаг ${JSON.stringify(stamped[0])}`
  );

  // Чужой файл не наше дело: мало ли какую книгу мастер завёл под кодом «Core».
  stamped.length = 0;
  expect(!(await corebook.markEdition(page("worlds/moi/kniga.pdf"))), "чужая книга помечена своей");
  expect(stamped.length === 0, "чужой книге всё-таки поставили флаг");
  expect(!(await corebook.markEdition(undefined)), "пометка без страницы прошла успешно");
}

console.log("Издание в исходниках и в коде — одно и то же");
{
  const pagesSource = fs.readFileSync(path.join(SCRIPTS, "corebook-pages.js"), "utf-8");
  const edition = pagesSource.match(/BOOK_EDITION = "([^"]+)"/)?.[1];
  expect(Boolean(edition), "в corebook-pages.js не объявлено издание книги");

  const coded = (coreJournal?.pages ?? []).filter(
    (p) => p.flags?.["pdf-pager"]?.code === "Core"
  );
  expect(
    coded[0]?.flags?.["cpr-addenda"]?.edition === edition,
    `в книге издание "${coded[0]?.flags?.["cpr-addenda"]?.edition}", а в коде "${edition}"`
  );
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
    "CPRADDENDA.corebook.relinked",
    "CPRADDENDA.settings.importCorebook.name",
    "CPRADDENDA.settings.importCorebook.hint",
  ]) {
    expect(key in ru, `нет русского текста: ${key}`);
    expect(key in en, `нет английского текста: ${key}`);
  }
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
