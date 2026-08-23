/**
 * Сопоставление позиций по текстам описаний.
 *
 * Сверка по названиям ловит далеко не всё: фанатский перевод и перевод
 * компендиума расходятся почти всегда. «Увеличенный Магазин» — это
 * Extended Magazine, «Коннектор Смартлинк» — Smartgun Link, «Чехол для
 * Одежды „Корпорат Дживс“» — Jeeves Executive Garment Bag. Ни одну из этих
 * пар сравнение названий не найдёт.
 *
 * Зато описания у одного и того же предмета совпадают по существу: те же
 * редкие слова, те же цифры, те же названия брендов. Здесь считается вес
 * пересечения — редкое общее слово стоит дорого, частое почти ничего.
 *
 *   node tools/match-descriptions.js материал.json
 *
 * Материал — JSON-массив объектов {name, description, price}.
 */

const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.resolve(__dirname, "index.json");

// Служебные слова, которые есть почти в каждом описании и потому ничего
// не говорят о совпадении.
const STOP = new Set([
  "который", "которая", "которое", "которые", "этого", "этому", "этот",
  "эта", "это", "весь", "вся", "всё", "все", "может", "можно", "если",
  "когда", "также", "чтобы", "любой", "любое", "любая", "быть", "было",
  "была", "были", "будет", "более", "менее", "очень", "после", "перед",
  "через", "вместо", "кроме", "только", "такой", "такая", "такое", "нужно",
  "один", "одна", "одно", "два", "две", "при", "для", "она", "они", "оно",
  "себя", "своё", "свой", "своя", "тебя", "тебе", "твой", "вами", "вас",
  "пользователь", "предмет", "оружие", "время", "действие", "проверка",
  "персонаж", "игрок", "рефери", "стоимость", "цена",
]);

/**
 * Разбивает текст на значимые слова.
 *
 * @param {String} text
 * @returns {Array<String>}
 */
function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9®]+/i)
    .filter((w) => w.length >= 5 && !STOP.has(w));
}

function main() {
  const materialPath = process.argv[2];
  if (!materialPath) {
    console.error("Укажите JSON материала: node tools/match-descriptions.js материал.json");
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  const material = JSON.parse(fs.readFileSync(materialPath, "utf-8"));

  // Сколько записей содержит каждое слово — редкие слова весят больше.
  const documentFrequency = new Map();
  const indexTokens = index.map((rec) => {
    const tokens = new Set([
      ...tokenize(rec.descriptionRu),
      ...tokenize(rec.nameRu),
    ]);
    for (const token of tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
    return tokens;
  });

  const total = index.length;
  const weight = (token) =>
    Math.log(total / (1 + (documentFrequency.get(token) ?? 0)));

  const results = material.map((entry) => {
    const tokens = new Set([
      ...tokenize(entry.description),
      ...tokenize(entry.name),
    ]);
    if (!tokens.size) {
      return { name: entry.name, candidates: [] };
    }

    const own = [...tokens].reduce((sum, t) => sum + weight(t), 0) || 1;

    const scored = index
      .map((rec, i) => {
        let score = 0;
        const shared = [];
        for (const token of tokens) {
          if (indexTokens[i].has(token)) {
            score += weight(token);
            shared.push(token);
          }
        }
        return { rec, score: score / own, shared };
      })
      .filter((c) => c.score > 0.12 && c.shared.length >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      name: entry.name,
      candidates: scored.map((c) => ({
        name: c.rec.name,
        nameRu: c.rec.nameRu,
        type: c.rec.type,
        pack: c.rec.packLabel,
        score: Number(c.score.toFixed(2)),
        shared: c.shared.slice(0, 6),
      })),
    };
  });

  for (const r of results) {
    if (!r.candidates.length) {
      console.log(`\n${r.name}\n    — ничего похожего`);
      continue;
    }
    console.log(`\n${r.name}`);
    for (const c of r.candidates) {
      console.log(
        `    ${String(c.score).padStart(4)} | ${c.name} / ${c.nameRu ?? "—"}` +
          ` — ${c.type} [${c.pack}]`
      );
      console.log(`         общие слова: ${c.shared.join(", ")}`);
    }
  }

  const out = materialPath.replace(/\.json$/, "") + "-matched.json";
  fs.writeFileSync(out, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\nПодробности: ${out}`);
}

main();
