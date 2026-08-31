/**
 * Проверка комплектов корпусов ПКТ.
 *
 * Foundry здесь не нужен: проверяются решения, которые модуль принимает до
 * обращения к нему, — как комплект разбирается на список к созданию и сколько
 * человечности возвращается персонажу. Заодно на реальных данных проверяется
 * то, ради чего комплект вообще собран: что каждая опция попадает в фундамент
 * своего типа и помещается в него.
 *
 *   node tools/selftest-pkt.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, "..", "scripts");
const SOURCES = path.join(HERE, "..", "sources", "addenda-cyberware");
const MODULE_ID = "cpr-addenda";

function prepare() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-pkt-"));
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.endsWith(".js")) continue;
    const body = fs
      .readFileSync(path.join(SCRIPTS, file), "utf-8")
      .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
  }
  return tmp;
}

const { planKit, refundKitHumanity, getKit, kitPartsOf } = await import(
  pathToFileURL(path.join(prepare(), "pkt-kit.mjs")).href
);

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`  ПРОВАЛ  ${message}`);
  }
}

// --- 1. Разбор комплекта в список к созданию --------------------------------

{
  const kit = {
    foundations: [
      { item: { name: "Киберрука" }, options: [{ name: "Дека" }, { name: "Мультитул" }] },
      { item: { name: "Кибернога" }, options: [] },
    ],
    carried: [{ name: "Покрытие" }],
  };
  const plan = planKit(kit);

  expect(plan.length === 5, `в списке ${plan.length} записей вместо 5`);
  expect(
    plan.map((p) => p.role).join(",") === "foundation,option,option,foundation,carried",
    `роли идут не в том порядке: ${plan.map((p) => p.role).join(",")}`
  );
  expect(
    plan[1].group === 0 && plan[2].group === 0,
    "опции должны ссылаться на свой фундамент"
  );
  expect(plan[3].group === 1, "второй фундамент потерял свой номер");
  expect(plan[4].role === "carried", "покрытие должно идти последним");
  expect(plan[5] === undefined, "лишняя запись в списке");
  expect(planKit(undefined).length === 0, "пустой комплект должен давать пустой список");
  expect(planKit({}).length === 0, "комплект без полей должен давать пустой список");
}

// --- 2. Возврат человечности за комплект ------------------------------------

{
  const part = (type, staticLoss, installed = true) => ({
    type: "cyberware",
    system: {
      type,
      isInstalledInActor: installed,
      humanityLoss: { static: staticLoss, roll: "0" },
    },
    getFlag: (scope, flag) =>
      scope === MODULE_ID && flag === "pktPart" ? { frame: "abc", slot: 0 } : undefined,
  });
  const foreign = {
    type: "cyberware",
    system: {
      type: "borgware",
      isInstalledInActor: true,
      humanityLoss: { static: 14, roll: "4d6" },
    },
    getFlag: () => undefined,
  };

  // Борговое из комплекта: система сняла 4, возвращаем ровно их.
  expect(
    refundKitHumanity(20, { items: [part("borgware", 0)] }) === 24,
    "штраф за борговое из комплекта не вернулся"
  );
  // Обычный имплант с обнулённой потерей система и так не штрафует.
  expect(
    refundKitHumanity(20, { items: [part("cyberArm", 0)] }) === 20,
    "за имплант без статической потери ничего возвращать не нужно"
  );
  // Чужая кибернетика — не наше дело.
  expect(
    refundKitHumanity(20, { items: [foreign] }) === 20,
    "тронут штраф за имплант вне комплекта"
  );
  // Снятое в рюкзак не штрафуется, значит и возвращать нечего.
  expect(
    refundKitHumanity(20, { items: [part("borgware", 0, false)] }) === 20,
    "возврат за неустановленный имплант"
  );
  expect(refundKitHumanity(20, { items: [] }) === 20, "пустой персонаж изменил максимум");
}

// --- 3. Поиск частей комплекта ----------------------------------------------

{
  const item = (frame) => ({
    getFlag: (scope, flag) =>
      scope === MODULE_ID && flag === "pktPart" ? { frame, slot: 0 } : undefined,
  });
  const actor = { items: [item("aaa"), item("bbb"), { getFlag: () => undefined }] };

  expect(kitPartsOf(actor, "aaa").length === 1, "часть комплекта не нашлась по корпусу");
  expect(kitPartsOf(actor, "zzz").length === 0, "нашлось лишнее для чужого корпуса");
}

// --- 4. Комплекты на реальных данных ----------------------------------------

{
  let frames = 0;
  let implants = 0;

  for (const file of fs.readdirSync(SOURCES)) {
    if (!file.endsWith(".json")) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(SOURCES, file), "utf-8"));
    const kit = getKit({
      getFlag: (scope, flag) => doc.flags?.[scope]?.[flag],
    });
    if (!kit) continue;

    frames += 1;
    implants += planKit(kit).length;

    for (const group of kit.foundations) {
      const host = group.item;
      const used = group.options.reduce((sum, o) => sum + (o.system.size ?? 1), 0);
      expect(
        used <= host.system.installedItems.slots,
        `«${doc.name}» → «${host.name}»: опции не помещаются (${used} из ${host.system.installedItems.slots})`
      );
      for (const option of group.options) {
        expect(
          option.system.type === host.system.type,
          `«${doc.name}»: «${option.name}» не того типа для «${host.name}»`
        );
      }
    }

    // Ни один имплант комплекта не должен отнимать человечность отдельно:
    // она назначена корпусу одной строкой из книги.
    for (const entry of planKit(kit)) {
      expect(
        entry.doc.system.humanityLoss.static === 0 &&
          String(entry.doc.system.humanityLoss.roll) === "0",
        `«${doc.name}»: «${entry.doc.name}» отнимает человечность отдельно`
      );
    }

    expect(
      !doc.flags?.cprInstallTree,
      `«${doc.name}»: осталось системное дерево установки`
    );
    expect(
      /\d+d\d+/.test(doc.system.humanityLoss.roll),
      `«${doc.name}»: у корпуса нет своей формулы потери человечности`
    );
  }

  expect(frames === 13, `корпусов с комплектом ${frames}, а должно быть 13`);
  console.log(`Корпусов: ${frames}, имплантов в комплектах: ${implants}`);
}

/* ------------------------------------------------------------------ */

console.log("Мастер установки: разбор комплекта");
{
  // Окно только рисует то, что посчитали эти функции, поэтому проверяем их, а
  // не разметку. Заглушки Foundry нужны лишь для экранирования имён.
  globalThis.Handlebars = { escapeExpression: (t) => String(t) };
  globalThis.game = {
    i18n: {
      localize: (key) => key,
      format: (key, data) => `${key}(${JSON.stringify(data)})`,
    },
  };

  const wizard = await import(
    pathToFileURL(path.join(prepare(), "pkt-wizard.mjs")).href
  );

  const tagged = (name, group, over = {}) => ({
    name,
    flags: { [MODULE_ID]: { pktGroup: group } },
    system: { size: 1, ...over },
  });

  // --- группа импланта ---
  expect(wizard.groupOf(tagged("х", "cost")) === "cost", "метка «с ПЧ» не прочиталась");
  expect(wizard.groupOf(tagged("х", "free")) === "free", "метка «без ПЧ» не прочиталась");
  // Непомеченный имплант считаем бесплатным: столбец «без ПЧ» в документе
  // больше, и ошибка в эту сторону не завышает списанную человечность.
  expect(wizard.groupOf({ name: "х" }) === "free", "имплант без метки признан платным");
  expect(wizard.groupOf(undefined) === "free", "undefined уронил разбор группы");

  // --- склейка одинаковых ---
  const counted = wizard.countByName([
    tagged("Киберрука", "free"),
    tagged("Киберрука", "free"),
    tagged("Нейролинк", "free"),
  ]);
  expect(counted.length === 2, `строк вышло ${counted.length}, а имён два`);
  expect(counted[0].name === "Киберрука" && counted[0].count === 2,
    "две киберруки не сложились в «×2»");
  expect(counted[1].count === 1, "нейролинк размножился");
  expect(wizard.countByName([]).length === 0, "пустой список дал строки");
  expect(wizard.countByName(undefined).length === 0, "undefined уронил склейку");

  // --- разбор целого комплекта ---
  const kit = {
    foundations: [
      {
        item: tagged("Киберрука", "free", { installedItems: { slots: 4 } }),
        options: [tagged("Выкидное оружие", "cost")],
      },
      {
        item: tagged("Киберрука", "free", { installedItems: { slots: 4 } }),
        options: [],
      },
      {
        item: tagged("Кибернога", "free", { installedItems: { slots: 3 } }),
        options: [tagged("Цепкая стопа", "cost")],
      },
    ],
    carried: [tagged("Подкожная броня", "cost"), tagged("Киберчереп", "free")],
  };
  const view = wizard.summariseKit(kit);

  expect(view.total === 7, `имплантов насчитано ${view.total}, а в комплекте 7`);
  const freeCount = view.free.reduce((s, e) => s + e.count, 0);
  const costCount = view.cost.reduce((s, e) => s + e.count, 0);
  expect(freeCount === 4, `без ПЧ ${freeCount}, а должно 4 (2 руки, нога, череп)`);
  expect(costCount === 3, `с ПЧ ${costCount}, а должно 3`);
  expect(freeCount + costCount === view.total, "часть имплантов не попала ни в один список");

  // Слоты видно до установки, а не после: занятое место в фундаменте — это то,
  // куда игрок уже не поставит своё.
  expect(view.places.length === 3, `фундаментов ${view.places.length}, а в комплекте 3`);
  expect(view.places[0].used === 1 && view.places[0].slots === 4,
    `первая рука: занято ${view.places[0].used} из ${view.places[0].slots}`);
  expect(view.places[1].used === 0, "вторая рука показана занятой");
  expect(view.frame.used === 2, `в корпусе занято ${view.frame.used}, а лежит два импланта`);

  // --- разметка шагов ---
  const frame = {
    name: "МИЛИТЕХ «ЗАТМЕНИЕ»",
    system: { humanityLoss: { roll: "19d6 + ceil(2d6/2)", static: 67 } },
  };

  const confirm = wizard.stepConfirm(frame, view);
  expect(confirm.includes("19d6"), "на первом шаге не показана формула потери");
  expect(confirm.includes("67"), "на первом шаге не показано среднее значение");

  const free = wizard.stepFree(view);
  expect(free.includes("Киберрука"), "в списке без ПЧ нет киберруки");
  expect(!free.includes("Выкидное оружие"), "в список без ПЧ попал платный имплант");

  // На третьем шаге видно, куда встанет каждый платный имплант: ради этого
  // шаг и заведён — плоский список ничего не объясняет.
  const cost = wizard.stepCost(frame, view, null);
  expect(cost.includes("Выкидное оружие"), "в раскладке нет выкидного оружия");
  expect(cost.includes("Киберрука"), "не показано, в какой фундамент оно встаёт");
  expect(!cost.includes("pkt.wizard.rolled"), "результат броска показан до броска");
  expect(
    !cost.includes("<strong>Кибернога</strong> <span class=\"slots\">pkt.wizard.slots") ||
      cost.indexOf("Цепкая стопа") > cost.indexOf("Кибернога"),
    "опция показана не под своим фундаментом"
  );

  const rolled = wizard.stepCost(frame, view, { type: "roll", value: 71 });
  expect(rolled.includes("71"), "результат броска не показан");
  expect(rolled.includes("pkt.wizard.rolled"), "бросок выдан за среднее значение");
  const averaged = wizard.stepCost(frame, view, { type: "static", value: 67 });
  expect(averaged.includes("pkt.wizard.tookAverage"), "среднее выдано за бросок");

  const summary = wizard.stepSummary(frame, view, { type: "roll", value: 71 });
  for (const who of ["Киберрука", "Выкидное оружие", "Подкожная броня"]) {
    expect(summary.includes(who), `в итоге нет «${who}»`);
  }
  expect(summary.includes("71"), "в итоге не показана списанная человечность");
  expect(
    wizard.stepSummary(frame, view, { type: "none", value: 0 })
      .includes("pkt.wizard.summary.noHumanity"),
    "отказ от списания человечности не отражён в итоге"
  );

  // Пустой комплект не должен ронять разбор: корпус без опций бывает.
  const bare = wizard.summariseKit({ foundations: [], carried: [] });
  expect(bare.total === 0 && bare.free.length === 0, "пустой комплект разобран неверно");
  expect(wizard.summariseKit(undefined).total === 0, "undefined уронил разбор комплекта");
}

console.log("Мастер установки: строки переведены");
{
  const ru = JSON.parse(
    fs.readFileSync(path.join(HERE, "..", "lang", "ru.json"), "utf-8")
  );
  const en = JSON.parse(
    fs.readFileSync(path.join(HERE, "..", "lang", "en.json"), "utf-8")
  );
  const source = fs.readFileSync(path.join(SCRIPTS, "pkt-wizard.js"), "utf-8");
  const used = new Set(
    [...source.matchAll(/localize\(\s*"(pkt\.[a-zA-Z.]+)"/g)].map((m) => m[1])
  );
  expect(used.size > 20, `ключей найдено подозрительно мало: ${used.size}`);
  for (const key of used) {
    expect(`CPRADDENDA.${key}` in ru, `нет русской строки CPRADDENDA.${key}`);
    expect(`CPRADDENDA.${key}` in en, `нет английской строки CPRADDENDA.${key}`);
  }
  // Отмена убирает корпус с листа, и об этом надо сказать вслух.
  for (const key of ["CPRADDENDA.pkt.cancelled"]) {
    expect(key in ru && key in en, `нет строки ${key}`);
  }
}

console.log("Парные опции расходятся по парным фундаментам");
{
  // Документ пишет «Цепкая Подошва х2» на две киберноги, имея в виду по одной
  // на каждую. Раньше обе валились в первую ногу, пока в ней хватало слотов.
  //
  // Сравниваем одноимённые опции: разные по имени раскладываются по-разному и
  // законно. У «Мудреца», скажем, обе киберруки получают по две кибердеки, но
  // все четыре улучшения к ним уходят в одну руку — во второй после дек уже
  // нет свободных слотов. Это не перекос, а вместимость, поэтому неравенство
  // прощается ровно тогда, когда менее загруженному фундаменту некуда ставить.
  let checked = 0;
  for (const file of fs.readdirSync(SOURCES)) {
    const doc = JSON.parse(fs.readFileSync(path.join(SOURCES, file), "utf-8"));
    const kit = doc.flags?.[MODULE_ID]?.pktKit;
    if (!kit) continue;

    const byType = new Map();
    for (const entry of kit.foundations) {
      const type = entry.item.system.type;
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(entry);
    }

    for (const [type, group] of byType) {
      if (group.length < 2) continue;

      const room = group.map(
        (e) =>
          e.item.system.installedItems.slots -
          e.options.reduce((sum, o) => sum + (o.system.size ?? 1), 0)
      );

      const names = new Set(group.flatMap((e) => e.options.map((o) => o.name)));
      for (const name of names) {
        const counts = group.map(
          (e) => e.options.filter((o) => o.name === name).length
        );
        const spread = Math.max(...counts) - Math.min(...counts);
        if (spread <= 1) {
          checked += 1;
          continue;
        }
        // Перекос допустим, только если недогруженным ставить было некуда.
        const size = group
          .flatMap((e) => e.options)
          .find((o) => o.name === name).system.size ?? 1;
        const lightest = counts.indexOf(Math.min(...counts));
        expect(
          room[lightest] < size,
          `«${doc.name}», ${type}, «${name}»: разложено как ${counts.join("/")}, ` +
            `а в наименее занятом фундаменте оставалось ${room[lightest]} слотов`
        );
        checked += 1;
      }
    }
  }
  expect(checked > 0, "не нашлось ни одного корпуса с парными фундаментами");
  console.log(`  проверено наборов одноимённых опций: ${checked}`);
}

console.log("У каждого импланта комплекта есть группа человечности");
{
  let tagged = 0;
  let untagged = [];
  for (const file of fs.readdirSync(SOURCES)) {
    const doc = JSON.parse(fs.readFileSync(path.join(SOURCES, file), "utf-8"));
    const kit = doc.flags?.[MODULE_ID]?.pktKit;
    if (!kit) continue;
    const all = [
      ...kit.foundations.flatMap((f) => [f.item, ...f.options]),
      ...kit.carried,
    ];
    for (const item of all) {
      const group = item.flags?.[MODULE_ID]?.pktGroup;
      if (group === "free" || group === "cost") tagged += 1;
      else untagged.push(`${doc.name}: ${item.name}`);
    }
  }
  expect(
    untagged.length === 0,
    `без группы человечности: ${untagged.slice(0, 5).join("; ")}`
  );
  expect(tagged > 200, `помеченных имплантов ${tagged} — подозрительно мало`);
  console.log(`  помечено имплантов: ${tagged}`);
}

console.log("Человечность считается отдельно от списания");
{
  // Мастер прокрутил бросок, вышел из окна — корпус исчез, а тридцать с лишним
  // очков человечности остались потерянными. Причина: списывали прямо на
  // третьем шаге, до точки невозврата. Теперь бросок только считает, а к листу
  // число применяется в самом конце, после «Установить».
  const wizard = await import(
    pathToFileURL(path.join(prepare(), "pkt-wizard.mjs")).href
  );
  const { measureHumanity, applyHumanity } = wizard.__test;

  const frame = {
    name: "МИЛИТЕХ «ДРАГУН»",
    system: { humanityLoss: { roll: "18d6 + ceil(3d6/2)", static: 64 } },
    parent: { id: "actor00000000001" },
  };

  // Среднее: число берётся из документа, ничего не бросается и не меняется.
  const average = await measureHumanity(frame, "static");
  expect(average.value === 64, `среднее ${average.value}, а в документе 64`);
  expect(average.type === "static", `тип "${average.type}"`);

  // Отказ от списания: ноль, и это именно отказ, а не «выпало ноль».
  const none = await measureHumanity(frame, "none");
  expect(none.value === 0 && none.type === "none", "отказ от списания посчитан неверно");

  // Ни один из этих вызовов не должен трогать лист. Проверяем на актёре,
  // который закричит, если его тронут.
  {
    const untouched = {
      system: { derivedStats: { humanity: { value: 50, max: 80 } } },
      update: () => {
        throw new Error("лист тронут при подсчёте");
      },
      setMaxHumanity: () => {
        throw new Error("максимум пересчитан при подсчёте");
      },
    };
    let threw = false;
    try {
      await measureHumanity(frame, "static");
      await measureHumanity(frame, "none");
    } catch (error) {
      threw = true;
    }
    expect(!threw, "подсчёт человечности всё-таки трогает лист");
    expect(
      untouched.system.derivedStats.humanity.value === 50,
      "человечность изменилась на этапе подсчёта"
    );
  }

  // Списание применяет ровно то число, которое показали, и пересчитывает максимум.
  {
    const updates = [];
    let recalculated = 0;
    const actor = {
      system: { derivedStats: { humanity: { value: 80, max: 80 } } },
      update: async (data) => updates.push(data),
      setMaxHumanity: async () => {
        recalculated += 1;
      },
    };
    await applyHumanity(actor, { type: "roll", value: 71 });
    expect(updates.length === 1, `обновлений листа ${updates.length}, а нужно одно`);
    expect(
      updates[0]["system.derivedStats.humanity.value"] === 9,
      `человечность стала ${updates[0]["system.derivedStats.humanity.value"]}, а 80 − 71 = 9`
    );
    expect(recalculated === 1, "максимум человечности не пересчитан");
  }

  // Отказ и ноль ничего не списывают — и не делают лишнего обращения к листу.
  for (const chosen of [{ type: "none", value: 0 }, null, { type: "roll", value: 0 }]) {
    const updates = [];
    const actor = {
      system: { derivedStats: { humanity: { value: 80, max: 80 } } },
      update: async (data) => updates.push(data),
      setMaxHumanity: async () => {},
    };
    await applyHumanity(actor, chosen);
    expect(updates.length === 0, `при выборе ${JSON.stringify(chosen)} лист всё-таки изменён`);
  }

  // Незаполненная человечность берётся из максимума — как это делает система.
  {
    const updates = [];
    const actor = {
      system: { derivedStats: { humanity: { value: null, max: 80 } } },
      update: async (data) => updates.push(data),
      setMaxHumanity: async () => {},
    };
    await applyHumanity(actor, { type: "static", value: 30 });
    expect(
      updates[0]?.["system.derivedStats.humanity.value"] === 50,
      "при пустом текущем значении не взят максимум"
    );
  }
}

console.log("Лист «шестёрки» не ставит корпус наперегонки с мастером");
{
  // Лист НИП ставит брошенную кибернетику сам, не спрашивая: система зовёт
  // `handleMookDraggedItem`, та открывает своё окно установки и списывает
  // человечность, а при закрытии окна удаляет предмет со всем содержимым.
  // Рядом при этом открыт наш мастер. Мастер игры это и увидел: человечность
  // ушла, корпус исчез, имплантов нет.
  const source = fs.readFileSync(path.join(SCRIPTS, "pkt-kit.js"), "utf-8");
  expect(
    source.includes("handleMookDraggedItem"),
    "автоустановка на листе «шестёрки» не перехвачена — она подерётся с мастером"
  );
  // Пропускать надо и сам корпус, и импланты комплекта: их создаёт deployKit,
  // а создание на листе НИП тоже считается «броском предмета», и система
  // открыла бы окно установки на каждый из двух десятков.
  const guard = source.slice(source.indexOf("cprAddendaMookDrop"));
  expect(
    guard.includes("getKit(item)"),
    "корпус с комплектом не исключён из автоустановки"
  );
  expect(
    guard.includes("FLAGS.pktPart"),
    "импланты комплекта не исключены из автоустановки — система спросит про каждый"
  );
}

console.log("Мастер применяет человечность только после установки");
{
  const source = fs.readFileSync(path.join(SCRIPTS, "pkt-wizard.js"), "utf-8");
  const deploy = source.indexOf("await deployKit(frame)");
  const apply = source.indexOf("await applyHumanity(actor, chosen)");
  expect(deploy > 0 && apply > deploy,
    "человечность списывается раньше установки — отмена снова оставит игрока без неё");
  expect(
    !source.includes("await actor.loseHumanityValue"),
    "мастер снова зовёт системное списание: оно бросает заново и даст не то число, что показано"
  );
  // Отказ от списания нужен для НИП: формула системы выводит ЭМП из
  // человечности, и полсотни очков за корпус уводят непися в минус.
  expect(source.includes('key: "none"'), "нет кнопки отказа от списания человечности");
  expect(source.includes("mookNote"), "нет пояснения про НИП на шаге с человечностью");
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
