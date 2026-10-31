/**
 * Irregular English inflections for the rule-based lemmatizer: verbs as "base past participle[/variant]",
 * then nouns and adjectives as "form:base". Words whose spelling only looks inflected ("news", "series") map to
 * themselves so the suffix rules leave them alone.
 */
const VERBS = `arise arose arisen|awake awoke awoken|be was/were been|bear bore borne/born|beat beat beaten|become became become
begin began begun|behold beheld beheld|bend bent bent|beset beset beset|bet bet bet|bid bade bidden|bind bound bound|bite bit bitten
bleed bled bled|blow blew blown|break broke broken|breed bred bred|bring brought brought|build built built|burn burnt burnt|burst burst burst
buy bought bought|cast cast cast|catch caught caught|choose chose chosen|cling clung clung|come came come|cost cost cost|creep crept crept
cut cut cut|deal dealt dealt|dig dug dug|dive dove dived|do did done|draw drew drawn|dream dreamt dreamt|drink drank drunk|drive drove driven
dwell dwelt dwelt|eat ate eaten|fall fell fallen|feed fed fed|feel felt felt|fight fought fought|find found found|flee fled fled|fling flung flung
fly flew flown|forbid forbade forbidden|forget forgot forgotten|forgive forgave forgiven|forsake forsook forsaken|freeze froze frozen
get got gotten|give gave given|go went gone|grind ground ground|grow grew grown|hang hung hung|have had had|hear heard heard|hew hewed hewn
hide hid hidden|hit hit hit|hold held held|hurt hurt hurt|keep kept kept|kneel knelt knelt|knit knit knit|know knew known|lay laid laid
lead led led|lean leant leant|leap leapt leapt|learn learnt learnt|leave left left|lend lent lent|let let let|lie lay lain|light lit lit
lose lost lost|make made made|mean meant meant|meet met met|mislead misled misled|mistake mistook mistaken|mow mowed mown|overcome overcame overcome
overtake overtook overtaken|pay paid paid|plead pled pled|prove proved proven|put put put|quit quit quit|read read read|rend rent rent|rid rid rid
ride rode ridden|ring rang rung|rise rose risen|run ran run|saw sawed sawn|say said said|see saw seen|seek sought sought|sell sold sold
send sent sent|set set set|sew sewed sewn|shake shook shaken|shear sheared shorn|shed shed shed|shine shone shone|shoot shot shot|show showed shown
shrink shrank shrunk|shut shut shut|sing sang sung|sink sank sunk|sit sat sat|slay slew slain|sleep slept slept|slide slid slid|sling slung slung
slink slunk slunk|slit slit slit|smell smelt smelt|smite smote smitten|sow sowed sown|speak spoke spoken|speed sped sped|spell spelt spelt
spend spent spent|spill spilt spilt|spin spun spun|spit spat spat|split split split|spoil spoilt spoilt|spread spread spread|spring sprang sprung
stand stood stood|steal stole stolen|stick stuck stuck|sting stung stung|stink stank stunk|stride strode stridden|strike struck stricken
string strung strung|strive strove striven|swear swore sworn|sweep swept swept|swell swelled swollen|swim swam swum|swing swung swung
take took taken|teach taught taught|tear tore torn|tell told told|think thought thought|thrive throve thriven|throw threw thrown|thrust thrust thrust
tread trod trodden|understand understood understood|undertake undertook undertaken|undo undid undone|uphold upheld upheld|upset upset upset
wake woke woken|wear wore worn|weave wove woven|weep wept wept|wet wet wet|win won won|wind wound wound|withdraw withdrew withdrawn
withhold withheld withheld|withstand withstood withstood|wring wrung wrung|write wrote written`;

const OTHERS = `am:be is:be are:be being:be has:have having:have does:do doing:do goes:go
children:child men:man women:woman feet:foot teeth:tooth geese:goose mice:mouse lice:louse oxen:ox people:people
dice:die criteria:criterion phenomena:phenomenon data:data alumni:alumnus fungi:fungus cacti:cactus nuclei:nucleus stimuli:stimulus
theses:thesis analyses:analysis crises:crisis hypotheses:hypothesis oases:oasis appendices:appendix indices:index matrices:matrix
better:good best:good worse:bad worst:bad further:far furthest:far farther:far farthest:far elder:old eldest:old
news:news series:series species:species means:means always:always perhaps:perhaps sometimes:sometimes besides:besides
during:during nothing:nothing something:something anything:anything everything:everything evening:evening morning:morning
ceiling:ceiling wedding:wedding pudding:pudding herring:herring shilling:shilling farthing:farthing
seed:seed need:need feed:feed weed:weed reed:reed deed:deed bleed:bleed breed:breed greed:greed speed:speed
bed:bed red:red wed:wed shed:shed sled:sled fled:flee bred:breed led:lead fed:feed sped:speed
united:united naked:naked wicked:wicked rugged:rugged ragged:ragged crooked:crooked learned:learned beloved:beloved
sacred:sacred hundred:hundred kindred:kindred hatred:hatred
glasses:glass lens:lens bus:bus gas:gas yes:yes this:this thus:thus us:us was:be
alas:alas ground:ground found:found wound:wound rent:rent lay:lay saw:saw left:left`;

function build(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of VERBS.split(/[|\n]/)) {
    const [base, past, participle] = entry.trim().split(' ') as [string, string, string];
    for (const form of [...past.split('/'), ...participle.split('/')]) if (form !== base && !map.has(form)) map.set(form, base);
  }
  for (const pair of OTHERS.split(/\s+/)) {
    const [form, base] = pair.split(':') as [string, string];
    map.set(form, base);
  }
  return map;
}

/** Irregular form → lemma. */
export const ENGLISH_IRREGULAR_FORMS: ReadonlyMap<string, string> = build();
