/**
 * Режим дроби в строке оружия.
 *
 * Книга (с. 175): «Помимо пуль, дробовики могут стрелять дробью. При
 * использовании дроби нельзя выполнять прицельную атаку. Когда ты стреляешь
 * дробью, ты совершаешь одну дальнобойную атаку: РЕФ + навык длинноствольное
 * оружие + 1d10 против СЛ 13.»
 *
 * То есть дробь — это именно режим стрельбы, как очередь и подавляющий огонь, а
 * не другой патрон. Поэтому и переключатель стоит рядом с ними, в том же
 * списке режимов, и выглядит так же.
 *
 * Флаг свой, а не системный `firetype`. Системный задаёт ТИП БРОСКА, и значение
 * «дробь» система бросить не умеет: `createRoll("shot", …)` вернул бы null, и
 * атака просто не состоялась бы. Здесь режим ничего в броске не меняет — он
 * лишь помечает выстрел площадным, а бросок остаётся обычным дальнобойным,
 * каким его книга и описывает.
 *
 * Сам бросок мы не трогаем и здесь: у дроби СЛ фиксированная, 13 независимо от
 * дистанции, и прицельный выстрел ею невозможен. Это сказано на карточке зоны
 * напоминанием — навязывать чужому расчёту свои числа ради подсказки
 * неправильно.
 */

import { MODULE_ID, SETTINGS, localize } from "./constants.js";
import { SHOT_FLAG, canFireShot, shotModeOn } from "./area-attacks.js";

/** Ключ флага режима для конкретного оружия. */
export function shotFlagKey(itemId) {
  return `${SHOT_FLAG}-${itemId}`;
}

/**
 * Переключает режим дроби.
 *
 * Выключенный режим флага не оставляет вовсе: лишние флаги копятся на актёре
 * навсегда и переживают даже удаление оружия.
 *
 * @async
 * @param {CPRActor} actor - владелец
 * @param {String} itemId - оружие
 * @returns {Promise<Boolean>} - включён ли режим теперь
 */
export async function toggleShotMode(actor, itemId) {
  const key = shotFlagKey(itemId);
  const on = Boolean(actor.getFlag(MODULE_ID, key));
  if (on) await actor.unsetFlag(MODULE_ID, key);
  else await actor.setFlag(MODULE_ID, key, true);
  return !on;
}

/**
 * Разметка переключателя — точь-в-точь как у режимов самой системы.
 *
 * Кружок и подпись берём теми же классами, что и очередь с подавляющим огнём:
 * своя кнопка посреди чужого списка выглядела бы заплаткой.
 *
 * @param {String} itemId - оружие
 * @param {Boolean} on - включён ли режим
 * @returns {String}
 */
export function shotToggleMarkup(itemId, on) {
  return (
    `<li class="cpr-addenda-shot">` +
    `<span class="text-padding-right-small" title="${localize("shot.hint")}">` +
    `${localize("shot.short")}</span>` +
    `<a class="cpr-addenda-shot-toggle" data-item-id="${itemId}"` +
    ` title="${localize("shot.hint")}">` +
    `<i class="far ${on ? "fa-circle-dot" : "fa-circle"} text-padding-right-smallest"></i>` +
    `</a></li>`
  );
}

/**
 * Дописывает переключатель в строки дробовиков на листе.
 *
 * Идём от списка режимов, а не от строки оружия: у списка есть свой класс, и
 * привязка к нему переживёт перестановку колонок в шаблоне системы.
 *
 * @param {ActorSheet} app - лист
 * @param {jQuery} html - разметка листа
 * @returns {Number} - сколько переключателей поставлено
 */
export function injectShotToggles(app, html) {
  const actor = app?.actor;
  const root = html?.[0] ?? html;
  if (!actor || !root?.querySelectorAll) return 0;

  let added = 0;
  for (const anchor of root.querySelectorAll("a.fire-checkbox")) {
    const itemId = anchor.dataset.itemId;
    const list = anchor.closest("ul");
    if (!itemId || !list) continue;
    // Один переключатель на оружие: у дробовика режимов может быть несколько,
    // и обход нашёл бы его список дважды.
    if (list.querySelector(".cpr-addenda-shot")) continue;

    const item = actor.items.get(itemId);
    if (!canFireShot(item)) continue;

    list.insertAdjacentHTML("beforeend", shotToggleMarkup(itemId, shotModeOn(item)));
    added += 1;
  }

  // Дробовик без очереди и подавляющего огня списка режимов не получает вовсе —
  // тогда вешаться не на что, и переключателя у него не будет. Такое оружие
  // остаётся на опознании по боеприпасу.
  return added;
}

/** Подключает переключатель к листам персонажей. */
export function registerShotMode() {
  Hooks.on("renderActorSheet", (app, html) => {
    try {
      if (!game.settings.get(MODULE_ID, SETTINGS.explosiveTemplates)) return;
      injectShotToggles(app, html);

      const root = html?.[0] ?? html;
      for (const toggle of root?.querySelectorAll?.(".cpr-addenda-shot-toggle") ?? []) {
        toggle.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const on = await toggleShotMode(app.actor, toggle.dataset.itemId);
          ui.notifications.info(
            localize(on ? "shot.on" : "shot.off", {
              name: app.actor.items.get(toggle.dataset.itemId)?.name ?? "",
            })
          );
          app.render();
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | режим дроби не подключён:`, error);
    }
  });
}
