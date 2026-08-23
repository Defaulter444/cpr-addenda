/**
 * Слоты на предмете-носителе.
 *
 * Чтобы в предмет можно было что-то установить, у него должны быть включены
 * два поля: `installedItems.allowed` (принимает ли он установку вообще) и
 * `installedItems.slots` (сколько места). Система выводит на лист только
 * второе — и только для кибернетики показывает первое. Для оружия, брони,
 * снаряжения и транспорта галки «принимает установку» в интерфейсе нет вовсе,
 * а без неё предмет не попадёт в список носителей.
 *
 * На практике это выглядит так: техник покупает Суперсканер, жмёт «установить»
 * и получает «нет предмета, в который можно установить» — потому что у всех
 * сканеров в системе приём установки выключен с завода. Из 51 предмета
 * снаряжения слоты открыты у шести.
 *
 * Модуль добавляет на лист носителя переключатель. Ничего не меняет сам:
 * решение открыть предмету слоты остаётся за мастером.
 */

import { MODULE_ID, SETTINGS, localize } from "./constants.js";

/** Типы предметов, которые в принципе умеют принимать модификации. */
const CARRIER_TYPES = [
  "armor", "cyberdeck", "clothing", "gear", "vehicle", "weapon",
];

/** Сколько слотов открыть, если мастер включает приём у предмета без слотов. */
const DEFAULT_SLOTS = 3;

/**
 * Рисует строку «Принимает модификации» на вкладке настроек носителя.
 *
 * @param {ItemSheet} app - лист предмета
 * @param {jQuery} html - отрендеренный HTML листа
 */
function onRenderCarrierSheet(app, html) {
  const item = app.document ?? app.item;
  if (!item || !CARRIER_TYPES.includes(item.type)) return;
  if (!game.settings.get(MODULE_ID, SETTINGS.showSheetControls)) return;

  const container = item.system?.installedItems;
  if (!container) return;

  // Цепляемся за сам список настроек, а не за поле «Слоты»: у снаряжения
  // раздел настроек может не содержать вообще ничего, и привязка к полю
  // означала бы, что переключатель не появится именно там, где он нужнее
  // всего — у сканеров и инструментов, в которые ничего не поставить.
  const list = html.find(".item-settings-tab ol.items-list").first();
  if (!list.length) return;
  if (list.find(".cpr-addenda-accepts").length) return;

  const editable = app.isEditable ?? item.isOwner;
  const accepts = Boolean(container.allowed);
  const icon = accepts ? "far fa-circle-check" : "far fa-circle";
  const slots = Number(container.slots) || 0;

  const row = $(`<li class="item flexrow cpr-addenda-accepts">
    <div class="item flexrow setting-name text-nowrap">
      ${localize("carrier.accepts")}
    </div>
    <div class="item flexrow setting-value text-nowrap item-end">
      <span class="cpr-addenda-summary">${
        accepts
          ? localize("carrier.slotsCount", { slots })
          : localize("carrier.acceptsNo")
      }</span>
      ${
        editable
          ? `<a class="item-checkbox cpr-addenda-toggle" title="${localize(
              "carrier.acceptsHint"
            )}"><i class="${icon}"></i></a>`
          : `<span><i class="${icon}"></i></span>`
      }
    </div>
  </li>`);

  row.find(".cpr-addenda-toggle").on("click", async () => {
    const updates = { "system.installedItems.allowed": !accepts };
    // Включать приём при нуле слотов бессмысленно — предмет всё равно ничего
    // не вместит, и мастер снова упрётся в «нет подходящего предмета».
    if (!accepts && slots === 0) {
      updates["system.installedItems.slots"] = DEFAULT_SLOTS;
    }
    await item.update(updates);
  });

  // Ставим сразу после блока «источник», до настроек от миксинов: вопрос
  // «принимает ли предмет установку» важнее частностей.
  const anchor = list.find('input[name="system.source.page"]').closest("li");
  if (anchor.length) anchor.after(row);
  else list.append(row);
}

export function registerCarrierHooks() {
  Hooks.on("renderCPRItemSheet", onRenderCarrierSheet);
  Hooks.on("renderItemSheet", (app, html) => {
    if (app.constructor.name === "CPRItemSheet") return;
    onRenderCarrierSheet(app, html);
  });
}
