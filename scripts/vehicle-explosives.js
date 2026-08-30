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
 * Отсюда и вся здешняя работа: поставить квадрат 5 × 5 клеток по цели и
 * напомнить в чате число, которое надо превзойти, чтобы уклониться. Ни урон,
 * ни спасброски модуль не бросает сам: куда лёг промах — решает мастер, а
 * уклоняться или нет — выбор игрока. Додумывать за них модуль не должен.
 *
 * Сторона считается в клетках, а не в метрах: книга даёт обе меры, и на
 * стандартной для Cyberpunk RED сетке в 2 м они совпадают, но клетки верны на
 * любой сетке.
 */

import { MODULE_ID, SETTINGS, localize } from "./constants.js";

/** Типы оружия системы, которые бьют по площади. */
const EXPLOSIVE_TYPES = ["rocketLauncher", "grenadeLauncher"];

/** Сторона зоны поражения в клетках. */
const BLAST_SQUARES = 5;

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
 * Ставит зону поражения и напоминает правило.
 *
 * Центр — выбранная цель. Если цель не выбрана, ставить некуда: книга говорит
 * «центр зоны — выбранная тобой цель», а угадывать за игрока модуль не станет.
 *
 * @param {CPRItem} item - оружие, из которого стреляли
 * @param {Number} attackTotal - результат броска атаки, его и надо превзойти
 * @returns {Promise<MeasuredTemplateDocument|null>}
 */
export async function placeBlast(item, attackTotal) {
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

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: item.actor }),
      content:
        `<p><strong>${item.name}</strong> — ${localize("vehicle.blast.title", {
          squares: BLAST_SQUARES,
          size: side,
          units: grid.units,
        })}</p>` +
        `<p>${localize("vehicle.blast.damageOnce")}</p>` +
        `<p>${localize("vehicle.blast.dodge", { total: attackTotal })}</p>` +
        `<p><em>${localize("vehicle.blast.miss")}</em></p>`,
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
