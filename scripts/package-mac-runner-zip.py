"""Build a Mac runner ZIP on Windows with explicit Unix executable modes.

Developer packaging only; Python is not required on the recipient's computer.
"""
from pathlib import Path
import stat
import sys
import zipfile

root = Path(sys.argv[1]).resolve(strict=True)
destination = Path(sys.argv[2]).resolve()
if not root.is_dir() or destination.parent != root.parent or destination.name != root.name + ".zip":
    raise ValueError("Invalid runner archive destination")

with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in [root, *sorted(root.rglob("*"))]:
        if path.is_symlink():
            raise ValueError("Unexpected symlink in runner package")
        name = path.relative_to(root.parent).as_posix()
        directory = path.is_dir()
        executable = path.relative_to(root).as_posix() == "runtime/node" or path.suffix in {".command", ".sh"}
        info = zipfile.ZipInfo(name + ("/" if directory else ""))
        info.create_system = 3  # Unix, even though the packaging host is Windows.
        mode = stat.S_IFDIR | 0o755 if directory else stat.S_IFREG | (0o755 if executable else 0o644)
        info.external_attr = (mode << 16) | (0x10 if directory else 0)
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, b"" if directory else path.read_bytes())

with zipfile.ZipFile(destination) as archive:
    for name in ["runtime/node", "Start ChineseTest.command", "Enable web launch.command"]:
        info = archive.getinfo(root.name + "/" + name)
        if info.create_system != 3 or (info.external_attr >> 16) & 0o111 != 0o111:
            raise ValueError("Executable permissions missing: " + name)
    bad = archive.testzip()
    if bad:
        raise ValueError("Corrupt archive member: " + bad)
print("Verified Mac ZIP executable modes and CRCs: " + destination.name)
