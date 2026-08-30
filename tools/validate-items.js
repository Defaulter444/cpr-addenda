/**
 * Проверка предметов модуля на работоспособность.
 *
 * Foundry не ругается на кривой предмет при загрузке компендиума — он молча
 * подставляет значения по умолчанию, а ломается позже: при попытке надеть
 * броню, установить модификацию или бросить кубик. Поэтому предметы
 * проверяются здесь, до того как попадут за стол.
 *
 * Что проверяется:
 *  1. Служебное — id ровно из 16 символов, уникальность, наличие типа и имени.
 *  2. Полнота — набор полей `system` совпадает с эталонным предметом того же
 *     типа из компендиумов системы. Недостающее поле однажды всплывёт как
 *     «cannot read property of undefined» в самый неподходящий момент.
 *  3. Допустимость значений — все поля с ограниченным набором вариантов
 *     (тип модификации, место установки, режим эффекта, тип оружия) сверяются
 *     со справочниками, вычитанными прямо из `config.js` системы.
 *  4. Числовые границы из схемы данных: размер и ОС не бывают отрицательными,
 *     штраф брони не ниже −10.
 *  5. Ссылки на иконки указывают на существующие файлы.
 *  6. Активные эффекты используют только ключи, известные системе.
 *
 *   node tools/validate-items.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const MODULE_ROOT = path.resolve(__dirname, "..");
const SOURCES = path.join(MODULE_ROOT, "sources");
const DATA_ROOT = path.resolve(MODULE_ROOT, "..", "..");
const SYSTEM_ROOT = path.join(DATA_ROOT, "systems", "cyberpunk-red-core");
const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop";

let ClassicLevel;
try {
  ({ ClassicLevel } = require(
    path.join(FOUNDRY_APP, "resources/app/node_modules/classic-level")
  ));
} catch {
  console.error("Не найден classic-level. Укажите FOUNDRY_APP.");
  process.exit(1);
}

const problems = [];
const notes = [];

function fail(file, message) {
  problems.push(`${file}: ${message}`);
}

/**
 * Читает справочник вида `CPR.<name> = { key: "...", ... }` из config.js.
 *
 * Система не отдаёт свой конфиг наружу, а дублировать списки в модуле —
 * значит однажды разойтись с ней. Поэтому вычитываем ключи из исходника.
 *
 * @param {String} source - текст config.js
 * @param {String} name - имя справочника
 * @returns {Array<String>} - список допустимых ключей
 */
function readConfigKeys(source, name) {
  const start = source.indexOf(`CPR.${name} = {`);
  if (start < 0) return [];
  let depth = 0;
  let end = start;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(start, end);
  // Ключи верхнего уровня: строка вида `  someKey: "..."`.
  return [...body.matchAll(/^\s{2}"?([A-Za-z0-9_& ]+)"?:/gm)].map((m) =>
    m[1].trim()
  );
}

/**
 * Собирает эталонные предметы: по одному документу каждого типа из
 * компендиумов системы.
 *
 * @async
 * @returns {Promise<Object>} - карта «тип предмета -> набор полей system»
 */

/**
 * Проверяет актёра.
 *
 * Актёры в модуле — готовые комплекты силовой брони, и открываться они должны
 * листом транспорта. Поэтому кроме служебных полей проверяем то, от чего
 * зависит их работа: выбран ли лист, есть ли пост экипажа и разбираются ли
 * модификаторы характеристик тем же способом, каким их читает сам лист.
 *
 * @param {Object} doc - документ актёра
 * @param {String} label - «пак/файл» для сообщений
 * @param {Map} seenIds - уже занятые идентификаторы
 */
function validateActor(doc, label, seenIds) {
  if (!/^[a-zA-Z0-9]{16}$/.test(doc._id ?? "")) {
    fail(label, `_id должен быть 16 буквенно-цифровых символов, получено "${doc._id}"`);
  } else if (seenIds.has(doc._id)) {
    fail(label, `_id "${doc._id}" уже занят файлом ${seenIds.get(doc._id)}`);
  } else {
    seenIds.set(doc._id, label);
  }

  if (!doc.name) fail(label, "нет имени");
  if (!doc.type) fail(label, "нет типа");

  // Лист транспорта вешается на character и mook — на других типах его нет.
  if (!["character", "mook"].includes(doc.type)) {
    fail(label, `тип "${doc.type}" не поддерживает лист транспорта`);
  }

  const sheet = doc.flags?.core?.sheetClass;
  if (sheet !== "cpr-addenda.VehicleSheet") {
    fail(label, `лист не выбран заранее: flags.core.sheetClass = "${sheet}"`);
  }

  const positions = doc.flags?.["cpr-addenda"]?.vehiclePositions;
  if (!Array.isArray(positions) || positions.length === 0) {
    fail(label, "нет ни одного поста экипажа");
  } else {
    for (const pos of positions) {
      if (!/^[a-zA-Z0-9]{16}$/.test(pos.id ?? "")) {
        fail(label, `пост "${pos.name}": id должен быть 16 символов, получено "${pos.id}"`);
      }
      if (!pos.name) fail(label, "у поста нет названия");
      if (!Number.isInteger(pos.maxOccupants) || pos.maxOccupants < 1) {
        fail(label, `пост "${pos.name}": мест на посту должно быть целым числом от 1`);
      }
      if (!Array.isArray(pos.occupants) || pos.occupants.length) {
        fail(label, `пост "${pos.name}": в компендиуме пост должен быть пуст`);
      }
      // Тот же разбор, что и в scripts/vehicle-effects.js: пары
      // «характеристика:число» через запятую. Опечатка здесь означала бы
      // молча не применившийся модификатор.
      for (const entry of String(pos.statMods ?? "").split(",")) {
        const text = entry.trim();
        if (!text) continue;
        if (!/^\p{L}+\s*:\s*[+-]?\d+$/u.test(text)) {
          fail(label, `пост "${pos.name}": модификатор "${text}" не разберётся листом`);
        }
      }
    }
  }

  const hp = doc.system?.derivedStats?.hp;
  if (!hp || !Number.isInteger(hp.value) || !Number.isInteger(hp.max)) {
    fail(label, "не проставлены ПЗ (system.derivedStats.hp)");
  } else if (hp.value !== hp.max) {
    fail(label, `ПЗ ${hp.value}/${hp.max}: в компендиуме костюм должен быть целым`);
  }

  const sp = doc.system?.externalData?.currentArmorBody;
  if (!sp || !Number.isInteger(sp.value) || !Number.isInteger(sp.max)) {
    fail(label, "не проставлены ОС (system.externalData.currentArmorBody)");
  }

  // ОС в шапке — только показания приборов. Урон система считает по надетым
  // предметам брони: `_applyDamage` спрашивает `getEquippedArmors` и берёт ОС
  // оттуда. Без предмета костюм получал полный урон при заполненной шапке —
  // ошибка, которую на листе не видно, поэтому держим её на проверке.
  const plates = (doc.items ?? []).filter((i) => i.type === "armor");
  if (plates.length !== 1) {
    fail(label, `предметов брони ${plates.length}, а нужен ровно один`);
  }
  for (const plate of plates) {
    const armor = plate.system ?? {};
    if (armor.equipped !== "equipped") {
      fail(label, `броня «${plate.name}» не надета (${armor.equipped}) — ОС не засчитается`);
    }
    if (!armor.isBodyLocation) {
      fail(label, `броня «${plate.name}» не покрывает тело, а обычный выстрел бьёт туда`);
    }
    if (!armor.isHeadLocation) {
      fail(label, `броня «${plate.name}» не покрывает голову: пилот заключён в оболочку целиком`);
    }
    for (const loc of ["bodyLocation", "headLocation"]) {
      const value = armor[loc]?.sp;
      if (value !== sp?.value) {
        fail(label, `броня «${plate.name}»: ${loc}.sp = ${value}, а в шапке ОС ${sp?.value}`);
      }
      if (armor[loc]?.ablation !== 0) {
        fail(label, `броня «${plate.name}»: ${loc}.ablation = ${armor[loc]?.ablation}, а костюм новый`);
      }
    }
  }

  // Вложенные предметы: бортовое оружие и импланты костюма.
  const positionIds = new Set((positions ?? []).map((p) => p.id));
  const itemIds = new Set();
  for (const item of doc.items ?? []) {
    if (!/^[a-zA-Z0-9]{16}$/.test(item._id ?? "")) {
      fail(label, `предмет "${item.name}": _id должен быть 16 символов, получено "${item._id}"`);
    } else if (itemIds.has(item._id)) {
      fail(label, `предмет "${item.name}": _id "${item._id}" повторяется внутри актёра`);
    } else {
      itemIds.add(item._id);
    }
    if (!item.name) fail(label, "у вложенного предмета нет имени");

    const flags = item.flags?.["cpr-addenda"] ?? {};
    const mount = flags.vehicleMountedPosition;
    if (mount !== undefined && !positionIds.has(mount)) {
      fail(label, `предмет "${item.name}" закреплён за постом "${mount}", которого нет`);
    }
    // Оружие должно быть закреплено, иначе с него нельзя стрелять с поста.
    if (item.type === "weapon" && mount === undefined) {
      fail(label, `оружие "${item.name}" не закреплено ни за одним постом`);
    }
    // Кибернетика должна быть помечена установленной, иначе уедет в груз.
    if (item.type === "cyberware" && flags.vehicleInstalled !== true) {
      fail(label, `имплант "${item.name}" не помечен установленным`);
    }
  }

  // Картинки: портрет костюма и картинка его токена. Мастер кладёт их в
  // assets/power-armor, и опечатка в имени файла иначе всплыла бы только
  // пустым квадратом на столе.
  for (const [what, src] of [
    ["портрет", doc.img],
    ["картинка токена", doc.prototypeToken?.texture?.src],
  ]) {
    if (!src) {
      fail(label, `не задан ${what}`);
      continue;
    }
    if (!fs.existsSync(path.join(DATA_ROOT, src))) {
      fail(label, `${what} не найден: ${src}`);
    }
  }

  const description = doc.system?.information?.description ?? "";
  if (!description || description === "<p></p>") {
    fail(label, "пустое описание");
  }
  const openTags = (description.match(/<p>/g) ?? []).length;
  const closeTags = (description.match(/<\/p>/g) ?? []).length;
  if (openTags !== closeTags) {
    fail(label, "незакрытая разметка в описании");
  }
}


async function loadReferences() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(SYSTEM_ROOT, "system.json"), "utf-8")
  );
  const references = {};

  for (const pack of manifest.packs) {
    if (pack.type !== "Item") continue;
    const dbPath = path.join(SYSTEM_ROOT, pack.path);
    if (!fs.existsSync(dbPath)) continue;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-ref-"));
    try {
      for (const f of fs.readdirSync(dbPath)) {
        if (f === "LOCK") continue;
        fs.copyFileSync(path.join(dbPath, f), path.join(tmp, f));
      }
      const db = new ClassicLevel(tmp, { valueEncoding: "json" });
      for await (const [, doc] of db.iterator()) {
        if (!doc?.type || !doc.system) continue;
        // Берём предмет с самым богатым набором полей: у некоторых записей
        // часть полей отсутствует, и такой эталон занизил бы требования.
        const current = references[doc.type];
        const size = Object.keys(doc.system).length;
        if (!current || size > current.size) {
          references[doc.type] = {
            size,
            name: doc.name,
            keys: new Set(Object.keys(doc.system)),
            modifierKeys: doc.system.modifiers
              ? new Set(Object.keys(doc.system.modifiers))
              : null,
          };
        }
      }
      await db.close();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return references;
}

/**
 * Проверяет таблицу бросков: полосы дистанций должны идти подряд, без дыр и
 * пересечений, иначе линейка дальности молча покажет пустое значение.
 *
 * @param {Object} doc - документ таблицы
 * @param {String} label - имя файла для сообщений
 * @param {Map} seenIds - общий реестр идентификаторов
 */
/**
 * Проверяет комплект корпуса ПКТ.
 *
 * Комплект едет в своём флаге и раскладывается модулем: фундаменты — в
 * персонажа, опции — в фундамент своего типа, покрытия — в сам корпус.
 * Проверяем то, на что эта раскладка опирается: типы, слоты и обнулённую
 * потерю человечности. Разойдись данные с раскладкой — модуль молча поставит
 * меньше, чем написано в книге.
 *
 * @param {Object} doc - корпус
 * @param {String} label - как называть предмет в сообщениях
 * @param {Map} seenIds - занятые идентификаторы, общие на весь модуль
 * @param {Function} report - куда сообщать о находках
 */
function checkPktKit(doc, label, seenIds, report) {
  const kit = doc.flags?.["cpr-addenda"]?.pktKit;
  if (kit === undefined) return;

  if (!Array.isArray(kit.foundations) || !Array.isArray(kit.carried)) {
    report(label, "комплект должен состоять из списков foundations и carried");
    return;
  }

  const checkPart = (part, where) => {
    if (!/^[a-zA-Z0-9]{16}$/.test(part._id ?? "")) {
      report(where, `«${part.name}»: _id должен быть 16 символов`);
    } else if (seenIds.has(part._id)) {
      report(
        where,
        `_id «${part._id}» уже занят (${seenIds.get(part._id)}) — ` +
          "у каждого экземпляра импланта должен быть свой"
      );
    } else {
      seenIds.set(part._id, where);
    }
    if (!part.name) report(where, "у импланта комплекта нет имени");
    if (!part.type) report(where, `имплант «${part.name}» без типа`);
    if (!part.system) report(where, `имплант «${part.name}» без данных`);

    // Потеря человечности за комплект назначена корпусу одной строкой из
    // книги; оставь имплантам их собственную — и система спишет её повторно,
    // да ещё бросит кубик за каждый из двух десятков.
    const loss = part.system?.humanityLoss ?? {};
    if (loss.static !== 0 || String(loss.roll) !== "0") {
      report(
        where,
        `«${part.name}»: потеря человечности должна быть обнулена, ` +
          `а стоит ${loss.static}/${loss.roll}`
      );
    }
    if (part.system?.installedItems?.list?.length) {
      report(where, `«${part.name}»: список установленного должен быть пуст`);
    }
  };

  for (const group of kit.foundations) {
    const host = group?.item;
    if (!host) {
      report(label, "в комплекте есть фундамент без предмета");
      continue;
    }
    const where = `${label} → «${host.name}»`;
    checkPart(host, label);

    if (!host.system?.isFoundational) {
      report(label, `«${host.name}» стоит фундаментом, но таковым не помечен`);
    }

    const options = group.options ?? [];
    for (const option of options) {
      checkPart(option, where);
      // Опция обязана быть того же типа: по нему система ищет, куда её
      // вернуть, если игрок снимет имплант и захочет поставить обратно.
      if (option.system?.type !== host.system?.type) {
        report(
          where,
          `«${option.name}» типа ${option.system?.type} стоит в фундаменте ` +
            `типа ${host.system?.type}`
        );
      }
    }

    const needed = options.reduce((sum, o) => sum + (o.system?.size ?? 1), 0);
    const slots = host.system?.installedItems?.slots ?? 0;
    if (needed > slots) {
      report(where, `опциям нужно ${needed} слотов, а у фундамента ${slots}`);
    }
    if (needed && host.system?.installedItems?.allowed !== true) {
      report(where, "фундамент с опциями должен принимать установку");
    }
  }

  for (const part of kit.carried) {
    checkPart(part, label);
    if (part.system?.isFoundational) {
      report(label, `«${part.name}» фундаментален — ему место не в корпусе`);
    }
  }

  const carriedSize = kit.carried.reduce(
    (sum, p) => sum + (p.system?.size ?? 1),
    0
  );
  const installed = doc.system?.installedItems ?? {};
  if ((installed.slots ?? 0) < carriedSize) {
    report(label, `корпусу нужно ${carriedSize} слотов, а есть ${installed.slots}`);
  }
  // Комплект разворачивает модуль, поэтому у предмета в компендиуме ничего
  // установленного быть не должно.
  if (installed.list?.length || installed.usedSlots) {
    report(label, "у корпуса в компендиуме не должно быть установленного");
  }
  if (doc.flags?.cprInstallTree) {
    report(label, "системное дерево установки больше не используется");
  }
}

function validateTable(doc, label, seenIds) {
  if (!/^[a-zA-Z0-9]{16}$/.test(doc._id ?? "")) {
    fail(label, `_id таблицы должен быть 16 символов, получено "${doc._id}"`);
  } else if (seenIds.has(doc._id)) {
    fail(label, `_id "${doc._id}" уже занят файлом ${seenIds.get(doc._id)}`);
  } else {
    seenIds.set(doc._id, label);
  }
  if (!doc.name) fail(label, "у таблицы нет имени");

  const rows = doc.results ?? [];
  if (!rows.length) {
    fail(label, "в таблице нет строк");
    return;
  }

  const sorted = [...rows].sort((a, b) => a.range[0] - b.range[0]);
  let previousEnd = -1;
  for (const row of sorted) {
    if (!Array.isArray(row.range) || row.range.length !== 2) {
      fail(label, `строка "${row.text}": диапазон задан неверно`);
      continue;
    }
    const [from, to] = row.range;
    if (from > to) fail(label, `строка "${row.text}": начало диапазона больше конца`);
    if (from !== previousEnd + 1) {
      fail(label, `разрыв дистанций перед ${from} м (предыдущая кончается на ${previousEnd})`);
    }
    previousEnd = to;
    if (!/^(\d+|N\/A)$/.test(String(row.text))) {
      fail(label, `строка ${from}-${to}: ожидается число или N/A, получено "${row.text}"`);
    }
    if (!/^[a-zA-Z0-9]{16}$/.test(row._id ?? "")) {
      fail(label, `строка ${from}-${to}: _id должен быть 16 символов`);
    }
    if (seenIds.has(row._id)) {
      fail(label, `_id строки "${row._id}" уже занят`);
    }
    seenIds.set(row._id, label);
  }
}

/**
 * Проверяет журнал: страницы должны иметь свои идентификаторы, а страницы с
 * файлом — ссылку на него. Сами файлы модуль не несёт (книги под копирайтом),
 * поэтому проверяем только целость ссылок.
 *
 * @param {Object} doc - документ журнала
 * @param {String} label - имя файла для сообщений
 * @param {Map} seenIds - общий реестр идентификаторов
 */
function validateJournal(doc, label, seenIds) {
  if (!/^[a-zA-Z0-9]{16}$/.test(doc._id ?? "")) {
    fail(label, `_id журнала должен быть 16 символов, получено "${doc._id}"`);
  } else if (seenIds.has(doc._id)) {
    fail(label, `_id "${doc._id}" уже занят файлом ${seenIds.get(doc._id)}`);
  } else {
    seenIds.set(doc._id, label);
  }
  if (!doc.name) fail(label, "у журнала нет имени");

  const pages = doc.pages ?? [];
  if (!pages.length) {
    fail(label, "в журнале нет страниц");
    return;
  }

  for (const page of pages) {
    if (!/^[a-zA-Z0-9]{16}$/.test(page._id ?? "")) {
      fail(label, `страница "${page.name}": _id должен быть 16 символов`);
    }
    if (seenIds.has(page._id)) {
      fail(label, `_id страницы "${page._id}" уже занят`);
    }
    seenIds.set(page._id, label);
    if (!page.name) fail(label, "у страницы нет имени");
    if (page.type === "pdf") {
      if (!page.src) {
        fail(label, `страница "${page.name}": тип PDF, но не указан файл`);
      } else {
        // Ссылка на файл внутри модуля должна вести на существующий файл,
        // иначе страница откроется пустой уже у игроков.
        const local = page.src.replace(/^modules\/cpr-addenda\//, "");
        const full = page.src.startsWith("modules/cpr-addenda/")
          ? path.join(MODULE_ROOT, local)
          : path.join(DATA_ROOT, page.src);
        if (!fs.existsSync(full)) {
          fail(label, `страница "${page.name}": файл не найден — ${page.src}`);
        }
      }
    }
    if (page.type === "text" && !page.text?.content) {
      fail(label, `страница "${page.name}": текстовая, но пустая`);
    }
  }
}

(async () => {
  const configSource = fs.readFileSync(
    path.join(SYSTEM_ROOT, "modules", "system", "config.js"),
    "utf-8"
  );

  const weaponTypes = readConfigKeys(configSource, "weaponTypes");
  const installLocations = readConfigKeys(configSource, "cyberwareInstallList");
  const effectUses = readConfigKeys(configSource, "effectUses");
  const upgradableTypes = [
    "armor", "cyberdeck", "cyberware", "clothing", "gear", "vehicle", "weapon",
  ];
  const equippedStates = ["owned", "carried", "equipped"];

  const ammoVarieties = readConfigKeys(configSource, "ammoVarieties");

  const effectKeys = new Set(
    [...configSource.matchAll(/"(bonuses\.[A-Za-z0-9_]+)"/g)].map((m) => m[1])
  );

  console.log(
    `Справочники системы: типов оружия ${weaponTypes.length},` +
      ` мест установки ${installLocations.length},` +
      ` режимов эффекта ${effectUses.length},` +
      ` ключей эффектов ${effectKeys.size}`
  );

  const references = await loadReferences();
  console.log(
    `Эталоны: ${Object.entries(references)
      .map(([t, r]) => `${t}(${r.size})`)
      .join(", ")}\n`
  );

  // Тип пака решает, что вообще проверять: у таблиц бросков нет ни поля
  // `type`, ни описания, ни системных полей предмета.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(MODULE_ROOT, "module.json"), "utf-8")
  );
  const packTypes = Object.fromEntries(
    manifest.packs.map((p) => [p.name, p.type])
  );


const seenIds = new Map();
  let count = 0;
  let tableCount = 0;
  let journalCount = 0;
  let actorCount = 0;

  for (const pack of fs.readdirSync(SOURCES)) {
    const dir = path.join(SOURCES, pack);
    if (!fs.statSync(dir).isDirectory()) continue;
    const packType = packTypes[pack] ?? "Item";

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const label = `${pack}/${file}`;
      count += 1;

      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      } catch (err) {
        fail(label, `не разбирается как JSON — ${err.message}`);
        continue;
      }

      if (packType === "RollTable") {
        count -= 1;
        tableCount += 1;
        validateTable(doc, label, seenIds);
        continue;
      }

      if (packType === "JournalEntry") {
        count -= 1;
        journalCount += 1;
        validateJournal(doc, label, seenIds);
        continue;
      }

      if (packType === "Actor") {
        count -= 1;
        actorCount += 1;
        validateActor(doc, label, seenIds);
        continue;
      }

      // 1. Служебное.
      if (!/^[a-zA-Z0-9]{16}$/.test(doc._id ?? "")) {
        fail(label, `_id должен быть 16 буквенно-цифровых символов, получено "${doc._id}"`);
      } else if (seenIds.has(doc._id)) {
        fail(label, `_id "${doc._id}" уже занят файлом ${seenIds.get(doc._id)}`);
      } else {
        seenIds.set(doc._id, label);
      }
      if (!doc.name) fail(label, "нет имени");
      if (!doc.type) fail(label, "нет типа");

      const system = doc.system ?? {};
      const reference = references[doc.type];

      // 2. Полнота набора полей.
      if (!reference) {
        notes.push(`${label}: нет эталона для типа "${doc.type}", проверка полей пропущена`);
      } else {
        const missing = [...reference.keys].filter((k) => !(k in system));
        if (missing.length) {
          fail(label, `не хватает полей system: ${missing.join(", ")}`);
        }
        if (reference.modifierKeys && system.modifiers) {
          const missingMods = [...reference.modifierKeys].filter(
            (k) => !(k in system.modifiers)
          );
          if (missingMods.length) {
            fail(label, `не хватает модификаторов: ${missingMods.join(", ")}`);
          }
        }
      }

      // 3. Допустимость значений.
      if (doc.type === "itemUpgrade" && !upgradableTypes.includes(system.type)) {
        fail(label, `system.type "${system.type}" не принимает модификации`);
      }
      if (system.installLocation && !installLocations.includes(system.installLocation)) {
        fail(label, `installLocation "${system.installLocation}" отсутствует в справочнике`);
      }
      if (system.usage && !effectUses.includes(system.usage)) {
        fail(label, `usage "${system.usage}" отсутствует в справочнике`);
      }
      if (system.equipped && !equippedStates.includes(system.equipped)) {
        fail(label, `equipped "${system.equipped}" недопустимо`);
      }
      if (system.weaponType && !weaponTypes.includes(system.weaponType)) {
        fail(label, `weaponType "${system.weaponType}" отсутствует в справочнике`);
      }

      const allowed = doc.flags?.["cpr-addenda"]?.allowedWeaponTypes ?? [];
      const denied = doc.flags?.["cpr-addenda"]?.deniedWeaponTypes ?? [];
      for (const type of [...allowed, ...denied]) {
        if (!weaponTypes.includes(type)) {
          fail(label, `в списке типов оружия неизвестный тип "${type}"`);
        }
      }
      if (allowed.length && denied.length) {
        fail(label, "заданы одновременно белый и чёрный списки типов оружия");
      }
      if ((allowed.length || denied.length) && system.type !== "weapon") {
        fail(label, "список типов оружия задан для не-оружейной модификации");
      }

      // 3b. Правки, которые модификация вносит в предмет-носитель.
      const carrierChanges = doc.flags?.["cpr-addenda"]?.carrierChanges ?? {};
      for (const [fieldPath, change] of Object.entries(carrierChanges)) {
        if (!fieldPath.startsWith("system.")) {
          fail(label, `правка носителя вне system: ${fieldPath}`);
        }
        if (!["set", "inc", "add"].includes(change?.op)) {
          fail(label, `правка ${fieldPath}: неизвестная операция "${change?.op}"`);
          continue;
        }
        if (change.value === undefined) {
          fail(label, `правка ${fieldPath}: нет значения`);
          continue;
        }
        // Значения проверяем по тем же справочникам, что и сами предметы:
        // опечатка здесь тихо испортит ствол, в который модификацию поставят.
        if (fieldPath === "system.weaponType" && !weaponTypes.includes(change.value)) {
          fail(label, `правка типа оружия: "${change.value}" отсутствует в справочнике`);
        }
        if (fieldPath === "system.ammoVariety") {
          const values = Array.isArray(change.value) ? change.value : [change.value];
          for (const variety of values) {
            if (!ammoVarieties.includes(variety)) {
              fail(label, `правка боеприпасов: "${variety}" отсутствует в справочнике`);
            }
          }
          if (change.op === "set") {
            notes.push(`${label}: боеприпасы задаются через set — исходные варианты ствола будут потеряны`);
          }
        }
        if (fieldPath === "system.fireModes.autoFire" && !Number.isInteger(change.value)) {
          fail(label, `правка автоогня: ожидается целое число, получено ${JSON.stringify(change.value)}`);
        }
        if (fieldPath === "system.damage" && !/^\d+d6$/.test(String(change.value))) {
          fail(label, `правка урона: ожидается формат «NdN», получено "${change.value}"`);
        }
        if (fieldPath === "system.dvTable" && typeof change.value !== "string") {
          fail(label, "правка таблицы дальности: ожидается название таблицы строкой");
        }
      }
      if (Object.keys(carrierChanges).length && doc.type !== "itemUpgrade") {
        fail(label, "правки носителя заданы не на модификации");
      }

      // 3c. Замена штрафа за прицельный выстрел.
      const aimedPenalty = doc.flags?.["cpr-addenda"]?.aimedShotPenalty;
      if (aimedPenalty !== undefined) {
        if (typeof aimedPenalty !== "number" || !Number.isInteger(aimedPenalty)) {
          fail(label, `замена штрафа прицеливания: ожидается целое число, получено ${JSON.stringify(aimedPenalty)}`);
        } else if (aimedPenalty > 0) {
          fail(label, `замена штрафа прицеливания: ${aimedPenalty} — это бонус, а прицеливание всегда штраф`);
        } else if (aimedPenalty < -8) {
          notes.push(`${label}: замена штрафа (${aimedPenalty}) жёстче системных −8, модификация ухудшает выстрел`);
        }
        if (doc.type !== "itemUpgrade" || system.type !== "weapon") {
          fail(label, "замена штрафа прицеливания задана не на оружейной модификации");
        }
      }

      // 3d. Формула потери человечности.
      const humanity = system.humanityLoss;
      if (humanity) {
        if (!Number.isInteger(humanity.static) || humanity.static < 0) {
          fail(label, `потеря человечности: «${humanity.static}» не целое число`);
        }
        // Разбор формулы в системе рассчитан на один член «XdY»: всё
        // остальное он гонит через Number() и получает NaN. Составные записи
        // модуль чинит патчем (scripts/roll-formula.js), но у патча есть своё
        // условие — кубик должен стоять первым слагаемым, иначе карточке
        // броска нечего показать в качестве выпавших граней.
        const formula = String(humanity.roll ?? "");
        const simple = /^\d+d\d+([+-]\d+)?$/.test(formula);
        const compound = /^\d+d\d+(\s*[+-]\s*(\d+d\d+|[a-z]+\([^)]*\)|\d+))+$/i.test(
          formula
        );
        if (!simple && !compound) {
          fail(
            label,
            `формула потери человечности «${formula}» не разбирается: ` +
              "нужен вид «XdY», «XdY+N» или «XdY + функция(...)», кубик первым"
          );
        }
        if (/^[a-z]+\(/i.test(formula)) {
          fail(
            label,
            `формула «${formula}» начинается с функции: кубик должен идти первым, ` +
              "иначе в карточке броска не будет выпавших граней"
          );
        }
      }

      // 3e. Комплект вложенных предметов.
      // Комплект раскладывает модуль, а не система: проверяем то, на что
      // эта раскладка опирается.
      checkPktKit(doc, label, seenIds, fail);

      // 4. Числовые границы из схемы данных.
      const numeric = [
        ["system.size", system.size, 0, null],
        ["system.price.market", system.price?.market, 0, null],
        ["system.bodyLocation.sp", system.bodyLocation?.sp, 0, null],
        ["system.headLocation.sp", system.headLocation?.sp, 0, null],
        ["system.shieldHitPoints.max", system.shieldHitPoints?.max, 0, null],
        ["system.penalty", system.penalty, -10, 0],
        ["system.installedItems.slots", system.installedItems?.slots, 0, null],
      ];
      for (const [name, value, min, max] of numeric) {
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          fail(label, `${name} должно быть числом, получено ${JSON.stringify(value)}`);
          continue;
        }
        if (!Number.isInteger(value)) {
          fail(label, `${name} должно быть целым, получено ${value}`);
        }
        if (min !== null && value < min) fail(label, `${name} = ${value}, меньше минимума ${min}`);
        if (max !== null && value > max) fail(label, `${name} = ${value}, больше максимума ${max}`);
      }

      // Броня: щит без запаса прочности бесполезен, а обычная броня без ОС —
      // это броня, которая ничего не защищает.
      if (doc.type === "armor") {
        const locations = [
          system.isBodyLocation,
          system.isHeadLocation,
          system.isShield,
        ].filter(Boolean);
        if (locations.length !== 1) {
          fail(label, "у брони должно быть ровно одно место ношения (тело, голова или щит)");
        }
        if (system.isShield && !(system.shieldHitPoints?.max > 0)) {
          fail(label, "у щита нулевой запас прочности");
        }
        if (system.isBodyLocation && !(system.bodyLocation?.sp > 0)) {
          fail(label, "у брони на тело нулевой ОС");
        }
        if (system.isHeadLocation && !(system.headLocation?.sp > 0)) {
          fail(label, "у брони на голову нулевой ОС");
        }
      }

      // 5. Иконки.
      if (doc.img) {
        const imgPath = path.join(DATA_ROOT, doc.img);
        if (!fs.existsSync(imgPath)) {
          fail(label, `иконка не найдена: ${doc.img}`);
        }
      }

      // 6. Активные эффекты.
      for (const effect of doc.effects ?? []) {
        if (!/^[a-zA-Z0-9]{16}$/.test(effect._id ?? "")) {
          fail(label, `эффект "${effect.name}": _id должен быть 16 символов`);
        }
        for (const change of effect.changes ?? []) {
          if (!effectKeys.has(change.key)) {
            fail(label, `эффект "${effect.name}": ключ "${change.key}" неизвестен системе`);
          }
          if (![1, 2, 3, 4, 5].includes(change.mode)) {
            fail(label, `эффект "${effect.name}": режим ${change.mode} недопустим`);
          }
        }
      }

      // 7. Описание.
      const description = system.description?.value ?? "";
      if (!description || description === "<p></p>") {
        fail(label, "пустое описание");
      }
      const openTags = (description.match(/<p>/g) ?? []).length;
      const closeTags = (description.match(/<\/p>/g) ?? []).length;
      if (openTags !== closeTags) {
        fail(label, "незакрытая разметка в описании");
      }
    }
  }

  console.log(
    `Проверено предметов: ${count}, таблиц: ${tableCount}, журналов: ${journalCount}, актёров: ${actorCount}`
  );
  if (notes.length) {
    console.log(`\nЗамечания (${notes.length}):`);
    notes.forEach((n) => console.log(`  ${n}`));
  }
  if (problems.length) {
    console.log(`\nОШИБКИ (${problems.length}):`);
    problems.forEach((p) => console.log(`  ${p}`));
    process.exit(1);
  }
  console.log("\nВсе предметы прошли проверку.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
