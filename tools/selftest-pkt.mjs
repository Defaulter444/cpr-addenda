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

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
