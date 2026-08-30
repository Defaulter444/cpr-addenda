/**
 * Проверка правок, которые модуль вносит в данные самой системы.
 *
 * У трёх предметов компендиума числа расходятся с их же описанием и с
 * документом: у «Фасеточного крепления» и «Сенсорного массива» три слота
 * вместо обещанных пяти, у остова «Фума Котаро» нет прибавки к Скрытности,
 * хотя правила её дают.
 *
 * Пак системы править нельзя — он перезапишется при обновлении. Поэтому правки
 * накладываются на лету, и у такого приёма два опасных края. Первый: правка
 * должна узнавать предмет надёжно, а не по имени — при включённом Babele имя
 * приезжает уже переведённым. Второй: правка не должна срабатывать дважды и не
 * должна трогать то, что уже исправлено, иначе слоты поедут дальше пяти, а
 * эффекты начнут множиться при каждом переносе.
 *
 * Оба края здесь и проверяются.
 *
 *   node tools/selftest-fixes.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const SCRIPTS = path.join(MODULE_ROOT, "scripts");
const LANG = path.join(MODULE_ROOT, "lang");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

/* ------------------------------------------------------------------ */

globalThis.game = {
  user: { isGM: true },
  i18n: {
    localize: (key) => key,
    format: (key, data) => `${key} ${JSON.stringify(data)}`,
  },
  settings: { get: () => true },
};
const said = [];
globalThis.ui = { notifications: { info: (m) => said.push(m), warn: (m) => said.push(m) } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-fixes-"));
for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".js")) continue;
  const body = fs
    .readFileSync(path.join(SCRIPTS, file), "utf-8")
    .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
}
const fixes = await import(pathToFileURL(path.join(tmp, "system-fixes.mjs")).href);
const { FIXES, fixFor, sourceUuid } = fixes.__test;

const MULTIOPTIC =
  "Compendium.cyberpunk-red-core.core_cyberware.Item.Iu2wDz9q6Ov0UAKo";
const SENSOR =
  "Compendium.cyberpunk-red-core.core_cyberware.Item.eapyCpVJd8BdGPMU";
const FUMA =
  "Compendium.cyberpunk-red-core.black-chrome_cyberware.Item.nH3p5XdyArI2faqK";

/** Предмет-заглушка в том виде, в каком он приходит из компендиума. */
const item = (uuid, over = {}) => {
  const doc = {
    name: "Предмет",
    img: "icon.svg",
    _stats: { compendiumSource: uuid },
    system: { installedItems: { slots: 3 } },
    effects: [],
    ...over,
  };
  doc.toObject = () => JSON.parse(JSON.stringify({ effects: doc.effects }));
  return doc;
};

console.log("Предмет узнаётся по ссылке на компендиум, а не по имени");
{
  // Имя при включённом Babele приезжает переведённым, и опознание по строке
  // развалилось бы от смены языка мира. Опознание не должно от имени зависеть.
  const ru = item(MULTIOPTIC, { name: "Фасеточное крепление" });
  const en = item(MULTIOPTIC, { name: "MultiOptic Mount" });
  const nonsense = item(MULTIOPTIC, { name: "" });
  for (const [what, doc] of [["русское", ru], ["английское", en], ["пустое", nonsense]]) {
    expect(fixFor(doc) !== null, `${what} имя: правка не нашлась`);
  }

  // Старое поле Foundry на случай предметов, разложенных давно.
  const old = {
    name: "Предмет",
    flags: { core: { sourceId: MULTIOPTIC } },
    system: { installedItems: { slots: 3 } },
    effects: [],
    toObject: () => ({ effects: [] }),
  };
  expect(fixFor(old) !== null, "предмет со старым полем sourceId не опознан");

  // Свой предмет модуля или чужой мод трогать нельзя.
  expect(fixFor(item("Compendium.cpr-addenda.addenda-cyberware.Item.x")) === null,
    "правка нашлась для чужого предмета");
  expect(fixFor({ name: "Предмет", system: {} }) === null,
    "правка нашлась для предмета без ссылки на компендиум");
  expect(sourceUuid({}) === null, "у предмета без ссылки она всё-таки нашлась");
}

console.log("Слоты доводятся до пяти — и ровно один раз");
{
  for (const [label, uuid] of [["Фасеточное крепление", MULTIOPTIC], ["Сенсорный массив", SENSOR]]) {
    const found = fixFor(item(uuid));
    expect(found !== null, `${label}: правка не нашлась`);
    expect(
      found?.changes?.["system.installedItems.slots"] === 5,
      `${label}: слотов ставится ${found?.changes?.["system.installedItems.slots"]}, а надо 5`
    );

    // Уже исправленный предмет второй раз не трогаем: иначе повторный перенос
    // погнал бы слоты дальше пяти.
    const done = item(uuid, { system: { installedItems: { slots: 5 } } });
    expect(fixFor(done) === null, `${label}: правка сработала на уже исправленном`);

    // И если систему однажды починят у истока — тоже молчим.
    const upstream = item(uuid, { system: { installedItems: { slots: 7 } } });
    expect(fixFor(upstream) === null, `${label}: правка тронула чужое значение 7`);
  }
}

console.log("«Фума Котаро» получает прибавку к Скрытности");
{
  // Родной эффект остова (ТЕЛ 12) должен уцелеть: он и так верный.
  const body = {
    name: "Остов",
    changes: [{ key: "system.stats.body.value", mode: 5, value: "12" }],
  };
  const doc = item(FUMA, { effects: [body] });
  const found = fixFor(doc);
  expect(found !== null, "правка для «Фума Котаро» не нашлась");

  const list = found?.changes?.effects ?? [];
  expect(list.length === 2, `эффектов после правки ${list.length}, а должно быть 2`);
  expect(
    list.some((e) => (e.changes ?? []).some((c) => c.key === "system.stats.body.value")),
    "родной эффект с ТЕЛ 12 потерялся"
  );
  const stealth = list.find((e) =>
    (e.changes ?? []).some((c) => c.key === "bonuses.stealth")
  );
  expect(stealth !== undefined, "прибавка к Скрытности не добавлена");
  const change = (stealth?.changes ?? []).find((c) => c.key === "bonuses.stealth");
  expect(change?.value === "2", `прибавка ${change?.value}, а в правилах +2`);
  expect(change?.mode === 2, `режим ${change?.mode}, а прибавка должна складываться (2)`);

  // Ключ должен быть именно тот, который система ищет для навыка: она берёт
  // `bonuses.` плюс имя навыка без пробелов и с маленькой буквы.
  expect(change?.key === "bonuses.stealth", `ключ "${change?.key}" система не найдёт`);

  // Второй раз не добавляем.
  const already = item(FUMA, { effects: [body, stealth] });
  expect(fixFor(already) === null, "прибавка добавлена повторно");
}

console.log("Каждая правка объяснима и переведена");
{
  const ru = JSON.parse(fs.readFileSync(path.join(LANG, "ru.json"), "utf-8"));
  const en = JSON.parse(fs.readFileSync(path.join(LANG, "en.json"), "utf-8"));
  for (const fix of FIXES) {
    const key = `CPRADDENDA.fixes.${fix.what}.applied`;
    expect(key in ru, `нет русского сообщения о правке: ${key}`);
    expect(key in en, `нет английского сообщения о правке: ${key}`);
    expect(
      typeof fix.uuid === "string" && fix.uuid.startsWith("Compendium."),
      `у правки "${fix.id}" не ссылка на компендиум: ${fix.uuid}`
    );
  }
  for (const key of [
    "CPRADDENDA.settings.systemFixes.name",
    "CPRADDENDA.settings.systemFixes.hint",
    "CPRADDENDA.fixes.fumaStealth.effect",
  ]) {
    expect(key in ru, `нет русской строки ${key}`);
    expect(key in en, `нет английской строки ${key}`);
  }
}

console.log("Выключенная настройка запрещает вмешательство");
{
  const doc = item(MULTIOPTIC);
  let updated = null;
  doc.updateSource = (changes) => {
    updated = changes;
  };
  game.settings.get = () => false;
  fixes.fixOnCreate(doc);
  expect(updated === null, "при выключенной настройке предмет всё-таки правится");
  game.settings.get = () => true;
  fixes.fixOnCreate(doc);
  expect(
    updated?.["system.installedItems.slots"] === 5,
    "при включённой настройке правка не применилась"
  );
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures > 0 ? 1 : 0);
