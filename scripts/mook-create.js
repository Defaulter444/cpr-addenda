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
 * ПОЧЕМУ АКТЁР СОЗДАЁТСЯ БЕЗ `system`
 *
 * `CPRActor.create` раздаёт новому актёру все 63 базовых навыка и корпуса для
 * имплантов — но только если в данных НЕТ ключа `system` (система по нему
 * отличает нового актёра от копии). Поэтому создаём пустым, а характеристики
 * прописываем следующим шагом. Заодно система сама затирает переданные `items`,
 * так что снаряжение добавляется тоже после создания.
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
      if (!name || found.has(name)) continue;
      found.set(name, {
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
  for (const [name, entry] of index) {
    if (entry.type !== "weapon" || !entry.weaponType) continue;
    if (/\s\((?:Poor|Excellent)\)$/.test(name)) continue;
    catalogue.push({ name, type: entry.weaponType });
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
  return index.has(graded) ? graded : name;
}

/**
 * Достаёт предметы из компендиумов по английским названиям.
 *
 * Ненайденные молча пропускаются, а их список возвращается отдельно: сорвать
 * сборку целиком из-за одного отсутствующего импланта — плохой размен, мастеру
 * нужен НИП, а не сообщение об ошибке. О пропущенном он узнает из уведомления.
 *
 * @async
 * @param {Map} index - указатель
 * @param {Array<String>} names - что искать (повторы допустимы: две руки — два предмета)
 * @returns {Promise<Object>} - {items: [данные предметов], missing: [названия]}
 */
export async function fetchItems(index, names) {
  const items = [];
  const missing = [];
  const cache = new Map();

  for (const name of names) {
    const entry = index.get(name);
    if (!entry) {
      if (!missing.includes(name)) missing.push(name);
      continue;
    }
    if (!cache.has(name)) {
      const pack = game.packs.get(entry.pack);
      // eslint-disable-next-line no-await-in-loop
      const document = await pack?.getDocument(entry.id);
      if (!document) {
        if (!missing.includes(name)) missing.push(name);
        continue;
      }
      cache.set(name, document.toObject());
    }
    // Копия на каждое вхождение: две кибернетические руки — два разных предмета.
    items.push(foundry.utils.deepClone(cache.get(name)));
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
  return Folder.create({ name: ROOT_FOLDER, type: "Actor" });
}

/* ------------------------------------------------------------------ */
/*  Сборка                                                             */
/* ------------------------------------------------------------------ */

/**
 * Прописывает уровни навыков.
 *
 * Базовые навыки уже стоят на актёре — их система выдала при создании, и имена у
 * них английские (у `internal_skills` перевода Babele нет). Те, которых нет
 * совсем — «Science (Chemistry)», «Play Instrument» и прочие подвиды, — лежат в
 * отдельных компендиумах, и их доносим.
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
    const level = wanted.get(englishName(item)) ?? wanted.get(item.name);
    if (level === undefined) continue;
    updates.push({ _id: item.id, "system.level": level });
    wanted.delete(englishName(item));
    wanted.delete(item.name);
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);

  if (!wanted.size) return [];
  const { items, missing } = await fetchItems(index, [...wanted.keys()]);
  for (const data of items) {
    data.system = { ...(data.system ?? {}), level: wanted.get(englishName(data)) ?? 0 };
  }
  if (items.length) await actor.createEmbeddedDocuments("Item", items);
  return missing;
}

/**
 * Выдаёт оружие, броню и импланты.
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
  const weaponNames = plan.weapons.map((weapon) => qualityName(index, weapon.name, plan.quality));
  const weapons = await fetchItems(index, weaponNames);
  missing.push(...weapons.missing);
  weapons.items.forEach((data, position) => {
    data.system = {
      ...(data.system ?? {}),
      equipped: position < EQUIPPED_WEAPONS ? "equipped" : "owned",
    };
  });

  // Броня: в компендиуме это две отдельные позиции, на голову и на корпус.
  const armour = await fetchItems(index, [`${plan.armor} (Body)`, `${plan.armor} (Head)`]);
  missing.push(...armour.missing);
  for (const data of armour.items) {
    data.system = { ...(data.system ?? {}), equipped: "equipped" };
  }

  const chrome = await fetchItems(index, plan.cyberware);
  missing.push(...chrome.missing);

  const created = await actor.createEmbeddedDocuments("Item", [
    ...weapons.items,
    ...armour.items,
    ...chrome.items,
  ]);

  await installChrome(actor, created);
  return missing;
}

/**
 * Вживляет импланты.
 *
 * Опорные («Neural Link», «Cyberarm») ставятся прямо в актёра — так же, как
 * система ставит базовые корпуса при создании. Остальные идут внутрь корпуса
 * своего вида: «Subdermal Armor» — во «External», «Grafted Muscle and Bone
 * Lace» — во «Internal». Оба корпуса система выдала сама.
 *
 * Не вживлённый имплант на листе выглядит как вещь в рюкзаке и ничего не даёт,
 * поэтому шаг обязательный, а не украшение.
 *
 * @async
 * @param {Actor} actor - шестёрка
 * @param {Array<Item>} created - только что созданные предметы
 */
async function installChrome(actor, created) {
  const chrome = created.filter((item) => item.type === "cyberware");
  if (!chrome.length) return;

  const foundational = chrome.filter((item) => item.system?.isFoundational);
  const optional = chrome.filter((item) => !item.system?.isFoundational);

  if (foundational.length) {
    const list = [
      ...(actor.system?.installedItems?.list ?? []),
      ...foundational.map((item) => item.id),
    ];
    await actor.update({ "system.installedItems.list": [...new Set(list)] });
  }

  for (const item of optional) {
    const kind = item.system?.type;
    const host = actor.items.find(
      (candidate) =>
        candidate.type === "cyberware" &&
        candidate.system?.isFoundational &&
        candidate.system?.type === kind &&
        typeof candidate.installItems === "function"
    );
    // Корпуса нужного вида нет — имплант остаётся в снаряжении. Это лучше, чем
    // засунуть его в чужой корпус и сломать лист.
    // eslint-disable-next-line no-await-in-loop
    if (host) await host.installItems([item]);
  }
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
  const { items } = await fetchItems(index, [english]);
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
  // Без ключа `system`: иначе система примет актёра за копию и не выдаст ни
  // базовых навыков, ни корпусов для имплантов.
  const actor = await Actor.create({
    name: plan.name,
    type: "mook",
    folder: folder?.id ?? null,
    items: [],
  });
  if (!actor) throw new Error("Actor.create вернул пусто");

  const missing = [];
  missing.push(...(await applySkills(actor, index, plan.skills)));
  missing.push(...(await applyGear(actor, index, plan)));
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
