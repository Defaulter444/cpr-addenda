/**
 * Таблицы дальности модуля.
 *
 * Система берёт таблицы СЛ по дистанции не отовсюду, а из одного компендиума —
 * того, что указан в её настройке `dvRollTableCompendium`. Пока там стоит
 * системный пак, таблицы модуля не видит ни линейка дальности, ни модификации
 * ствола, которые их переключают.
 *
 * Пак модуля сделан полной заменой: в нём есть и расширенный набор из
 * документа, и таблицы под системными именами, чтобы штатное оружие не
 * осталось без своей таблицы после переключения.
 *
 * Настройку модуль не трогает — это решение мастера. Он только один раз
 * показывает, что переключить, и как вернуть обратно.
 */

import { MODULE_ID, localize } from "./constants.js";

const SYSTEM_SETTING = "dvRollTableCompendium";
const OUR_PACK = `${MODULE_ID}.addenda-dv-tables`;
const HINT_SHOWN = "dvHintShown";  // оставлено для совместимости со старыми мирами

/**
 * Показывает мастеру подсказку про настройку — один раз на мир.
 *
 * @async
 */
export async function checkDvTableSetting() {
  if (!game.user.isGM) return;

  let current;
  try {
    current = game.settings.get(game.system.id, SYSTEM_SETTING);
  } catch {
    // Настройки нет — версия системы другая, лезть не с чем.
    return;
  }

  if (current === OUR_PACK) return;

  // Показываем при каждой загрузке мира, пока настройка не переключена.
  // Разовая подсказка легко теряется в потоке сообщений, а без переключения
  // не работают ни таблицы, ни модификации ствола — молча и необъяснимо.

  // Инструкцию «зайдите в настройки и выберите» легко прочитать и не сделать,
  // а без переключения таблицы модуля просто не работают. Поэтому рядом с
  // объяснением сразу кнопка.
  ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM"),
    content: `<div class="cpr-addenda-hint">
      <h3>${localize("dv.hintTitle")}</h3>
      <p>${localize("dv.hintBody")}</p>
      <p class="notes">${localize("dv.hintSafety")}</p>
      <button type="button" class="cpr-addenda-dv-switch">
        ${localize("dv.switchButton")}
      </button>
      <p class="notes">${localize("dv.hintWhere")}</p>
    </div>`,
  });
}

/**
 * Переключает настройку системы на пак модуля.
 *
 * @async
 */
export async function switchToModuleTables() {
  if (!game.user.isGM) return false;

  // Компендиумы регистрируются сервером при запуске Foundry. Если модуль
  // включили или обновили без полного перезапуска, пака ещё нет — и
  // переключение настройки на несуществующий пак оставит систему вообще
  // без таблиц. Лучше честно сказать, чем сломать молча.
  const pack = game.packs.get(OUR_PACK);
  if (!pack) {
    ui.notifications.error(localize("dv.packMissing"));
    return false;
  }

  await game.settings.set(game.system.id, SYSTEM_SETTING, OUR_PACK);
  ui.notifications.info(
    localize("dv.switched", { count: pack.index.size })
  );
  return true;
}

/**
 * Возвращает системный компендиум таблиц.
 *
 * Нужно перед выключением модуля: настройка живёт в системе и переживает
 * отключение, а указывать она будет на пак, которого больше нет.
 *
 * @async
 */
export async function restoreSystemTables() {
  if (!game.user.isGM) return false;
  const systemPack = `${game.system.id}.internal_dv-tables`;
  await game.settings.set(game.system.id, SYSTEM_SETTING, systemPack);
  ui.notifications.info(localize("dv.restored"));
  return true;
}

/**
 * Оживляет кнопку в сообщении чата.
 */
export function registerDvHooks() {
  Hooks.on("renderChatMessage", (message, html) => {
    html.find(".cpr-addenda-dv-switch").on("click", async (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const ok = await switchToModuleTables();
        if (ok) button.textContent = localize("dv.switchDone");
        else button.disabled = false;
      } catch (err) {
        button.disabled = false;
        console.error(`${MODULE_ID} | Не удалось переключить таблицы`, err);
        ui.notifications.error(localize("dv.switchFailed"));
      }
    });
  });
}

/**
 * Регистрирует служебную настройку-«галочку», чтобы подсказка не повторялась.
 */
export function registerDvSettings() {
  game.settings.register(MODULE_ID, HINT_SHOWN, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
}
