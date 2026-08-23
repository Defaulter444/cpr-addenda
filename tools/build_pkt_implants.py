"""
Вкладывает импланты в корпуса ПКТ.

Комплект корпуса — это не список в описании, а полтора десятка настоящих
имплантов, которые должны появиться у персонажа вместе с корпусом. Система это
умеет: если у предмета непустой `installedItems.list` и флаг `cprInstallTree`
с данными, при переносе на актёра она создаст всю вложенность сама
(`createInstalledItemsOnActor` в cpr-container.js).

Здесь этот флаг и собирается. Данные имплантов берутся из компендиумов
системы — так у них остаются верные цена, потеря человечности и слоты. Тем,
чего в системе нет (киберчереп, покрытия корпусов), модуль заводит собственные
предметы: без них комплект неполон.

Соответствие записей документа предметам системы описано в
`docs/implant-map.json`.

    python tools/build_pkt_implants.py
"""

import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

MODULE_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = MODULE_ROOT.parent.parent
SYSTEM_ROOT = DATA_ROOT / "systems" / "cyberpunk-red-core"

PKT = MODULE_ROOT / "docs" / "pkt.json"
IMPLANT_MAP = MODULE_ROOT / "docs" / "implant-map.json"
FRAMES_DIR = MODULE_ROOT / "sources" / "addenda-cyberware"

FOUNDRY_APP = os.environ.get(
    "FOUNDRY_APP", r"C:\Program Files\Foundry Virtual Tabletop"
)

# --- Чтение компендиумов системы --------------------------------------------


def read_pack(db_path):
    """Читает компендиум через копию, не трогая оригинал."""
    import subprocess

    script = f"""
const {{ ClassicLevel }} = require({json.dumps(str(Path(FOUNDRY_APP) / 'resources/app/node_modules/classic-level').replace(os.sep, '/'))});
const fs = require("fs"), path = require("path"), os = require("os");
(async () => {{
  const src = {json.dumps(str(db_path).replace(os.sep, '/'))};
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-imp-"));
  for (const f of fs.readdirSync(src)) if (f !== "LOCK")
    fs.copyFileSync(path.join(src, f), path.join(tmp, f));
  const db = new ClassicLevel(tmp, {{ valueEncoding: "json" }});
  const out = [];
  for await (const [, v] of db.iterator()) out.push(v);
  await db.close();
  fs.rmSync(tmp, {{ recursive: true, force: true }});
  process.stdout.write(JSON.stringify(out));
}})();
"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
        fh.write(script)
        temp = fh.name
    try:
        result = subprocess.run(
            ["node", temp], capture_output=True, text=True, encoding="utf-8"
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())
        return json.loads(result.stdout)
    finally:
        os.unlink(temp)


def load_translations():
    """
    Собирает русские названия и описания из каталогов Babele.

    Babele переводит компендиумы на лету, но предмет, попавший на лист
    персонажа, — это уже копия с английским именем. Комплект корпуса
    разворачивается именно в такие копии, поэтому перевод надо вложить
    в них заранее.
    """
    modules_dir = DATA_ROOT / "modules"
    translations = {}
    if not modules_dir.exists():
        return translations

    # Индекс модуля собран из всех компендиумов сразу и содержит русские
    # названия там, где отдельные каталоги Babele их не покрывают.
    index_path = MODULE_ROOT / "tools" / "index.json"
    if index_path.exists():
        for record in json.loads(index_path.read_text(encoding="utf-8")):
            if record.get("type") != "cyberware" or not record.get("nameRu"):
                continue
            translations.setdefault(
                record["name"],
                {
                    "name": record["nameRu"],
                    "description": record.get("descriptionRu") or "",
                },
            )

    for module in modules_dir.iterdir():
        babele = module / "babele" / "ru"
        if not babele.is_dir():
            continue
        for path in babele.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            for name, entry in (data.get("entries") or {}).items():
                if isinstance(entry, dict) and entry.get("name"):
                    translations.setdefault(name, entry)
    return translations


def load_system_cyberware():
    """Собирает всю кибернетику системы по английскому имени."""
    manifest = json.loads((SYSTEM_ROOT / "system.json").read_text(encoding="utf-8"))
    found = {}
    for pack in manifest["packs"]:
        if pack["type"] != "Item":
            continue
        path = SYSTEM_ROOT / pack["path"]
        if not path.exists():
            continue
        for doc in read_pack(path):
            if doc.get("type") == "cyberware" and doc.get("name") not in found:
                found[doc["name"]] = doc
    return found


# --- Разбор записей комплекта ------------------------------------------------

SPLIT_FIXES = {
    "Киберруки х4 Кибераудио": ["Киберруки х4", "Кибераудио"],
    "Подкожные Карманы х2 ТАп (увеличенные под оружие)": [
        "Подкожные Карманы х2",
        "ТАп (увеличенные под оружие)",
    ],
    "ТАп (установлен Аэрогиппо) Рука- Мультитул": [
        "ТАп (установлен Аэрогиппо)",
        "Рука-Мультитул",
    ],
    "Тюнинг вер. Модернизация Внутренней Гидравлики": [
        "Модернизация Внутренней Гидравлики",
    ],
}

SPELLING = {
    "Слабое Освещение/УК/ИФ": "Слабое освещение/ИК/УФ",
    "Слабое освещение/УФ/ИК": "Слабое освещение/ИК/УФ",
    "Слабое Освещение/ИК/УФ": "Слабое освещение/ИК/УФ",
    "Низкое освещение/ИК/УФ": "Слабое освещение/ИК/УФ",
    "Радар/Сонар": "Радар/ Сонар",
    "Усиленный слух": "Усиленный Слух",
    "Встроенный Агент": "Внутренний Агент",
    "РадарДетектор": "Детектор Радиации",
    "Рука- Мультитул": "Рука-Мультитул",
    "Рука Мультитул": "Рука-Мультитул",
    "Стопа- Трансформер": "Стопа-Трансформер",
    "Цепкие Подошвы": "Цепкая Подошва",
}

COUNT = re.compile(r"\s+[хx](\d+)\s*$", re.IGNORECASE)


def split_entry(text):
    if not text:
        return []
    text = re.sub(r'""([^"]+)""', r"«\1»", text)
    text = re.sub(r'"([^"]+)"', r"«\1»", text)
    return [p.strip(" .,") for p in re.split(r",(?![^(]*\))", text) if p.strip(" .,")]


def normalize(raw):
    """Возвращает пары «название, количество»."""
    result = []
    for part in SPLIT_FIXES.get(raw.strip(), [raw.strip()]):
        count = 1
        match = COUNT.search(part)
        if match:
            count = int(match.group(1))
            part = COUNT.sub("", part)
        part = re.sub(r"\s+", " ", part).strip(" .,")
        part = SPELLING.get(part, part)
        if part:
            result.append((part, count))
    return result


# --- Сборка предметов --------------------------------------------------------

def clean_name(raw):
    """
    Название корпуса — теми же правилами, что и при его создании.

    Кавычки в документе идут вперемешку, поэтому чередуем: первая
    открывающая, следующая закрывающая.
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


_id_counter = 0


def next_id(prefix="Imp"):
    """Уникальный идентификатор для каждого экземпляра импланта."""
    global _id_counter
    _id_counter += 1
    return (f"cprAdd{prefix}{_id_counter:05d}" + "0" * 16)[:16]


def own_implant(name, spec, doc_id):
    """Имплант, которого нет в системе: заводим свой."""
    return {
        "_id": doc_id,
        "name": name,
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
            "description": {"value": f"<p>{spec['description']}</p>"},
            "dvTable": "",
            "favorite": False,
            "fireModes": {"autoFire": 0, "suppressiveFire": False},
            # Ноль и в цене, и в человечности: и то и другое уже учтено
            # в стоимости самого корпуса, о чём сказано в документе.
            "humanityLoss": {"roll": "1d6", "static": 0},
            "ignoreArmorPercent": 0,
            "ignoreBelowSP": 0,
            "installLocation": "hospital",
            "installedItems": {
                "allowed": bool(spec.get("slots")),
                "allowedTypes": ["itemUpgrade", "cyberware"],
                "list": [],
                "slots": spec.get("slots", 0),
                "usedSlots": 0,
            },
            "isElectronic": True,
            "isFoundational": bool(spec.get("foundational")),
            "isRanged": False,
            "isWeapon": False,
            "magazine": {"ammoData": None, "max": 0, "value": 0},
            "price": {"market": 0},
            "providesHardening": False,
            "revealed": True,
            "rof": 1,
            "size": 1,
            "source": {"book": "DataPool", "page": 0},
            "type": spec["type"],
            "unarmedAutomaticCalculation": True,
            "usage": "installed",
            "usesType": "magazine",
            "weaponSkill": "",
            "weaponType": "",
        },
    }


def instance_from_system(doc, doc_id, translations):
    """Копия импланта системы под своим идентификатором, с русским названием."""
    copy = json.loads(json.dumps(doc))
    copy["_id"] = doc_id

    translated = translations.get(doc["name"])
    if translated:
        copy["name"] = translated["name"]
        if translated.get("description"):
            copy["system"]["description"]["value"] = translated["description"]
    copy.pop("_stats", None)
    copy["folder"] = None
    copy["sort"] = 0
    # Вложенность внутри импланта не переносим: комплект описан плоским списком.
    copy["system"]["installedItems"]["list"] = []
    copy["system"]["installedItems"]["usedSlots"] = 0
    copy.setdefault("flags", {}).pop("cprInstallTree", None)
    return copy


def free_slots(host):
    used = sum(c["system"].get("size", 1) for c in host.get("_children", []))
    return host["system"]["installedItems"]["slots"] - used


def arrange(tree, frame_type):
    """
    Раскладывает комплект по фундаментам.

    По правилам опциональная кибернетика ставится не в тело, а в фундамент
    своего типа: подсветка — в киберглаз, радио — в набор кибераудио, деки и
    выкидное оружие — в киберруку. Система придерживается того же: при ручной
    установке `installCyberware` ищет фундамент с совпадающим `system.type`.
    Значит и комплект корпуса должен приезжать собранным так же, иначе игрок
    получит два десятка имплантов, сваленных в корпус, — снять и переставить
    их потом система уже не даст.

    Возвращает верхний уровень: сами фундаменты и то, что несёт корпус.
    Опции складываются в поле `_children` своего фундамента.
    """
    foundations = [i for i in tree if i["system"].get("isFoundational")]
    by_type = {}
    for item in foundations:
        by_type.setdefault(item["system"]["type"], []).append(item)

    top = []
    nested = 0
    widened = []

    for item in tree:
        data = item["system"]
        # Фундаменты и то, что того же типа, что сам корпус (покрытия,
        # эндоскелеты), остаются на верхнем уровне: их носитель — корпус.
        if data.get("isFoundational") or data["type"] == frame_type:
            top.append(item)
            continue

        hosts = by_type.get(data["type"])
        if not hosts:
            # Внутренняя, внешняя и фэшнверная кибернетика фундамента в
            # комплекте не имеет — её тоже несёт корпус.
            top.append(item)
            continue

        size = data.get("size", 1)
        host = next((h for h in hosts if free_slots(h) >= size), None)
        if host is None:
            # Комплект задан документом: раз производитель уместил столько
            # опций, значит фундамент у него расширенный.
            host = max(hosts, key=free_slots)
            host["system"]["installedItems"]["slots"] += size - free_slots(host)
            widened.append(host["name"])

        host.setdefault("_children", []).append(item)
        nested += 1

    return top, nested, widened


def close_host(host):
    """Переносит вложенные опции фундамента в его флаг и список."""
    children = host.pop("_children", [])
    if not children:
        return host
    host["flags"] = dict(host.get("flags") or {})
    host["flags"]["cprInstallTree"] = children
    installed = host["system"]["installedItems"]
    installed["allowed"] = True
    installed["list"] = [c["_id"] for c in children]
    installed["usedSlots"] = sum(c["system"].get("size", 1) for c in children)
    return host


def main():
    frames = json.loads(PKT.read_text(encoding="utf-8"))
    mapping = json.loads(IMPLANT_MAP.read_text(encoding="utf-8"))
    system = load_system_cyberware()
    translations = load_translations()

    print(f"Кибернетики в системе: {len(system)}")
    print(f"Переводов из Babele: {len(translations)}")

    own_specs = mapping["own"]
    name_map = mapping["map"]

    # Собственные импланты кладём и отдельными предметами: их должно быть
    # видно в компендиуме, а не только внутри корпусов.
    own_items = {}
    for index, (name, spec) in enumerate(sorted(own_specs.items()), start=1):
        own_items[name] = own_implant(name, spec, (f"cprAddOwn{index:04d}" + "0" * 16)[:16])

    slug_re = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }

    def slug(text):
        out = [slug_re.get(ch, ch if ch.isalnum() else "-") for ch in text.lower()]
        return re.sub(r"-+", "-", "".join(out)).strip("-")[:60]

    for name, item in own_items.items():
        path = FRAMES_DIR / f"{slug(name)}.json"
        path.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")

    # Раскладываем комплекты по корпусам.
    unknown = set()
    report = []
    widened_total = []

    # Файл корпуса ищем по имени, приведённому теми же правилами, что и при
    # его создании: сравнивать сами названия ненадёжно, в них кавычки и
    # уточнения вроде «ИЗМ. ВОЕН. ПЛАТФОРМА».
    frame_files = {}
    for candidate in FRAMES_DIR.glob("*.json"):
        doc = json.loads(candidate.read_text(encoding="utf-8"))
        if doc["system"].get("type") == "borgware" and doc["_id"].startswith("cprAddPkt"):
            frame_files[doc["name"]] = candidate

    for entry in frames:
        frame_name = clean_name(entry["name"])
        frame_file = frame_files.get(frame_name)
        if not frame_file:
            print(f"  !! не найден файл корпуса «{frame_name}»")
            continue

        frame = json.loads(frame_file.read_text(encoding="utf-8"))

        tree = []
        for field in ("implantsFree", "implantsCost"):
            for raw in split_entry(entry.get(field)):
                for name, count in normalize(raw):
                    target = name_map.get(name, "__unmapped__")
                    if target == "__unmapped__":
                        unknown.add(name)
                        continue
                    for _ in range(count):
                        doc_id = next_id()
                        if target is None:
                            tree.append(
                                json.loads(json.dumps(own_items[name]))
                                | {"_id": doc_id}
                            )
                        else:
                            source = system.get(target)
                            if not source:
                                unknown.add(f"{name} -> {target}")
                                continue
                            tree.append(
                                instance_from_system(source, doc_id, translations)
                            )

        top, nested, widened = arrange(tree, frame["system"]["type"])
        top = [close_host(item) for item in top]
        widened_total.extend(widened)

        frame["flags"]["cprInstallTree"] = top
        frame["system"]["installedItems"]["list"] = [i["_id"] for i in top]
        # Слотов должно хватать на весь верхний уровень: система считает
        # занятые места по размеру каждого импланта, а фундаменты, у которых
        # размер нулевой, мест не занимают вовсе.
        used = sum(i["system"].get("size", 1) for i in top)
        frame["system"]["installedItems"]["slots"] = max(used, 1)
        # Разворачивая комплект, система переписывает только список: занятые
        # места она пересчитывает лишь при снятии импланта. Поэтому счётчик
        # проставляем сами, иначе корпус приедет с пустой шкалой слотов и в
        # него можно будет доставить ещё столько же.
        frame["system"]["installedItems"]["usedSlots"] = used

        frame_file.write_text(
            json.dumps(frame, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        report.append((frame["name"], len(tree), len(top), nested))

    print(f"\nКорпусов собрано: {len(report)}")
    for name, count, top_count, nested in sorted(report):
        print(
            f"  {name[:38]:40} имплантов {count:3}  "
            f"в корпусе {top_count:3}  в фундаментах {nested:3}"
        )

    print(f"\nСобственных имплантов заведено: {len(own_items)}")
    if unknown:
        print(f"\nНе сопоставлено ({len(unknown)}):")
        for name in sorted(unknown):
            print(f"  {name}")


main()
