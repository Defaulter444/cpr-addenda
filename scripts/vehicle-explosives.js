/**
 * Взрывающееся оружие: зона поражения на столе.
 *
 * Ракетница и гранатомёт бьют не по фигуре, а по площади. Книга правил,
 * раздел «Взрывчатка»:
 *
 *   «Все взрывающиеся виды оружия наносят урон всем целям (включая окружение)
 *   в зоне 10 м × 10 м (5 × 5 клеток). Центр зоны — это выбранная тобой цель,
 *   которая представляет собой квадрат 2 м × 2 м, а не отдельную фигуру. Урон
 *   бросается один раз и применяется ко всем целям в зоне.
 *
 *   Если ты выбросил значение ниже СЛ, необходимой для попадания по выбранной
 *   цели, рефери определяет, в какой точке внутри квадрата 10 × 10 м […] на
 *   самом деле сработал взрыв.
 *
 *   Любой персонаж с РЕФ 8 или выше может попытаться индивидуально уклониться
 *   от взрыва, выбросив результат выше твоей исходной проверки.»
 *
 * Отсюда и вся здешняя работа: поставить квадрат 5 × 5 клеток по цели,
 * назвать число, которое надо превзойти, и дать на карточке кнопки — одну на
 * урон и по одной на уклонение каждому, кому правила это позволяют.
 *
 * Бросков модуль не делает сам, он их только предлагает. Урон бросается один
 * раз на всю зону — значит, и кнопка на него одна, а не по кнопке на цель.
 * Уклонение — выбор игрока, поэтому его кнопка стоит у каждого своя и работает
 * только у того, чей это персонаж. Куда лёг промах, по-прежнему решает мастер:
 * такого решения кнопкой не заменить.
 *
 * Сторона считается в клетках, а не в метрах: книга даёт обе меры, и на
 * стандартной для Cyberpunk RED сетке в 2 м они совпадают, но клетки верны на
 * любой сетке.
 */

import { MODULE_ID, SETTINGS, SYSTEM_ID, localize } from "./constants.js";
import { findSkill } from "./vehicle-skills.js";

/** Типы оружия системы, которые бьют по площади. */
const EXPLOSIVE_TYPES = ["rocketLauncher", "grenadeLauncher"];

/** Сторона зоны поражения в клетках. */
const BLAST_SQUARES = 5;

/** РЕФ, начиная с которого правила разрешают уклоняться от взрыва. */
const DODGE_REF = 8;

/** Навык уклонения. Имя английское: по нему `findSkill` найдёт и русское. */
const EVASION = "Evasion";

/**
 * Бьёт ли это оружие по площади.
 *
 * @param {CPRItem} item - оружие
 * @returns {Boolean}
 */
export function isExplosive(item) {
  return EXPLOSIVE_TYPES.includes(item?.system?.weaponType);
}

/**
 * Экранирование текста, попадающего в разметку карточки.
 *
 * В карточку идут имена персонажей и оружия, а их пишет мастер. Апостроф или
 * угловая скобка в имени не должны разъезжать вёрстку.
 *
 * @param {String} text - произвольная строка
 * @returns {String}
 */
function esc(text) {
  return Handlebars.escapeExpression(String(text ?? ""));
}

/**
 * Ставит зону поражения и выдаёт карточку с кнопками.
 *
 * Центр — выбранная цель. Если цель не выбрана, ставить некуда: книга говорит
 * «центр зоны — выбранная тобой цель», а угадывать за игрока модуль не станет.
 *
 * @param {CPRItem} item - оружие, из которого стреляли
 * @param {Number} attackTotal - результат броска атаки, его и надо превзойти
 * @param {CPRActor} [gunner] - кто стрелял; от него пойдёт бросок урона
 * @returns {Promise<MeasuredTemplateDocument|null>}
 */
export async function placeBlast(item, attackTotal, gunner = null) {
  if (!game.settings.get(MODULE_ID, SETTINGS.explosiveTemplates)) return null;
  if (!canvas?.scene) return null;

  const [target] = Array.from(game.user.targets);
  if (!target) {
    ui.notifications.warn(localize("vehicle.blast.noTarget", { name: item.name }));
    return null;
  }

  const grid = canvas.scene.grid;
  const side = BLAST_SQUARES * grid.distance;
  const halfPixels = (BLAST_SQUARES * grid.size) / 2;

  // Прямоугольный шаблон Foundry рисуется из угла в точку, заданную
  // направлением и расстоянием. Направление 45° и диагональ side×√2 дают
  // ровный квадрат со стороной side; угол смещаем так, чтобы центр квадрата
  // пришёлся на середину клетки цели.
  const template = {
    t: "rect",
    user: game.user.id,
    x: target.center.x - halfPixels,
    y: target.center.y - halfPixels,
    direction: 45,
    distance: side * Math.SQRT2,
    angle: 0,
    borderColor: "#000000",
    fillColor: game.user.color,
    flags: { [MODULE_ID]: { blast: true, weapon: item.name } },
  };

  try {
    const [created] = await canvas.scene.createEmbeddedDocuments(
      "MeasuredTemplate",
      [template]
    );

    // Кто оказался в зоне. Считаем по центру фигуры: книга говорит про цели
    // «в зоне», а не про то, задело ли краем.
    const caught = [];
    for (const token of canvas.tokens?.placeables ?? []) {
      const { x, y } = token.center;
      if (
        x < template.x ||
        x > template.x + halfPixels * 2 ||
        y < template.y ||
        y > template.y + halfPixels * 2
      ) {
        continue;
      }
      const ref = token.actor?.system?.stats?.ref?.value ?? 0;
      caught.push({
        name: token.name,
        uuid: token.document?.uuid ?? token.actor?.uuid ?? null,
        ref,
        canDodge: ref >= DODGE_REF,
      });
    }

    const roster = caught.length
      ? "<ul>" +
        caught
          .map((t) => {
            const who = `${esc(t.name)} — ${localize("vehicle.blast.ref")} ${t.ref}: `;
            if (!t.canDodge) return `<li>${who}${localize("vehicle.blast.cannotDodge")}</li>`;
            const button =
              `<button type="button" class="cpr-addenda-blast-dodge"` +
              ` data-action="cprAddendaBlastDodge"` +
              ` data-token-uuid="${esc(t.uuid)}">` +
              `${localize("vehicle.blast.dodgeButton")}</button>`;
            return `<li>${who}${button}</li>`;
          })
          .join("") +
        "</ul>"
      : `<p><em>${localize("vehicle.blast.empty")}</em></p>`;

    const damageButton =
      `<button type="button" class="cpr-addenda-blast-damage"` +
      ` data-action="cprAddendaBlastDamage">` +
      `${localize("vehicle.blast.damageButton", { damage: item.system?.damage ?? "?" })}` +
      `</button>`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: item.actor }),
      content:
        `<p><strong>${esc(item.name)}</strong> — ${localize("vehicle.blast.title", {
          squares: BLAST_SQUARES,
          size: side,
          units: grid.units,
        })}</p>` +
        `<p>${localize("vehicle.blast.damageOnce")}</p>` +
        `<div class="cpr-addenda-blast-actions">${damageButton}</div>` +
        `<p class="cpr-addenda-blast-hint">${localize("vehicle.blast.applyHint")}</p>` +
        `<p>${localize("vehicle.blast.dodge", { total: attackTotal })}</p>` +
        `<p><strong>${localize("vehicle.blast.inZone")}</strong></p>` +
        roster +
        `<p><em>${localize("vehicle.blast.miss")}</em></p>`,
      // Кнопкам нужны не подписи, а ссылки на документы. Держим их во флагах:
      // разметку карточки пользователь может выделить и скопировать куда угодно,
      // а флаги переживут и это, и перезагрузку мира.
      flags: {
        [MODULE_ID]: {
          blast: {
            weapon: item.uuid,
            gunner: gunner?.uuid ?? item.actor?.uuid ?? null,
            attack: attackTotal,
            // Все, кто в зоне: урон применяется ко всем сразу, значит и в
            // карточку урона должны попасть все, а не одна выбранная цель.
            caught: caught.map((t) => t.uuid).filter(Boolean),
          },
        },
      },
    });

    return created;
  } catch (error) {
    console.error(`${MODULE_ID} | зона поражения не поставлена:`, error);
    ui.notifications.error(
      localize("vehicle.blast.failed", {
        message: error?.message ?? String(error),
      })
    );
    return null;
  }
}

/**
 * Общая часть обоих бросков карточки.
 *
 * Система бросает одинаково: сначала диалог доработки, потом подтверждение
 * предмета, потом сам бросок, потом карточка. Повторять эту цепочку дважды нет
 * смысла, а разойтись с системой в одном из шагов — верный способ получить
 * бросок, который отличается от такого же с листа персонажа.
 *
 * @param {Event} event - клик по кнопке, диалог читает из него модификаторы
 * @param {CPRActor} actor - от кого бросок
 * @param {CPRItem} item - чем бросают
 * @param {CPRRoll} roll - заготовка броска
 * @param {String|null} tokenId - фигура на столе, если она есть
 * @param {Array} targets - по кому раздавать урон; в карточку идут сами фигуры
 * @returns {Promise<CPRRoll|null>} - брошенный бросок или null, если отменили
 */
async function finishRoll(event, actor, item, roll, tokenId = null, targets = []) {
  let cprRoll = roll;
  const keepRolling = await cprRoll.handleRollDialog(event, actor, item);
  if (!keepRolling) return null;

  cprRoll = await item.confirmRoll(cprRoll);
  if (!cprRoll) return null;

  await cprRoll.roll();

  cprRoll.entityData = {
    actor: actor.id,
    token: tokenId,
    // Шаблон карточки урона берёт отсюда `name`, `actor.id` и `id`, поэтому
    // кладём документы фигур целиком. Идентификаторов ему мало: от них внизу
    // карточки остаются пустые строчки с кнопкой, которая никуда не применяет.
    tokens: targets,
    item: item.id,
  };

  const CPRChat = await import(
    `/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`
  );
  await CPRChat.default.RenderRollCard(cprRoll);
  return cprRoll;
}

/**
 * Кнопка «бросить урон»: один бросок на всю зону.
 *
 * Урон взрыва не зависит ни от навыка, ни от того, кто в зоне, — правила
 * говорят «бросается один раз и применяется ко всем». Поэтому кнопка одна, и
 * жать её должен тот, кто стрелял, или мастер.
 *
 * @param {Event} event - клик
 * @param {Object} blast - данные из флагов сообщения
 * @returns {Promise<void>}
 */
async function rollBlastDamage(event, blast) {
  const item = blast.weapon ? await fromUuid(blast.weapon) : null;
  if (!item) {
    ui.notifications.warn(localize("vehicle.blast.weaponGone"));
    return;
  }
  if (!item.isOwner && !game.user.isGM) {
    ui.notifications.warn(localize("vehicle.blast.damageNotYours"));
    return;
  }

  const gunner =
    (blast.gunner ? await fromUuid(blast.gunner) : null) ?? item.actor;
  if (!gunner) {
    ui.notifications.warn(localize("vehicle.blast.weaponGone"));
    return;
  }

  // Взрыв не бывает очередью: у ракетницы и гранатомёта режима огня нет,
  // а без явного типа система подставила бы режим прошлого выстрела.
  const roll = item.createRoll("damage", gunner, { damageType: "damage" });
  if (!roll) {
    ui.notifications.warn(
      localize("vehicle.notify.rollUnsupported", {
        name: item.name,
        type: "damage",
      })
    );
    return;
  }

  // Все, кто был в зоне на момент выстрела. Каждый получит в карточке урона
  // свою строчку с кнопкой — урон один на всех, но применяется поимённо.
  // Пропавшие со сцены фигуры просто выпадают из списка.
  const targets = [];
  for (const uuid of blast.caught ?? []) {
    const token = await fromUuid(uuid); // eslint-disable-line no-await-in-loop
    if (token) targets.push(token);
  }

  await finishRoll(event, gunner, item, roll, null, targets);
}

/**
 * Кнопка «уклониться»: бросок за одного персонажа из зоны.
 *
 * Книга: «Любой персонаж с РЕФ 8 или выше может попытаться индивидуально
 * уклониться от взрыва, выбросив результат выше твоей исходной проверки». РЕФ
 * проверен ещё при выдаче карточки — здесь остаётся бросок и сравнение.
 *
 * Уклоняется каждый сам за себя, поэтому кнопка работает только у владельца
 * персонажа: чужой бросок за игрока — не помощь, а отобранный выбор.
 *
 * @param {Event} event - клик
 * @param {Object} blast - данные из флагов сообщения
 * @param {String} tokenUuid - фигура, которая уклоняется
 * @returns {Promise<void>}
 */
async function rollBlastDodge(event, blast, tokenUuid) {
  const document = tokenUuid ? await fromUuid(tokenUuid) : null;
  const actor = document?.actor ?? document;
  if (!actor) {
    ui.notifications.warn(localize("vehicle.blast.tokenGone"));
    return;
  }
  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn(
      localize("vehicle.blast.dodgeNotYours", { name: actor.name })
    );
    return;
  }

  const skill = findSkill(actor, EVASION);
  if (!skill) {
    ui.notifications.warn(
      localize("vehicle.blast.noEvasion", { name: actor.name })
    );
    return;
  }

  const tokenId = document?.id ?? null;
  const cprRoll = await finishRoll(
    event,
    actor,
    skill,
    skill.createRoll("skill", actor),
    tokenId
  );
  if (!cprRoll) return;

  // Сравниваем и говорим итог вслух: у системной карточки навыка нет понятия
  // «против чего бросали», а без этого числа бросок ничего не решает.
  const total = Number(blast.attack);
  const escaped = cprRoll.resultTotal > total;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${localize(
      escaped ? "vehicle.blast.dodgeSuccess" : "vehicle.blast.dodgeFail",
      { name: actor.name, result: cprRoll.resultTotal, total }
    )}</p>`,
  });
}

/**
 * Вешает кнопки карточки взрыва.
 *
 * Зовётся на каждое отрисованное сообщение чата. Чужие сообщения отсеиваются по
 * флагу: искать кнопки по классу в любом сообщении подряд — способ однажды
 * перехватить чужую кнопку с тем же именем.
 *
 * @param {ChatMessage} message - сообщение
 * @param {jQuery} html - его разметка
 * @returns {void}
 */
export function activateBlastCard(message, html) {
  const blast = message?.flags?.[MODULE_ID]?.blast;
  if (!blast) return;

  const root = html?.[0] ?? html;
  if (!root?.querySelectorAll) return;

  for (const button of root.querySelectorAll("[data-action]")) {
    const action = button.dataset.action;
    if (action === "cprAddendaBlastDamage") {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        rollBlastDamage(event, blast).catch((error) => {
          console.error(`${MODULE_ID} | урон взрыва не брошен:`, error);
          ui.notifications.error(
            localize("vehicle.blast.failed", {
              message: error?.message ?? String(error),
            })
          );
        });
      });
    } else if (action === "cprAddendaBlastDodge") {
      const uuid = button.dataset.tokenUuid;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        rollBlastDodge(event, blast, uuid).catch((error) => {
          console.error(`${MODULE_ID} | уклонение не брошено:`, error);
          ui.notifications.error(
            localize("vehicle.blast.failed", {
              message: error?.message ?? String(error),
            })
          );
        });
      });
    }
  }
}

/** Внутренности для самопроверки. */
export const __test = { finishRoll, rollBlastDamage, rollBlastDodge, DODGE_REF };
