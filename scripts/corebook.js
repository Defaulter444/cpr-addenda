/**
 * Книга правил в мире.
 *
 * Ссылки на страницы книги делает модуль `cpr-source-links`: он видит у
 * предмета источник вида «Core, с. 341» и зовёт `ui.pdfpager.openPDFByCode`.
 * А тот ищет нужный PDF так:
 *
 *     for (const journal of game.journal)
 *       for (const page of journal.pages)
 *         if (page.type === "pdf" && page.getFlag("pdf-pager", "code") === code)
 *
 * То есть **только по журналам мира**. Компендиумы он не смотрит вовсе — в его
 * исходниках так и написано: «We don't support Compendiums».
 *
 * Отсюда и вся история: в том мире, куда книгу когда-то втащили руками, ссылки
 * работают, а в новом мире — и у другого мастера — их будто нет. Ошибки при
 * этом не видно: `openPDFByCode` просто пишет в консоль, что кода не нашёл.
 *
 * Поэтому модуль кладёт книгу в мир сам — один раз, и только если такой книги
 * там ещё нет. Мастер, которому это не нужно, выключает в настройках.
 */

import { MODULE_ID, SETTINGS, localize } from "./constants.js";
import { BOOK_EDITION, bookPage } from "./corebook-pages.js";

/** Модуль, который показывает PDF и держит соответствие «код -> страница». */
const PDF_PAGER = "pdf-pager";

/** Код книги, по которому `cpr-source-links` просит открыть страницу. */
const CORE_CODE = "Core";

/** Флаг издания на нашей странице книги — по нему узнаём свою. */
const EDITION_FLAG = "edition";

/** Компендиум и документ, откуда берём книгу. */
const JOURNAL_PACK = `${MODULE_ID}.addenda-journals`;
const CORE_JOURNAL_ID = "cprAddJn00010000";

/**
 * Есть ли уже в мире книга, которую откроет `openPDFByCode`.
 *
 * Ищем ровно так же, как ищет сам pdf-pager, — иначе можно завести вторую
 * книгу рядом с той, что мастер принёс руками.
 *
 * @returns {JournalEntryPage|null}
 */
export function findCorebookPage() {
  for (const journal of game.journal) {
    for (const page of journal.pages) {
      if (page.type !== "pdf") continue;
      if (page.getFlag(PDF_PAGER, "code") === CORE_CODE) return page;
    }
  }
  return null;
}

/**
 * Кладёт книгу правил в мир, если её там ещё нет.
 *
 * Идемпотентна: повторный вызов ничего не создаёт. Возвращает журнал, если
 * он был создан именно этим вызовом, и null во всех остальных случаях.
 *
 * @param {Object} options - {silent: не показывать уведомления}
 * @returns {Promise<JournalEntry|null>}
 */
export async function importCorebook({ silent = false } = {}) {
  if (!game.user.isGM) return null;

  const existing = findCorebookPage();
  if (existing) {
    if (!silent) {
      ui.notifications.info(
        localize("corebook.alreadyHere", { journal: existing.parent.name })
      );
    }
    return null;
  }

  const pack = game.packs.get(JOURNAL_PACK);
  if (!pack) {
    console.warn(`${MODULE_ID} | компендиум ${JOURNAL_PACK} не найден`);
    return null;
  }

  try {
    const source = await pack.getDocument(CORE_JOURNAL_ID);
    if (!source) {
      console.warn(
        `${MODULE_ID} | книги правил нет в компендиуме под id ${CORE_JOURNAL_ID}`
      );
      return null;
    }

    // Без keepId: если мир когда-то уже видел этот идентификатор, создание
    // упало бы, а книга — не тот документ, ради которого стоит рисковать.
    const journal = await JournalEntry.create(source.toObject());

    // Идентификаторы страниц Foundry раздал заново, и ссылки оглавления теперь
    // ведут в никуда. Пересчитываем сразу, иначе книга приедет с сотней
    // мёртвых ссылок — а именно ими её и листают.
    await relinkImported(journal, source);

    if (!silent) {
      ui.notifications.info(localize("corebook.imported"));
    }
    console.log(`${MODULE_ID} | книга правил добавлена в мир: ${journal.name}`);
    return journal;
  } catch (error) {
    console.error(`${MODULE_ID} | не удалось добавить книгу правил в мир:`, error);
    if (!silent) ui.notifications.error(localize("corebook.failed"));
    return null;
  }
}

/**
 * Пересчитывает ссылки оглавления сразу после импорта.
 *
 * @async
 * @param {JournalEntry} journal - только что созданная книга
 * @param {JournalEntry} source - её исходник из компендиума
 * @returns {Promise<void>}
 */
async function relinkImported(journal, source) {
  try {
    const page = findContentsPage(journal);
    const sourcePages = source?.pages?.contents ?? [];
    const sourceContents = sourcePages.find(
      (p) => p.type === "text" && linkTargets(p.text?.content).length
    );
    if (!page || !sourceContents) return;

    const fixed = relinkContents(
      sourceContents.text.content,
      sourcePages.map((p) => ({ _id: p.id, name: p.name })),
      journal.pages.map((p) => ({ id: p.id, name: p.name }))
    );
    if (fixed !== page.text?.content) await page.update({ "text.content": fixed });
  } catch (error) {
    console.error(`${MODULE_ID} | не удалось пересчитать ссылки оглавления:`, error);
  }
}

/**
 * Проверка при входе в мир.
 *
 * Молчаливая: если книга уже на месте — ничего не говорит. Если её нет и
 * автоматическое добавление разрешено — добавляет и сообщает об этом один раз.
 *
 * @returns {Promise<void>}
 */
export async function checkCorebook() {
  if (!game.user.isGM) return;
  if (!game.settings.get(MODULE_ID, SETTINGS.importCorebook)) return;

  const existing = findCorebookPage();
  if (existing) {
    // Книгу могли занести до того, как у страниц появился флаг издания:
    // помечаем свою по файлу, иначе поправка страниц её не признает.
    const ours = await markEdition(existing);
    // Оглавление могло приехать со ссылками на чужой мир — тогда все сто с
    // лишним ссылок в нём мертвы, а именно ими книгу и листают.
    if (ours) await repairContents(existing.parent);
    return;
  }

  // Без pdf-pager книга в мире бесполезна: показывать PDF будет нечем.
  if (!game.modules.get(PDF_PAGER)?.active) {
    ui.notifications.warn(localize("corebook.needPdfPager"), { permanent: true });
    return;
  }

  await importCorebook();
}

/* ------------------------------------------------------------------ */
/*  Ссылки оглавления                                                  */
/* ------------------------------------------------------------------ */

/**
 * Ссылки на страницы книги внутри её же оглавления.
 *
 * Foundry понимает две записи: полную — `@UUID[JournalEntry.<ж>.JournalEntryPage.<с>]`
 * — и относительную, `@UUID[.<с>]`, которая резолвится от той страницы, где
 * написана. Лист страницы журнала передаёт `relativeTo`, поэтому относительная
 * работает и в мире, и в компендиуме.
 *
 * Хвост `#page=130` в счёт не идёт: движок отрезает его до разбора ссылки.
 */
const LINK_PATTERN =
  /@UUID\[(?:JournalEntry\.[A-Za-z0-9]+\.JournalEntryPage\.|\.)([A-Za-z0-9]+)/g;

/**
 * На какие страницы ссылается текст.
 *
 * @param {String} html - содержимое страницы
 * @returns {String[]} - идентификаторы страниц
 */
export function linkTargets(html) {
  if (typeof html !== "string") return [];
  return [...html.matchAll(LINK_PATTERN)].map((match) => match[1]);
}

/**
 * Страница-оглавление книги — та, что ссылается на остальные.
 *
 * Ищем по ссылкам, а не по названию: название мастер может переименовать, а
 * оглавление без ссылок — уже не оглавление.
 *
 * @param {JournalEntry} journal - книга
 * @returns {JournalEntryPage|null}
 */
export function findContentsPage(journal) {
  for (const page of journal?.pages ?? []) {
    if (page.type !== "text") continue;
    if (linkTargets(page.text?.content).length) return page;
  }
  return null;
}

/**
 * Переписывает ссылки оглавления на страницы этого же журнала.
 *
 * Идентификаторы страниц Foundry раздаёт заново при каждом импорте, поэтому
 * ссылки, записанные в исходнике, в мире ведут в никуда. Сопоставляем страницы
 * по НАЗВАНИЮ — оно у книги стабильно и осмысленно, в отличие от
 * идентификатора.
 *
 * @param {String} html - оглавление из исходника
 * @param {Array} sourcePages - страницы исходника ({_id, name})
 * @param {Array} livePages - страницы в мире ({id, name})
 * @returns {String} - оглавление со ссылками на живые страницы
 */
export function relinkContents(html, sourcePages, livePages) {
  if (typeof html !== "string") return html;

  const liveByName = new Map();
  for (const page of livePages ?? []) liveByName.set(page.name, page.id ?? page._id);

  const replacement = new Map();
  for (const page of sourcePages ?? []) {
    const live = liveByName.get(page.name);
    if (live) replacement.set(page._id ?? page.id, live);
  }

  return html.replace(LINK_PATTERN, (whole, target) => {
    const live = replacement.get(target);
    // Страницу, которой в книге нет, не трогаем: пусть остаётся битой и
    // видимой, чем молча уедет на соседнюю главу.
    return live ? `@UUID[.${live}` : whole;
  });
}

/**
 * Целы ли ссылки оглавления.
 *
 * Ссылка цела, когда ведёт на страницу этой же книги. Всё остальное — след
 * чужого мира: идентификаторы у страниц новые, а в оглавлении остались старые.
 *
 * @param {JournalEntry} journal - книга в мире
 * @returns {Boolean}
 */
export function contentsLinksBroken(journal) {
  const page = findContentsPage(journal);
  if (!page) return false;

  const own = new Set((journal.pages ?? []).map((p) => p.id ?? p._id));
  return linkTargets(page.text?.content).some((target) => !own.has(target));
}

/**
 * Чинит оглавление книги, лежащей в мире.
 *
 * Берёт оглавление из компендиума модуля и переписывает его ссылки на страницы
 * той книги, что уже стоит в мире. Трогает страницу только если ссылки и правда
 * никуда не ведут: у мастера могут быть свои пометки, и переписывать рабочую
 * страницу просто так нельзя.
 *
 * @async
 * @param {JournalEntry} journal - книга в мире
 * @returns {Promise<Boolean>} - чинили ли
 */
export async function repairContents(journal) {
  if (!contentsLinksBroken(journal)) return false;

  const page = findContentsPage(journal);
  const pack = game.packs.get(JOURNAL_PACK);
  if (!page || !pack) return false;

  try {
    const source = await pack.getDocument(CORE_JOURNAL_ID);
    const sourcePages = source?.pages?.contents ?? [];
    const sourceContents = sourcePages.find(
      (p) => p.type === "text" && linkTargets(p.text?.content).length
    );
    if (!sourceContents) return false;

    const fixed = relinkContents(
      sourceContents.text.content,
      sourcePages.map((p) => ({ _id: p.id, name: p.name })),
      journal.pages.map((p) => ({ id: p.id, name: p.name }))
    );
    if (fixed === page.text?.content) return false;

    await page.update({ "text.content": fixed });
    console.log(`${MODULE_ID} | ссылки в оглавлении книги пересчитаны на страницы мира`);
    ui.notifications.info(localize("corebook.relinked"));
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | не удалось починить оглавление книги:`, error);
    return false;
  }
}

/**
 * Помечает нашу книгу флагом издания, если его ещё нет.
 *
 * Книга могла попасть в мир раньше, чем появилась поправка страниц, — тогда
 * флага у неё нет, и узнать её можно только по файлу, из которого она читается.
 *
 * @async
 * @param {JournalEntryPage} page - страница с кодом «Core»
 * @returns {Promise<Boolean>} - наша ли это книга теперь
 */
export async function markEdition(page) {
  if (isRussianEdition(page)) return true;
  if (!page?.src?.includes(`modules/${MODULE_ID}/pdfs/`)) return false;

  try {
    await page.setFlag(MODULE_ID, EDITION_FLAG, BOOK_EDITION);
    console.log(`${MODULE_ID} | книга в мире помечена как издание ${BOOK_EDITION}`);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | не удалось пометить книгу:`, error);
    return false;
  }
}

/**
 * Наша ли это книга.
 *
 * Поправка страниц верна только для русского издания. Если мастер положил в мир
 * английский корбук и пометил его кодом «Core», сдвигать ничего нельзя: там
 * номера и так совпадают. Поэтому смотрим не на код, а на флаг издания —
 * его ставим мы сами.
 *
 * @param {JournalEntryPage|null} page - страница с кодом «Core»
 * @returns {Boolean}
 */
export function isRussianEdition(page) {
  try {
    return page?.getFlag(MODULE_ID, EDITION_FLAG) === BOOK_EDITION;
  } catch (error) {
    return false;
  }
}

/**
 * Переводит номер страницы для ссылки на источник.
 *
 * Возвращает исходные настройки без изменений, если книга в мире не наша или
 * страницу вообще не просили: лучше открыть книгу не на той странице, чем не
 * открыть вовсе.
 *
 * @param {String} code - код книги из ссылки
 * @param {Object} options - настройки openPDFByCode
 * @returns {Object} - настройки с поправленной страницей
 */
export function correctPage(code, options) {
  if (code !== CORE_CODE || !options?.page) return options;
  if (!isRussianEdition(findCorebookPage())) return options;

  const page = bookPage(options.page);
  if (page === options.page) return options;

  console.log(
    `${MODULE_ID} | ссылка «${code}, ${options.page}» ведёт на ${page} русского издания`
  );
  return { ...options, page };
}

/**
 * Подключает поправку к ссылкам на источники.
 *
 * `cpr-source-links` зовёт `ui.pdfpager.openPDFByCode` напрямую, и это
 * единственная воронка: через неё проходят и ссылки с листов предметов, и
 * ручной вызов из макроса. Поэтому оборачиваем её, а не обработчик щелчка.
 *
 * libWrapper здесь не годится: `ui.pdfpager` — обычный объект, который
 * pdf-pager создаёт у себя в `ready`, а не класс из пространства имён игры.
 *
 * Оттуда же и попытки: `ui.pdfpager` появляется в чужом обработчике `ready`, а
 * порядок обработчиков — это порядок загрузки модулей, и рассчитывать на него
 * нельзя. Занять объект заранее тоже не выйдет: pdf-pager создаёт его через
 * `if (!ui.pdfpager)` и, увидев чужой, не положит туда ничего вовсе.
 *
 * @param {Number} attemptsLeft - сколько попыток дождаться pdf-pager осталось
 * @returns {Boolean} - удалось ли подключиться сразу
 */
export function registerPageMap(attemptsLeft = 10) {
  const pager = ui.pdfpager;
  if (typeof pager?.openPDFByCode !== "function") {
    if (attemptsLeft > 0) {
      setTimeout(() => registerPageMap(attemptsLeft - 1), 500);
      return false;
    }
    console.warn(`${MODULE_ID} | pdf-pager не появился, поправка страниц не подключена`);
    return false;
  }
  if (pager.openPDFByCode.cprAddendaWrapped) return true;

  const original = pager.openPDFByCode;
  const wrapped = function openPDFByCode(code, options = {}) {
    let corrected = options;
    try {
      corrected = correctPage(code, options);
    } catch (error) {
      // Поправка — удобство, а не условие работы: если она упала, ссылка
      // всё равно должна открыть книгу.
      console.error(`${MODULE_ID} | не удалось поправить страницу:`, error);
    }
    return original.call(this, code, corrected);
  };
  wrapped.cprAddendaWrapped = true;
  pager.openPDFByCode = wrapped;

  console.log(`${MODULE_ID} | ссылки на источники переведены на русское издание`);
  return true;
}
