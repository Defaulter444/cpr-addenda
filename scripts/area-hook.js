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
import {
  SHOT,
  areaKindOf,
  forgetArea,
  placeArea,
  recallArea,
} from "./area-attacks.js";

/** Карточки, по которым узнаётся именно атака оружием. */
const ATTACK_CARDS = [
  "cpr-attack-rollcard",
  "cpr-aimed-attack-rollcard",
  "cpr-autofire-rollcard",
  "cpr-suppressive-fire-rollcard",
];

/** Прицельный выстрел: дробью он по книге невозможен. */
const AIMED_CARD = "cpr-aimed-attack-rollcard";

/** Карточка урона: в неё и подставляем тех, кого накрыла зона. */
const DAMAGE_CARD = "cpr-damage-rollcard";

/**
 * Это карточка такого-то вида?
 *
 * @param {Object} roll - объект броска системы
 * @param {String} card - имя шаблона карточки
 * @returns {Boolean}
 */
function isCard(roll, card) {
  return String(roll?.rollCard ?? "").includes(card);
}

/**
 * Подставляет в карточку урона всех, кого накрыла зона.
 *
 * Система собирает список фигур из ПОМЕЧЕННЫХ целей
 * (`getUserTargetedOrSelected("targeted")`), поэтому после взрыва урон
 * предлагался одной цели, хотя накрыло нескольких: у остальных просто не было
 * кнопки. Книга же говорит обратное — «урон бросается один раз и применяется ко
 * всем целям в зоне».
 *
 * Правим до отрисовки: шаблон карточки читает `entityData.tokens` в момент
 * сборки разметки, и после неё менять что-либо поздно.
 *
 * @param {Object} roll - бросок урона
 * @returns {Number} - сколько фигур подставлено, ноль если не наш случай
 */
function widenDamage(roll) {
  const entity = roll?.entityData;
  if (!entity) return 0;

  const caught = recallArea(entity.actor, entity.item);
  if (!caught?.length) return 0;

  entity.tokens = caught;
  return caught.length;
}

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

/** Внутренности для самопроверки без запуска Foundry. */
export const __test = { isCard, widenDamage, AIMED_CARD, DAMAGE_CARD };

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
      // Урон правим ДО отрисовки: шаблон карточки читает список фигур в момент
      // сборки разметки, и после неё менять что-либо поздно.
      try {
        if (
          game.settings.get(MODULE_ID, SETTINGS.explosiveTemplates) &&
          isCard(roll, DAMAGE_CARD)
        ) {
          const widened = widenDamage(roll);
          if (widened) {
            console.log(
              `${MODULE_ID} | урон раздаётся по зоне: фигур ${widened}`
            );
          }
        }
      } catch (error) {
        console.error(`${MODULE_ID} | список целей урона не расширен:`, error);
      }

      const result = wrapped(roll, ...rest);
      try {
        if (!game.settings.get(MODULE_ID, SETTINGS.explosiveTemplates)) return result;
        if (!isAttackRoll(roll)) return result;

        const actor = game.actors.get(roll?.entityData?.actor);
        const item = actor?.items?.get(roll?.entityData?.item);
        const kind = item ? areaKindOf(item) : null;

        // Выстрел без зоны отменяет прежнюю: иначе выключенный режим дроби
        // оставил бы за собой список, и обычный выстрел тем же стволом раздал
        // бы урон по вчерашней зоне.
        if (!kind) {
          if (item) forgetArea(actor?.id, item.id);
          return result;
        }

        // «При использовании дроби нельзя выполнять прицельную атаку» (с. 175).
        // Зону не ставим и говорим почему, иначе выглядит как поломка.
        if (kind === SHOT && isCard(roll, AIMED_CARD)) {
          forgetArea(actor?.id, item.id);
          ui.notifications.warn(localize("area.shot.noAimed", { name: item.name }));
          return result;
        }

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
