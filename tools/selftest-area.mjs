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

  // Дробь и жакан различаются ТОЛЬКО боеприпасом.
  expect(A.areaKindOf(weapon("shotgunShell", "shotgun")) === A.SHOT, "дробь не опознана");
  expect(
    A.areaKindOf(weapon("shotgunSlug", "shotgun")) === null,
    "жакан превратился в площадную атаку — это выстрел по одной цели"
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

console.log("Сектор дроби: три клетки перед стрелком");
{
  const shooter = { x: 1000, y: 700 };
  // Направление 0° — вправо по холсту.
  const g = A.areaGeometry(A.SHOT, GRID, shooter, 0);

  expect(g.template.t === "cone", `тип шаблона "${g.template.t}"`);
  expect(g.template.angle === 180, `раствор ${g.template.angle}, а «перед тобой» — это 180`);
  expect(
    g.template.distance === A.SHOT_SQUARES * GRID.distance,
    `дальность ${g.template.distance} ${GRID.units}, а по книге шесть метров`
  );
  expect(g.hit.radius === A.SHOT_SQUARES * GRID.size, `радиус в пикселях ${g.hit.radius}`);

  const at = (dx, dy) => ({ x: shooter.x + dx, y: shooter.y + dy });
  // Радиус — три клетки, то есть 300 пикселей.
  expect(A.inCone(at(250, 0), g.hit), "цель прямо перед стволом не попала");
  expect(A.inCone(at(0, 250), g.hit), "цель сбоку (ровно 90°) не попала — а это край сектора");
  expect(A.inCone(at(0, -250), g.hit), "цель с другого бока не попала");
  expect(!A.inCone(at(-250, 0), g.hit), "цель ЗА СПИНОЙ попала под дробь");
  expect(!A.inCone(at(-10, 250), g.hit), "цель чуть позади линии плеч попала");
  expect(!A.inCone(at(350, 0), g.hit), "цель дальше шести метров попала");
  expect(!A.inCone(shooter, g.hit), "стрелок попал в собственную зону");

  // Разворот сектора: то, что было за спиной, оказывается под ударом.
  const back = A.areaGeometry(A.SHOT, GRID, shooter, 180);
  expect(A.inCone(at(-250, 0), back.hit), "после разворота цель сзади так и не попала");
  expect(!A.inCone(at(250, 0), back.hit), "после разворота цель спереди осталась в зоне");

  // Направление в градусах может прийти любым — считаем по кругу.
  const skew = A.areaGeometry(A.SHOT, GRID, shooter, -90);
  expect(A.inCone(at(0, -250), skew.hit), "отрицательное направление считается неверно");
  const wrap = A.areaGeometry(A.SHOT, GRID, shooter, 450);
  expect(A.inCone(at(250, 0), wrap.hit), "направление больше круга считается неверно");
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
