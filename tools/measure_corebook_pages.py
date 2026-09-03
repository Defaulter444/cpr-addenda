# -*- coding: utf-8 -*-
"""Измеряет расхождение страниц между английским и русским изданием корбука.

Откуда берутся числа в `scripts/corebook-pages.js`.

Источник у предметов системы записан по английскому изданию: «Core, 341».
Русское издание переведено постранично, но каталог в нём длиннее, и ссылки
промахиваются. Насколько — здесь и считается.

Способ. У каждого предмета системы с источником «Core» есть английское название
и номер страницы. Русское название берётся из перевода `cyberpunk-red-ru`. По
тексту русского PDF ищется страница, где это название напечатано.

Считаются только ОДНОЗНАЧНЫЕ находки — те, где название встретилось ровно на
одной странице поблизости. Половина предметов каталога напечатана дважды: в
сводной таблице и в описании, и такой предмет указывает сразу на две страницы.
Отбросить его дешевле, чем гадать: однозначных хватает с запасом, а сдвиг всё
равно общий для целой страницы, и по ней голосует не один предмет, а десяток.

Сдвиг страницы — медиана по её однозначным предметам. Ни цепочек, ни
выравнивания: соседняя ошибка не должна тянуть за собой всё остальное.

    python tools/measure_corebook_pages.py

Печатает сдвиг по каждой странице и отрезки, на которые он разбивается. Числа
из последнего блока и лежат в `PAGE_SHIFTS`.
"""

import json
import os
import pickle
import re
import subprocess
import sys
import tempfile
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")

MODULE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.path.dirname(os.path.dirname(MODULE_ROOT))
SYSTEM_PACKS = os.path.join(DATA_ROOT, "systems", "cyberpunk-red-core", "packs")
BABELE = os.path.join(DATA_ROOT, "modules", "cyberpunk-red-ru", "babele", "ru")
BOOK = os.path.join(MODULE_ROOT, "pdfs", "cyberpunk-red-core-ru-v13.pdf")

# Дальше пятнадцати страниц совпадение — это однофамилец, а не наш предмет.
MAX_DRIFT = 15

# Короткие названия ловят пол-книги: «Нож» есть на каждой странице.
MIN_NAME = 7

READ_ITEMS = r"""
const {ClassicLevel} = require(process.argv[2]);
const fs = require("fs"), path = require("path");
(async () => {
  const base = process.argv[3], out = [];
  const dirs = [];
  for (const group of fs.readdirSync(base)) {
    const gp = path.join(base, group);
    if (!fs.statSync(gp).isDirectory()) continue;
    for (const sub of fs.readdirSync(gp)) {
      const sp = path.join(gp, sub);
      if (fs.statSync(sp).isDirectory() && fs.existsSync(path.join(sp, "CURRENT"))) dirs.push(sp);
    }
  }
  for (const dir of dirs) {
    let db;
    try { db = new ClassicLevel(dir, {valueEncoding: "json"}); await db.open(); } catch (e) { continue; }
    for await (const [key, value] of db.iterator()) {
      if (!key.startsWith("!items!")) continue;
      const source = value.system?.source;
      if (source?.book === "Core" && source.page) out.push({name: value.name, page: Number(source.page)});
    }
    await db.close();
  }
  fs.writeFileSync(process.argv[4], JSON.stringify(out));
})();
"""


def classic_level():
    """Путь к classic-level из поставки Foundry — своего у нас нет."""
    root = r"C:\Program Files\Foundry Virtual Tabletop\resources\app\node_modules\classic-level"
    if not os.path.isdir(root):
        sys.exit("не нашёл classic-level из поставки Foundry: " + root)
    return root.replace("\\", "/")


def read_items(tmp):
    """Предметы системы с источником «Core»."""
    script = os.path.join(tmp, "read-items.js")
    result = os.path.join(tmp, "items.json")
    with open(script, "w", encoding="utf-8") as handle:
        handle.write(READ_ITEMS)
    subprocess.run(
        ["node", script, classic_level(), SYSTEM_PACKS, result],
        check=True, capture_output=True,
    )
    with open(result, encoding="utf-8") as handle:
        return json.load(handle)


def read_names():
    """Английское название -> русское, из переводов Babele."""
    names = {}
    for entry in sorted(os.listdir(BABELE)):
        if not entry.endswith(".json"):
            continue
        with open(os.path.join(BABELE, entry), encoding="utf-8") as handle:
            entries = (json.load(handle).get("entries") or {})
        pairs = entries.items() if isinstance(entries, dict) else (
            (item.get("id"), item) for item in entries
        )
        for key, value in pairs:
            name = value.get("name") if isinstance(value, dict) else value
            if key and name:
                names[key] = name
    return names


def read_pages(tmp):
    """Текст каждой страницы русской книги. Разбор небыстрый — кешируем."""
    cache = os.path.join(tmp, "ru-pages.pkl")
    if os.path.exists(cache):
        with open(cache, "rb") as handle:
            return pickle.load(handle)

    from pypdf import PdfReader

    pages = [(page.extract_text() or "") for page in PdfReader(BOOK).pages]
    with open(cache, "wb") as handle:
        pickle.dump(pages, handle)
    return pages


def flatten(text):
    """Голые буквы: в PDF слова рвутся пробелами и мягкими переносами."""
    return re.sub(r"[^0-9a-zа-яё]+", "", text.lower().replace("ё", "е"))


def measure(by_page, names, flat):
    """Сдвиг каждой английской страницы — медиана по однозначным находкам."""
    measured = {}
    for page, english_names in sorted(by_page.items()):
        offsets = []
        for english in sorted(english_names):
            russian = names.get(english)
            key = flatten(russian) if russian else ""
            if len(key) < MIN_NAME:
                continue
            hits = [i for i, text in enumerate(flat)
                    if abs(i - page) <= MAX_DRIFT and key in text]
            # Ровно одна страница — значит, спорить не о чем.
            if len(hits) == 1:
                offsets.append(hits[0] - page)
        if offsets:
            offsets.sort()
            measured[page] = (offsets[len(offsets) // 2], offsets)
    return measured


def spans(measured):
    """Склеивает соседние страницы с одинаковым сдвигом в отрезки."""
    result = []
    for page, (shift, _) in measured.items():
        if result and result[-1][2] == shift:
            result[-1][1] = page
        else:
            result.append([page, page, shift])
    return result


def main():
    tmp = os.path.join(tempfile.gettempdir(), "cpr-addenda-pages")
    os.makedirs(tmp, exist_ok=True)

    items = read_items(tmp)
    names = read_names()
    pages = read_pages(tmp)
    flat = [flatten(page) for page in pages]
    print("предметов из корбука: %d, страниц в книге: %d" % (len(items), len(pages)))

    by_page = defaultdict(set)
    for item in items:
        by_page[item["page"]].add(item["name"])

    measured = measure(by_page, names, flat)
    print("страниц с однозначными находками: %d из %d" % (len(measured), len(by_page)))
    print("")
    print("англ. стр. | однозначных | сдвиг | разброс")
    for page, (shift, offsets) in measured.items():
        spread = "" if offsets[0] == offsets[-1] else "   %+d…%+d" % (offsets[0], offsets[-1])
        print("  %3d      | %3d         | %+d%s" % (page, len(offsets), shift, spread))

    print("")
    print("отрезки постоянного сдвига:")
    for first, last, shift in spans(measured):
        if shift:
            print("  { from: %d, to: %d, shift: %d }," % (first, last, shift))


if __name__ == "__main__":
    main()
