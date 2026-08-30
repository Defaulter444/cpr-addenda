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

/** Модуль, который показывает PDF и держит соответствие «код -> страница». */
const PDF_PAGER = "pdf-pager";

/** Код книги, по которому `cpr-source-links` просит открыть страницу. */
const CORE_CODE = "Core";

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

  if (findCorebookPage()) return;

  // Без pdf-pager книга в мире бесполезна: показывать PDF будет нечем.
  if (!game.modules.get(PDF_PAGER)?.active) {
    ui.notifications.warn(localize("corebook.needPdfPager"), { permanent: true });
    return;
  }

  await importCorebook();
}
