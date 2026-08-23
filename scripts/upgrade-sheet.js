/**
 * Строка «Типы оружия» на листе модификации.
 *
 * Ограничения хранятся во флагах предмета, а не в его данных, — так модуль
 * ничего не ломает в схеме системы и предмет остаётся полностью совместимым:
 * без модуля он просто ведёт себя как раньше. Но флаги нельзя править из
 * интерфейса, поэтому модуль дорисовывает на вкладку настроек одну строку с
 * кнопкой, открывающей выбор типов.
 */

import { MODULE_ID, FLAGS, SETTINGS, getFlag, localize } from "./constants.js";
import { getWeaponTypes, weaponTypeLabel } from "./cpr-config.js";
import { describeCarrierChanges } from "./carrier-changes.js";

/**
 * Короткая сводка ограничения для показа в строке листа.
 *
 * @param {Item} item - модификация
 * @returns {String}
 */
function describeRestriction(item) {
  const allowed = getFlag(item, FLAGS.allowedWeaponTypes);
  const denied = getFlag(item, FLAGS.deniedWeaponTypes);

  if (Array.isArray(allowed) && allowed.length) {
    return allowed.map(weaponTypeLabel).join(", ");
  }
  if (Array.isArray(denied) && denied.length) {
    return localize("sheet.exceptTypes", {
      types: denied.map(weaponTypeLabel).join(", "),
    });
  }
  return localize("sheet.noRestriction");
}

/**
 * Диалог выбора типов оружия.
 *
 * @async
 * @param {Item} item - модификация, которой правим ограничение
 */
async function openWeaponTypeDialog(item) {
  const types = getWeaponTypes();
  const allowed = new Set(getFlag(item, FLAGS.allowedWeaponTypes) ?? []);
  const denied = new Set(getFlag(item, FLAGS.deniedWeaponTypes) ?? []);
  const mode = denied.size > 0 && allowed.size === 0 ? "deny" : "allow";
  const checked = mode === "deny" ? denied : allowed;

  const rows = Object.keys(types)
    .map((key) => {
      const label = weaponTypeLabel(key);
      const isChecked = checked.has(key) ? "checked" : "";
      return `<label class="cpr-addenda-type">
        <input type="checkbox" name="wt" value="${key}" ${isChecked}/>
        <span>${label}</span>
      </label>`;
    })
    .join("");

  const content = `<form class="cpr-addenda-dialog">
    <p class="notes">${localize("dialog.hint")}</p>
    <div class="cpr-addenda-mode">
      <label>
        <input type="radio" name="mode" value="allow" ${
          mode === "allow" ? "checked" : ""
        }/>
        <span>${localize("dialog.modeAllow")}</span>
      </label>
      <label>
        <input type="radio" name="mode" value="deny" ${
          mode === "deny" ? "checked" : ""
        }/>
        <span>${localize("dialog.modeDeny")}</span>
      </label>
    </div>
    <div class="cpr-addenda-types">${rows}</div>
  </form>`;

  return Dialog.prompt({
    title: localize("dialog.title", { name: item.name }),
    content,
    label: localize("dialog.save"),
    rejectClose: false,
    options: { classes: ["cpr-addenda", "dialog"], width: 460 },
    callback: async (html) => {
      const form = html[0].querySelector("form") ?? html[0];
      const picked = Array.from(
        form.querySelectorAll('input[name="wt"]:checked')
      ).map((el) => el.value);
      const chosenMode =
        form.querySelector('input[name="mode"]:checked')?.value ?? "allow";

      // Списки взаимоисключающие: держать оба разом — верный способ
      // получить правило, которое никто не сможет прочитать.
      const updates = {
        [`flags.${MODULE_ID}.${FLAGS.allowedWeaponTypes}`]:
          chosenMode === "allow" ? picked : [],
        [`flags.${MODULE_ID}.${FLAGS.deniedWeaponTypes}`]:
          chosenMode === "deny" ? picked : [],
      };
      await item.update(updates);
    },
  });
}

/**
 * Дорисовывает строку на вкладку настроек листа модификации.
 *
 * @param {ItemSheet} app - лист предмета
 * @param {jQuery} html - отрендеренный HTML листа
 */
function onRenderItemSheet(app, html) {
  const item = app.document ?? app.item;
  if (item?.type !== "itemUpgrade") return;
  if (!game.settings.get(MODULE_ID, SETTINGS.showSheetControls)) return;

  // Якорь — системная строка «Тип модификации». От неё поднимаемся к списку
  // настроек и дописываем свои строки в конец.
  const anchor = html.find('select[name="system.type"]').closest("li");
  const list = anchor.length ? anchor.parent() : html.find("ul.item-list");
  if (!list.length) return;

  // Куда эта модификация вообще ставится. Системный лист показывает тип
  // выпадающим списком, но человеку, который держит предмет в руках, нужен
  // ответ на вопрос «в какой предмет мне его теперь тащить».
  if (!list.find(".cpr-addenda-carrier").length) {
    const carrierType = item.system?.type ?? "";
    const carrierLabel = game.i18n.localize(
      `CPR.global.itemTypes.${carrierType}`
    );
    const carrierRow = $(`<li class="item flexrow cpr-addenda-carrier">
      <div class="item flexrow setting-name text-nowrap">
        ${localize("sheet.installsInto")}
      </div>
      <div class="item flexrow setting-value text-nowrap item-end">
        <span class="cpr-addenda-summary">${carrierLabel}</span>
      </div>
    </li>`);
    list.append(carrierRow);
  }

  // Что модификация делает с предметом, в который встанет. Система такие
  // правки не показывает нигде: они лежат во флагах, и без этой строки понять,
  // что Автоспуск даёт стволу автоогонь, можно только из текста описания.
  if (!list.find(".cpr-addenda-changes").length) {
    const changes = describeCarrierChanges(item);
    if (changes.length) {
      list.append(
        $(`<li class="item flexrow cpr-addenda-changes">
          <div class="item flexrow setting-name text-nowrap">
            ${localize("sheet.carrierChanges")}
          </div>
          <div class="item flexrow setting-value text-nowrap item-end">
            <span class="cpr-addenda-summary" title="${changes.join("; ")}">${changes.join("; ")}</span>
          </div>
        </li>`)
      );
    }
  }

  // Ограничение по типам оружия имеет смысл только для оружейных модификаций.
  if (item.system?.type !== "weapon") return;
  if (!game.settings.get(MODULE_ID, SETTINGS.enforceWeaponTypes)) return;
  if (list.find(".cpr-addenda-weapon-types").length) return;

  const editable = app.isEditable ?? item.isOwner;
  const summary = describeRestriction(item);

  const row = $(`<li class="item flexrow cpr-addenda-weapon-types">
    <div class="item flexrow setting-name text-nowrap">
      ${localize("sheet.weaponTypes")}
    </div>
    <div class="item flexrow setting-value text-nowrap item-end">
      <span class="cpr-addenda-summary" title="${summary}">${summary}</span>
      ${
        editable
          ? `<a class="cpr-addenda-edit" title="${localize(
              "sheet.edit"
            )}"><i class="fas fa-crosshairs"></i></a>`
          : ""
      }
    </div>
  </li>`);

  row.find(".cpr-addenda-edit").on("click", () => openWeaponTypeDialog(item));
  list.append(row);
}

export function registerSheetHooks() {
  // Система регистрирует свой лист под именем CPRItemSheet, поэтому Foundry
  // выпускает хук с этим именем. Подписываемся и на общий, если система
  // когда-нибудь переименует класс.
  Hooks.on("renderCPRItemSheet", onRenderItemSheet);
  Hooks.on("renderItemSheet", (app, html) => {
    if (app.constructor.name === "CPRItemSheet") return;
    onRenderItemSheet(app, html);
  });
}
