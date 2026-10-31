import { type FrequencyList, parseFrequencyList, type WordHintLanguage } from '@epubtrans/core';
import cs from '../../../packages/core/data/wordfreq/cs.txt' with { type: 'file' };
import de from '../../../packages/core/data/wordfreq/de.txt' with { type: 'file' };
import en from '../../../packages/core/data/wordfreq/en.txt' with { type: 'file' };
import es from '../../../packages/core/data/wordfreq/es.txt' with { type: 'file' };
import fr from '../../../packages/core/data/wordfreq/fr.txt' with { type: 'file' };
import it from '../../../packages/core/data/wordfreq/it.txt' with { type: 'file' };
import ja from '../../../packages/core/data/wordfreq/ja.txt' with { type: 'file' };
import ko from '../../../packages/core/data/wordfreq/ko.txt' with { type: 'file' };
import nl from '../../../packages/core/data/wordfreq/nl.txt' with { type: 'file' };
import pl from '../../../packages/core/data/wordfreq/pl.txt' with { type: 'file' };
import pt from '../../../packages/core/data/wordfreq/pt.txt' with { type: 'file' };
import ru from '../../../packages/core/data/wordfreq/ru.txt' with { type: 'file' };
import sv from '../../../packages/core/data/wordfreq/sv.txt' with { type: 'file' };
import uk from '../../../packages/core/data/wordfreq/uk.txt' with { type: 'file' };
import zh from '../../../packages/core/data/wordfreq/zh.txt' with { type: 'file' };

/**
 * Word frequency lists (wordfreq data, CC BY-SA 4.0). `with { type: 'file' }` makes `bun build --compile` embed each
 * file in the binary (the import is then a path inside the binary's virtual file system); from source it is the
 * path of the file in the repository. A list is only read when a command needs that language.
 */
const FILES: Record<WordHintLanguage, string> = { cs, de, en, es, fr, it, ja, ko, nl, pl, pt, ru, sv, uk, zh };

export async function loadFrequencyList(lang: WordHintLanguage): Promise<FrequencyList> {
  return parseFrequencyList(lang, await Bun.file(FILES[lang]).text());
}
