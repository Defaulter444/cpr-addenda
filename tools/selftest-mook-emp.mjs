/**
 * Проверка того, что у НИП не съезжает ЭМП.
 *
 * Мастер поставил «шестёрке» БИОСИСТЕМУ — и у непися прибавилось два ЭМП, а при
 * удалении отнялось три. Имплант тут ни при чём: так ведёт себя любая
 * кибернетика, и вот почему.
 *
 * Cyberpunk RED считает максимум человечности от «максимума ЭМП»:
 *
 *     maxHumanity = 10 * stats.emp.max - штрафы за импланты
 *
 * а после каждой установки выводит из человечности сам ЭМП:
 *
 *     "system.stats.emp.value": Math.floor(humanity.value / 10)
 *
 * Лист «шестёрки» при этом редактирует только `stats.emp.value` — поля
 * `emp.max` там нет вовсе, и оно навсегда остаётся стандартной шестёркой.
 * Значит, набранный мастером ЭМП живёт ровно до первого импланта.
 *
 * Здесь воспроизведена арифметика системы — по её же исходникам — и проверено,
 * что заплатка модуля возвращает ЭМП, не трогая обычных персонажей.
 *
 *   node tools/selftest-mook-emp.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const SCRIPTS = path.join(MODULE_ROOT, "scripts");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

/* ------------------------------------------------------------------ */

/**
 * Актёр с той же арифметикой человечности, что у системы.
 *
 * Переписано с `cpr-actor.js`: `_calcMaxHumanity` и `setMaxHumanity`. Значения
 * по умолчанию — из схемы данных: человечность 60/60, ЭМП 6/6.
 */
function makeActor({ type = "mook", emp = 6, empMax = 6, borgware = 0 } = {}) {
  return {
    type,
    system: {
      stats: { emp: { value: emp, max: empMax } },
      derivedStats: { humanity: { value: 60, max: 60 } },
    },
    borgware,
    async update(data) {
      for (const [key, value] of Object.entries(data)) {
        const parts = key.split(".");
        let node = this;
        for (const part of parts.slice(0, -1)) node = node[part];
        node[parts.at(-1)] = value;
      }
    },
    calcMaxHumanity() {
      return 10 * this.system.stats.emp.max - this.borgware * 4;
    },
    async setMaxHumanity() {
      const maxHumanity = this.calcMaxHumanity();
      const { humanity } = this.system.derivedStats;
      if (humanity.max === humanity.value && maxHumanity < humanity.max) {
        await this.update({
          "system.derivedStats.humanity.max": maxHumanity,
          "system.derivedStats.humanity.value": maxHumanity,
          "system.stats.emp.value": Math.floor(humanity.value / 10),
        });
      } else {
        await this.update({
          "system.derivedStats.humanity.max": maxHumanity,
          "system.stats.emp.value": Math.floor(humanity.value / 10),
        });
      }
    },
  };
}

/** Заплатка модуля поверх `setMaxHumanity`, как её вешает libWrapper. */
function patch(actor, enabled = true) {
  const original = actor.setMaxHumanity.bind(actor);
  actor.setMaxHumanity = async function patched(...args) {
    if (actor.type !== "mook" || !enabled) return original(...args);
    const before = actor.system?.stats?.emp?.value;
    const result = await original(...args);
    const after = actor.system?.stats?.emp?.value;
    if (Number.isInteger(before) && after !== before) {
      await actor.update({ "system.stats.emp.value": before });
    }
    return result;
  };
  return actor;
}

console.log("Без заплатки система затирает ЭМП, набранный мастером");
{
  // Мастер завёл «шестёрку» и поставил ей ЭМП 4. Максимум ЭМП на листе НИП
  // показать негде, он остался стандартной шестёркой.
  const actor = makeActor({ emp: 4 });
  actor.borgware = 1; // поставили один борг-имплант, например БИОСИСТЕМУ
  await actor.setMaxHumanity();

  expect(
    actor.system.stats.emp.value === 6,
    `ЭМП стал ${actor.system.stats.emp.value} — ожидалась шестёрка из человечности`
  );
  expect(
    actor.system.stats.emp.value !== 4,
    "проверка бессмысленна: система и так сохранила ЭМП"
  );
  console.log(`  ЭМП 4 превратился в ${actor.system.stats.emp.value} после одного импланта`);
}

console.log("С заплаткой ЭМП у НИП остаётся тем, что поставил мастер");
{
  for (const emp of [3, 4, 5, 7, 8, 0]) {
    const actor = patch(makeActor({ emp }));
    actor.borgware = 1;
    await actor.setMaxHumanity();
    expect(
      actor.system.stats.emp.value === emp,
      `ЭМП ${emp} превратился в ${actor.system.stats.emp.value}`
    );
  }

  // И при удалении импланта — тоже: мастер видел, как там отнималось ещё.
  const actor = patch(makeActor({ emp: 4 }));
  actor.borgware = 1;
  await actor.setMaxHumanity();
  actor.borgware = 0;
  await actor.setMaxHumanity();
  expect(
    actor.system.stats.emp.value === 4,
    `после удаления импланта ЭМП стал ${actor.system.stats.emp.value}, а был 4`
  );

  // Человечность при этом система считает как считала: её мы не трогаем.
  expect(
    actor.system.derivedStats.humanity.max === 60,
    `максимум человечности ${actor.system.derivedStats.humanity.max}, а формулу мы не меняли`
  );
}

console.log("Обычного персонажа заплатка не трогает");
{
  // У персонажа человечность считается всерьёз, и ЭМП обязан от неё зависеть:
  // это правило игры, а не недосмотр системы.
  const actor = patch(makeActor({ type: "character", emp: 8, empMax: 8 }));
  actor.borgware = 1;
  await actor.setMaxHumanity();
  expect(
    actor.system.stats.emp.value === 6,
    `у персонажа ЭМП стал ${actor.system.stats.emp.value}, а должен пересчитаться из человечности`
  );
}

console.log("Выключенная настройка возвращает поведение системы");
{
  const actor = patch(makeActor({ emp: 4 }), false);
  actor.borgware = 1;
  await actor.setMaxHumanity();
  expect(
    actor.system.stats.emp.value === 6,
    "при выключенной настройке ЭМП всё-таки сохранён"
  );
}

console.log("Заплатка на месте и объяснена");
{
  const source = fs.readFileSync(path.join(SCRIPTS, "pkt-kit.js"), "utf-8");
  expect(
    source.includes("cprAddendaKeepMookEmpathy"),
    "заплатки на setMaxHumanity больше нет"
  );
  expect(
    source.includes('this.type !== "mook"'),
    "заплатка не ограничена настоящими «шестёрками» — она тронет и персонажей"
  );
  expect(
    source.includes("SETTINGS.mookEmpathy"),
    "заплатку нельзя выключить настройкой"
  );

  for (const file of ["ru.json", "en.json"]) {
    const lang = JSON.parse(
      fs.readFileSync(path.join(MODULE_ROOT, "lang", file), "utf-8")
    );
    for (const key of [
      "CPRADDENDA.settings.mookEmpathy.name",
      "CPRADDENDA.settings.mookEmpathy.hint",
    ]) {
      expect(key in lang, `${file}: нет строки ${key}`);
    }
  }
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures > 0 ? 1 : 0);
