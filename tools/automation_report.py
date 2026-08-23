"""
Отчёт по автоматизируемости предметов.

Разбор живёт в `docs/automation.json` — там по каждому предмету записано, можно
ли выразить его правило средствами системы и что при этом теряется. Скрипт
собирает из него читаемый документ и заодно проверяет, что разбор покрывает
ровно те предметы, которые лежат в `sources/`: ни одного забытого, ни одного
лишнего.

    python tools/automation_report.py
"""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

MODULE_ROOT = Path(__file__).resolve().parent.parent
PLAN = MODULE_ROOT / "docs" / "automation.json"
REPORT = MODULE_ROOT / "docs" / "automation-plan.md"
SOURCES = MODULE_ROOT / "sources"

HEADINGS = {
    "done": (
        "Уже работает",
        "Правило целиком лежит на штатных полях системы. Делать ничего не нужно.",
    ),
    "full": (
        "Можно автоматизировать полностью",
        "Правило выражается средствами системы без искажений: то, что написано в "
        "документе, будет работать именно так.",
    ),
    "partial": (
        "Можно с натяжкой",
        "Механику навесить получится, но часть правила потеряется. В каждой "
        "строке указано, что именно, — решать, приемлема ли потеря, тебе.",
    ),
    "text": (
        "Только текст",
        "Автоматизировать нечего: правило либо адресовано мастеру, либо действует "
        "на чужого персонажа, либо опирается на поля, которых в системе нет. "
        "Предмет остаётся карточкой с описанием — и это нормальное состояние, "
        "а не недоделка.",
    ),
}


def check_coverage(plan):
    """
    Сверяет разбор со списком предметов в исходниках.

    Считаем только предметы: таблицы дальности лежат в тех же исходниках, но
    автоматизировать в них нечего — это справочные данные, а не снаряжение.
    """
    covered = set()
    for key in ("done", "full", "partial", "text"):
        covered |= set(plan.get(key, {}))

    manifest = json.loads(
        (MODULE_ROOT / "module.json").read_text(encoding="utf-8")
    )
    item_packs = {p["name"] for p in manifest["packs"] if p["type"] == "Item"}

    actual = set()
    for pack in item_packs:
        for path in (SOURCES / pack).glob("*.json"):
            actual.add(json.loads(path.read_text(encoding="utf-8"))["name"])

    return sorted(actual - covered), sorted(covered - actual)


def main():
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    missing, extra = check_coverage(plan)

    counts = {k: len(plan.get(k, {})) for k in HEADINGS}
    total = sum(counts.values())

    lines = [
        "# Что из этого можно автоматизировать",
        "",
        "Разбор всех предметов модуля: какие правила система способна отыграть "
        "сама, какие — частично, а какие остаются текстом в карточке.",
        "",
        "| Категория | Предметов |",
        "|---|---:|",
    ]
    for key, (title, _) in HEADINGS.items():
        lines.append(f"| {title} | {counts[key]} |")
    lines.append(f"| **Всего** | **{total}** |")
    lines.append("")

    for key, (title, intro) in HEADINGS.items():
        entries = plan.get(key, {})
        if not entries:
            continue
        lines += [f"## {title} — {len(entries)}", "", intro, ""]

        if key in ("full", "partial"):
            head = "Что теряется" if key == "partial" else "Замечание"
            lines += [f"| Предмет | Как сделать | {head} |", "|---|---|---|"]
            for name, data in entries.items():
                note = data.get("loss") or data.get("note", "")
                lines.append(f"| {name} | {data['how']} | {note} |")
        else:
            lines += ["| Предмет | Почему |", "|---|---|"]
            for name, note in entries.items():
                lines.append(f"| {name} | {note} |")
        lines.append("")

    REPORT.write_text("\n".join(lines), encoding="utf-8")

    for key, (title, _) in HEADINGS.items():
        print(f"{title:34} {counts[key]:3}")
    print(f"{'Всего':34} {total:3}")

    if missing or extra:
        print("\nРАСХОЖДЕНИЯ С ИСХОДНИКАМИ:")
        for name in missing:
            print(f"  не разобран: {name}")
        for name in extra:
            print(f"  разобран, но такого предмета нет: {name}")
        sys.exit(1)

    print(f"\nРазбор покрывает все предметы. Отчёт: {REPORT}")


main()
