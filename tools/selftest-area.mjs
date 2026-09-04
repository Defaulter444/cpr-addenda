/**
 * Проверка площадных атак: взрывчатка и дробь.
 *
 * Книга даёт для них разные правила (с. 175), и здесь проверяется, что модуль
 * их не путает: у взрыва квадрат 5 × 5 клеток по выбранной цели, у дроби —
 * полукруг в три клетки перед стрелком, и только то, что видно.
 *
 * Геометрия посчитана обычной арифметикой, а не фигурами PIXI, именно ради
 * этого файла: фигуры Foundry вне игры не существуют, а числа проверяются
 * где угодно.
 *
 *   node tools/selftest-area.mjs
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
  user: { id: "user000000000001", isGM: true, color: "#ff0000", targets: new Set() },
  i18n: { localize: (k) => k, format: (k, d) => `${k}(${JSON.stringify(d)})` },
  settings: { get: () => true },
  actors: { get: () => null },
};
globalThis.Handlebars = { escapeExpression: (t) => String(t) };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-area-"));
for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".js")) continue;
  const body = fs
    .readFileSync(path.join(SCRIPTS, file), "utf-8")
    .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
}
const A = await import(pathToFileURL(path.join(tmp, "area-attacks.mjs")).href);

/** Сетка Cyberpunk RED: 2 метра на клетку, 100 пикселей. */
const GRID = { distance: 2, size: 100, units: "m" };

console.log("Что считается площадной атакой");
{
  const weapon = (variety, weaponType) => ({
    name: "оружие",
    system: { weaponType },
    _getLoadedAmmoProp: () => variety,
  });

  // Взрыв: ракета и граната, каким бы оружием их ни послали.
  expect(A.areaKindOf(weapon("rocket", "rocketLauncher")) === A.BLAST, "ракета не даёт взрыв");
  expect(A.areaKindOf(weapon("grenade", "grenadeLauncher")) === A.BLAST, "граната не даёт взрыв");
  // Брошенная граната — тоже взрывчатка: книга прямо говорит, что урон тот же,
  // что из гранатомёта.
  expect(
    A.areaKindOf(weapon("grenade", "thrownWeapon")) === A.BLAST,
    "брошенная граната не даёт взрыв"
  );

  // Дробь — РЕЖИМ, а не патрон. Раньше её опознавали по `shotgunShell`, и зона
  // вставала на каждый выстрел из дробовика, включая прицельный. Но
  // shotgunShell — обычный патрон дробовика, и сам по себе зоны не даёт.
  expect(
    A.areaKindOf(weapon("shotgunShell", "shotgun")) === null,
    "дробовик с обычным патроном ставит зону сам по себе"
  );
  expect(
    A.areaKindOf(weapon("shotgunSlug", "shotgun")) === null,
    "жакан превратился в площадную атаку — это выстрел по одной цели"
  );
  expect(
    A.areaKindOf(weapon(undefined, "shotgun")) === null,
    "пустой дробовик ставит зону"
  );

  // Метательное без гранаты — это нож, и взрыва он не устраивает.
  expect(
    A.areaKindOf(weapon(undefined, "thrownWeapon")) === null,
    "брошенный нож устроил взрыв"
  );
  // Дробовик без сведений о заряженном: отличить дробь от жакана нельзя,
  // и выдумывать зону мы не станем.
  expect(
    A.areaKindOf(weapon(undefined, "shotgun")) === null,
    "дробовик без боеприпаса всё-таки дал зону"
  );
  // Ракетница силовой брони приезжает с пустым магазином — её спасает
  // запасной путь по типу оружия.
  expect(
    A.areaKindOf(weapon(undefined, "rocketLauncher")) === A.BLAST,
    "ракетница без боеприпаса осталась без зоны"
  );

  for (const type of ["assaultRifle", "heavyPistol", "medMelee", "bow", "smg"]) {
    expect(A.areaKindOf(weapon(undefined, type)) === null, `"${type}" зря считается площадным`);
  }
  expect(A.areaKindOf(undefined) === null, "undefined принят за оружие");
  expect(A.loadedVariety(undefined) === undefined, "разбор боеприпаса упал на undefined");
}

console.log("Квадрат взрыва: 5 × 5 клеток по цели");
{
  const centre = { x: 1000, y: 700 };
  const g = A.areaGeometry(A.BLAST, GRID, centre);

  expect(g.template.t === "rect", `тип шаблона "${g.template.t}"`);
  expect(g.template.direction === 45, `направление ${g.template.direction}, а нужно 45`);
  const side = A.BLAST_SQUARES * GRID.distance;
  expect(
    Math.abs(g.template.distance - side * Math.SQRT2) < 1e-9,
    `диагональ ${g.template.distance}, а нужна ${side * Math.SQRT2}`
  );
  // Ширина = диагональ × cos(45°): должно выйти ровно пять клеток.
  const widthUnits = g.template.distance * Math.cos(Math.PI / 4);
  expect(Math.abs(widthUnits - side) < 1e-9, `сторона ${widthUnits}, а нужна ${side}`);
  expect(g.hit.size === A.BLAST_SQUARES * GRID.size, `сторона в пикселях ${g.hit.size}`);
  expect(
    Math.abs(g.hit.x + g.hit.size / 2 - centre.x) < 1e-9 &&
      Math.abs(g.hit.y + g.hit.size / 2 - centre.y) < 1e-9,
    "квадрат не центрирован на цели"
  );

  // Квадрат от 750 до 1250 по X и от 450 до 950 по Y.
  expect(A.inBlast({ x: 1000, y: 700 }, g.hit), "центр не попал в свою же зону");
  expect(A.inBlast({ x: 750, y: 450 }, g.hit), "угол зоны не считается попаданием");
  expect(!A.inBlast({ x: 749, y: 700 }, g.hit), "точка левее зоны попала");
  expect(!A.inBlast({ x: 1251, y: 700 }, g.hit), "точка правее зоны попала");
  expect(!A.inBlast({ x: 1000, y: 951 }, g.hit), "точка ниже зоны попала");
}

console.log("Зона дроби: блок три на три перед стрелком");
{
  const shooter = { x: 1000, y: 700 };
  // Направление 0° — вправо по холсту.
  const g = A.areaGeometry(A.SHOT, GRID, shooter, 0);

  expect(g.template.t === "rect", `тип шаблона "${g.template.t}"`);
  expect(g.hit.size === A.SHOT_SQUARES * GRID.size, `сторона блока ${g.hit.size} пикселей`);
  expect(
    g.metres === A.SHOT_SQUARES * GRID.distance,
    `сторона ${g.metres} ${GRID.units}, а по книге шесть метров`
  );

  // Блок вплотную перед стрелком: ближняя кромка — соседняя клетка, дальняя —
  // третья. При клетке в 100 пикселей это от +50 до +350 по X от центра токена.
  expect(
    Math.abs(g.hit.x - (shooter.x + 50)) < 1e-9,
    `ближняя кромка на ${g.hit.x - shooter.x} пикселей, а должна на 50`
  );
  expect(
    Math.abs(g.hit.x + g.hit.size - (shooter.x + 350)) < 1e-9,
    `дальняя кромка на ${g.hit.x + g.hit.size - shooter.x}, а должна на 350`
  );
  // По ширине блок центрирован на стрелке: полторы клетки в каждую сторону.
  expect(
    Math.abs(g.hit.y + g.hit.size / 2 - shooter.y) < 1e-9,
    "блок не центрирован по ширине"
  );

  const at = (dx, dy) => ({ x: shooter.x + dx, y: shooter.y + dy });
  // Клетки блока: первая, вторая и третья вперёд, по три в ряд.
  expect(A.inBlast(at(100, 0), g.hit), "первая клетка перед стволом не попала");
  expect(A.inBlast(at(200, 0), g.hit), "вторая клетка не попала");
  expect(A.inBlast(at(300, 0), g.hit), "третья клетка (6 м) не попала");
  expect(A.inBlast(at(200, 100), g.hit), "клетка сбоку от оси не попала");
  expect(A.inBlast(at(200, -100), g.hit), "клетка с другого бока не попала");

  // А это уже мимо.
  expect(!A.inBlast(shooter, g.hit), "стрелок попал в собственную зону");
  expect(!A.inBlast(at(400, 0), g.hit), "цель дальше шести метров попала");
  expect(!A.inBlast(at(-100, 0), g.hit), "цель ЗА СПИНОЙ попала под дробь");
  expect(!A.inBlast(at(200, 200), g.hit), "цель вне ширины блока попала");

  // Разворот: то, что было за спиной, оказывается под ударом.
  const back = A.areaGeometry(A.SHOT, GRID, shooter, 180);
  expect(A.inBlast(at(-200, 0), back.hit), "после разворота цель сзади не попала");
  expect(!A.inBlast(at(200, 0), back.hit), "после разворота цель спереди осталась в зоне");

  // Вниз по холсту.
  const down = A.areaGeometry(A.SHOT, GRID, shooter, 90);
  expect(A.inBlast(at(0, 200), down.hit), "при стрельбе вниз зона не туда");
  expect(!A.inBlast(at(200, 0), down.hit), "при стрельбе вниз накрыло вбок");
}

console.log("Направление округляется до сторон сетки");
{
  // Блок идёт по клеткам, а клетки не поворачиваются: произвольный угол
  // округляем до ближайшей из восьми сторон.
  const cases = [
    [0, 0, 1, 0], [10, 0, 1, 0], [44, 45, 1, 1], [90, 90, 0, 1],
    [180, 180, -1, 0], [270, 270, 0, -1], [-90, 270, 0, -1],
    [360, 0, 1, 0], [450, 90, 0, 1], [-45, 315, 1, -1],
  ];
  for (const [given, degrees, dx, dy] of cases) {
    const snapped = A.__test.snapToGrid(given);
    expect(
      snapped.degrees === degrees && snapped.dx === dx && snapped.dy === dy,
      `${given}° → ${snapped.degrees}° (${snapped.dx},${snapped.dy}), ` +
        `а ожидалось ${degrees}° (${dx},${dy})`
    );
  }
}

console.log("Режим дроби решает за боеприпас");
{
  // Стрелок сам сказал, чем стреляет: режим важнее того, что в магазине.
  const withMode = (on, variety, weaponType) => ({
    id: "wpn0000000000001",
    type: "weapon",
    name: "дробовик",
    system: { weaponType },
    _getLoadedAmmoProp: () => variety,
    actor: { getFlag: (scope, key) => (on && key === "shotmode-wpn0000000000001") || false },
  });

  expect(
    A.areaKindOf(withMode(true, "shotgunSlug", "shotgun")) === A.SHOT,
    "включённый режим дроби не перебил жакан в магазине"
  );
  expect(
    A.areaKindOf(withMode(false, "shotgunSlug", "shotgun")) === null,
    "выключенный режим всё равно дал зону"
  );
  expect(
    A.areaKindOf(withMode(true, undefined, "shotgun")) === A.SHOT,
    "режим без боеприпаса не сработал"
  );
  expect(A.shotModeOn(withMode(true, undefined, "shotgun")), "режим не прочитался");
  expect(!A.shotModeOn({ id: "x" }), "режим прочитался у предмета без владельца");
  expect(!A.shotModeOn(undefined), "undefined уронил чтение режима");

  // Переключатель показываем только дробовикам.
  expect(A.canFireShot({ type: "weapon", system: { weaponType: "shotgun" } }), "дробовик не опознан");
  for (const type of ["assaultRifle", "rocketLauncher", "medPistol", "bow"]) {
    expect(
      !A.canFireShot({ type: "weapon", system: { weaponType: type } }),
      `"${type}" зря получил переключатель дроби`
    );
  }
  expect(!A.canFireShot({ type: "ammo", system: { weaponType: "shotgun" } }), "патрон получил переключатель");
}

console.log("Переключатель встаёт в список режимов");
{
  const M = await import(pathToFileURL(path.join(tmp, "shot-mode.mjs")).href);

  expect(M.shotFlagKey("abc") === "shotmode-abc", `ключ флага "${M.shotFlagKey("abc")}"`);

  const markup = M.shotToggleMarkup("wpn1", true);
  expect(markup.includes("fa-circle-dot"), "включённый режим показан пустым кружком");
  const off = M.shotToggleMarkup("wpn1", false);
  expect(
    off.includes("fa-circle ") && !off.includes("fa-circle-dot"),
    "выключенный режим показан закрашенным кружком"
  );
  expect(markup.includes('data-item-id="wpn1"'), "переключатель не знает, к чему относится");

  // Выключение должно снимать флаг, а не писать false: лишние флаги копятся на
  // актёре навсегда и переживают даже удаление оружия.
  const source = fs.readFileSync(path.join(SCRIPTS, "shot-mode.js"), "utf-8");
  expect(source.includes("unsetFlag"), "выключенный режим оставляет флаг на актёре");
  // Системный firetype трогать нельзя: система попробует бросить «дробь» как
  // тип броска, получит null и атака не состоится.
  // Ищем именно обращение к флагу, а не упоминание: в комментарии рядом как раз
  // объяснено, почему системный firetype трогать нельзя.
  expect(
    !/["'`]firetype-|getFlag\([^)]*firetype/.test(source),
    "режим лезет в системный firetype — система попробует бросить «дробь» как тип броска"
  );
}

console.log("Кто попал в зону");
{
  const token = (name, x, y, ref) => ({
    name,
    center: { x, y },
    document: { uuid: `Scene.s1.Token.${name}` },
    actor: { system: { stats: { ref: { value: ref } } } },
  });

  const g = A.areaGeometry(A.BLAST, GRID, { x: 1000, y: 700 });
  const caught = A.caughtBy(
    g,
    [
      token("центр", 1000, 700, 9),
      token("угол", 750, 450, 8),
      token("слабый", 900, 600, 5),
      token("снаружи", 1400, 700, 9),
    ],
    null
  );

  expect(caught.length === 3, `в зоне ${caught.length}, а внутри трое`);
  expect(!caught.some((t) => t.name === "снаружи"), "внешняя фигура попала в список");
  // Порог из книги — РЕФ 8, а не 7 и не 9.
  expect(A.DODGE_REF === 8, `порог уклонения ${A.DODGE_REF}, а в книге 8`);
  expect(caught.find((t) => t.name === "угол").canDodge, "РЕФ ровно 8 не даёт уклоняться");
  expect(!caught.find((t) => t.name === "слабый").canDodge, "РЕФ 5 зря пустили уклоняться");
  expect(A.caughtBy(g, [], null).length === 0, "пустая сцена дала попавших");
  expect(A.caughtBy(g, undefined, null).length === 0, "undefined уронил подсчёт");
}

console.log("Дробь не достаёт сквозь стену");
{
  const token = (name, x, y) => ({
    name,
    center: { x, y },
    document: { uuid: `Scene.s1.Token.${name}` },
    actor: { system: { stats: { ref: { value: 9 } } } },
  });
  const shooter = { x: 1000, y: 700 };
  const g = A.areaGeometry(A.SHOT, GRID, shooter, 0);
  const crowd = [token("видимый", 1200, 700), token("застенный", 1250, 700)];

  // Без Foundry проверки стен нет — тогда преград не выдумываем: лучше лишний
  // в списке, чем молча вычеркнутый.
  expect(A.sightBlocked({ x: 0, y: 0 }, { x: 1, y: 1 }) === false,
    "без Foundry модуль всё-таки выдумал стену");
  expect(A.caughtBy(g, crowd, shooter).length === 2, "без стен кто-то потерялся");

  // А со стеной — вычёркиваем закрытого.
  globalThis.ClockwiseSweepPolygon = {
    testCollision: (from, to) => to.x >= 1250,
  };
  const visible = A.caughtBy(g, crowd, shooter);
  expect(visible.length === 1, `сквозь стену видно ${visible.length} из 2`);
  expect(visible[0].name === "видимый", "вычеркнули не того");

  // Взрыв стены не спрашивает: он бьёт по площади, а укрытие — решение мастера.
  const blast = A.areaGeometry(A.BLAST, GRID, { x: 1225, y: 700 });
  expect(A.caughtBy(blast, crowd, null).length === 2, "взрыв зря отфильтровал по видимости");

  // Сломанная проверка не должна ронять подсчёт.
  globalThis.ClockwiseSweepPolygon = {
    testCollision: () => {
      throw new Error("нет холста");
    },
  };
  expect(A.caughtBy(g, crowd, shooter).length === 2, "ошибка проверки стен потеряла цели");
  delete globalThis.ClockwiseSweepPolygon;
}

console.log("Запуск идёт от атаки, а не от листа");
{
  const hook = fs.readFileSync(path.join(SCRIPTS, "area-hook.js"), "utf-8");
  expect(hook.includes("RenderRollCard"), "обёртка больше не стоит на отрисовке карточки");
  expect(
    hook.includes('"WRAPPER"'),
    "обёртка не в режиме WRAPPER — она может подменить возвращаемое системой"
  );
  // Хук createChatMessage сработал бы у КАЖДОГО клиента и размножил бы зону по
  // числу игроков. Ищем именно вызов, а не упоминание: в комментарии рядом как
  // раз объяснено, почему этот путь не взят.
  expect(
    !/Hooks\.on\(\s*["']createChatMessage/.test(hook),
    "запуск переведён на хук сообщения — зона размножится по числу игроков"
  );

  const sheet = fs.readFileSync(path.join(SCRIPTS, "vehicle-sheet.js"), "utf-8");
  expect(
    !sheet.includes("placeBlast") && !sheet.includes("placeArea"),
    "лист транспорта снова ставит зону сам — выстрел с поста даст две"
  );

  const main = fs.readFileSync(path.join(SCRIPTS, "main.js"), "utf-8");
  expect(main.includes("registerAreaAttacks"), "площадные атаки не подключены в main.js");
}

console.log("Строки карточки переведены");
{
  const ru = JSON.parse(fs.readFileSync(path.join(LANG, "ru.json"), "utf-8"));
  const en = JSON.parse(fs.readFileSync(path.join(LANG, "en.json"), "utf-8"));
  const source =
    fs.readFileSync(path.join(SCRIPTS, "area-attacks.js"), "utf-8") +
    fs.readFileSync(path.join(SCRIPTS, "area-hook.js"), "utf-8");

  const used = new Set(
    [...source.matchAll(/localize\(\s*"(area\.[a-zA-Z.]+)"/g)].map((m) => m[1])
  );
  for (const m of source.matchAll(/"(area\.[a-z][a-zA-Z.]+)"/g)) used.add(m[1]);

  expect(used.size > 20, `ключей найдено подозрительно мало: ${used.size}`);
  for (const key of used) {
    expect(`CPRADDENDA.${key}` in ru, `нет русской строки CPRADDENDA.${key}`);
    expect(`CPRADDENDA.${key}` in en, `нет английской строки CPRADDENDA.${key}`);
  }

  // Старые ключи взрыва должны были уйти вместе с переездом.
  const stale = Object.keys(ru).filter((k) => k.startsWith("CPRADDENDA.vehicle.blast."));
  expect(stale.length === 0, `остались осиротевшие ключи: ${stale.slice(0, 3).join(", ")}`);
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures > 0 ? 1 : 0);
