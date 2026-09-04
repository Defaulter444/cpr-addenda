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


def sync_download(version):
    """Приводит ссылку на архив в манифесте к текущей версии.

    Ссылку легко не заметить: Foundry берёт из манифеста ЕЁ, а не версию, и
    если она отстала, мастер «обновляется» на старый архив. Внешне всё
    благополучно: версия в списке модулей новая, а код на диске прежний.

    Так и вышло с выпусками 0.19.0–0.19.2: ссылка осталась от 0.18.1, и всё
    это время раздавался архив трёхмесячной давности. Поэтому теперь она не
    правится руками, а собирается из версии.

    @param {str} version - версия из манифеста
    @returns {bool} - пришлось ли править
    """
    path = ROOT / "module.json"
    text = path.read_text(encoding="utf-8")
    manifest = json.loads(text)

    want = (
        "https://github.com/Defaulter444/cpr-addenda/releases/download/"
        f"v{version}/module.zip"
    )
    if manifest.get("download") == want:
        return False

    was = manifest.get("download", "—")
    path.write_text(
        text.replace(f'"download": "{was}"', f'"download": "{want}"'),
        encoding="utf-8",
        newline="\n",
    )
    print(f"Ссылка на архив была {was}")
    print(f"                стала {want}")
    return True


def main():
    version = json.loads((ROOT / "module.json").read_text(encoding="utf-8"))["version"]
    sync_download(version)

    # `-z` обязателен: без него git экранирует имена с не-ASCII символами —
    # «vneshniy-ekzoskelet-ω-omega.json» превращается в строку с кавычками и
    # восьмеричными кодами, путь по ней не открывается, и файл тихо выпадает
    # из архива. С `-z` имена приходят как есть, разделённые нулевым байтом.
    files = [
        name
        for name in subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        ).stdout.split(chr(0))
        if name
    ]

    if OUT.exists():
        OUT.unlink()

    # Пропущенный файл — не мелочь, а испорченный пак. Компендиум Foundry
    # это папка LevelDB: убери из неё один `.ldb` или журнал, и база
    # откроется, но части предметов в ней не будет. Молчаливый `continue`
    # здесь однажды уже отправил пользователю пак без семи новых предметов,
    # поэтому теперь отсутствие файла — остановка сборки.
    missing = [name for name in files if not (ROOT / name).is_file()]
    if missing:
        print("Файлы числятся в репозитории, но их нет на диске:")
        for name in missing:
            print(f"  {name}")
        print()
        print("Запустите `node tools/build-packs.js` и закоммитьте паки.")
        raise SystemExit(1)

    total = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in files:
            archive.write(ROOT / name, name.replace("\\", "/"))
            total += 1

    # И сверяем, что в архиве лежат все паки целиком: список файлов берётся из
    # git, а туда пак попадает только если его закоммитили после сборки.
    check_packs(version)

    size = OUT.stat().st_size / 1024 / 1024
    print(f"Версия {version}: файлов {total}, размер {size:.1f} МБ")
    print(f"Архив: {OUT}")


def check_packs(version):
    """Сверяет, что паки в архиве не беднее паков на диске.

    Сравниваем поимённо, а не по числу: пропасть может ровно тот предмет,
    который только что добавили, и счётчик, совпавший случайно, ничего бы не
    сказал. Диск — эталон, потому что его только что собрал build-packs.

    @param {str} version - версия, для сообщения об ошибке
    """
    manifest = json.loads((ROOT / "module.json").read_text(encoding="utf-8"))
    beds = []
    with zipfile.ZipFile(OUT) as archive:
        inside = set(archive.namelist())
        for pack in manifest.get("packs", []):
            path = pack["path"].lstrip("./")
            on_disk = {
                f"{path}/{item.name}"
                for item in (ROOT / path).iterdir()
                if item.is_file()
            }
            lost = sorted(on_disk - inside)
            if lost:
                beds.append((pack["name"], lost))

    if not beds:
        return
    print(f"В архиве версии {version} паки неполные:")
    for name, lost in beds:
        print(f"  {name}: не попали {', '.join(lost)}")
    print()
    print(
        "Скорее всего, паки собраны, но не закоммичены: список файлов архива "
        "берётся из git. Выполните `git add packs` и соберите заново."
    )
    OUT.unlink()
    raise SystemExit(1)


main()
