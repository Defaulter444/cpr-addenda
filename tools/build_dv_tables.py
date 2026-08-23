"""
Сборка таблиц СЛ по дистанции в исходники модуля.

Система берёт таблицы дальности не откуда попало, а из компендиума, указанного
в её настройке `dvRollTableCompendium`. Значит модуль может отдать свой полный
набор — с теми значениями, что записаны в документе, а не с системными:
у системного «Пистолета» на 101–200 метрах стоит 30, тогда как в документе 35.

Таблицы в Foundry — это документы RollTable: сама таблица и её строки,
которые хранятся отдельными записями. Здесь из плоских списков значений
собираются и те, и другие.

    python tools/build_dv_tables.py
"""

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

MODULE_ROOT = Path(__file__).resolve().parent.parent
DATA = MODULE_ROOT / "docs" / "dv-tables.json"
SOURCES = MODULE_ROOT / "sources" / "addenda-dv-tables"

# Дистанционные полосы расширенной таблицы, в метрах.
BANDS_SINGLE = [(0, 6), (7, 12), (13, 25), (26, 50), (51, 100),
                (101, 200), (201, 400), (401, 800)]
BANDS_AUTOFIRE = BANDS_SINGLE[:5]

ICON = "systems/cyberpunk-red-core/icons/compendium/default/Default_DV_Table.svg"

# Текст, которым система показывает недостижимую дистанцию.
OUT_OF_RANGE = "N/A"


def make_id(prefix, n, seq=0):
    """Идентификатор документа: ровно 16 буквенно-цифровых символов."""
    base = f"cprAdd{prefix}{n:03d}{seq:03d}"
    return (base + "0" * 16)[:16]


def slug(text):
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
    out = [translit.get(ch, ch if ch.isalnum() else "-") for ch in text.lower()]
    return re.sub(r"-+", "-", "".join(out)).strip("-")[:60]


def build_table(index, name, values, bands):
    """Собирает документ таблицы вместе со строками дистанций."""
    if len(values) != len(bands):
        raise ValueError(
            f"«{name}»: значений {len(values)}, а полос дистанции {len(bands)}"
        )

    table_id = make_id("Dv", index)
    results = []
    for seq, ((low, high), value) in enumerate(zip(bands, values)):
        results.append({
            "_id": make_id("Dr", index, seq),
            "documentId": None,
            "drawn": False,
            "img": ICON,
            "range": [low, high],
            "text": OUT_OF_RANGE if value is None else str(value),
            "type": "text",
            "weight": 1,
            "flags": {},
        })

    return {
        "_id": table_id,
        "name": name,
        "description": "<p>Расширенная таблица СЛ по дистанции (Data Pool).</p>",
        "displayRoll": False,
        "formula": "",
        "img": ICON,
        "replacement": False,
        "results": results,
        "folder": None,
        "sort": 0,
        "flags": {},
    }


def check_name_collisions(names):
    """
    Ищет имена, вложенные одно в другое.

    Система подбирает автоогневую таблицу поиском вхождения имени базовой.
    Если одно имя окажется частью другого, оружию достанется чужая таблица —
    молча и без единой ошибки в консоли.
    """
    problems = []
    for name in names:
        for other in names:
            if name != other and name in other:
                problems.append(f"«{name}» является частью «{other}»")
    return problems


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    SOURCES.mkdir(parents=True, exist_ok=True)

    for old in SOURCES.glob("*.json"):
        old.unlink()

    # Пересечения проверяем внутри каждого набора имён отдельно: русские
    # названия и системные живут параллельно и друг друга не ищут.
    collisions = (check_name_collisions(list(data["single"]))
                  + check_name_collisions(list(data["aliases"])))
    if collisions:
        print("Имена таблиц пересекаются:")
        for problem in collisions:
            print(f"  {problem}")
        sys.exit(1)

    index = 0
    sections = (
        ("single", BANDS_SINGLE),
        ("autofire", BANDS_AUTOFIRE),
        ("aliases", BANDS_SINGLE),
        ("aliases_autofire", BANDS_AUTOFIRE),
        ("aliases_ru", BANDS_SINGLE),
        ("aliases_ru_autofire", BANDS_AUTOFIRE),
    )
    for section, bands in sections:
        for name, values in data[section].items():
            index += 1
            table = build_table(index, name, values, bands)
            path = SOURCES / f"{slug(name)}.json"
            path.write_text(
                json.dumps(table, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    print(f"Таблиц собрано: {index}")
    print(f"  одиночный выстрел:  {len(data['single'])}")
    print(f"  автоогонь:          {len(data['autofire'])}")
    print(f"  имена системы:      {len(data['aliases']) + len(data['aliases_autofire'])}")
    print(f"  имена русификации:  {len(data['aliases_ru']) + len(data['aliases_ru_autofire'])}")
    print(f"\nИсходники: {SOURCES}")


main()
