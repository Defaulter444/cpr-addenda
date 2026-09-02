/**
 * Запуск площадных атак от самого броска.
 *
 * Обёртка стоит на отрисовке карточки атаки, а не на хуке сообщения чата, и
 * этому две причины. Во-первых, здесь есть живой объект броска: тип оружия,
 * итог броска, актёр, предмет и помеченные цели — из готового сообщения всё это
 * пришлось бы выковыривать из разметки. Во-вторых, отрисовка выполняется только
 * у того, кто бросал; хук `createChatMessage` сработал бы у каждого клиента, и
 * зона с карточкой размножились бы по числу игроков в игре.
 *
 * Прежде это жило в листе транспорта и потому работало лишь при выстреле с
 * поста силовой брони: граната с листа персонажа не давала ничего.
 */

import { MODULE_ID, SETTINGS, SYSTEM_ID, localize } from "./constants.js";
import { areaKindOf, placeArea } from "./area-attacks.js";

/** Карточки, по которым узнаётся именно атака оружием. */
const ATTACK_CARDS = [
  "cpr-attack-rollcard",
  "cpr-aimed-attack-rollcard",
  "cpr-autofire-rollcard",
  "cpr-suppressive-fire-rollcard",
];

/**
 * Это бросок атаки оружием?
 *
 * Проверяем по шаблону карточки, а не по классу броска: классы системы наружу
 * не выставлены, а имя шаблона — обычная строка в самом объекте.
 *
 * @param {Object} roll - объект броска системы
 * @returns {Boolean}
 */
export function isAttackRoll(roll) {
  const card = String(roll?.rollCard ?? "");
  return ATTACK_CARDS.some((name) => card.includes(name));
}

/**
 * Подключает обёртку.
 *
 * @async
 */
export async function registerAreaAttacks() {
  let CPRChat;
  try {
    const module = await import(`/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`);
    CPRChat = module.default ?? module.CPRChat;
  } catch (error) {
    console.warn(
      `${MODULE_ID} | чат системы недоступен: площадные атаки останутся без зоны.`,
      error
    );
    return;
  }
  if (!CPRChat?.RenderRollCard) return;

  // libWrapper адресует обёртки от globalThis, а классы системы наружу не
  // выставлены — публикуем ссылку под своим именем.
  globalThis.cprAddendaChatClass = CPRChat;

  libWrapper.register(
    MODULE_ID,
    "cprAddendaChatClass.RenderRollCard",
    function cprAddendaAreaAttack(wrapped, roll, ...rest) {
      const result = wrapped(roll, ...rest);
      try {
        if (!game.settings.get(MODULE_ID, SETTINGS.explosiveTemplates)) return result;
        if (!isAttackRoll(roll)) return result;

        const actor = game.actors.get(roll?.entityData?.actor);
        const item = actor?.items?.get(roll?.entityData?.item);
        const kind = item ? areaKindOf(item) : null;
        if (!kind) return result;

        // Зону ставим после того, как карточка атаки ушла в чат: иначе она
        // окажется в журнале раньше самого выстрела.
        Promise.resolve(result)
          .then(() =>
            placeArea({ item, actor, kind, attackTotal: roll.resultTotal })
          )
          .catch((error) => {
            console.error(`${MODULE_ID} | зона поражения не поставлена:`, error);
            ui.notifications.error(
              localize("area.failed", {
                message: error?.message ?? String(error),
              })
            );
          });
      } catch (error) {
        console.error(`${MODULE_ID} | площадная атака не распознана:`, error);
      }
      return result;
    },
    "WRAPPER"
  );

  console.log(`${MODULE_ID} | площадные атаки подключены`);
}
