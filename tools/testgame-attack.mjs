/**
 * Тестовая партия: площадная атака от выстрела до урона.
 *
 * Отдельные куски этой цепочки уже проверены — геометрия в `selftest-area`,
 * броски в `testgame-rolls`. Но за столом ломается обычно не кусок, а стык:
 * атака прошла, а шаблон не встал; шаблон встал, а список попавших пустой;
 * список есть, а урон ушёл не туда. Здесь проверяется именно проход насквозь.
 *
 * Сцена настоящая по устройству, хоть и собранная руками: сетка 100 пикселей
 * на 2 метра, стрелок, четверо целей — одна вплотную, одна на краю зоны, одна
 * далеко, одна за стеной. Дальше всё как в игре: бросок атаки уходит в
 * карточку, обёртка модуля ловит его, ставит шаблон, считает попавших и
 * выдаёт кнопки. Кнопки нажимаются, и проверяется, что уклонение бросается за
 * того, за кого надо, а урон уходит по списку попавших, а не по выделенным
 * фигурам — на этом модуль уже обжигался.
 *
 * Чего здесь нет: отрисовки самой карточки. Последним шагом модуль загружает
 * `cpr-chat.js` системы по адресу от корня сайта, а вне Foundry такого адреса
 * не существует. Поэтому проверяется всё вплоть до этого шага включительно —
 * то есть что именно уходит в карточку.
 *
 *   node tools/testgame-attack.mjs
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

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
/*  Сцена                                                              */
/* ------------------------------------------------------------------ */

const GRID = { size: 100, distance: 2, units: "м" };

/** Фигура на сцене. */
function makeToken(name, x, y, { ref = 8, actorId = null } = {}) {
  const id = actorId ?? `actor-${name}`;
  const token = {
    name,
    center: { x, y },
    actor: {
      id,
      name,
      uuid: `Actor.${id}`,
      system: { stats: { ref: { value: ref } } },
    },
    document: { uuid: `Scene.main.Token.token-${name}`, rotation: 0 },
  };
  return token;
}

/** Стены сцены: пары точек, через которые не видно. */
let walls = [];

/** Пересекает ли отрезок хоть одну стену. */
function crosses(a, b) {
  const side = (p, q, r) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  for (const [w1, w2] of walls) {
    if (
      side(a, b, w1) !== side(a, b, w2) &&
      side(w1, w2, a) !== side(w1, w2, b)
    ) {
      return true;
    }
  }
  return false;
}

const created = { templates: [], messages: [] };
globalThis.__rollMode = "publicroll";
let tokens = [];
let targets = new Set();
let notified = [];

function stubFoundry() {
  globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };

  globalThis.canvas = {
    get scene() {
      return {
        grid: GRID,
        async createEmbeddedDocuments(type, data) {
          const docs = data.map((d, i) => ({
            ...d,
            uuid: `Scene.main.MeasuredTemplate.tpl${created.templates.length + i}`,
            update: async () => {},
            delete: async () => {},
          }));
          created.templates.push(...docs);
          return docs;
        },
      };
    },
    get tokens() {
      return { placeables: tokens };
    },
  };

  globalThis.ClockwiseSweepPolygon = {
    testCollision(origin, dest) {
      return crosses(origin, dest);
    },
  };

  globalThis.game = {
    system: { id: "cyberpunk-red-core" },
    user: {
      id: "user1",
      isGM: true,
      color: "#ffffff",
      get targets() {
        return targets;
      },
    },
    settings: {
      get: (scope, key) =>
        scope === "core" && key === "rollMode" ? globalThis.__rollMode : true,
    },
    i18n: {
      localize: (key) => key,
      format: (key, data) => `${key}|${JSON.stringify(data)}`,
    },
    actors: { get: (id) => tokens.find((t) => t.actor.id === id)?.actor ?? null },
    modules: { get: () => ({ active: true }) },
  };

  globalThis.ui = {
    notifications: {
      info: (m) => notified.push(["info", m]),
      warn: (m) => notified.push(["warn", m]),
      error: (m) => notified.push(["error", m]),
    },
  };

  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor?.id ?? null }),
    getWhisperRecipients: () => [{ id: "gm1" }],
    // Повторяет ядро Foundry (client/data/documents/chat-message.js).
    applyRollMode(data, mode) {
      const rollMode = mode === "roll" ? globalThis.__rollMode : mode;
      if (rollMode === "gmroll" || rollMode === "blindroll") {
        data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
      } else if (rollMode === "selfroll") {
        data.whisper = [game.user.id];
      } else if (rollMode === "publicroll") {
        data.whisper = [];
      }
      data.blind = rollMode === "blindroll";
      return data;
    },
    async create(data) {
      const message = { ...data, id: `msg${created.messages.length}`, update: async () => {} };
      created.messages.push(message);
      return message;
    },
  };

  globalThis.fromUuid = async (uuid) => {
    const token = tokens.find((t) => t.document.uuid === uuid);
    if (token) return { ...token.document, actor: token.actor, center: token.center };
    const actor = tokens.find((t) => t.actor.uuid === uuid)?.actor;
    if (actor) return actor;
    if (uuid?.startsWith("Item.")) return globalThis.__weapon ?? null;
    if (uuid?.includes("MeasuredTemplate")) {
      return created.templates.find((t) => t.uuid === uuid) ?? null;
    }
    return null;
  };

  globalThis.foundry = {
    utils: { hasProperty: () => false, mergeObject: (a, b) => ({ ...a, ...b }) },
  };
  globalThis.Hooks = { on() {}, once() {}, callAll() {} };

  // Разметку карточки модуль собирает строкой и экранирует имена штатным
  // хелпером Handlebars — повторяем ровно его поведение.
  globalThis.Handlebars = {
    escapeExpression: (text) =>
      String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;"),
  };
}

/** Копия скриптов модуля с расширением .mjs. */
function prepareModule() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-attack-"));
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.endsWith(".js")) continue;
    const body = fs
      .readFileSync(path.join(SCRIPTS, file), "utf-8")
      .replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, ".mjs")), body, "utf-8");
  }
  return tmp;
}

/** Оружие, каким его видит модуль. */
function makeWeapon(name, weaponType, ammoVariety, actor, { shotMode = false } = {}) {
  return {
    id: "wpn1",
    uuid: "Item.wpn1",
    name,
    type: "weapon",
    system: { weaponType },
    actor,
    isOwner: true,
    _getLoadedAmmoProp: () => ammoVariety,
    createRoll: (type, who, extra) => ({
      __type: type,
      __actor: who,
      __extra: extra,
      resultTotal: 0,
      mods: [],
      async handleRollDialog() {
        return true;
      },
      async roll() {},
    }),
    confirmRoll: async (roll) => roll,
  };
}

/** Разбирает кнопки карточки, не поднимая настоящий DOM. */
function buttonsOf(html) {
  const found = [];
  for (const match of html.matchAll(/<button[^>]*>/g)) {
    const tag = match[0];
    const action = tag.match(/data-action="([^"]+)"/)?.[1];
    if (!action) continue;
    found.push({
      dataset: {
        action,
        tokenUuid: tag.match(/data-token-uuid="([^"]+)"/)?.[1],
      },
      handlers: [],
      addEventListener(_event, fn) {
        this.handlers.push(fn);
      },
      click() {
        const event = { preventDefault() {} };
        return Promise.all(this.handlers.map((fn) => fn(event)));
      },
    });
  }
  return found;
}

/** Обёртка над разметкой карточки — то немногое, что нужно модулю. */
function fakeHtml(buttons) {
  return [
    {
      querySelectorAll: () => buttons,
    },
  ];
}

/* ------------------------------------------------------------------ */

console.log("Площадная атака насквозь: выстрел → шаблон → урон\n");

stubFoundry();
const modulePath = prepareModule();
const area = await import(pathToFileURL(path.join(modulePath, "area-attacks.mjs")).href);

/** Ставит сцену заново перед каждым сюжетом. */
function scene() {
  created.templates.length = 0;
  created.messages.length = 0;
  notified = [];
  targets = new Set();
  walls = [];
  globalThis.__rollMode = "publicroll";
}

const SHOOTER = { x: 1000, y: 1000 };

console.log("Ракета: шаблон встаёт по цели, в списке все, кто в квадрате");
{
  scene();
  const shooter = makeToken("Стрелок", SHOOTER.x, SHOOTER.y);
  const near = makeToken("Рядом", 1300, 1000);        // цель, по ней и бьём
  const inside = makeToken("В зоне", 1300, 1200);     // в том же квадрате
  const far = makeToken("Далеко", 1300, 1900);        // вне квадрата
  tokens = [shooter, near, inside, far];
  targets = new Set([near]);
  globalThis.__weapon = makeWeapon("Ракетница", "rocketLauncher", "rocket", shooter.actor);

  const template = await area.placeArea({
    item: globalThis.__weapon,
    actor: shooter.actor,
    kind: area.BLAST,
    attackTotal: 15,
  });

  expect(template !== null, "шаблон взрыва не поставлен");
  expect(created.templates.length === 1, `шаблонов создано ${created.templates.length}`);
  expect(created.messages.length === 1, `карточек создано ${created.messages.length}`);

  const tpl = created.templates[0];
  const side = area.BLAST_SQUARES * GRID.size;
  expect(tpl.t === "rect", `тип шаблона «${tpl.t}»`);
  // Квадрат 5×5 центрируется на цели: угол на 2.5 клетки левее и выше.
  expect(
    Math.abs(tpl.x - (near.center.x - side / 2)) < 1e-9,
    `угол шаблона по X ${tpl.x}, а цель в ${near.center.x}`
  );
  expect(
    Math.abs(tpl.y - (near.center.y - side / 2)) < 1e-9,
    `угол шаблона по Y ${tpl.y}, а цель в ${near.center.y}`
  );

  const flags = created.messages[0].flags["cpr-addenda"].area;
  expect(flags.kind === area.BLAST, `в карточке вид зоны «${flags.kind}»`);
  expect(flags.attack === 15, `итог атаки в карточке ${flags.attack}`);
  expect(flags.weapon === "Item.wpn1", "в карточке не то оружие");
  expect(flags.shooter === shooter.actor.uuid, "в карточке не тот стрелок");

  const caught = flags.caught;
  expect(caught.includes(near.document.uuid), "цель не попала в свой же взрыв");
  expect(caught.includes(inside.document.uuid), "сосед в квадрате не попал");
  expect(!caught.includes(far.document.uuid), "дальний зря попал");
  console.log(`  в зоне: ${caught.length} из ${tokens.length}`);
}

console.log("Ракета без помеченной цели: ставить некуда, и модуль это говорит");
{
  scene();
  const shooter = makeToken("Стрелок", SHOOTER.x, SHOOTER.y);
  tokens = [shooter];
  globalThis.__weapon = makeWeapon("Ракетница", "rocketLauncher", "rocket", shooter.actor);

  const template = await area.placeArea({
    item: globalThis.__weapon,
    actor: shooter.actor,
    kind: area.BLAST,
    attackTotal: 12,
  });
  expect(template === null, "без цели шаблон всё-таки поставлен");
  expect(created.templates.length === 0, "создан шаблон в никуда");
  expect(
    notified.some(([level]) => level === "warn"),
    "молча ничего не сделал — за столом это неотличимо от поломки"
  );
}

console.log("Дробь: блок перед стрелком, за стеной не достаёт");
{
  scene();
  const shooter = makeToken("Стрелок", SHOOTER.x, SHOOTER.y);
  const ahead = makeToken("Впереди", 1200, 1000);
  const behindWall = makeToken("За стеной", 1300, 1000);
  const behindBack = makeToken("Сзади", 800, 1000);
  tokens = [shooter, ahead, behindWall, behindBack];
  targets = new Set([ahead]);
  // Стена между стрелком и дальней фигурой.
  walls = [[{ x: 1250, y: 800 }, { x: 1250, y: 1200 }]];
  globalThis.__weapon = makeWeapon("Дробовик", "shotgun", "shotgunShell", shooter.actor);

  await area.placeArea({
    item: globalThis.__weapon,
    actor: shooter.actor,
    kind: area.SHOT,
    attackTotal: 14,
  });

  expect(created.templates.length === 1, "шаблон дроби не поставлен");
  const flags = created.messages[0].flags["cpr-addenda"].area;
  const caught = flags.caught;
  expect(caught.includes(ahead.document.uuid), "цель прямо перед стволом не попала");
  expect(!caught.includes(behindWall.document.uuid), "дробь прошла сквозь стену");
  expect(!caught.includes(behindBack.document.uuid), "дробь достала за спину");
  console.log(`  в зоне: ${caught.length}, стена отсекла одного`);
}

console.log("Кнопки карточки: уклонение за того, кого выбрали");
{
  scene();
  const shooter = makeToken("Стрелок", SHOOTER.x, SHOOTER.y);
  const quick = makeToken("Ловкий", 1300, 1000, { ref: 8 });
  const slow = makeToken("Неповоротливый", 1300, 1100, { ref: 5 });
  tokens = [shooter, quick, slow];
  targets = new Set([quick]);
  globalThis.__weapon = makeWeapon("Ракетница", "rocketLauncher", "rocket", shooter.actor);

  await area.placeArea({
    item: globalThis.__weapon,
    actor: shooter.actor,
    kind: area.BLAST,
    attackTotal: 13,
  });

  const card = created.messages[0];
  const html = card.content;
  expect(html.includes(quick.name), "ловкого нет в списке карточки");
  expect(html.includes(slow.name), "неповоротливого нет в списке карточки");

  const buttons = buttonsOf(html);
  const dodge = buttons.filter((b) => b.dataset.action === "cprAddendaAreaDodge");
  const damage = buttons.filter((b) => b.dataset.action === "cprAddendaAreaDamage");

  // Уклоняться может только РЕФ 8 и выше — кнопка положена лишь ему.
  expect(dodge.length === 1, `кнопок уклонения ${dodge.length}, а уклоняться может один`);
  expect(
    dodge[0]?.dataset.tokenUuid === quick.document.uuid,
    "кнопка уклонения выдана не тому"
  );
  expect(damage.length === 1, `кнопок урона ${damage.length}`);
}

console.log("Урон уходит по списку зоны, а не по выделенным фигурам");
{
  scene();
  const shooter = makeToken("Стрелок", SHOOTER.x, SHOOTER.y);
  const hitA = makeToken("Попал А", 1300, 1000);
  const hitB = makeToken("Попал Б", 1300, 1100);
  const outside = makeToken("Мимо", 1300, 2000);
  tokens = [shooter, hitA, hitB, outside];
  targets = new Set([hitA]);

  // Оружие с настоящим объектом броска: по нему и посмотрим, что ушло в карточку.
  let handed = null;
  const weapon = makeWeapon("Ракетница", "rocketLauncher", "rocket", shooter.actor);
  weapon.createRoll = (type, who, extra) => {
    handed = {
      __type: type,
      __actor: who,
      __extra: extra,
      resultTotal: 0,
      mods: [],
      async handleRollDialog() {
        return true;
      },
      async roll() {},
    };
    return handed;
  };
  globalThis.__weapon = weapon;

  await area.placeArea({
    item: weapon,
    actor: shooter.actor,
    kind: area.BLAST,
    attackTotal: 16,
  });

  const card = created.messages[0];
  const buttons = buttonsOf(card.content);
  area.activateAreaCard(
    { flags: { "cpr-addenda": { area: card.flags["cpr-addenda"].area } } },
    fakeHtml(buttons)
  );

  const damage = buttons.find((b) => b.dataset.action === "cprAddendaAreaDamage");
  expect(damage !== undefined, "кнопки урона на карточке нет");

  // Обработчик кнопки промис наружу не отдаёт — он и не должен, это щелчок
  // мыши. Поэтому ждём, пока цепочка отработает сама.
  //
  // Последним шагом модуль грузит карточку системы по адресу от корня сайта —
  // вне Foundry его нет, и загрузка падает. Всё, что нас интересует, к этому
  // моменту уже записано в бросок.
  const realError = console.error;
  console.error = () => {}; // падение загрузки здесь ожидаемо, не засоряем вывод
  await damage.click().catch(() => {});
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
  console.error = realError;

  expect(handed !== null, "бросок урона не создан");
  expect(handed?.__type === "damage", `создан бросок типа «${handed?.__type}»`);
  expect(
    handed?.__extra?.damageType === "damage",
    "не указан тип урона — система подставит режим прошлого выстрела"
  );
  expect(handed?.__actor?.id === shooter.actor.id, "урон бросает не стрелок");

  const entity = handed?.entityData;
  expect(entity !== undefined, "в бросок не положены данные для карточки");
  const names = (entity?.tokens ?? []).map((t) => t.name ?? t?.actor?.name);
  expect(names.includes("Попал А"), `в карточке урона нет «Попал А»: ${names}`);
  expect(names.includes("Попал Б"), `в карточке урона нет «Попал Б»: ${names}`);
  expect(!names.includes("Мимо"), "урон достался тому, кто вне зоны");
  expect(!names.includes("Стрелок"), "урон достался стрелку вместо целей");
  expect(
    (entity?.tokens ?? []).every((t) => typeof t === "object"),
    "в карточку положены идентификаторы вместо фигур — список будет пустым"
  );
  console.log(`  урон уходит по ${names.length} фигурам: ${names.join(", ")}`);
}

console.log("Зону двигают — список пересчитывается");
{
  scene();
  const shooter = makeToken("Стрелок", SHOOTER.x, SHOOTER.y);
  const first = makeToken("Первый", 1300, 1000);
  const second = makeToken("Второй", 2000, 1000);
  tokens = [shooter, first, second];
  targets = new Set([first]);
  globalThis.__weapon = makeWeapon("Ракетница", "rocketLauncher", "rocket", shooter.actor);

  await area.placeArea({
    item: globalThis.__weapon,
    actor: shooter.actor,
    kind: area.BLAST,
    attackTotal: 11,
  });

  const before = created.messages[0].flags["cpr-addenda"].area.caught;
  expect(before.includes(first.document.uuid), "первый не попал в свой взрыв");
  expect(!before.includes(second.document.uuid), "дальний попал сразу");

  // Мастер переносит промахнувшийся взрыв на второго — как велит книга.
  const tpl = created.templates[0];
  const side = area.BLAST_SQUARES * GRID.size;
  tpl.x = second.center.x - side / 2;
  tpl.y = second.center.y - side / 2;

  const geometry = { kind: area.BLAST, hit: { x: tpl.x, y: tpl.y, size: side } };
  const now = area.caughtBy(geometry, tokens).map((t) => t.uuid);
  expect(now.includes(second.document.uuid), "после переноса второй не попал");
  expect(!now.includes(first.document.uuid), "после переноса первый остался в зоне");
}

console.log("Карточка зоны уходит тем же, кому ушёл выстрел");
{
  // Система подчиняет карточку выстрела настройке «режим броска». Карточка
  // модуля этого не делала и всегда шла в общий чат: при приватном броске
  // мастера за столом выходило, будто выстрела не было вовсе — зона видна
  // всем, а карточка атаки только мастеру. При слепом броске было хуже:
  // модуль публично объявлял итог, который как раз и прятали, ведь в
  // карточке зоны написано, что уклонение должно его превзойти.
  const shooter = makeToken("Стрелок", SHOOTER.x, SHOOTER.y);
  const victim = makeToken("Цель", 1300, 1000);

  const modes = [
    ["publicroll", false, false],
    ["gmroll", true, false],
    ["blindroll", true, true],
    ["selfroll", true, false],
  ];

  for (const [mode, hidden, blind] of modes) {
    scene();
    globalThis.__rollMode = mode;
    tokens = [shooter, victim];
    targets = new Set([victim]);
    globalThis.__weapon = makeWeapon("Ракетница", "rocketLauncher", "rocket", shooter.actor);

    // eslint-disable-next-line no-await-in-loop
    await area.placeArea({
      item: globalThis.__weapon,
      actor: shooter.actor,
      kind: area.BLAST,
      attackTotal: 15,
    });

    const card = created.messages[0];
    expect(card !== undefined, `при режиме «${mode}» карточка зоны не создана`);
    if (!card) continue;

    const whispered = Array.isArray(card.whisper) && card.whisper.length > 0;
    expect(
      whispered === hidden,
      `при режиме «${mode}» карточка ${whispered ? "спрятана" : "публична"}, ` +
        `а должна быть ${hidden ? "спрятана" : "публична"}`
    );
    expect(
      Boolean(card.blind) === blind,
      `при режиме «${mode}» blind=${card.blind}, а ожидалось ${blind}`
    );
  }
  console.log(`  проверено режимов: ${modes.length}`);
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);
