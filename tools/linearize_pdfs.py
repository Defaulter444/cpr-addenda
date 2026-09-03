# -*- coding: utf-8 -*-
"""Линеаризует главы книги правил («быстрый просмотр в вебе»).

Зачем. Книгу разрезали на главы ради скорости: качать 57 МБ ради одной страницы
незачем. Но сами главы получились НЕ линеаризованными, и половина выигрыша
пропала. В обычном PDF таблица объектов лежит в конце файла, поэтому просмотрщик
не может показать первую страницу, пока не доберётся до хвоста, — на практике
качает файл целиком. У линеаризованного всё нужное для первой страницы лежит в
начале, и она рисуется, пока остальное ещё едет.

Особенно заметно на «Найт-Сити»: 10.3 МБ по медленному каналу до чужого стола.

Правка не переупаковывает содержимое — только переставляет объекты и дописывает
словарь `/Linearized`. Поэтому здесь же и проверка: число страниц, число
картинок и текст первой и последней страницы обязаны совпасть с исходником,
иначе файл не заменяется.

    python tools/linearize_pdfs.py           # проверить и починить
    python tools/linearize_pdfs.py --check   # только проверить, ничего не трогать

Нужен pikepdf (в нём qpdf). PyMuPDF не подойдёт: начиная с 1.25 он умеет только
читать линеаризованные файлы, но не создавать их.
"""

import os
import shutil
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")

MODULE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK_DIR = os.path.join(MODULE_ROOT, "pdfs")

# Словарь линеаризации всегда лежит в самом начале файла.
HEAD = 2048
MARK = b"/Linearized"


def linearized(path):
    """Готов ли файл к постраничной отдаче."""
    with open(path, "rb") as handle:
        return MARK in handle.read(HEAD)


def fingerprint(path):
    """Слепок содержимого: страницы, картинки, текст с краёв."""
    import fitz

    with fitz.open(path) as book:
        pages = book.page_count
        images = sum(len(page.get_images(full=True)) for page in book)
        first = (book[0].get_text() or "")[:400]
        last = (book[pages - 1].get_text() or "")[:400]
    return pages, images, first, last


def books():
    """Все PDF книги — главы и том целиком."""
    found = []
    for root, _dirs, names in os.walk(BOOK_DIR):
        for name in sorted(names):
            if name.lower().endswith(".pdf"):
                found.append(os.path.join(root, name))
    return found


def fix(path):
    """Линеаризует файл на месте. Возвращает причину отказа или None."""
    import pikepdf

    before = fingerprint(path)
    handle, temporary = tempfile.mkstemp(suffix=".pdf")
    os.close(handle)
    try:
        with pikepdf.open(path) as pdf:
            pdf.save(temporary, linearize=True)

        if not linearized(temporary):
            return "после правки файл всё равно не линеаризован"

        after = fingerprint(temporary)
        if after[0] != before[0]:
            return "страниц было %d, стало %d" % (before[0], after[0])
        if after[1] != before[1]:
            return "картинок было %d, стало %d" % (before[1], after[1])
        if after[2] != before[2]:
            return "текст первой страницы изменился"
        if after[3] != before[3]:
            return "текст последней страницы изменился"

        shutil.move(temporary, path)
        return None
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def main():
    check_only = "--check" in sys.argv
    files = books()
    if not files:
        sys.exit("не нашёл ни одного PDF в " + BOOK_DIR)

    pending = [f for f in files if not linearized(f)]
    print("файлов книги: %d, из них не линеаризовано: %d" % (len(files), len(pending)))

    if check_only:
        for path in pending:
            print("  надо починить:", os.path.relpath(path, MODULE_ROOT))
        sys.exit(1 if pending else 0)

    failed = 0
    for path in pending:
        name = os.path.relpath(path, MODULE_ROOT)
        size = os.path.getsize(path) / 1048576
        reason = fix(path)
        if reason:
            failed += 1
            print("  ОТКАЗ  %-46s %s" % (name, reason))
        else:
            print("  готово %-46s %5.1f → %5.1f МБ"
                  % (name, size, os.path.getsize(path) / 1048576))

    left = [f for f in books() if not linearized(f)]
    print("осталось не линеаризованных: %d" % len(left))
    sys.exit(1 if (failed or left) else 0)


if __name__ == "__main__":
    main()
