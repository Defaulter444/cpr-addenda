# -*- coding: utf-8 -*-
"""
Кладёт картинки костюмов силовой брони в assets/power-armor.

Исходники приходят по 2048×2048: портреты JPEG по 2–3 МБ, токены PNG по 5 МБ.
Так их класть нельзя — двадцать файлов добавили бы к модулю 77 МБ, а он и без
них весит сотню. При этом столько пикселей некуда девать: портрет на листе
показывается сотнями точек, токен на столе — и того меньше.

Поэтому картинки пересобираются в webp: портрет до 1024, токен до 512. Выходит
около 280 КБ и 90 КБ соответственно — в двадцать раз меньше при том же виде на
экране. Прозрачность токенов webp сохраняет, так что круглые жетоны остаются
круглыми.

Соответствие имён задано вручную: у присланных файлов свои написания
(«Standart», «SovOil Bombarder», «ZHIRAFA»), и угадывать их сопоставлением
строк — ровно тот способ, который уже подводил на оружии.

    python tools/import_power_armor_art.py "C:/Users/Horusian/Downloads/ACPA"

После — `python tools/import_power_armor.py` и `node tools/build-packs.js`.
"""

import io
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

try:
    from PIL import Image
except ImportError:
    raise SystemExit(
        "Нужен Pillow: python -m pip install Pillow"
    )

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "assets", "power-armor")

#: Портрет на листе. 1024 с запасом: показывается он куда мельче.
PORTRAIT_SIZE = 1024
PORTRAIT_QUALITY = 90

#: Токен на столе. 512 хватает и при сильном приближении.
TOKEN_SIZE = 512
TOKEN_QUALITY = 95

#: «имя костюма латиницей» -> (файл портрета, файл токена в подпапке «Токен»).
ART = {
    "arasaka-neo-guardian": ("Arasaka Neo Guardian.jpeg", "Arasaka_Neo_Guardian_2048.png"),
    "arasaka-neo-standard": ("Arasaka Neo Standart.jpeg", "Arasaka_Neo_Standart_2048.png"),
    "arasaka-shin-daioni": ("Arasaka Shin Daioni.jpeg", "Arasaka_Shin_Daioni_2048.png"),
    "blueraven-sewer-rat": ("Blueraven Sewer Rat.jpeg", "Blueraven_Sewer_Rat_2048.png"),
    "metacorp-nyx": ("MetaCorp Nyx.jpeg", "MetaCorp_Nyx_2048.png"),
    "militech-commando": ("Militech Commando.jpeg", "Militech_Commando_2048.png"),
    "sovoyl-bombardir": ("SovOil Bombarder.jpeg", "SovOil_Bombarder_2048.png"),
    "tsunami-arms-magus": ("Tsunami Arms Magus.jpeg", "Tsunami_Arms_Magus_2048.png"),
    "zetatech-grasshopper": ("Zetatech Grasshopper.jpeg", "Zetatech_Grasshopper_2048.png"),
    "zhirafa-boris": ("ZHIRAFA Борис.jpeg", "ZHIRAFA_2048.png"),
}

TOKEN_DIR = "Токен"


def convert(source, destination, size, quality, keep_alpha):
    """Пересобирает картинку в webp нужного размера.

    @param {str} source - путь к исходнику
    @param {str} destination - куда положить
    @param {int} size - наибольшая сторона
    @param {int} quality - качество webp
    @param {bool} keep_alpha - сохранять ли прозрачность
    @returns {tuple} - (размер исходника, размер результата, стороны)
    """
    before = os.path.getsize(source)
    with Image.open(source) as image:
        image = image.convert("RGBA" if keep_alpha else "RGB")
        image.thumbnail((size, size), Image.LANCZOS)
        # method=6 — самый медленный и самый плотный режим сжатия webp.
        # Картинок два десятка, так что лишние секунды роли не играют.
        image.save(destination, "WEBP", quality=quality, method=6)
        dimensions = image.size
    return before, os.path.getsize(destination), dimensions


def main():
    if len(sys.argv) < 2:
        raise SystemExit(
            "Укажите папку с исходниками:\n"
            '    python tools/import_power_armor_art.py "путь/к/ACPA"'
        )
    source_dir = sys.argv[1]
    if not os.path.isdir(source_dir):
        raise SystemExit(f"Папки нет: {source_dir}")

    os.makedirs(TARGET, exist_ok=True)

    missing = []
    for name, (portrait, token) in ART.items():
        if not os.path.exists(os.path.join(source_dir, portrait)):
            missing.append(f"портрет «{portrait}» для {name}")
        if not os.path.exists(os.path.join(source_dir, TOKEN_DIR, token)):
            missing.append(f"токен «{token}» для {name}")
    if missing:
        print("Не найдены исходники — соответствие имён устарело:")
        for item in missing:
            print(f"  {item}")
        raise SystemExit(1)

    total_before = total_after = 0
    for name, (portrait, token) in sorted(ART.items()):
        before, after, dims = convert(
            os.path.join(source_dir, portrait),
            os.path.join(TARGET, f"{name}.webp"),
            PORTRAIT_SIZE, PORTRAIT_QUALITY, keep_alpha=False,
        )
        total_before += before
        total_after += after
        print(f"  {name}.webp".ljust(38)
              + f"{dims[0]}×{dims[1]}  {before // 1024} КБ -> {after // 1024} КБ")

        before, after, dims = convert(
            os.path.join(source_dir, TOKEN_DIR, token),
            os.path.join(TARGET, f"{name}-token.webp"),
            TOKEN_SIZE, TOKEN_QUALITY, keep_alpha=True,
        )
        total_before += before
        total_after += after
        print(f"  {name}-token.webp".ljust(38)
              + f"{dims[0]}×{dims[1]}  {before // 1024} КБ -> {after // 1024} КБ")

    print(
        f"\nКартинок: {len(ART) * 2}. "
        f"Было {total_before / 1048576:.1f} МБ, стало {total_after / 1048576:.1f} МБ "
        f"(в {total_before / max(total_after, 1):.0f} раз меньше)."
    )


main()
