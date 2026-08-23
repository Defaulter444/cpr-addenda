"""
Сборка корпусов ПКТ в исходники модуля.

ПКТ — полная кибернетическая трансформация: корпус, который заменяет тело
целиком. В системе для такого есть готовый вид кибернетики — `borgware`,
с местом установки «госпиталь», потерей человечности и слотами под опции.
Поэтому корпуса ложатся штатно, без обходных путей.

Потеря человечности в документе записана двумя числами сразу: фиксированным
(«52») и формулой броска («[2d6/2 round up] + 15d6»). Система хранит ровно эту
пару и при установке спрашивает, каким способом считать, — значит переносим
оба значения как есть, только формулу приводим к синтаксису Foundry.

    python tools/import_pkt.py
"""

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

MODULE_ROOT = Path(__file__).resolve().parent.parent
DATA = MODULE_ROOT / "docs" / "pkt.json"
OUT_DIR = MODULE_ROOT / "sources" / "addenda-cyberware"

SOURCE_BOOK = "DataPool"
PARAGRAPH = "\n\n"


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


def make_id(index):
    return (f"cprAddPkt{index:04d}" + "0" * 16)[:16]


def clean_name(raw):
    """
    Приводит название к читаемому виду.

    В документе кавычки вперемешку: где-то прямые с обеих сторон, где-то
    закрывающая типографская. Поэтому идём по строке и чередуем — первая
    кавычка открывающая, следующая закрывающая, и так далее.
    """
    result = []
    opened = False
    for char in raw.strip():
        if char in '"“”«»':
            result.append("»" if opened else "«")
            opened = not opened
        else:
            result.append(char)
    name = "".join(result)
    name = re.sub(r"«\s+", "«", name)
    name = re.sub(r"\s+»", "»", name)
    return re.sub(r"\s+", " ", name).strip()


def price_of(text):
    """Число из «17,300eb (Очень Дорогое)» или «16,800 (Очень Дорогое)»."""
    match = re.search(r"([\d][\d,\s]*)", text or "")
    if not match:
        return 0
    digits = re.sub(r"[^\d]", "", match.group(1))
    return int(digits) if digits else 0


# Среднее значение записи «[XdY/2 округлить вверх]» из документа.
# Система не понимает функций в формуле броска (её разбор ищет один XdY,
# а остальное пропускает через Number()), поэтому эту часть заменяем
# постоянной прибавкой, равной среднему.
HALF_DIE_AVERAGE = {"1d6": 2, "2d6": 4, "3d6": 5}


def humanity_of(text):
    """
    Разбирает «52 ([2d6/2 round up] + 15d6)» на фиксированное значение и формулу.

    Формула приводится к виду «XdY+K» — единственному, который система
    разбирает верно. Скобочная половина броска становится прибавкой K, равной
    её среднему: точная запись всё равно сохранена в описании предмета.
    """
    static_match = re.match(r"\s*(\d+)", text or "")
    static = int(static_match.group(1)) if static_match else 0

    formula_match = re.search(r"\((.+)\)\s*$", (text or "").strip())
    raw = formula_match.group(1).strip() if formula_match else ""

    bonus = 0
    half = re.search(
        r"\[\s*(\d+d\d+)\s*/\s*2\s*(?:round up|округлить вверх)\s*\]",
        raw,
        flags=re.IGNORECASE,
    )
    if half:
        bonus = HALF_DIE_AVERAGE.get(half.group(1), 3)
        raw = raw[: half.start()] + raw[half.end():]

    # Основной кубик — самый крупный XdY из оставшегося.
    dice = re.findall(r"(\d+)d(\d+)", raw)
    if not dice:
        return static, "1d6"
    count, faces = max(dice, key=lambda d: int(d[0]))

    # Пробелы недопустимы: разбор системы режет формулу по ним и ломается
    # на пустых кусках.
    formula = f"{count}d{faces}"
    if bonus:
        formula += f"+{bonus}"
    return static, formula


# Кавычки в выгрузке идут вперемешку: удвоенные прямые, одинарные прямые и
# типографские. Приводим всё к «ёлочкам».
QUOTED = "«\1»"


def tidy_quotes(text):
    """Заменяет удвоенные и прямые кавычки документа на типографские."""
    text = re.sub(r'""([^"]+)""', QUOTED, text or "")
    text = re.sub(r'"([^"]+)"', QUOTED, text)
    return text.replace("”", "»").replace("“", "«")


def split_implants(text):
    """Список имплантов из строки таблицы."""
    if not text:
        return []
    parts = re.split(r",(?![^(]*\))", tidy_quotes(text))
    return [p.strip(" .,") for p in parts if p.strip(" .,")]


def build(index, entry):
    static, formula = humanity_of(entry["humanity"])
    free = split_implants(entry.get("implantsFree"))
    paid = split_implants(entry.get("implantsCost"))

    description = [tidy_quotes(entry.get("description", "")).strip()]
    if free:
        description.append(
            "<strong>Входит в комплект (без потери человечности):</strong> "
            + ", ".join(free)
            + "."
        )
    if paid:
        description.append(
            "<strong>Входит в комплект (с потерей человечности):</strong> "
            + ", ".join(paid)
            + "."
        )
    if entry.get("extra"):
        description.append(f"<strong>Установка:</strong> {entry['extra']}.")
    description.append(
        f"<strong>Потеря человечности за комплект:</strong> {entry['humanity']}."
    )

    return {
        "_id": make_id(index),
        "name": clean_name(entry["name"]),
        "type": "cyberware",
        "img": "modules/cpr-addenda/assets/icons/borgware.svg",
        "folder": None,
        "sort": 0,
        "effects": [],
        "flags": {},
        "system": {
            "ammoVariety": [],
            "attackmod": 0,
            "brand": "",
            "canIgnoreArmor": False,
            "concealable": {"concealable": False, "isConcealed": False},
            "core": False,
            "critFailEffect": "jammed",
            "damage": "1d6",
            "description": {
                "value": "".join(f"<p>{p}</p>" for p in description if p)
            },
            "dvTable": "",
            "favorite": False,
            "fireModes": {"autoFire": 0, "suppressiveFire": False},
            "humanityLoss": {"roll": formula, "static": static},
            "ignoreArmorPercent": 0,
            # Поле схемы "attackable": корпус не оружие и его не использует,
            # но система ждёт его у всякой кибернетики.
            "ignoreBelowSP": 0,
            # Корпус меняет тело целиком — ставится только в госпитале,
            # и документ отдельно оговаривает необходимость биосистемы.
            "installLocation": "hospital",
            "installedItems": {
                "allowed": True,
                "allowedTypes": ["itemUpgrade", "cyberware"],
                "list": [],
                # Слотов ровно столько, сколько опций входит в комплект:
                # иначе их некуда будет поставить после установки корпуса.
                "slots": max(len(paid), 3),
                "usedSlots": 0,
            },
            "isElectronic": True,
            "isFoundational": True,
            "isRanged": False,
            "isWeapon": False,
            "magazine": {"ammoData": None, "max": 0, "value": 0},
            "price": {"market": price_of(entry["price"])},
            "providesHardening": False,
            "revealed": True,
            "rof": 1,
            "size": 0,
            "source": {"book": SOURCE_BOOK, "page": 0},
            "type": "borgware",
            "unarmedAutomaticCalculation": True,
            "usage": "installed",
            "usesType": "magazine",
            "weaponSkill": "",
            "weaponType": "",
        },
    }


def main():
    entries = json.loads(DATA.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for index, entry in enumerate(entries, start=1):
        doc = build(index, entry)
        path = OUT_DIR / f"{slug(doc['name'])}.json"
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Корпусов ПКТ собрано: {len(entries)}\n")
    for index, entry in enumerate(entries, start=1):
        doc = build(index, entry)
        s = doc["system"]
        print(
            f"  {doc['name'][:40]:40} {s['price']['market']:>6}eb  "
            f"ПЧ {s['humanityLoss']['static']:>3} / {s['humanityLoss']['roll']:<22} "
            f"слотов {s['installedItems']['slots']}"
        )
    print(f"\nИсходники: {OUT_DIR}")


main()
