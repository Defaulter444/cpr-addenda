/**
 * Сборка случайной шестёрки: расклад -> актёр в мире.
 *
 * Расклад считает `mook-random.js`, а здесь он превращается в живого актёра:
 * ищутся НАСТОЯЩИЕ предметы в компендиумах, ставятся уровни навыков, надевается
 * броня, вживляются импланты.
 *
 * ПОЧЕМУ ПОИСК ИДЁТ ПО АНГЛИЙСКИМ НАЗВАНИЯМ
 *
 * У мастера включён Babele, и он переводит имена документов В КОМПЕНДИУМАХ:
 * `pack.getIndex()` отдаёт «Штурмовая винтовка», а не «Assault Rifle». Искать по
 * русскому названию нельзя — оно зависит от перевода, а перевод правится. Зато
 * Babele кладёт исходное имя в `flags.babele.originalName`, и оно неизменно.
 * По нему и ищем, а на лист попадает уже переведённое имя.
 *
 * ПОЧЕМУ АКТЁР СОЗДАЁТСЯ ЧЕРЕЗ `getDocumentClass`, А НЕ ЧЕРЕЗ `Actor`
 *
 * Глобальный `Actor` — это БАЗОВЫЙ класс Foundry. Система подменяет не его, а
 * `CONFIG.Actor.documentClass`, и весь её `CPRActor.create` — раздача 63
 * базовых навыков и трёх корпусов под импланты — висит именно там. Вызов
 * `Actor.create()` проходит мимо: актёр получается правильного вида, но пустой,
 * без единого навыка и без гнёзд, куда вставлять опции имплантов. Ровно это и
 * случилось. `getDocumentClass("Actor")` возвращает класс системы.
 *
 * ПОЧЕМУ АКТЁР СОЗДАЁТСЯ БЕЗ `system`
 *
 * Ту раздачу система делает только если в данных НЕТ ключа `system` (по нему
 * она отличает нового актёра от копии). Поэтому создаём пустым, а
 * характеристики прописываем следующим шагом. Заодно система сама затирает
 * переданные `items`, так что снаряжение добавляется тоже после создания.
 *
 * ПОЧЕМУ ПОИСК ИДЁТ ПО ПАРЕ «ВИД + НАЗВАНИЕ»
 *
 * Одно и то же название встречается у предметов разного вида: «Subdermal
 * Armor» есть и среди брони, и среди имплантов, «Skin Weave» тоже. Поиск по
 * одному названию выдавал броню вместо импланта — шестёрка получала третий
 * элемент брони и оставалась без подкожки.
 */

import { MODULE_ID, SYSTEM_ID, localize } from "./constants.js";
import { planMook } from "./mook-random.js";

/** Папка, в которой конструктор шестёрок держит своё хозяйство. */
const ROOT_FOLDER = "MookMaker";

/** Сколько оружия шестёрка держит в руках; остальное лежит в рюкзаке. */
const EQUIPPED_WEAPONS = 2;

/** Названия предметов качества: в компендиуме это отдельные позиции. */
const QUALITY_SUFFIX = { poor: " (Poor)", standard: "", excellent: " (Excellent)" };

/* ------------------------------------------------------------------ */
/*  Поиск по компендиумам                                              */
/* ------------------------------------------------------------------ */

/**
 * Исходное (английское) имя документа, даже когда его перевёл Babele.
 *
 * Babele перекладывает оригинал в `flags.babele.originalName`, а в записях
 * указателя дублирует его и верхним уровнем. Проверяем оба места: указатель и
 * документ приходят сюда вперемешку.
 *
 * @param {Object} doc - документ или запись указателя
 * @returns {String}
 */
export function englishName(doc) {
  return (
    doc?.flags?.babele?.originalName ??
    doc?.originalName ??
    doc?.name ??
    ""
  );
}

/**
 * Указатель по всем предметным компендиумам системы.
 *
 * Собирается один раз на сборку: перебирать компендиумы ради каждой позиции
 * дорого, а шестёрке нужно полтора десятка предметов.
 *
 * Первый нашедшийся побеждает. Компендиумы системы перечислены в том порядке, в
 * каком их объявил `system.json`, и `core` идёт раньше дополнений — значит,
 * «Assault Rifle» возьмётся из корбука, а не из DLC с тем же названием.
 *
 * @async
 * @returns {Promise<Map<String, Object>>} - английское имя -> {pack, id, type, weaponType}
 */
export async function itemIndex() {
  const found = new Map();
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    const from = pack.metadata?.packageName ?? pack.metadata?.package;
    if (from !== SYSTEM_ID) continue;

    // eslint-disable-next-line no-await-in-loop
    const index = await pack.getIndex({
      fields: ["type", "system.weaponType", "system.type", "flags.babele.originalName"],
    });
    for (const entry of index) {
      const name = englishName(entry);
      if (!name || !entry.type) continue;
      const key = `${entry.type}|${name}`;
      if (found.has(key)) continue;
      found.set(key, {
        name,
        pack: pack.collection,
        id: entry._id,
        type: entry.type,
        weaponType: entry.system?.weaponType ?? "",
        cyberType: entry.system?.type ?? "",
      });
    }
  }
  return found;
}

/**
 * Запись указателя по виду и названию.
 *
 * @param {Map} index - указатель
 * @param {String} type - вид предмета: weapon, armor, cyberware, skill, role
 * @param {String} name - английское название
 * @returns {Object|null}
 */
export function lookup(index, type, name) {
  return index.get(`${type}|${name}`) ?? null;
}

/**
 * Список оружия для раскладчика: базовые названия и их типы.
 *
 * Отсеиваются позиции качества («Assault Rifle (Poor)») — это то же оружие, и
 * качество выбирает ступень, а не жребий. Иначе один и тот же ствол попадал бы
 * в жеребьёвку трижды.
 *
 * @param {Map} index - указатель из `itemIndex`
 * @returns {Array<Object>} - [{name, type}]
 */
export function weaponCatalogue(index) {
  const catalogue = [];
  for (const entry of index.values()) {
    if (entry.type !== "weapon" || !entry.weaponType) continue;
    if (/\s\((?:Poor|Excellent)\)$/.test(entry.name)) continue;
    catalogue.push({ name: entry.name, type: entry.weaponType });
  }
  return catalogue.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Название той же вещи нужного качества.
 *
 * Марочное оружие («Malorian Arms 3516») вариантов качества не имеет — тогда
 * возвращаем как есть, а не выдумываем несуществующую позицию.
 *
 * @param {Map} index - указатель
 * @param {String} name - базовое английское название
 * @param {String} quality - poor | standard | excellent
 * @returns {String}
 */
export function qualityName(index, name, quality) {
  const suffix = QUALITY_SUFFIX[quality] ?? "";
  if (!suffix) return name;
  const graded = `${name}${suffix}`;
  return lookup(index, "weapon", graded) ? graded : name;
}

/**
 * Достаёт один предмет из компендиума.
 *
 * @async
 * @param {Map} index - указатель
 * @param {String} type - вид предмета
 * @param {String} name - английское название
 * @param {Map} cache - общий кэш на сборку
 * @returns {Promise<Object|null>} - данные предмета или null
 */
async function fetchOne(index, type, name, cache) {
  const key = `${type}|${name}`;
  if (!cache.has(key)) {
    const entry = lookup(index, type, name);
    if (!entry) return null;
    const pack = game.packs.get(entry.pack);
    const document = await pack?.getDocument(entry.id);
    if (!document) return null;
    cache.set(key, document.toObject());
  }
  // Копия на каждое вхождение: две кибернетические руки — два разных предмета.
  const copy = foundry.utils.deepClone(cache.get(key));
  // Опознавательные поля исходного документа снимаем — так же, как это делает
  // сама система, когда переносит предмет из компендиума. Иначе обе киберруки
  // приходят с ОДНИМ `_id`, и это ровно тот случай, когда «два предмета»
  // незаметно оказываются одним.
  delete copy._id;
  delete copy.folder;
  delete copy.sort;
  delete copy._stats;
  return copy;
}

/**
 * Достаёт предметы из компендиумов по виду и английскому названию.
 *
 * Ненайденные молча пропускаются, а их список возвращается отдельно: сорвать
 * сборку целиком из-за одного отсутствующего импланта — плохой размен, мастеру
 * нужен НИП, а не сообщение об ошибке. О пропущенном он узнает из уведомления.
 *
 * @async
 * @param {Map} index - указатель
 * @param {Array<Object>} requests - [{type, name}], повторы допустимы
 * @returns {Promise<Object>} - {items: [данные], missing: [названия]}
 */
export async function fetchItems(index, requests) {
  const items = [];
  const missing = [];
  const cache = new Map();

  for (const request of requests) {
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchOne(index, request.type, request.name, cache);
    if (!data) {
      if (!missing.includes(request.name)) missing.push(request.name);
      continue;
    }
    items.push(data);
  }
  return { items, missing };
}

/* ------------------------------------------------------------------ */
/*  Папка                                                              */
/* ------------------------------------------------------------------ */

/**
 * Папка `MookMaker`, при надобности — созданная.
 *
 * Та же, куда складывает свои заготовки конструктор шестёрок: мастер уже знает,
 * где их искать, и заводить рядом вторую папку значит прятать половину НИП.
 *
 * @async
 * @returns {Promise<Folder|null>}
 */
export async function mookFolder() {
  const existing = (game.folders ?? []).find(
    (folder) => folder.type === "Actor" && folder.name === ROOT_FOLDER && !folder.folder
  );
  if (existing) return existing;
  return getDocumentClass("Folder").create({ name: ROOT_FOLDER, type: "Actor" });
}

/* ------------------------------------------------------------------ */
/*  Сборка                                                             */
/* ------------------------------------------------------------------ */

/**
 * Прописывает уровни навыков.
 *
 * Базовые навыки уже стоят на актёре — их система выдала при создании, и имена у
 * них английские (у `internal_skills` перевода Babele нет). Те, которых нет
 * совсем — «Science (Chemistry)», «Play Instrument (Guitar)» и прочие подвиды, —
 * лежат в отдельных компендиумах, и их доносим.
 *
 * @async
 * @param {Actor} actor - собираемая шестёрка
 * @param {Map} index - указатель
 * @param {Object} levels - название навыка -> уровень
 * @returns {Promise<Array<String>>} - навыки, которых не нашлось
 */
async function applySkills(actor, index, levels) {
  const updates = [];
  const wanted = new Map(Object.entries(levels));

  for (const item of actor.items) {
    if (item.type !== "skill") continue;
    const name = englishName(item);
    const level = wanted.get(name) ?? wanted.get(item.name);
    if (level === undefined) continue;
    updates.push({ _id: item.id, "system.level": level });
    wanted.delete(name);
    wanted.delete(item.name);
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);

  if (!wanted.size) return [];
  const requests = [...wanted.keys()].map((name) => ({ type: "skill", name }));
  const { items, missing } = await fetchItems(index, requests);
  for (const data of items) {
    data.system = { ...(data.system ?? {}), level: wanted.get(englishName(data)) ?? 0 };
  }
  if (items.length) await actor.createEmbeddedDocuments("Item", items);
  return missing;
}

/**
 * Выдаёт оружие и броню.
 *
 * @async
 * @param {Actor} actor - шестёрка
 * @param {Map} index - указатель
 * @param {Object} plan - расклад
 * @returns {Promise<Array<String>>} - чего не нашлось
 */
async function applyGear(actor, index, plan) {
  const missing = [];

  // Оружие: качество задаёт ступень. В руках держим два ствола, остальное
  // числится в снаряжении — так же делает конструктор шестёрок.
  const weapons = await fetchItems(
    index,
    plan.weapons.map((weapon) => ({
      type: "weapon",
      name: qualityName(index, weapon.name, plan.quality),
    }))
  );
  missing.push(...weapons.missing);
  weapons.items.forEach((data, position) => {
    data.system = {
      ...(data.system ?? {}),
      equipped: position < EQUIPPED_WEAPONS ? "equipped" : "owned",
    };
  });

  // Броня: в компендиуме это две отдельные позиции, на голову и на корпус.
  const armour = await fetchItems(index, [
    { type: "armor", name: `${plan.armor} (Body)` },
    { type: "armor", name: `${plan.armor} (Head)` },
  ]);
  missing.push(...armour.missing);
  for (const data of armour.items) {
    data.system = { ...(data.system ?? {}), equipped: "equipped" };
  }

  await actor.createEmbeddedDocuments("Item", [...weapons.items, ...armour.items]);
  return missing;
}

/**
 * Корпус, в который встаёт неопорный имплант.
 *
 * @param {Actor} actor - шестёрка
 * @param {Item} item - имплант
 * @param {Set<String>} fresh - id только что созданных: сами себе не корпуса
 * @returns {Item|null}
 */
function hostFor(actor, item, fresh) {
  const kind = item.system?.type;
  return (
    actor.items.find(
      (candidate) =>
        candidate.type === "cyberware" &&
        candidate.system?.isFoundational &&
        candidate.system?.type === kind &&
        !fresh.has(candidate.id) &&
        typeof candidate.installItems === "function"
    ) ?? null
  );
}

/**
 * Выдаёт и вживляет импланты вместе с их опциями.
 *
 * Голая киберрука не делает ничего — весь смысл в том, что в неё вставлено,
 * поэтому опции здесь не украшение, а половина работы.
 *
 * Опорные импланты («Neural Link», «Cyberarm») вживляются прямо в актёра — так
 * же, как система ставит базовые корпуса при создании. Неопорные идут внутрь
 * корпуса своего вида: «Subdermal Armor» — во «External», «Grafted Muscle and
 * Bone Lace» — во «Internal». Оба корпуса система выдала сама.
 *
 * Невживлённый имплант на листе выглядит как вещь в рюкзаке и ничего не даёт,
 * поэтому шаг обязательный.
 *
 * @async
 * @param {Actor} actor - шестёрка
 * @param {Map} index - указатель
 * @param {Object} plan - расклад
 * @returns {Promise<Array<String>>} - чего не нашлось
 */
async function applyChrome(actor, index, plan) {
  const missing = [];
  if (!plan.cyberware.length) return missing;

  // Опоры достаём по одной, сохраняя связь с их опциями: две киберруки — это
  // два разных предмета с разной начинкой, и по имени их потом не различить.
  const parts = [];
  for (const part of plan.cyberware) {
    // eslint-disable-next-line no-await-in-loop
    const { items, missing: gone } = await fetchItems(index, [
      { type: "cyberware", name: part.name },
    ]);
    missing.push(...gone);
    if (items[0]) parts.push({ data: items[0], options: part.options ?? [] });
  }
  if (!parts.length) return missing;

  const created = await actor.createEmbeddedDocuments(
    "Item",
    parts.map((part) => part.data)
  );
  const fresh = new Set(created.map((item) => item.id));

  // Опоры — в самого актёра.
  const foundations = created.filter((item) => item.system?.isFoundational);
  if (foundations.length) {
    const list = [
      ...(actor.system?.installedItems?.list ?? []),
      ...foundations.map((item) => item.id),
    ];
    await actor.update({ "system.installedItems.list": [...new Set(list)] });
  }

  // Неопорные — в системный корпус своего вида.
  for (const item of created) {
    if (item.system?.isFoundational) continue;
    const host = hostFor(actor, item, fresh);
    // Корпуса нужного вида нет — имплант остаётся в снаряжении. Это лучше, чем
    // засунуть его в чужой корпус и сломать лист.
    // eslint-disable-next-line no-await-in-loop
    if (host) await host.installItems([item]);
  }

  // Опции — внутрь своей опоры.
  for (let position = 0; position < created.length; position += 1) {
    const foundation = created[position];
    const options = parts[position]?.options ?? [];
    if (!options.length || !foundation?.system?.isFoundational) continue;

    // eslint-disable-next-line no-await-in-loop
    const { items, missing: gone } = await fetchItems(
      index,
      options.map((name) => ({ type: "cyberware", name }))
    );
    missing.push(...gone);
    if (!items.length) continue;

    // eslint-disable-next-line no-await-in-loop
    const made = await actor.createEmbeddedDocuments("Item", items);
    // eslint-disable-next-line no-await-in-loop
    await foundation.installItems(made);
  }
  return missing;
}

/**
 * Ставит роль нужного ранга.
 *
 * @async
 * @param {Actor} actor - шестёрка
 * @param {Map} index - указатель
 * @param {Object} plan - расклад
 * @returns {Promise<String>} - имя роли, каким его видно на листе (или пустая строка)
 */
async function applyRole(actor, index, plan) {
  if (!plan.roleRank || plan.role === "none") return "";

  // В компендиуме роль называется с большой буквы: solo -> Solo.
  const english = plan.role.charAt(0).toUpperCase() + plan.role.slice(1);
  const { items } = await fetchItems(index, [{ type: "role", name: english }]);
  const data = items[0];
  if (!data) return "";

  data.system = { ...(data.system ?? {}), rank: plan.roleRank };
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  // Активной ролью система считает ИМЯ предмета, а его мог перевести Babele —
  // поэтому берём имя созданного предмета, а не английское.
  return created?.name ?? "";
}

/**
 * Собирает шестёрку по раскладу.
 *
 * @async
 * @param {Object} plan - расклад из `planMook`
 * @param {Map} index - указатель по компендиумам
 * @param {Folder} folder - куда положить
 * @returns {Promise<Object>} - {actor, missing}
 */
export async function createMook(plan, index, folder) {
  // Класс берём у системы, а не глобальный `Actor`: раздача базовых навыков и
  // корпусов под импланты живёт в `CPRActor.create`, и мимо неё актёр выходит
  // пустым.
  //
  // А вот ЧТО вернёт этот вызов — не наше дело и полагаться на это нельзя.
  // `CPRActor.create` заканчивается на `actor.update({...installedItems.list})`,
  // а `Document#update` возвращает `updates.shift()` — пустоту, когда менять
  // нечего. Список корпусов к тому моменту уже правильный, так что система
  // отдаёт ничто при полностью созданном актёре.
  //
  // Ловить его хуком `createActor` тоже оказалось ненадёжно. Поэтому берём то,
  // что нельзя не заметить: актёр, которого в мире не было до вызова, и есть
  // наш. К моменту, когда `create` завершился, он уже лежит в `game.actors`.
  const before = new Set((game.actors ?? []).map((existing) => existing.id));

  // Без ключа `system`: иначе система примет актёра за копию и ничего не выдаст.
  await getDocumentClass("Actor").create({
    name: plan.name,
    type: "mook",
    folder: folder?.id ?? null,
    items: [],
  });

  const fresh = (game.actors ?? []).filter((made) => !before.has(made.id));
  // Имя — уточнение на случай, если в ту же секунду актёра завёл кто-то ещё,
  // а не обязательное условие: важно, что актёр новый.
  const actor = fresh.find((made) => made.name === plan.name) ?? fresh[0] ?? null;
  if (!actor) throw new Error("актёр не появился в мире после создания");

  const missing = [];
  missing.push(...(await applySkills(actor, index, plan.skills)));
  missing.push(...(await applyGear(actor, index, plan)));
  missing.push(...(await applyChrome(actor, index, plan)));
  const roleName = await applyRole(actor, index, plan);

  const stats = {};
  for (const [key, value] of Object.entries(plan.stats)) {
    stats[`system.stats.${key}.value`] = value;
  }
  await actor.update({
    ...stats,
    "system.derivedStats.hp.max": plan.hp,
    "system.derivedStats.hp.value": plan.hp,
    "system.roleInfo.activeRole": roleName,
  });

  return { actor, missing: [...new Set(missing)] };
}

/**
 * Собирает сразу нескольких по одним настройкам.
 *
 * Указатель по компендиумам строится ОДИН раз на всю пачку: он и есть самая
 * долгая часть, а шестёрок мастер обычно заказывает пять-шесть.
 *
 * @async
 * @param {Object} options - {role, tier, chrome, count, name}
 * @returns {Promise<Object>} - {actors, missing}
 */
export async function createMooks({ role, tier, chrome, count = 1, name = "" }) {
  const index = await itemIndex();
  const catalogue = weaponCatalogue(index);
  const folder = await mookFolder();

  const actors = [];
  const missing = [];
  const total = Math.max(1, Math.min(20, Number(count) || 1));
  const base = String(name).trim() || localize("random.defaultName");

  for (let number = 1; number <= total; number += 1) {
    const plan = planMook({
      role,
      tier,
      chrome,
      catalogue,
      name: total > 1 ? `${base} ${number}` : base,
    });
    // eslint-disable-next-line no-await-in-loop
    const made = await createMook(plan, index, folder);
    actors.push(made.actor);
    missing.push(...made.missing);
  }

  if (missing.length) {
    const list = [...new Set(missing)].join(", ");
    ui.notifications.warn(localize("random.missing", { list }));
    console.warn(`${MODULE_ID} | не нашлось в компендиумах: ${list}`);
  }
  return { actors, missing: [...new Set(missing)] };
}
