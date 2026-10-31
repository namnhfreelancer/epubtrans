/**
 * Small word lists for local glossary candidate extraction. English is the only language with a static
 * stopword list; other languages get dynamic stopwords (their most frequent short words, see
 * `extract-word-candidates.ts`), which catches function words in any space-separated language.
 */
export const ENGLISH_STOPWORDS = new Set(
  `a about above after again against all almost also although always am among an and another any anyone anything are around as at away
back be because been before being below between both but by can cannot could did do does doing done down during each either else enough even
ever every few for from further had has have having he her here hers herself him himself his how however i if in into is it its itself just
least less let like made make many may me might mine more most much must my myself neither never no nobody none nor not nothing now of off
often on once one only onto or other others our ours ourselves out over own perhaps quite rather really said same say says see seem seemed
shall she should since so some something sometimes still such than that the their theirs them themselves then there these they thing things
this those though through thus till to too toward towards under until up upon us very was we well were what whatever when where whether which
while who whom whose why will with within without would yes yet you your yours yourself yourselves
mr mrs ms dr st oh ah well yes no sir madam don't didn't doesn't isn't wasn't weren't won't wouldn't couldn't shouldn't can't i'm i've i'll i'd
you're you've you'll he's she's it's we're they're that's there's let's
two three four five six seven eight nine ten hundred thousand time times way ways day days year years man men woman women
good little long old last next own right left back put get got go went gone come came take took know knew think thought tell told
upon whilst shall`.split(/\s+/),
);

/** Lowercase words that may sit inside a multi-word proper name: "Duke of York", "Leonardo da Vinci". */
export const NAME_CONNECTORS = new Set([
  'of',
  'the',
  'de',
  'da',
  'di',
  'del',
  'della',
  'der',
  'den',
  'van',
  'von',
  'la',
  'le',
  'du',
  'des',
  'al',
  'el',
  'bin',
  'ibn',
  'y',
]);

/** Title abbreviations whose trailing period does not end the sentence: "Mr. Darcy" stays one name. */
export const TITLE_ABBREVIATIONS = new Set([
  'Mr',
  'Mrs',
  'Ms',
  'Dr',
  'St',
  'Prof',
  'Sr',
  'Jr',
  'Mt',
  'Capt',
  'Col',
  'Gen',
  'Lt',
  'Sgt',
  'Rev',
  'Hon',
  'Messrs',
  'Mme',
  'Mlle',
]);

/** Chinese/Japanese function characters that rarely start or end a term. */
export const CJK_FUNCTION_CHARS = new Set([...'的了是在和也就都而及与着或一不这那他她它我你们之其个为以于上下中有没把被让给']);
