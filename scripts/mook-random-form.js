/**
 * Окно заказа случайной шестёрки.
 *
 * Мастер называет четыре вещи — кого, насколько опасного, сколько железа и
 * сколько штук, — и получает готовых НИП в папке `MookMaker`.
 *
 * Окно намеренно маленькое. Всё, что можно вывести из этих четырёх ответов,
 * выводится: характеристики, навыки, оружие, броня и импланты берутся из книги
 * (см. `mook-random.js`), а не спрашиваются по одному. Заполнять два десятка
 * полей ради безымянного бандита никто не станет — ради этого и затевался
 * раскладчик.
 */

import { MODULE_ID, localize } from "./constants.js";
import { TIER_ORDER, ROLE_ORDER, CHROME_ORDER } from "./mook-random.js";
import { createMooks } from "./mook-create.js";

/** Сколько шестёрок можно заказать за раз. */
const MAX_COUNT = 20;

/**
 * Список `<option>` из ключей и подписей.
 *
 * @param {Array<String>} keys - ключи
 * @param {String} prefix - начало ключа перевода
 * @param {String} selected - что отметить выбранным
 * @returns {String}
 */
function options(keys, prefix, selected) {
  return keys
    .map((key) => {
      const label = Handlebars.escapeExpression(localize(`${prefix}.${key}`));
      const mark = key === selected ? " selected" : "";
      return `<option value="${key}"${mark}>${label}</option>`;
    })
    .join("");
}

/**
 * Разметка окна.
 *
 * @returns {String}
 */
function formContent() {
  const row = (label, hint, field) =>
    `<div class="form-group">
       <label>${Handlebars.escapeExpression(localize(label))}</label>
       <div class="form-fields">${field}</div>
       ${hint ? `<p class="notes">${Handlebars.escapeExpression(localize(hint))}</p>` : ""}
     </div>`;

  return `<form class="cpr-addenda-random-mook">
    ${row("random.name", "", `<input type="text" name="name" value="${Handlebars.escapeExpression(localize("random.defaultName"))}">`)}
    ${row("random.role", "random.roleHint", `<select name="role">${options(ROLE_ORDER, "random.roles", "none")}</select>`)}
    ${row("random.tier", "random.tierHint", `<select name="tier">${options(TIER_ORDER, "random.tiers", "mook")}</select>`)}
    ${row("random.chrome", "random.chromeHint", `<select name="chrome">${options(CHROME_ORDER, "random.chromes", "none")}</select>`)}
    ${row("random.count", "", `<input type="number" name="count" value="1" min="1" max="${MAX_COUNT}" step="1">`)}
  </form>`;
}

/**
 * Открывает окно заказа и собирает то, что в нём назвали.
 *
 * @async
 */
export async function showRandomMookForm() {
  return new Promise((resolve) => {
    new Dialog({
      title: localize("random.title"),
      content: formContent(),
      buttons: {
        make: {
          icon: '<i class="fas fa-dice"></i>',
          label: localize("random.make"),
          callback: async (html) => {
            const read = (field) => html.find(`[name="${field}"]`).val();
            const count = Math.max(1, Math.min(MAX_COUNT, Number(read("count")) || 1));
            try {
              const { actors } = await createMooks({
                name: read("name"),
                role: read("role"),
                tier: read("tier"),
                chrome: read("chrome"),
                count,
              });
              ui.notifications.info(localize("random.done", { count: actors.length }));
              // Один — сразу открываем лист: мастер почти наверняка хочет
              // взглянуть. Пачку не открываем, иначе на экране двадцать окон.
              if (actors.length === 1) actors[0].sheet?.render(true);
              resolve(actors);
            } catch (error) {
              console.error(`${MODULE_ID} | не удалось собрать случайную шестёрку:`, error);
              ui.notifications.error(localize("random.failed"));
              resolve([]);
            }
          },
        },
        cancel: { label: localize("mook.cancel"), callback: () => resolve([]) },
      },
      default: "make",
      close: () => resolve([]),
    }).render(true);
  });
}
