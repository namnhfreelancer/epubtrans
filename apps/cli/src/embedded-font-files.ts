import { EMBEDDED_FONT_FILES } from '@epubtrans/core';
import beVietnamProBold from '../../../packages/core/data/fonts/be-vietnam-pro-bold.ttf' with { type: 'file' };
import beVietnamProItalic from '../../../packages/core/data/fonts/be-vietnam-pro-italic.ttf' with { type: 'file' };
import beVietnamProOfl from '../../../packages/core/data/fonts/be-vietnam-pro-OFL.txt' with { type: 'file' };
import beVietnamProRegular from '../../../packages/core/data/fonts/be-vietnam-pro-regular.ttf' with { type: 'file' };
import literataBold from '../../../packages/core/data/fonts/literata-bold.ttf' with { type: 'file' };
import literataItalic from '../../../packages/core/data/fonts/literata-italic.ttf' with { type: 'file' };
import literataOfl from '../../../packages/core/data/fonts/literata-OFL.txt' with { type: 'file' };
import literataRegular from '../../../packages/core/data/fonts/literata-regular.ttf' with { type: 'file' };
import notoSansBold from '../../../packages/core/data/fonts/noto-sans-bold.ttf' with { type: 'file' };
import notoSansItalic from '../../../packages/core/data/fonts/noto-sans-italic.ttf' with { type: 'file' };
import notoSansOfl from '../../../packages/core/data/fonts/noto-sans-OFL.txt' with { type: 'file' };
import notoSansRegular from '../../../packages/core/data/fonts/noto-sans-regular.ttf' with { type: 'file' };
import notoSerifBold from '../../../packages/core/data/fonts/noto-serif-bold.ttf' with { type: 'file' };
import notoSerifItalic from '../../../packages/core/data/fonts/noto-serif-italic.ttf' with { type: 'file' };
import notoSerifOfl from '../../../packages/core/data/fonts/noto-serif-OFL.txt' with { type: 'file' };
import notoSerifRegular from '../../../packages/core/data/fonts/noto-serif-regular.ttf' with { type: 'file' };

/**
 * Bundled SIL OFL fonts (and their licenses) that an export style can embed. Like the word frequency lists,
 * `with { type: 'file' }` makes `bun build --compile` embed each file in the binary; from source the import is the
 * file's path in the repository. A file is only read when an export embeds its font.
 */
const FILES: Record<string, string> = {
  'be-vietnam-pro-OFL.txt': beVietnamProOfl,
  'be-vietnam-pro-bold.ttf': beVietnamProBold,
  'be-vietnam-pro-italic.ttf': beVietnamProItalic,
  'be-vietnam-pro-regular.ttf': beVietnamProRegular,
  'literata-OFL.txt': literataOfl,
  'literata-bold.ttf': literataBold,
  'literata-italic.ttf': literataItalic,
  'literata-regular.ttf': literataRegular,
  'noto-sans-OFL.txt': notoSansOfl,
  'noto-sans-bold.ttf': notoSansBold,
  'noto-sans-italic.ttf': notoSansItalic,
  'noto-sans-regular.ttf': notoSansRegular,
  'noto-serif-OFL.txt': notoSerifOfl,
  'noto-serif-bold.ttf': notoSerifBold,
  'noto-serif-italic.ttf': notoSerifItalic,
  'noto-serif-regular.ttf': notoSerifRegular,
};

/** Loader handed to core's export: only names from the core catalog are ever served. */
export async function loadFontFile(file: string): Promise<Uint8Array> {
  const path = EMBEDDED_FONT_FILES.includes(file) ? FILES[file] : undefined;
  if (!path) throw new Error(`Unknown font file: ${file}`);
  return new Uint8Array(await Bun.file(path).arrayBuffer());
}
