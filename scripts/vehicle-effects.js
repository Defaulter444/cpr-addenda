/**
 * Транспорт: права доступа и эффекты постов.
 *
 * Всё, что лист транспорта делает с чужими документами, живёт здесь, а не в
 * самом листе. Причина простая: посадка в машину меняет права игрока и вешает
 * эффект на его персонажа, и это должно происходить, даже когда лист закрыт —
 * например, когда мастер правит посты макросом или когда транспорт удаляют.
 *
 * Обе сверки идут от состояния, а не от события: функция смотрит, как должно
 * быть, сравнивает с тем, как есть, и правит разницу. Поэтому их безопасно
 * звать сколько угодно раз подряд — лишних эффектов не появится.
 *
 * Владелец обеих операций — мастер. У игрока нет прав менять чужие документы,
 * поэтому обе функции на клиенте игрока молча выходят.
 */

import {
  MODULE_ID,
  SETTINGS,
  VEHICLE_FLAGS,
  localize,
  normalize,
} from "./constants.js";

/** Уровни доступа Foundry. Держим локально, чтобы не тянуть CONST в каждый файл. */
const OWNERSHIP = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

/** Картинка активного эффекта, который выдаёт транспорт. */
const EFFECT_IMG = `modules/${MODULE_ID}/assets/vehicle-effect.svg`;

/** Характеристики, которые пост может менять у сидящего в нём. */
const STATS = [
  "ref",
  "dex",
  "body",
  "cool",
  "will",
  "luck",
  "tech",
  "int",
  "move",
  "emp",
];

/**
 * Словарь «как пользователь мог написать характеристику» → путь к полю.
 *
 * Собирается на лету из локализации системы, поэтому мастер пишет модификатор
 * теми же буквами, что видит на листе персонажа: под русским языком это
 * «РЕФ:-2», под английским «REF:-2». Английские сокращения понимаются всегда —
 * они совпадают с внутренними ключами системы, и записанный когда-то профиль
 * не сломается от переключения языка.
 *
 * @returns {Map<String, String>} - нормализованное имя → путь к полю актёра
 */
function statAliases() {
  const aliases = new Map();
  for (const stat of STATS) {
    const path = `system.stats.${stat}.value`;
    aliases.set(stat, path);
    const label = normalize(game.i18n.localize(`CPR.global.stats.${stat}`));
    if (label) aliases.set(label, path);
  }
  return aliases;
}

/**
 * Разбирает строку модификаторов поста в изменения активного эффекта.
 *
 * Формат — «РЕФ:-2, ЛВК:+1»: пары «характеристика:число» через запятую.
 * Непонятные куски молча пропускаются: строку пишет человек руками, и одна
 * опечатка не должна лишать пост всех остальных модификаторов.
 *
 * @param {String} statMods - строка из настроек поста
 * @returns {Array<Object>} - массив changes для ActiveEffect
 */
export function parseStatMods(statMods) {
  const changes = [];
  if (!statMods) return changes;

  const aliases = statAliases();
  const entries = String(statMods)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part);

  for (const entry of entries) {
    // \p{L} вместо [A-Z]: под русским языком мастер пишет «РЕФ», а не «REF».
    const match = entry.match(/^(\p{L}+)\s*:\s*([+-]?\d+)$/u);
    if (!match) continue;
    const key = aliases.get(normalize(match[1]));
    if (!key) continue;
    // mode 2 — ADD: модификатор поста складывается с собственной
    // характеристикой персонажа, а не заменяет её.
    changes.push({ key, mode: 2, priority: null, value: String(Number(match[2])) });
  }
  return changes;
}

/**
 * Собирает документ активного эффекта в том виде, в каком его ждёт система.
 *
 * Системе мало стандартных полей: лист эффектов Cyberpunk RED читает свой флаг
 * `changes.cats` и без него показывает бонусы пустыми. Поэтому категорию
 * («stat») и ситуационность проставляем на каждое изменение сами.
 *
 * @param {String} name - имя эффекта, видимое игроку
 * @param {Array<Object>} changes - изменения характеристик
 * @param {Object} flags - флаги модуля, привязывающие эффект к транспорту
 * @returns {Object} - данные для createEmbeddedDocuments("ActiveEffect")
 */
function buildEffect(name, changes, flags) {
  const cats = {};
  const situational = {};
  changes.forEach((_, index) => {
    cats[String(index)] = "stat";
    situational[String(index)] = { isSituational: false, onByDefault: false };
  });

  return {
    name,
    type: "base",
    system: {},
    img: EFFECT_IMG,
    changes,
    disabled: false,
    transfer: true,
    tint: "#ffffff",
    description: "",
    origin: null,
    statuses: [],
    sort: 0,
    duration: {
      combat: null,
      rounds: null,
      seconds: null,
      startRound: null,
      startTime: null,
      startTurn: null,
      turns: null,
    },
    flags: {
      "cyberpunk-red-core": { changes: { cats, situational } },
      [MODULE_ID]: flags,
    },
  };
}

/**
 * Приводит права доступа к транспорту в соответствие с рассадкой.
 *
 * Логика: игрок получает права на транспорт, если в каком-то посту сидит его
 * персонаж. Пост, который управляет оружием или отдаёт токен, даёт полные
 * права, любой другой — только наблюдение.
 *
 * Настройка «беречь права мастера» решает спор между этим расчётом и тем, что
 * мастер выставил руками. Пока она включена, расчёт может права только
 * повысить; понизить — лишь до нуля и только когда персонаж вышел из машины.
 *
 * @param {CPRActor} actor - актёр-транспорт
 * @returns {Promise<void>}
 */
export async function reconcilePermissions(actor) {
  if (!game.user.isGM) return;
  try {
    const positions = actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || [];
    const players = game.users.filter((user) => !user.isGM);
    const keepGmPermissions = game.settings.get(
      MODULE_ID,
      SETTINGS.keepGmPermissions
    );

    for (const user of players) {
      let highestLevel = OWNERSHIP.NONE;
      let needsTokenControl = false;

      for (const pos of positions) {
        const userInPos = (pos.occupants || []).some((uuid) => {
          if (!uuid.startsWith("Actor.")) return false;
          const occupant = game.actors.get(uuid.split(".")[1]);
          return occupant?.testUserPermission(user, "OWNER") ?? false;
        });
        if (!userInPos) continue;

        const level =
          pos.grantsTokenControl || pos.canControlWeapons
            ? OWNERSHIP.OWNER
            : OWNERSHIP.OBSERVER;
        if (level > highestLevel) highestLevel = level;
        if (pos.grantsTokenControl) needsTokenControl = true;
      }

      const currentLevel = actor.ownership?.[user.id] ?? OWNERSHIP.NONE;
      const shouldUpdate = keepGmPermissions
        ? highestLevel === OWNERSHIP.NONE
          ? currentLevel !== OWNERSHIP.NONE
          : highestLevel > currentLevel
        : currentLevel !== highestLevel;
      if (shouldUpdate) {
        await actor.update({ [`ownership.${user.id}`]: highestLevel });
      }

      // Права на токен отдельные от прав на актёра: без них игрок видит лист,
      // но не может двигать машину по сцене.
      const targetTokenLevel = needsTokenControl
        ? OWNERSHIP.OWNER
        : OWNERSHIP.NONE;
      const sceneTokens =
        canvas.scene?.tokens?.filter((token) => token.actorId === actor.id) ||
        [];
      for (const tokenDoc of sceneTokens) {
        const current = tokenDoc.ownership?.[user.id] ?? OWNERSHIP.NONE;
        if (current !== targetTokenLevel) {
          await tokenDoc.update({ [`ownership.${user.id}`]: targetTokenLevel });
        }
      }
      const protoLevel =
        actor.prototypeToken?.ownership?.[user.id] ?? OWNERSHIP.NONE;
      if (protoLevel !== targetTokenLevel) {
        await actor.update({
          [`prototypeToken.ownership.${user.id}`]: targetTokenLevel,
        });
      }
    }
  } catch (error) {
    console.error(`${MODULE_ID} | сверка прав доступа к транспорту:`, error);
  }
}

/**
 * Замок от повторного входа.
 *
 * Сверка эффектов сама вызывает createEmbeddedDocuments, тот поднимает
 * updateActor, а на updateActor висит хук, зовущий сверку снова. Без замка это
 * рекурсия.
 */
const reconcileLocks = new Set();

/**
 * Приводит активные эффекты к текущей рассадке.
 *
 * Работает в две стороны. Пассажирам выдаются эффекты постов — модификаторы
 * характеристик и, если пост так настроен, СКО транспорта вместо своего.
 * Самому транспорту выдаётся эффект «СКО как у пилота» — для случая, когда
 * машина едет ровно так быстро, как ведёт её водитель.
 *
 * Свои эффекты модуль опознаёт по флагу, а не по имени: имя переводится и
 * меняется вместе с названием поста, флаг — нет.
 *
 * @param {CPRActor} actor - актёр-транспорт
 * @returns {Promise<void>}
 */
export async function reconcileEffects(actor) {
  if (!game.user.isGM) return;
  if (reconcileLocks.has(actor.id)) return;
  reconcileLocks.add(actor.id);

  try {
    const positions = actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || [];

    // Кому какой эффект положен. Ключ — uuid пассажира.
    const desired = new Map();
    for (const pos of positions) {
      const changes = parseStatMods(pos.statMods);
      if (pos.matchVehicleMove) {
        const vehicleMove = actor.system.stats?.move?.value ?? 0;
        // mode 5 — OVERRIDE: пассажир движется со скоростью машины,
        // собственная скорость при этом не складывается, а замещается.
        changes.push({
          key: "system.stats.move.value",
          mode: 5,
          priority: null,
          value: String(vehicleMove),
        });
      }
      if (changes.length === 0) continue;
      for (const uuid of pos.occupants || []) {
        desired.set(uuid, {
          name: localize("vehicle.effect.position", { position: pos.name }),
          changes,
          positionId: pos.id,
        });
      }
    }

    // Пересматриваем не только тех, кому эффект положен, но и всех, у кого
    // эффект от этого транспорта уже висит: иначе вышедший из машины остался
    // бы с чужим бонусом навсегда.
    const affected = game.actors.filter(
      (candidate) =>
        desired.has(candidate.uuid) ||
        candidate.effects.some(
          (effect) =>
            effect.getFlag(MODULE_ID, VEHICLE_FLAGS.managedBy) === actor.id
        )
    );

    for (const occupant of affected) {
      const stale = occupant.effects
        .filter(
          (effect) =>
            effect.getFlag(MODULE_ID, VEHICLE_FLAGS.managedBy) === actor.id
        )
        .map((effect) => effect.id);
      if (stale.length > 0) {
        await occupant.deleteEmbeddedDocuments("ActiveEffect", stale, {
          render: false,
        });
      }

      const wanted = desired.get(occupant.uuid);
      if (!wanted) continue;
      await occupant.createEmbeddedDocuments(
        "ActiveEffect",
        [
          buildEffect(wanted.name, wanted.changes, {
            [VEHICLE_FLAGS.managedBy]: actor.id,
            [VEHICLE_FLAGS.positionId]: wanted.positionId,
          }),
        ],
        { render: false }
      );
    }

    // Обратное направление: скорость машины по скорости пилота.
    const ownEffects = actor.effects
      .filter(
        (effect) =>
          effect.getFlag(MODULE_ID, VEHICLE_FLAGS.occupantMovePos) !== undefined
      )
      .map((effect) => effect.id);
    if (ownEffects.length > 0) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", ownEffects);
    }

    for (const pos of positions) {
      if (!pos.matchOccupantMove || !pos.occupants?.length) continue;
      const uuid = pos.occupants[0];
      if (!uuid.startsWith("Actor.")) continue;
      const pilot = game.actors.get(uuid.split(".")[1]);
      if (!pilot) continue;

      const pilotMove = pilot.system.stats?.move?.value ?? 0;
      await actor.createEmbeddedDocuments("ActiveEffect", [
        buildEffect(
          localize("vehicle.effect.pilotMove", { position: pos.name }),
          [
            {
              key: "system.stats.move.value",
              mode: 5,
              priority: null,
              value: String(pilotMove),
            },
          ],
          { [VEHICLE_FLAGS.occupantMovePos]: pos.id }
        ),
      ]);
    }
  } catch (error) {
    console.error(`${MODULE_ID} | сверка эффектов транспорта:`, error);
  } finally {
    reconcileLocks.delete(actor.id);
  }
}

/**
 * Снимает эффекты, оставшиеся от удалённого транспорта.
 *
 * Обычная сверка тут не поможет: транспорта уже нет, звать по нему нечего.
 *
 * @param {String} vehicleId - id удалённого актёра-транспорта
 * @returns {Promise<void>}
 */
export async function cleanupOrphanedEffects(vehicleId) {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    const orphaned = actor.effects
      .filter(
        (effect) =>
          effect.getFlag(MODULE_ID, VEHICLE_FLAGS.managedBy) === vehicleId
      )
      .map((effect) => effect.id);
    if (orphaned.length === 0) continue;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", orphaned, {
        render: false,
      });
    } catch (error) {
      console.error(
        `${MODULE_ID} | не удалось снять эффекты удалённого транспорта:`,
        error
      );
    }
  }
}
