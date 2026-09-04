/**
 * Проверка того, что модуль доедет до пользователя целиком.
 *
 * Компендиум Foundry — это папка LevelDB, и уезжает она в архив релиза целой
 * папкой, файл за файлом. Стоит одному файлу не попасть в репозиторий, и база
 * у пользователя откроется как ни в чём не бывало — просто без части
 * предметов. Ни ошибки, ни предупреждения: пак просто беднее, чем у автора.
 *
 * Именно так и вышло: правило `*.log` в `.gitignore` задумывалось для
 * черновиков, а под него попали журналы LevelDB — файлы вида `000171.log`
 * внутри пака, где лежат самые свежие записи. В релизе 0.13.0 из-за этого
 * уехал пак без семи только что добавленных предметов.
 *
 * Поэтому здесь проверяется не содержимое паков (этим занят validate-items),
 * а сама возможность их потерять.
 *
 * Запускать последней и после `git add packs`: открытие базы прокручивает её
 * служебные файлы, поэтому соседние проверки, читающие паки, оставляют за
 * собой новый MANIFEST. Порядок перед релизом такой:
 *
 *   node tools/build-packs.js
 *   node tools/validate-items.js && остальные проверки
 *   git add packs
 *   node tools/selftest-release.mjs
 *   python tools/make_release.py
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const PACKS = path.join(MODULE_ROOT, "packs");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

/** Все файлы паков, какие есть на диске. */
function packFiles() {
  const found = [];
  for (const pack of fs.readdirSync(PACKS)) {
    const dir = path.join(PACKS, pack);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      if (fs.statSync(full).isFile()) {
        found.push(path.relative(MODULE_ROOT, full).split(path.sep).join("/"));
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------------ */

console.log("Ссылка на архив в манифесте ведёт на текущую версию");
{
  // Foundry при обновлении берёт из манифеста ИМЕННО ссылку `download`, а не
  // версию. Отстанет ссылка — мастер «обновится» на старый архив, и внешне всё
  // будет благополучно: в списке модулей новая версия, а код на диске прежний.
  //
  // Так и вышло с выпусками 0.19.0-0.19.2: ссылка осталась от 0.18.1, и всё это
  // время раздавался архив трёхмесячной давности. Ошибку не видно ни в одной
  // другой проверке — архив-то собирался правильный, промахивалась раздача.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(MODULE_ROOT, "module.json"), "utf-8")
  );
  const want =
    "https://github.com/Defaulter444/cpr-addenda/releases/download/" +
    `v${manifest.version}/module.zip`;

  expect(
    manifest.download === want,
    `ссылка ведёт на «${manifest.download}», а версия ${manifest.version} — ` +
      "мастер обновится на чужой архив"
  );

  // Ссылка на сам манифест, наоборот, обязана быть плавающей: она одна и та же
  // во всех выпусках, по ней Foundry и узнаёт о новой версии.
  expect(
    manifest.manifest ===
      "https://github.com/Defaulter444/cpr-addenda/releases/latest/download/module.json",
    `ссылка на манифест «${manifest.manifest}» — она должна вести на latest`
  );
  console.log(`  версия ${manifest.version}, ссылка на архив совпадает`);
}

console.log("Ни один файл пака не игнорируется");
{
  const files = packFiles();
  expect(files.length > 0, "в packs/ вообще нет файлов — паки не собраны");

  // `git check-ignore` отвечает списком тех, кого git отказывается видеть.
  // Пустой ответ (код 1) — это и есть успех.
  let ignored = [];
  try {
    const out = execFileSync("git", ["check-ignore", "--", ...files], {
      cwd: MODULE_ROOT,
      encoding: "utf-8",
    });
    ignored = out.split("\n").filter(Boolean);
  } catch (error) {
    // Код 1 значит «ничего не игнорируется». Любой другой — git не отработал.
    if (error.status !== 1) throw error;
  }

  expect(
    ignored.length === 0,
    `эти файлы паков не попадут в репозиторий и в релиз: ${ignored.join(", ")}`
  );

  // Правило `*.log` без якоря — та самая ошибка. Ловим её отдельно, потому что
  // сообщение выше появится только когда журнал непустой и потому существует.
  const gitignore = fs.readFileSync(
    path.join(MODULE_ROOT, ".gitignore"),
    "utf-8"
  );
  const loose = gitignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => /^\*\.(log|ldb)$/.test(line));
  expect(
    loose.length === 0,
    `правило "${loose[0]}" в .gitignore унесёт внутренние файлы LevelDB — ` +
      "поставьте якорь на корень (/*.log)"
  );
}

console.log("Паки собраны и закоммичены");
{
  // Файл, который числится в git, но исчез с диска, — признак того, что паки
  // пересобирали, а результат не закоммитили: LevelDB при уплотнении заводит
  // новые файлы и удаляет старые. Архив релиза берёт список из git, так что
  // такой файл в него просто не попадёт.
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "packs"], {
    cwd: MODULE_ROOT,
    encoding: "utf-8",
  })
    .split("\0")
    .filter(Boolean);

  // Пустой журнал не в счёт: LevelDB заводит новый при каждом открытии базы, а
  // открывает её и validate-items, и соседние проверки. Данных в нём нет,
  // гоняться за ним между прогонами бессмысленно. А вот `.ldb`, `MANIFEST` и
  // `CURRENT` — это и есть база, их расхождение с git означает битый пак.
  const meaningful = (name) => {
    if (!/\/\d+\.log$/.test(name)) return true;
    const full = path.join(MODULE_ROOT, name);
    return fs.existsSync(full) && fs.statSync(full).size > 0;
  };

  const gone = tracked
    .filter((name) => !fs.existsSync(path.join(MODULE_ROOT, name)))
    .filter((name) => !/\/\d+\.log$/.test(name));
  expect(
    gone.length === 0,
    `числятся в git, но пропали с диска: ${gone.join(", ")} — ` +
      "выполните `git add packs` (открытие базы прокручивает MANIFEST)"
  );

  const untracked = packFiles()
    .filter((name) => !tracked.includes(name))
    .filter(meaningful);
  expect(
    untracked.length === 0,
    `лежат на диске, но не в git: ${untracked.join(", ")} — ` +
      "выполните `git add packs`"
  );
}

console.log("Сборка паков уплотняет базу");
{
  // Уплотнение переносит свежие записи из журнала в `.ldb`. Без него данные
  // остаются в файле, который легко потерять — и один раз уже потеряли.
  const build = fs.readFileSync(
    path.join(MODULE_ROOT, "tools", "build-packs.js"),
    "utf-8"
  );
  expect(
    build.includes("compactRange"),
    "build-packs.js больше не уплотняет базу — свежие записи останутся в журнале"
  );

  for (const pack of fs.readdirSync(PACKS)) {
    const dir = path.join(PACKS, pack);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/^\d+\.log$/.test(file)) continue;
      const size = fs.statSync(path.join(dir, file)).size;
      expect(
        size === 0,
        `${pack}/${file}: в журнале ${size} байт — ` +
          "пересоберите паки, иначе эти записи могут не уехать в релиз"
      );
    }
  }
}

console.log("Сборщик архива не молчит о потерях");
{
  const release = fs.readFileSync(
    path.join(MODULE_ROOT, "tools", "make_release.py"),
    "utf-8"
  );
  expect(
    !release.includes("if not path.is_file():\n                continue"),
    "make_release.py снова молча пропускает отсутствующие файлы"
  );
  expect(
    release.includes('"ls-files", "-z"'),
    "make_release.py читает список файлов без -z — имена с не-ASCII " +
      "символами git экранирует, и такие файлы выпадут из архива"
  );
  expect(
    release.includes("check_packs"),
    "make_release.py больше не сверяет паки в архиве с паками на диске"
  );
}

console.log("Эффекты предметов актёров вынесены отдельно");
{
  // У актёра эффекты его предметов лежат на третьем уровне ключа —
  // `!actors.items.effects!`. Проверено на рабочем чужом паке мобов. Оставленные
  // внутри записи предмета, они молча пропадают: костюм приезжает, имплант на
  // месте, а его эффект не действует.
  const dir = path.join(PACKS, "addenda-actors");
  let ClassicLevel = null;
  for (const candidate of [
    "C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json",
    "/opt/foundryvtt/resources/app/package.json",
  ]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      ({ ClassicLevel } = createRequire(pathToFileURL(candidate))("classic-level"));
      break;
    } catch (error) {
      // Ищем дальше.
    }
  }

  if (!ClassicLevel || !fs.existsSync(dir)) {
    console.log("  пропущено: пак не собран или classic-level недоступен");
  } else {
    const db = new ClassicLevel(dir, { valueEncoding: "json" });
    let opened = false;
    const inline = [];
    let separate = 0;
    try {
      await db.open();
      opened = true;
      for await (const [key, value] of db.iterator()) {
        if (key.startsWith("!actors.items.effects!")) {
          separate += 1;
          expect(
            typeof value?.name === "string" && value.name.length > 0,
            `эффект ${key}: нет имени — Foundry откажется его создавать`
          );
        } else if (key.startsWith("!actors.items!")) {
          for (const effect of value.effects ?? []) {
            if (typeof effect !== "string") {
              inline.push(`${value.name}: ${JSON.stringify(effect).slice(0, 60)}`);
            }
          }
        }
      }
    } catch (error) {
      // База занята — скажем ниже.
    } finally {
      await db.close().catch(() => {});
    }

    if (!opened) {
      console.log("  пропущено: пак заблокирован (запущен Foundry?)");
    } else {
      expect(
        inline.length === 0,
        `эффекты остались внутри записи предмета: ${inline.join("; ")}`
      );
      expect(separate > 0, "в паке актёров нет ни одного эффекта предмета — их потеряли");
      console.log(`  эффектов предметов вынесено: ${separate}`);
    }
  }
}

console.log("Эффекты доезжают до собранных паков");
{
  // Проверка появилась после боевой ошибки, точь-в-точь повторившей прошлую с
  // актёрами: сборщик клал эффекты внутрь записи предмета, а Foundry ждёт их
  // отдельными ключами `!items.effects!`. Предмет импортировался нормально,
  // эффект пропадал — молча, и на листе просто ничего не менялось. В
  // исходниках при этом всё было на месте, поэтому validate-items ошибки не
  // видел: сверять надо именно собранный пак.
  const table = JSON.parse(
    fs.readFileSync(path.join(MODULE_ROOT, "docs", "stat-effects.json"), "utf-8")
  ).items;
  const wanted = new Set(Object.keys(table));

  const foundryCandidates = [
    "C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json",
    "/opt/foundryvtt/resources/app/package.json",
  ];
  let ClassicLevel = null;
  for (const candidate of foundryCandidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      ({ ClassicLevel } = createRequire(pathToFileURL(candidate))("classic-level"));
      break;
    } catch (error) {
      // Ищем дальше.
    }
  }

  if (!ClassicLevel) {
    console.log("  пропущено: classic-level недоступен");
  } else {
    const found = new Map();
    let opened = 0;
    for (const pack of fs.readdirSync(PACKS)) {
      const dir = path.join(PACKS, pack);
      if (!fs.statSync(dir).isDirectory()) continue;
      const db = new ClassicLevel(dir, { valueEncoding: "json" });
      try {
        // Пока Foundry запущен, база заблокирована им. Это не повод падать.
        await db.open();
        opened += 1;
        const byId = new Map();
        const effects = [];
        for await (const [key, value] of db.iterator()) {
          if (key.startsWith("!items.effects!")) effects.push([key, value]);
          else if (key.startsWith("!items!")) byId.set(value._id, value);
        }
        for (const [key, effect] of effects) {
          const owner = key.split("!")[2].split(".")[0];
          const item = byId.get(owner);
          if (!item || !wanted.has(item.name)) continue;
          if (!found.has(item.name)) found.set(item.name, { item, changes: [] });
          found.get(item.name).changes.push(...(effect.changes ?? []));
        }
      } catch (error) {
        // Заблокированную базу пропускаем молча — ниже об этом скажем.
      } finally {
        await db.close().catch(() => {});
      }
    }

    if (!opened) {
      console.log("  пропущено: паки заблокированы (запущен Foundry?)");
    } else {
      for (const [name, expected] of Object.entries(table)) {
        const got = found.get(name);
        if (!got) {
          expect(
            false,
            `«${name}»: в собранном паке нет эффекта — ` +
              "он лежит внутри записи предмета вместо отдельного ключа"
          );
          continue;
        }
        expect(
          got.item.system?.usage === expected.usage,
          `«${name}»: в паке usage "${got.item.system?.usage}", а нужен "${expected.usage}"`
        );
        for (const want of expected.changes) {
          const change = got.changes.find((c) => c.key === want.key);
          expect(change !== undefined, `«${name}»: в паке нет ключа ${want.key}`);
          if (!change) continue;
          expect(
            String(change.value) === String(want.value) && change.mode === want.mode,
            `«${name}»: в паке ${want.key} = ${change.value} режимом ${change.mode}, ` +
              `а нужно ${want.value} режимом ${want.mode}`
          );
        }
      }
      console.log(`  сверено предметов: ${found.size} из ${wanted.size}`);
    }
  }
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures > 0 ? 1 : 0);
