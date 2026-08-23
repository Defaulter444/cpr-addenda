"""
Собирает module.zip для релиза на GitHub.

Foundry скачивает архив по ссылке из манифеста и распаковывает как есть,
поэтому в архив должно попасть ровно то, что лежит в репозитории, — файлы
берём из git, а не со диска, чтобы черновики и локальный индекс не уехали
вместе с модулем.

Пути внутри архива пишем через косую черту: Foundry на Linux не понимает
записи с обратной, а стандартный архиватор Windows кладёт именно такие.

    python tools/make_release.py
"""

import json
import subprocess
import sys
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "module.zip"


def main():
    version = json.loads((ROOT / "module.json").read_text(encoding="utf-8"))["version"]

    files = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout.splitlines()

    if OUT.exists():
        OUT.unlink()

    total = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in files:
            path = ROOT / name
            if not path.is_file():
                continue
            archive.write(path, name.replace("\\", "/"))
            total += 1

    size = OUT.stat().st_size / 1024 / 1024
    print(f"Версия {version}: файлов {total}, размер {size:.1f} МБ")
    print(f"Архив: {OUT}")


main()
