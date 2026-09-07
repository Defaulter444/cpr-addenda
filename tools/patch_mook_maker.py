# -*- coding: utf-8 -*-
"""Правит Pneuma Mook Maker так, чтобы он работал с русскими названиями.

ЗАЧЕМ. Модуль опознаёт навыки и оружие по НАЗВАНИЮ, а названия у нас русские.
Две поломки, обе тихие — ошибок в консоли нет, просто ничего не происходит:

1. `normalizeSkillKey` вырезала из названия всё, кроме латиницы и цифр:

       .replace(/[^a-z0-9]+/g, " ")

   Русское название после этого превращается в пустую строку, поэтому ВСЕ
   русские навыки сваливаются в один пустой ключ и не совпадают ни с чем.
   Классификация не работает: боевой показатель не считается, «довести до»
   ничего не меняет. В мире мастера так ведут себя «Драка», «Боевые искусства»,
   «Физподготовка», «Бой» и ещё два десятка навыков.

2. `isNaturalWeapon` искала в названии слова «unarmed» и «martial arts», чтобы
   не предлагать безоружный бой как оружие. По-русски это «Безоружная атака» и
   «Боевые искусства», и проверка промахивалась.

ЧТО ДЕЛАЕМ.
1. Оставляем в ключе и кириллицу. Ключ по-прежнему нечувствителен к регистру и
   знакам препинания, просто теперь не теряет русские буквы.
2. Дополняем таблицу разбивки русскими названиями — из перевода самой системы
   (`CPR.global.itemType.skill.*`), а не придуманными. Категории те же, что у
   английских: это один и тот же навык, только подписан по-другому.
3. Природное оружие опознаём по `system.weaponType` (`unarmed`, `martialArts`) —
   он не зависит от языка вовсе. Проверка по названию остаётся запасной.

ПОЧЕМУ ПРАВКА ВНЕШНЯЯ. Модуль чужой, и обновление его перезапишет. Скрипт можно
запустить снова — он идемпотентен и скажет, если уже применён.

    python tools/patch_mook_maker.py           # применить
    python tools/patch_mook_maker.py --check   # только проверить
"""

import io
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

MODULE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULES = os.path.dirname(MODULE_ROOT)
MOOK = os.path.join(MODULES, "pneuma-mook-maker")
SYSTEM_RU = os.path.join(MODULES, "cyberpunk-red-ru", "lang", "ru.json")

MARK = "cpr-addenda: русские названия"

# Названия, которые не выводятся из английских механически: в них косые черты
# и амперсанды, и система называет их по-своему.
ODD_KEYS = {
    "Conceal/Reveal Object": "concealOrRevealObject",
    "Electronics/Security Tech": "electronicsAndSecurityTech",
    "Local Expert (Your Home)": "localExpert",
    "Paint/Draw/Sculpt": "paintOrDrawOrSculpt",
    "Photography/Film": "photographyAndFilm",
    "Resist Torture/Drugs": "resistTortureOrDrugs",
    "Wardrobe & Style": "wardrobeAndStyle",
}


def camel(name):
    parts = [p for p in re.split(r"[^A-Za-z0-9]+", name) if p]
    if not parts:
        return ""
    return parts[0][0].lower() + parts[0][1:] + "".join(p[0].upper() + p[1:] for p in parts[1:])


def russian_skill_names():
    """Английское название навыка -> русское, из перевода системы."""
    if not os.path.isfile(SYSTEM_RU):
        sys.exit("не нашёл русский перевод системы: " + SYSTEM_RU)
    lang = json.load(io.open(SYSTEM_RU, encoding="utf-8"))
    return {
        key.rsplit(".", 1)[1]: value
        for key, value in lang.items()
        if key.startswith("CPR.global.itemType.skill.") and not key.endswith("ToolTip")
    }


def read(name):
    path = os.path.join(MOOK, "scripts", name)
    if not os.path.isfile(path):
        sys.exit("нет файла модуля: " + path)
    return path, io.open(path, encoding="utf-8").read()


def patch_skills(check):
    path, text = read("skill-settings.js")
    if MARK in text:
        return False, "уже применена"

    old_norm = '.replace(/[^a-z0-9]+/g, " ")'
    if old_norm not in text:
        sys.exit("skill-settings.js: не нашёл нормализацию ключа — модуль изменился")

    # 1. Ключ больше не теряет кириллицу.
    text = text.replace(
        old_norm,
        '.replace(/[^a-z0-9\\u0430-\\u044f\\u0451]+/g, " ") // ' + MARK,
        1,
    )

    # 2. Русские названия в таблицу разбивки.
    start = text.index("DEFAULT_SKILL_CLASSIFICATIONS = {")
    end = text.index("};", start)
    block = text[start:end]
    pairs = [
        (a or b, int(c))
        for a, b, c in re.findall(r'(?:"([^"]+)"|(\w+)):\s*(\d)', block)
    ]
    if not pairs:
        sys.exit("skill-settings.js: таблица разбивки пуста")

    names = russian_skill_names()
    lines, missing = [], []
    for english, category in pairs:
        key = ODD_KEYS.get(english, camel(english))
        russian = names.get(key)
        if not russian:
            missing.append(f"{english} ({key})")
            continue
        lines.append(f'    "{russian}": {category},')

    if missing:
        sys.exit("нет русского названия для: " + ", ".join(missing))

    for family, category in FAMILIES.items():
        lines.append(f'    "{family}": {category},')

    addition = (
        "\n    // --- " + MARK + " ---\n"
        "    // Те же навыки, подписанные по-русски: модуль ищет их по названию,\n"
        "    // а на листе они называются так. Категории те же, что у английских.\n"
        + "\n".join(lines)
        + "\n"
    )
    text = text[:end] + addition + text[end:]

    if not check:
        io.open(path, "w", encoding="utf-8", newline="\n").write(text)
    return True, f"навыков добавлено: {len(lines)}"


FAMILIES = {
    # Семейства навыков. На листе они называются «Наука (Математика)», а
    # разбивка знает только семью. Категории — как у родственных навыков в
    # таблице модуля: языки и знание района там уже стоят третьими.
    "Наука": 3,
    "Science": 3,
    "Знание района": 3,
    "Local Expert": 3,
    "Игра на инструменте": 3,
    "Play Instrument": 3,
    "Язык": 3,
    "Language": 3,
    "Боевые искусства": 1,
    "Martial Arts": 1,
}


def patch_families(check):
    """Учит разбивку узнавать подвиды навыков.

    В Cyberpunk RED часть навыков берётся семьями: «Наука (Математика)»,
    «Знание района (Старый корпоративный центр)», «Язык (английский)». Модуль
    ищет разбивку по ПОЛНОМУ названию, поэтому конкретный подвид не совпадает ни
    с чем и остаётся неклассифицированным — а таких на листах шестёрок больше
    сотни.

    Запасной поиск: не нашли полное название — отбрасываем уточнение в скобках и
    ищем семью.
    """
    path, text = read("skills.js")
    if MARK in text:
        return False, "уже применена"

    old = "classifications[normalizeSkillKey(item.name)]"
    if text.count(old) != 2:
        sys.exit(f"skills.js: ожидал два обращения к разбивке, нашёл {text.count(old)}")

    helper = (
        "// " + MARK + "\n"
        "// Подвиды навыков («Наука (Математика)») ищем сперва целиком, а не найдя —\n"
        "// по семье: разбивка задаётся на семью, а не на каждый частный случай.\n"
        "function classify(classifications, name) {\n"
        "    const whole = classifications[normalizeSkillKey(name)];\n"
        "    if (whole !== undefined)\n"
        "        return whole;\n"
        "    const family = String(name).replace(/\\s*\\([^)]*\\)\\s*$/, \"\").trim();\n"
        "    if (!family || family === name)\n"
        "        return undefined;\n"
        "    return classifications[normalizeSkillKey(family)];\n"
        "}\n"
    )
    anchor = "export function getCurrentCombatNumber(actor) {"
    if anchor not in text:
        sys.exit("skills.js: не нашёл точку вставки — модуль изменился")
    text = text.replace(anchor, helper + anchor, 1)
    text = text.replace(old, "classify(classifications, item.name)")

    if not check:
        io.open(path, "w", encoding="utf-8", newline="\n").write(text)
    return True, "поиск по семье навыка"


def patch_weapons(check):
    path, text = read("weapons.js")
    if MARK in text:
        return False, "уже применена"

    old = """function isNaturalWeapon(item) {
    const name = (item.name ?? "").trim().toLocaleLowerCase();
    return name.includes("unarmed") || name.includes("martial arts");
}"""
    if old not in text:
        sys.exit("weapons.js: не нашёл проверку природного оружия — модуль изменился")

    new = """function isNaturalWeapon(item) {
    // """ + MARK + """
    // Тип оружия не зависит от языка, а название зависит: по-русски это
    // «Безоружная атака» и «Боевые искусства», и проверка по слову промахивалась.
    const kind = String(foundry.utils.getProperty(item, "system.weaponType") ?? "")
        .toLocaleLowerCase();
    if (kind === "unarmed" || kind === "martialarts")
        return true;
    const name = (item.name ?? "").trim().toLocaleLowerCase();
    return name.includes("unarmed")
        || name.includes("martial arts")
        || name.includes("безоружн")
        || name.includes("боевые искусства");
}"""
    text = text.replace(old, new, 1)
    if not check:
        io.open(path, "w", encoding="utf-8", newline="\n").write(text)
    return True, "опознание по типу оружия"


def main():
    check = "--check" in sys.argv
    if not os.path.isdir(MOOK):
        sys.exit("Pneuma Mook Maker не установлен: " + MOOK)

    results = [
        ("навыки", *patch_skills(check)),
        ("подвиды", *patch_families(check)),
        ("оружие", *patch_weapons(check)),
    ]
    changed = 0
    for what, did, note in results:
        changed += 1 if did else 0
        print(f"  {what}: {'нужна правка' if (did and check) else ('поправлено' if did else note)} — {note}")

    if check:
        print("\nправок не хватает:" if changed else "\nвсё на месте")
        sys.exit(1 if changed else 0)
    print("\nготово" if changed else "\nничего менять не пришлось")


if __name__ == "__main__":
    main()
