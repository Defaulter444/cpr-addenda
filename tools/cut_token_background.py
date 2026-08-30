# -*- coding: utf-8 -*-
"""
Делает токены силовой брони с прозрачным фоном.

Токены иногда приходят на белом листе. Просто «сделать белое прозрачным»
нельзя: у моделей белым нарисованы логотипы Arasaka, номер «120» и надпись
MILITECH — от порогового отсечения на их месте остались бы дыры.

Поэтому фон ищется заливкой от четырёх углов: прозрачным становится только то
белое, что связано с краем кадра, а белое внутри силуэта остаётся на месте.
Заливка идёт с фиксированным диапазоном — иначе OpenCV сравнивает соседние
пиксели, а не цвет затравки, и по мягким теням затекает внутрь модели
(проверено: съедало 97% кадра вместо 50%).

Готовая маска расширяется на пару пикселей, чтобы срезать светлую кайму от
сжатия JPEG. Модели нарисованы с толстым чёрным контуром, так что этих
пикселей не жалко. Прозрачным пикселям выставляется чёрный цвет: при
уменьшении в края затекает он, а не белый, и на тёмном столе это незаметно.

    python tools/cut_token_background.py "путь/к/папке"

Имя файла должно совпадать с именем костюма — регистр, пробелы и кириллические
двойники латиницы («АRASAKA» через русскую А) приводятся сами.

После — python tools/import_power_armor.py и node tools/build-packs.js
"""

import glob
import io
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

try:
    import numpy as np
    import cv2
    from PIL import Image
except ImportError as error:
    raise SystemExit(f"Нужны numpy, opencv-python и Pillow: {error}")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "assets", "power-armor")
SOURCES = os.path.join(ROOT, "sources", "addenda-actors")

#: Наибольшая сторона токена. Больше не нужно даже при сильном приближении.
TOKEN_SIZE = 512
TOKEN_QUALITY = 95

#: Насколько цвет пикселя может отличаться от белого, чтобы считаться фоном.
WHITE_TOLERANCE = 20

#: На сколько пикселей расширить маску фона, срезая светлую кайму.
FEATHER = 2

#: Кириллические буквы, неотличимые от латинских: в именах файлов они попадаются.
LOOKALIKES = str.maketrans({
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H",
    "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X",
})


def normalize(name):
    """Имя файла к виду имени костюма: латиница, нижний регистр, дефисы."""
    name = os.path.splitext(name)[0].translate(LOOKALIKES).lower()
    return "-".join(part for part in name.replace("_", " ").split() if part)


def known_suits():
    """Имена костюмов — по файлам исходников, чтобы список не разъезжался."""
    return {
        os.path.splitext(os.path.basename(path))[0]
        for path in glob.glob(os.path.join(SOURCES, "*.json"))
    }


def cut(path):
    """Убирает связный с краем белый фон и возвращает картинку токена.

    @param {str} path - путь к исходнику
    @returns {tuple} - (изображение RGBA, доля прозрачного)
    """
    # OpenCV на Windows не открывает пути с кириллицей — читаем байтами.
    raw = np.frombuffer(io.open(path, "rb").read(), np.uint8)
    bgr = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"Не читается как изображение: {path}")

    height, width = bgr.shape[:2]
    mask = np.zeros((height + 2, width + 2), np.uint8)
    flags = (
        4
        | cv2.FLOODFILL_MASK_ONLY
        | cv2.FLOODFILL_FIXED_RANGE
        | (255 << 8)
    )
    tolerance = (WHITE_TOLERANCE,) * 3
    for seed in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        cv2.floodFill(bgr, mask, seed, 0, loDiff=tolerance, upDiff=tolerance,
                      flags=flags)

    background = mask[1:-1, 1:-1] > 0
    if FEATHER:
        background = cv2.dilate(
            background.astype(np.uint8), np.ones((3, 3), np.uint8),
            iterations=FEATHER,
        ) > 0

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    rgb[background] = 0
    alpha = np.where(background, 0, 255).astype(np.uint8)

    image = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
    image.thumbnail((TOKEN_SIZE, TOKEN_SIZE), Image.LANCZOS)
    return image, float(background.mean())


def main():
    if len(sys.argv) < 2:
        raise SystemExit(
            "Укажите папку с токенами:\n"
            '    python tools/cut_token_background.py "путь/к/папке"'
        )
    source_dir = sys.argv[1]
    if not os.path.isdir(source_dir):
        raise SystemExit(f"Папки нет: {source_dir}")

    suits = known_suits()
    os.makedirs(TARGET, exist_ok=True)

    matched, skipped = [], []
    for path in sorted(glob.glob(os.path.join(source_dir, "*"))):
        if not os.path.isfile(path):
            continue
        extension = os.path.splitext(path)[1].lower()
        if extension not in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
            continue
        name = normalize(os.path.basename(path))
        if name in suits:
            matched.append((name, path))
        else:
            skipped.append((os.path.basename(path), name))

    if skipped:
        print("Не опознаны — имя файла должно совпадать с именем костюма:")
        for original, guess in skipped:
            print(f"  {original}  ->  «{guess}»")
        print()

    if not matched:
        raise SystemExit("Ни один файл не опознан, ничего не записано.")

    for name, path in matched:
        image, share = cut(path)
        destination = os.path.join(TARGET, f"{name}-token.webp")
        image.save(destination, "WEBP", quality=TOKEN_QUALITY, method=6)
        before = os.path.getsize(path)
        after = os.path.getsize(destination)
        print(
            f"  {name}-token.webp".ljust(38)
            + f"{image.size[0]}×{image.size[1]}  "
            + f"фон {share * 100:.0f}%  "
            + f"{before // 1024} КБ -> {after // 1024} КБ"
        )

    print(f"\nТокенов обработано: {len(matched)}.")


main()
