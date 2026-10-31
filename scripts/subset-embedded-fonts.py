"""
Rebuilds the embeddable fonts in packages/core/data/fonts/ from the official Google Fonts sources.

Not part of the build: the generated TTF files are committed. Run it only to update a font.

  1. Download the sources from https://github.com/google/fonts (ofl/literata, ofl/notoserif, ofl/bevietnampro,
     ofl/notosans: the variable or static TTF files named below, plus each OFL.txt) into SOURCE_DIR/<family>/.
  2. python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools
  3. /tmp/ft/bin/python -I scripts/subset-embedded-fonts.py SOURCE_DIR packages/core/data/fonts

Each face becomes a static instance (variable axes pinned: weight 400 or 700, default optical size and width), then a
subset covering Latin, Latin Extended, Vietnamese and common punctuation, without hinting. All four families are
licensed under the SIL Open Font License 1.1 without Reserved Font Names, so subsetting under the original names is
allowed; each family's OFL.txt is copied next to its files.
"""

import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Basic Latin + Latin-1, Latin Extended-A/B, IPA/spacing modifiers, combining marks, Latin Extended Additional
# (Vietnamese precomposed letters), general punctuation, currency signs (đồng, euro), letterlike symbols.
UNICODES = "U+0000-024F,U+0250-02FF,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20A0-20C0,U+2100-2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"

# (family directory, source file, output file, pinned axes or None for a static source)
FACES = [
    ("literata", "Literata-VF.ttf", "literata-regular.ttf", {"wght": 400, "opsz": 12}),
    ("literata", "Literata-VF.ttf", "literata-bold.ttf", {"wght": 700, "opsz": 12}),
    ("literata", "Literata-Italic-VF.ttf", "literata-italic.ttf", {"wght": 400, "opsz": 12}),
    ("notoserif", "NotoSerif-VF.ttf", "noto-serif-regular.ttf", {"wght": 400, "wdth": 100}),
    ("notoserif", "NotoSerif-VF.ttf", "noto-serif-bold.ttf", {"wght": 700, "wdth": 100}),
    ("notoserif", "NotoSerif-Italic-VF.ttf", "noto-serif-italic.ttf", {"wght": 400, "wdth": 100}),
    ("bevietnampro", "BeVietnamPro-Regular.ttf", "be-vietnam-pro-regular.ttf", None),
    ("bevietnampro", "BeVietnamPro-Bold.ttf", "be-vietnam-pro-bold.ttf", None),
    ("bevietnampro", "BeVietnamPro-Italic.ttf", "be-vietnam-pro-italic.ttf", None),
    ("notosans", "NotoSans-VF.ttf", "noto-sans-regular.ttf", {"wght": 400, "wdth": 100}),
    ("notosans", "NotoSans-VF.ttf", "noto-sans-bold.ttf", {"wght": 700, "wdth": 100}),
    ("notosans", "NotoSans-Italic-VF.ttf", "noto-sans-italic.ttf", {"wght": 400, "wdth": 100}),
]

LICENSE_NAMES = {"literata": "literata", "notoserif": "noto-serif", "bevietnampro": "be-vietnam-pro", "notosans": "noto-sans"}


def build(source_dir: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    options = subset.Options()
    options.hinting = False
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.drop_tables += ["STAT"]
    for family, source, output, axes in FACES:
        font = TTFont(source_dir / family / source)
        if axes is not None:
            font = instancer.instantiateVariableFont(font, axes, updateFontNames=True)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
        subsetter.subset(font)
        target = out_dir / output
        font.save(target)
        print(f"{target}: {target.stat().st_size} bytes")
    for family, name in LICENSE_NAMES.items():
        shutil.copyfile(source_dir / family / "OFL.txt", out_dir / f"{name}-OFL.txt")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: subset-embedded-fonts.py SOURCE_DIR OUT_DIR")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
