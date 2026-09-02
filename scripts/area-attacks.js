/**
 * Площадные атаки: взрывчатка и дробь.
 *
 * Книга правил, с. 175, даёт два разных правила, и путать их нельзя.
 *
 *   «Взрывчатка. Все взрывающиеся виды оружия наносят урон всем целям
 *   (включая окружение) в зоне 10 м × 10 м (5 × 5 клеток). Центр зоны — это
 *   выбранная тобой цель… Урон бросается один раз и применяется ко всем целям
 *   в зоне. […] Любой персонаж с РЕФ 8 или выше может попытаться индивидуально
 *   уклониться от взрыва, выбросив результат выше твоей исходной проверки.»
 *
 *   «Дробь. При использовании дроби нельзя выполнять прицельную атаку. Когда ты
 *   стреляешь дробью, ты совершаешь одну дальнобойную атаку: РЕФ + навык
 *   длинноствольное оружие + 1d10 против СЛ 13. При успехе каждая цель перед
 *   тобой, находящаяся в пределах 6 м (3 клетки) и зоне видимости, получает
 *   3d6 урона. Урон бросается один раз и применяется ко всем целям. […]
 *   Отдельные цели с РЕФ 8 или выше всё ещё могут попытаться уклониться.»
 *
 * Отсюда всё устройство. Зона у взрыва — квадрат по цели; у дроби — полукруг
 * перед стрелком, и «перед» здесь буквально: полный раствор 180°, а куда именно
 * повёрнут стрелок, решает игрок, наведя шаблон колесом мыши.
 *
 * Модуль ничего не решает за игроков: он ставит зону, перечисляет попавших,
 * даёт каждому с РЕФ 8+ кнопку уклонения и одну кнопку урона на всех. Ни куда
 * лёг промахнувшийся взрыв, ни защитило ли укрытие — этого книга машине не
 * поручает, и здесь оно остаётся решением мастера.
 *
 * Раньше всё это жило внутри листа транспорта и потому работало только при
 * выстреле с поста силовой брони: граната с листа персонажа не давала ничего.
 * Теперь запуск идёт от самой атаки, откуда бы она ни пришла.
 */

import { MODULE_ID, SYSTEM_ID, SETTINGS, localize } from "./constants.js";
import { findSkill } from "./vehicle-skills.js";

/* ------------------------------------------------------------------ */
/*  Что считается площадной атакой                                     */
/* ------------------------------------------------------------------ */

/** Взрыв: квадрат по выбранной цели. */
export const BLAST = "blast";

/** Дробь: полукруг перед стрелком. */
export const SHOT = "shot";

/** Разновидности боеприпаса, дающие взрыв. */
const BLAST_AMMO = ["rocket", "grenade"];

/**
 * Типы оружия, взрывающиеся и без сведений о заряженном.
 *
 * Метательного оружия здесь намеренно нет: гранату кидают им же, но им же
 * кидают и нож, а книга даёт зону только гранате. Дробовика тоже нет — не зная
 * боеприпаса, отличить дробь от жакана невозможно, а жакан бьёт по одному.
 */
const BLAST_WEAPONS = ["rocketLauncher", "grenadeLauncher"];

/** Сторона зоны взрыва в клетках: 10 м при сетке в 2 м. */
export const BLAST_SQUARES = 5;

/** Сторона зоны дроби в клетках: блок три на три перед стрелком. */
export const SHOT_SQUARES = 3;

/**
 * Флаг режима дроби на актёре.
 *
 * Свой, а не системный `firetype`: тот задаёт тип броска, и значение «дробь»
 * система бросить не умеет — атака бы просто не состоялась. Здесь же режим
 * только помечает выстрел как площадной, а бросок остаётся обычным
 * дальнобойным, каким его и описывает книга.
 */
export const SHOT_FLAG = "shotmode";

/** РЕФ, начиная с которого правила разрешают уклоняться. */
export const DODGE_REF = 8;

/** Навык уклонения. Имя английское: по нему `findSkill` найдёт и русское. */
const EVASION = "Evasion";

/**
 * Разновидность заряженного боеприпаса.
 *
 * Не `system.ammoVariety` — это список совместимых, а не заряженное; и не
 * `system.magazine.ammoData`, которое миграция системы давно обнулила. Патрон
 * лежит установленным предметом, и метод системы достаёт его оттуда. При пустом
 * магазине патрон из оружия не выгружается, так что разновидность известна и
 * когда стрелять уже нечем.
 *
 * @param {CPRItem} item - оружие
 * @returns {String|undefined}
 */
export function loadedVariety(item) {
  try {
    return item?._getLoadedAmmoProp?.("variety");
  } catch (error) {
    return undefined;
  }
}

/**
 * Какой площадной атакой бьёт это оружие — и бьёт ли вообще.
 *
 * Сперва смотрим на заряженное: дробь и жакан различаются только им, и ошибка
 * здесь означала бы взрыв на пять клеток от пули. Тип оружия — запасной путь,
 * он нужен ракетницам силовой брони: они приезжают с пустым магазином, и
 * боеприпаса у них нет вовсе.
 *
 * @param {CPRItem} item - оружие
 * @returns {String|null} - BLAST, SHOT или null
 */
export function areaKindOf(item) {
  // Включённый режим дроби решает всё: стрелок сам сказал, чем стреляет.
  if (shotModeOn(item)) return SHOT;

  const variety = loadedVariety(item);
  if (BLAST_AMMO.includes(variety)) return BLAST;
  if (variety === "shotgunShell") return SHOT;
  // Жакан назван явно: это выстрел по одной цели, и запасной путь по типу
  // оружия не должен превращать его в площадную атаку.
  if (variety === "shotgunSlug") return null;
  if (variety) return null;

  return BLAST_WEAPONS.includes(item?.system?.weaponType) ? BLAST : null;
}

/**
 * Включён ли у этого оружия режим дроби.
 *
 * Режим живёт флагом на актёре, а не на предмете: так же поступает и сама
 * система с очередью и подавляющим огнём, и по той же причине — оружие может
 * лежать в компендиуме, а решение стрелять дробью принадлежит тому, кто держит
 * его в руках.
 *
 * @param {CPRItem} item - оружие
 * @returns {Boolean}
 */
export function shotModeOn(item) {
  if (!item?.id || !item.actor?.getFlag) return false;
  try {
    return Boolean(item.actor.getFlag(MODULE_ID, `${SHOT_FLAG}-${item.id}`));
  } catch (error) {
    return false;
  }
}

/**
 * Может ли это оружие стрелять дробью.
 *
 * Кнопку режима показываем только дробовикам: у остальных дроби не бывает.
 *
 * @param {CPRItem} item - оружие
 * @returns {Boolean}
 */
export function canFireShot(item) {
  return item?.type === "weapon" && item?.system?.weaponType === "shotgun";
}

/* ------------------------------------------------------------------ */
/*  Геометрия                                                          */
/* ------------------------------------------------------------------ */

/**
 * Попадает ли точка в квадрат зоны взрыва.
 *
 * Считаем по центру фигуры: книга говорит про цели «в зоне», а не про то,
 * задело ли краем.
 *
 * @param {Object} point - {x, y} центр фигуры в пикселях
 * @param {Object} area - {x, y, size} угол квадрата и его сторона в пикселях
 * @returns {Boolean}
 */
export function inBlast(point, area) {
  return (
    point.x >= area.x &&
    point.x <= area.x + area.size &&
    point.y >= area.y &&
    point.y <= area.y + area.size
  );
}

/**
 * Направление, приведённое к восьми сторонам сетки.
 *
 * Зона дроби — квадратный блок по клеткам, и повернуть его на произвольный угол
 * нельзя: клетки не поворачиваются. Поэтому наведение округляем до ближайшей из
 * восьми сторон, как это и происходит за столом — «он бьёт туда».
 *
 * @param {Number} degrees - направление в градусах
 * @returns {Object} - {dx, dy} шаг в клетках и {degrees} округлённый угол
 */
export function snapToGrid(degrees) {
  const step = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  const angle = step * 45;
  const radians = (angle * Math.PI) / 180;
  // Округляем: косинус 45° даёт 0.707, а шаг по клеткам бывает только целым.
  return {
    degrees: angle,
    dx: Math.round(Math.cos(radians)),
    dy: Math.round(Math.sin(radians)),
  };
}

/**
 * Мешает ли стена видеть точку из точки.
 *
 * Книга требует, чтобы цель дроби была «в зоне видимости». Спрашиваем у самой
 * Foundry: она считает это по стенам, независимо от того, включено ли на сцене
 * зрение токенов, — а на большинстве сцен оно выключено.
 *
 * Если считать не удалось, преграды не выдумываем: лучше показать лишнего в
 * списке, чем молча вычеркнуть того, кого задело.
 *
 * @param {Object} from - {x, y}
 * @param {Object} to - {x, y}
 * @returns {Boolean}
 */
export function sightBlocked(from, to) {
  const sweep = globalThis.ClockwiseSweepPolygon;
  if (!sweep?.testCollision) return false;
  try {
    return Boolean(sweep.testCollision(from, to, { type: "sight", mode: "any" }));
  } catch (error) {
    console.warn(`${MODULE_ID} | не удалось проверить стену:`, error);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Постановка зоны                                                    */
/* ------------------------------------------------------------------ */

/** Экранирование: в карточку идут имена персонажей и оружия. */
function esc(text) {
  return Handlebars.escapeExpression(String(text ?? ""));
}

/** Токен стрелка на текущей сцене. */
function tokenOf(actor) {
  if (!actor) return null;
  return (
    canvas.tokens?.placeables?.find((t) => t.actor?.id === actor.id) ?? null
  );
}

/**
 * Собирает данные зоны, ничего ещё не рисуя.
 *
 * Разделено намеренно: расчёт можно проверить тестами, а рисование нельзя.
 *
 * @param {String} kind - BLAST или SHOT
 * @param {Object} grid - {size, distance} сетка сцены
 * @param {Object} origin - {x, y} центр цели для взрыва, центр стрелка для дроби
 * @param {Number} direction - направление дроби в градусах
 * @returns {Object} - данные для документа шаблона и для проверки попадания
 */
export function areaGeometry(kind, grid, origin, direction = 0) {
  if (kind === BLAST) {
    const side = BLAST_SQUARES * grid.distance;
    const halfPixels = (BLAST_SQUARES * grid.size) / 2;
    return {
      kind,
      // Прямоугольный шаблон Foundry рисуется из угла в точку, заданную
      // направлением и расстоянием. Направление 45° и диагональ side×√2 дают
      // ровный квадрат со стороной side.
      template: {
        t: "rect",
        x: origin.x - halfPixels,
        y: origin.y - halfPixels,
        direction: 45,
        distance: side * Math.SQRT2,
        angle: 0,
      },
      hit: { x: origin.x - halfPixels, y: origin.y - halfPixels, size: halfPixels * 2 },
      squares: BLAST_SQUARES,
      metres: side,
    };
  }

  // Блок три на три вплотную перед стрелком: ближняя кромка — соседняя клетка,
  // дальняя — третья, то есть шесть метров, как и требует книга. Центр блока
  // приходится на вторую клетку по ходу выстрела.
  const facing = snapToGrid(direction);
  const side = SHOT_SQUARES * grid.size;
  const centreOffset = 2 * grid.size;
  const centre = {
    x: origin.x + facing.dx * centreOffset,
    y: origin.y + facing.dy * centreOffset,
  };
  const corner = { x: centre.x - side / 2, y: centre.y - side / 2 };
  const sideUnits = SHOT_SQUARES * grid.distance;

  return {
    kind,
    facing: facing.degrees,
    template: {
      t: "rect",
      x: corner.x,
      y: corner.y,
      direction: 45,
      distance: sideUnits * Math.SQRT2,
      angle: 0,
    },
    // Блок проверяется тем же способом, что и квадрат взрыва: обе зоны —
    // выровненные по сетке квадраты, и разной арифметики им не нужно.
    hit: { x: corner.x, y: corner.y, size: side },
    squares: SHOT_SQUARES,
    metres: sideUnits,
  };
}

/**
 * Кто оказался в зоне.
 *
 * @param {Object} geometry - результат areaGeometry
 * @param {Array} tokens - фигуры на сцене
 * @param {Object|null} origin - откуда смотреть для дроби; null — не проверять
 * @returns {Array<Object>}
 */
export function caughtBy(geometry, tokens, origin = null) {
  const caught = [];
  for (const token of tokens ?? []) {
    const centre = token.center;
    if (!centre) continue;

    if (!inBlast(centre, geometry.hit)) continue;

    // Дробь достаёт только видимое: книга требует «зону видимости».
    if (geometry.kind === SHOT && origin && sightBlocked(origin, centre)) continue;

    const ref = token.actor?.system?.stats?.ref?.value ?? 0;
    caught.push({
      name: token.name,
      uuid: token.document?.uuid ?? token.actor?.uuid ?? null,
      ref,
      canDodge: ref >= DODGE_REF,
    });
  }
  return caught;
}

/**
 * Ставит зону и выдаёт карточку с кнопками.
 *
 * @async
 * @param {Object} options - {item, actor, kind, attackTotal}
 * @returns {Promise<MeasuredTemplateDocument|null>}
 */
export async function placeArea({ item, actor, kind, attackTotal }) {
  if (!game.settings.get(MODULE_ID, SETTINGS.explosiveTemplates)) return null;
  if (!canvas?.scene) return null;

  const grid = canvas.scene.grid;
  const [target] = Array.from(game.user.targets);
  const shooter = tokenOf(actor);

  let origin;
  let direction = 0;

  if (kind === BLAST) {
    // Центр зоны — выбранная цель. Без неё ставить некуда: угадывать за
    // игрока, куда он целился, модуль не станет.
    if (!target) {
      ui.notifications.warn(localize("area.noTarget", { name: item.name }));
      return null;
    }
    origin = target.center;
  } else {
    if (!shooter) {
      ui.notifications.warn(localize("area.noShooter", { name: item.name }));
      return null;
    }
    origin = shooter.center;
    // Начальное направление — на помеченную цель, если она есть, иначе куда
    // повёрнут токен. Дальше игрок доводит сектор колесом мыши.
    if (target) {
      const dx = target.center.x - origin.x;
      const dy = target.center.y - origin.y;
      direction = Math.atan2(dy, dx) * (180 / Math.PI);
    } else {
      direction = Number(shooter.document?.rotation) || 0;
    }
  }

  const geometry = areaGeometry(kind, grid, origin, direction);

  try {
    const [created] = await canvas.scene.createEmbeddedDocuments(
      "MeasuredTemplate",
      [
        {
          ...geometry.template,
          user: game.user.id,
          borderColor: "#000000",
          fillColor: game.user.color,
          flags: { [MODULE_ID]: { area: kind, weapon: item.name } },
        },
      ]
    );

    await postCard({ item, actor, kind, attackTotal, geometry, shooter, created });
    return created;
  } catch (error) {
    console.error(`${MODULE_ID} | зона поражения не поставлена:`, error);
    ui.notifications.error(
      localize("area.failed", { message: error?.message ?? String(error) })
    );
    return null;
  }
}

/**
 * Кладёт в чат карточку зоны со списком попавших и кнопками.
 *
 * @async
 */
async function postCard({ item, actor, kind, attackTotal, geometry, shooter, created }) {
  const origin = kind === SHOT && shooter ? shooter.center : null;
  const caught = caughtBy(geometry, canvas.tokens?.placeables ?? [], origin);

  const roster = caught.length
    ? "<ul>" +
      caught
        .map((t) => {
          const who = `${esc(t.name)} — ${localize("area.ref")} ${t.ref}: `;
          if (!t.canDodge) return `<li>${who}${localize("area.cannotDodge")}</li>`;
          return (
            `<li>${who}<button type="button" class="cpr-addenda-blast-dodge"` +
            ` data-action="cprAddendaAreaDodge"` +
            ` data-token-uuid="${esc(t.uuid)}">` +
            `${localize("area.dodgeButton")}</button></li>`
          );
        })
        .join("") +
      "</ul>"
    : `<p><em>${localize("area.empty")}</em></p>`;

  const head =
    kind === BLAST
      ? localize("area.blast.title", {
          squares: geometry.squares,
          size: geometry.metres,
          units: canvas.scene.grid.units,
        })
      : localize("area.shot.title", {
          squares: geometry.squares,
          size: geometry.metres,
          units: canvas.scene.grid.units,
        });

  const rules =
    kind === BLAST
      ? `<p>${localize("area.blast.damageOnce")}</p>` +
        `<p class="cpr-addenda-pkt-note">${localize("area.blast.miss")}</p>` +
        `<p class="cpr-addenda-pkt-note">${localize("area.blast.cover")}</p>`
      : `<p>${localize("area.shot.damageOnce")}</p>` +
        `<p class="cpr-addenda-pkt-note">${localize("area.shot.dv")}</p>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `<p><strong>${esc(item.name)}</strong> — ${head}</p>` +
      rules +
      `<div class="cpr-addenda-blast-actions">` +
      `<button type="button" class="cpr-addenda-blast-damage"` +
      ` data-action="cprAddendaAreaDamage">` +
      `${localize("area.damageButton", { damage: item.system?.damage ?? "?" })}` +
      `</button>` +
      // Пересчёт нужен обеим зонам. У дроби — если направление вышло не то, у
      // взрыва — потому что книга прямо велит мастеру перенести промахнувшийся
      // взрыв в другую точку квадрата.
      `<button type="button" data-action="cprAddendaAreaRecount">` +
      `${localize("area.recount")}</button>` +
      `</div>` +
      `<p class="cpr-addenda-pkt-note">${localize("area.applyHint")}</p>` +
      `<p>${localize("area.dodge", { total: attackTotal })}</p>` +
      `<p><strong>${localize("area.inZone")}</strong></p>` +
      roster,
    flags: {
      [MODULE_ID]: {
        area: {
          kind,
          weapon: item.uuid,
          shooter: actor?.uuid ?? null,
          attack: attackTotal,
          template: created?.uuid ?? null,
          caught: caught.map((t) => t.uuid).filter(Boolean),
        },
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Кнопки карточки                                                    */
/* ------------------------------------------------------------------ */

/**
 * Общая часть бросков карточки: диалог, подтверждение, бросок, карточка.
 *
 * @async
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
    // Шаблон карточки урона берёт у цели `name`, `actor.id` и `id`, поэтому
    // кладём документы фигур целиком: от идентификаторов там остаются пустые
    // строчки с нерабочей кнопкой.
    tokens: targets,
    item: item.id,
  };

  const CPRChat = await import(`/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`);
  await CPRChat.default.RenderRollCard(cprRoll);
  return cprRoll;
}

/** Урон: один бросок на всю зону. */
async function rollAreaDamage(event, area) {
  const item = area.weapon ? await fromUuid(area.weapon) : null;
  if (!item) {
    ui.notifications.warn(localize("area.weaponGone"));
    return;
  }
  if (!item.isOwner && !game.user.isGM) {
    ui.notifications.warn(localize("area.damageNotYours"));
    return;
  }

  const shooter = (area.shooter ? await fromUuid(area.shooter) : null) ?? item.actor;
  if (!shooter) {
    ui.notifications.warn(localize("area.weaponGone"));
    return;
  }

  // Площадная атака не бывает очередью: без явного типа система подставила бы
  // режим прошлого выстрела.
  const roll = item.createRoll("damage", shooter, { damageType: "damage" });
  if (!roll) {
    ui.notifications.warn(
      localize("vehicle.notify.rollUnsupported", { name: item.name, type: "damage" })
    );
    return;
  }

  const targets = [];
  for (const uuid of area.caught ?? []) {
    const token = await fromUuid(uuid); // eslint-disable-line no-await-in-loop
    if (token) targets.push(token);
  }

  await finishRoll(event, shooter, item, roll, null, targets);
}

/** Уклонение: бросок за одного из зоны. */
async function rollAreaDodge(event, area, tokenUuid) {
  const document = tokenUuid ? await fromUuid(tokenUuid) : null;
  const actor = document?.actor ?? document;
  if (!actor) {
    ui.notifications.warn(localize("area.tokenGone"));
    return;
  }
  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn(localize("area.dodgeNotYours", { name: actor.name }));
    return;
  }

  const skill = findSkill(actor, EVASION);
  if (!skill) {
    ui.notifications.warn(localize("area.noEvasion", { name: actor.name }));
    return;
  }

  const cprRoll = await finishRoll(
    event,
    actor,
    skill,
    skill.createRoll("skill", actor),
    document?.id ?? null
  );
  if (!cprRoll) return;

  // Сравниваем и говорим итог вслух: у системной карточки навыка нет понятия
  // «против чего бросали», а без этого числа бросок ничего не решает.
  const total = Number(area.attack);
  const escaped = cprRoll.resultTotal > total;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${localize(
      escaped ? "area.dodgeSuccess" : "area.dodgeFail",
      { name: actor.name, result: cprRoll.resultTotal, total }
    )}</p>`,
  });
}

/**
 * Пересчёт списка после того, как игрок навёл сектор.
 *
 * Сектор дроби наводится колесом мыши уже после выстрела, поэтому список в
 * карточке к этому моменту устаревает. Пересчитываем по текущему положению
 * шаблона и говорим, кто теперь под ударом.
 */
async function recountArea(event, area, message) {
  const template = area.template ? await fromUuid(area.template) : null;
  if (!template) {
    ui.notifications.warn(localize("area.templateGone"));
    return;
  }

  const grid = canvas.scene.grid;
  // Шаблон обеих зон — выровненный квадрат, заданный углом. Пересчитываем по
  // тому, где он лежит сейчас: игрок мог его подвинуть.
  const side =
    (area.kind === SHOT ? SHOT_SQUARES : BLAST_SQUARES) * grid.size;
  const geometry = {
    kind: area.kind,
    hit: { x: template.x, y: template.y, size: side },
  };
  // Видимость считаем от стрелка, а не от угла блока: стена между ними и
  // решает, достала дробь или нет.
  const shooter = area.shooter ? await fromUuid(area.shooter) : null;
  const origin =
    area.kind === SHOT ? tokenOf(shooter?.actor ?? shooter)?.center ?? null : null;
  const caught = caughtBy(geometry, canvas.tokens?.placeables ?? [], origin);

  await ChatMessage.create({
    speaker: message.speaker,
    content:
      `<p><strong>${localize("area.recounted")}</strong></p>` +
      (caught.length
        ? "<ul>" +
          caught
            .map(
              (t) =>
                `<li>${esc(t.name)} — ${localize("area.ref")} ${t.ref}: ` +
                (t.canDodge
                  ? localize("area.mayDodgeShort")
                  : localize("area.cannotDodge")) +
                "</li>"
            )
            .join("") +
          "</ul>"
        : `<p><em>${localize("area.empty")}</em></p>`),
    flags: {
      [MODULE_ID]: {
        area: { ...area, caught: caught.map((t) => t.uuid).filter(Boolean) },
      },
    },
  });
}

/**
 * Вешает кнопки карточки зоны.
 *
 * @param {ChatMessage} message - сообщение
 * @param {jQuery} html - его разметка
 */
export function activateAreaCard(message, html) {
  const area = message?.flags?.[MODULE_ID]?.area;
  if (!area) return;

  const root = html?.[0] ?? html;
  if (!root?.querySelectorAll) return;

  const guard = (fn) => (event) => {
    event.preventDefault();
    fn(event).catch((error) => {
      console.error(`${MODULE_ID} | площадная атака:`, error);
      ui.notifications.error(
        localize("area.failed", { message: error?.message ?? String(error) })
      );
    });
  };

  for (const button of root.querySelectorAll("[data-action]")) {
    const action = button.dataset.action;
    if (action === "cprAddendaAreaDamage") {
      button.addEventListener("click", guard((e) => rollAreaDamage(e, area)));
    } else if (action === "cprAddendaAreaDodge") {
      const uuid = button.dataset.tokenUuid;
      button.addEventListener("click", guard((e) => rollAreaDodge(e, area, uuid)));
    } else if (action === "cprAddendaAreaRecount") {
      button.addEventListener("click", guard((e) => recountArea(e, area, message)));
    }
  }
}

/** Внутренности для самопроверки. */
export const __test = {
  BLAST_AMMO,
  snapToGrid,
  BLAST_WEAPONS,
  rollAreaDamage,
  rollAreaDodge,
  tokenOf,
};
