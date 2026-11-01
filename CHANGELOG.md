# Changelog

## [3.2.0](https://github.com/namnhfreelancer/epubtrans/compare/v3.1.0...v3.2.0) (2026-11-01)


### Features

* **cli:** add --polish as the name of the natural-style second pass ([a8e87e1](https://github.com/namnhfreelancer/epubtrans/commit/a8e87e196af1940ef6893a6fc495cea6abae5e6b))
* **core:** meaning-first translation prompt, read-only context and a polish pass ([3ac330b](https://github.com/namnhfreelancer/epubtrans/commit/3ac330b18ab765f4af0448440247c546db89ac60))
* natural, meaning-first translation prompts and an optional polish pass ([16e252d](https://github.com/namnhfreelancer/epubtrans/commit/16e252d492b126d7890448198c18ab5845c7de8b))
* **web:** label the second pass "Polish for natural style" ([e6b1ded](https://github.com/namnhfreelancer/epubtrans/commit/e6b1ded88455c957b2ef8b0b6d8ac7570cfb9795))


### Bug Fixes

* **core:** correct the Vietnamese craft rules and never split surrogate pairs in capped context ([4cbf875](https://github.com/namnhfreelancer/epubtrans/commit/4cbf87508d059f2a129d7f3245f64bd7a697a5f5))
* **core:** size the cost estimate as an upper bound of what a run sends ([58c90a5](https://github.com/namnhfreelancer/epubtrans/commit/58c90a5d15df15ceaa62b2bd69dac412c25fdad7))

## [3.1.0](https://github.com/namnhfreelancer/epubtrans/compare/v3.0.0...v3.1.0) (2026-10-31)


### Features

* batch caps, DRM detection, reasoning setting, cached tokens, glossary files, TXT/MD import ([07654ff](https://github.com/namnhfreelancer/epubtrans/commit/07654ff2ed48506aae793f331cf326ba6bdae317))
* **cli:** --style-file and --attribution for translate, resume, export and hints ([b9c3843](https://github.com/namnhfreelancer/epubtrans/commit/b9c3843d404da5dbb3e3b59a054bdaf3a62d0e51))
* **cli:** accept --glossary-file in the hints command ([009aa4c](https://github.com/namnhfreelancer/epubtrans/commit/009aa4cb83af05116cfe2c2bca71ea146421af0d))
* **cli:** add the hints command and Word Wise export flags ([23bd0d2](https://github.com/namnhfreelancer/epubtrans/commit/23bd0d2e4081cf8f067e32bc5c7d9c66a7a495c9))
* **cli:** glossary files, TXT/Markdown input, batch cap, reasoning and cached-token flags ([d635d3c](https://github.com/namnhfreelancer/epubtrans/commit/d635d3c8ac30a099c520cd564870e8c246d0678d))
* **cli:** show glossary and guideline generation progress ([998ba1c](https://github.com/namnhfreelancer/epubtrans/commit/998ba1c17faaca7a63396d4287d2538c94e2e919))
* **cli:** use public price lookup for the sample estimate ([1253262](https://github.com/namnhfreelancer/epubtrans/commit/1253262e39b09af73296f3edbec27204394ccd61))
* **core,web,cli:** look up model prices automatically for the cost estimate ([0fd95df](https://github.com/namnhfreelancer/epubtrans/commit/0fd95df51aace6e2765a15ade35db0cbf44895ea))
* **core,web,cli:** translate sample passages before the full run ([593e706](https://github.com/namnhfreelancer/epubtrans/commit/593e7067ca4db08bf58401efd99345e580be7a2a))
* **core:** add a preview export option that keeps segment ids and flags issues ([eb5b342](https://github.com/namnhfreelancer/epubtrans/commit/eb5b3420ba30feec2a96943adafc45e4ad56c7b7))
* **core:** add Word Wise hints and the original export mode ([23fb3a1](https://github.com/namnhfreelancer/epubtrans/commit/23fb3a1bf4457382eb42254b502742756d47253f))
* **core:** batch segment cap, DRM detection, TXT/Markdown import, identical warnings, cached tokens, reasoning and glossary files ([369822e](https://github.com/namnhfreelancer/epubtrans/commit/369822e913f00a4343cbcb3a54be1ba40091506e))
* **core:** per-book export styles, embedded OFL fonts, own export identifier and opt-in attribution page ([3ba02ef](https://github.com/namnhfreelancer/epubtrans/commit/3ba02efac55f2194419ec7d3cbaacab2856ee613))
* **core:** scalable glossary and sectioned style guideline generation ([daaa475](https://github.com/namnhfreelancer/epubtrans/commit/daaa475ac8d9738eb82ed8718a2aa03db49a9c07))
* online EPUB preview with device emulation and click-to-edit ([aa59428](https://github.com/namnhfreelancer/epubtrans/commit/aa59428429c336e3e8c7756b21b9eb94874703e1))
* per-book export styles, embedded fonts, style templates, own book identifier, opt-in attribution ([3a76c69](https://github.com/namnhfreelancer/epubtrans/commit/3a76c69b26dd66ec7fc687575135b15151147aa6))
* sample translation, scalable glossary, automatic pricing; fix dropped page markers ([7a81f21](https://github.com/namnhfreelancer/epubtrans/commit/7a81f21ff2690f0a9a4612cb0eba5b306fbece7c))
* **web:** book style editor with live preview, embedded fonts, style templates and WebMCP style options ([d460e23](https://github.com/namnhfreelancer/epubtrans/commit/d460e233556681e556184af386b648365f71c338))
* **web:** expose library, translation and export as WebMCP tools for in-browser agents ([6f35e11](https://github.com/namnhfreelancer/epubtrans/commit/6f35e11bcb34136784bf998b6c18ba97faa638e9))
* **web:** generate and export Word Wise hints ([3b419ce](https://github.com/namnhfreelancer/epubtrans/commit/3b419ceb22088d5052901cb9a1a62857570566b6))
* **web:** glossary table for hundreds of entries and generation progress ([13054b5](https://github.com/namnhfreelancer/epubtrans/commit/13054b5123caaa12268fcd26b57af1e506f624bd))
* **web:** highlight failed segments in the reader and jump between them ([800a7a0](https://github.com/namnhfreelancer/epubtrans/commit/800a7a0b34b3bfc2fcc92b95c37b04e1c22add18))
* **web:** preview the exported EPUB with foliate-js on emulated devices ([f22091c](https://github.com/namnhfreelancer/epubtrans/commit/f22091ccddb4a254479143cc2a554d1116a16163))
* **web:** respect the cross-tab job lock in reader retries and sample runs ([a6b4aca](https://github.com/namnhfreelancer/epubtrans/commit/a6b4aca6c24676c7c3fd570bb8e821b912933bc7))
* **web:** target-language guard, identical-translation warnings, glossary files, reasoning and cached-token settings, TXT/MD import ([1bf68d7](https://github.com/namnhfreelancer/epubtrans/commit/1bf68d709f906780da5c459c901d9a17c8a7c741))
* **web:** WebMCP tools for in-browser AI agents ([2b60e54](https://github.com/namnhfreelancer/epubtrans/commit/2b60e54c9fae909b6797c9c13b2a69727de62337))
* Word Wise-style hints with context-aware LLM glosses ([31e657c](https://github.com/namnhfreelancer/epubtrans/commit/31e657ca69f3e8b547d2ef2db871050a7b0130d0))


### Bug Fixes

* **cli:** describe the reasoning fallback steps in help ([fb16d09](https://github.com/namnhfreelancer/epubtrans/commit/fb16d098ffe74efc3eb51bc6d575628ddbaaac92))
* **cli:** redact secrets from printed errors and sample report ([443183d](https://github.com/namnhfreelancer/epubtrans/commit/443183dee3b643a5b5e3924901fb56d5867f8337))
* **cli:** state the CC BY-SA 4.0 exception for the embedded word frequency data ([68eab7b](https://github.com/namnhfreelancer/epubtrans/commit/68eab7bbbecd07bb7a0925532602d1c713f2c1e2))
* **cli:** strip terminal controls from all output, time out the price lookup ([a915943](https://github.com/namnhfreelancer/epubtrans/commit/a915943a36d7d98e7f16405e23af1d33c77f02f5))
* **core:** close remaining source-book export vectors and keep extra renditions ([9f9228c](https://github.com/namnhfreelancer/epubtrans/commit/9f9228cb9be5a6f8341142f2207f83dc91857633)), closes [#4](https://github.com/namnhfreelancer/epubtrans/issues/4)
* **core:** end the generated guideline block with explicit markers ([b033d8e](https://github.com/namnhfreelancer/epubtrans/commit/b033d8ea4c6698916ce4859cc7782b2da84db41e))
* **core:** fast cost estimate, inflection-tolerant glossary, safe sample re-runs ([016271f](https://github.com/namnhfreelancer/epubtrans/commit/016271fd1f905a06dee52d3e06b75b1991663483))
* **core:** keep -eed nouns (steed, creed, tweed) intact in the English lemmatizer ([c59c526](https://github.com/namnhfreelancer/epubtrans/commit/c59c52682934a11a69b72bf8940a16b3dbb40123))
* **core:** keep empty page markers away from the model and restore them ([0ebec4f](https://github.com/namnhfreelancer/epubtrans/commit/0ebec4f3623c2d423d86eff97872a4829938b332))
* **core:** keep hard-wrapped Markdown paragraphs whole and split long ones after inline rendering ([1c63dd4](https://github.com/namnhfreelancer/epubtrans/commit/1c63dd44af08a7e15c55ec90d8e433fb1b300a4d))
* **core:** keep Markdown scene breaks, split flat and oversized text, make inline parsing linear ([384f4ec](https://github.com/namnhfreelancer/epubtrans/commit/384f4ecf68fd955ec38613289e42a7d7608675e0))
* **core:** keep opaque resources and container links intact during export ([929f85c](https://github.com/namnhfreelancer/epubtrans/commit/929f85c2983346f0e41b09850a3d9a4ce45f7f54))
* **core:** keep segmenter compounds and Traditional text out of rare CJK words; tighten names, lemmas and XML characters ([3b9c6ea](https://github.com/namnhfreelancer/epubtrans/commit/3b9c6ea208c6cc3ac02ac8594bd562a4c02103ca))
* **core:** list embedded fonts in every rendition that shares the styled stylesheet ([51d835e](https://github.com/namnhfreelancer/epubtrans/commit/51d835e5951b494635674fc4bc42912761e0876c))
* **core:** make chosen export styles win over the book's own stylesheet ([864a6a5](https://github.com/namnhfreelancer/epubtrans/commit/864a6a5044a240af8511dd1c9b0a9fa790af481d))
* **core:** per-form hint ranks, safer lemmas, drop caps, CJK rare words and clean glosses ([dbe8ad4](https://github.com/namnhfreelancer/epubtrans/commit/dbe8ad4a79851352eabb219cd8638d2f19710d53))
* **core:** redact API keys and secrets from provider error text ([12394e5](https://github.com/namnhfreelancer/epubtrans/commit/12394e51ef4cf87b8439d5c84855139ea40cd963))
* **core:** render newline-heavy Markdown paragraphs in linear time and accept capitalized front matter keys ([a86e3b7](https://github.com/namnhfreelancer/epubtrans/commit/a86e3b7b75f4ea8819ed440bbf4bf63ff4f07cd3))
* **core:** step reasoning off down to minimal effort and parse OpenRouter cache writes ([ee8e05a](https://github.com/namnhfreelancer/epubtrans/commit/ee8e05a9a495804260b4ba8d0aada5288ec208c7))
* **core:** treat an empty export style as the Classic look ([69c2f69](https://github.com/namnhfreelancer/epubtrans/commit/69c2f693182c2184873de812da414ed70305b89c))
* **core:** valid attribution page in fixed-layout books, one colophon and id on re-export, forward-compatible style files ([9bb7599](https://github.com/namnhfreelancer/epubtrans/commit/9bb7599bada2816a7d5df7781495755081ade0c5))
* **core:** write no HTML5 doctype into EPUB 2 content documents ([3857898](https://github.com/namnhfreelancer/epubtrans/commit/38578987dc25c2589d09e7b2cc1660f58e181728))
* cross-tab edit safety and export sanitizer hardening ([fe8c6d9](https://github.com/namnhfreelancer/epubtrans/commit/fe8c6d9fc5a77dc8a5347ad34fd2d468a159959a))
* export styles had no effect on books that style paragraphs by class ([342a460](https://github.com/namnhfreelancer/epubtrans/commit/342a4600e1ae70db1195b830c5ea5d5ea2e44652))
* lock the reader resume button while another tab translates; run CI tests on Node 24 ([a510a6e](https://github.com/namnhfreelancer/epubtrans/commit/a510a6e8ad16f37194e2ab8de5eba0fb3dc56389))
* never cache HTML fallbacks as fonts; drop a stale colophon when attribution is off ([15b1941](https://github.com/namnhfreelancer/epubtrans/commit/15b19414be71818de782cf443efa7cfd44ff0b7c))
* re-check the cross-tab job lock after confirm dialogs; strengthen sniffed-markup test ([3efe396](https://github.com/namnhfreelancer/epubtrans/commit/3efe39654539568a8f2519994e49df3e1e726940))
* redact API keys from provider error text ([61bb622](https://github.com/namnhfreelancer/epubtrans/commit/61bb62228853e705a1239b4c9a5ed5655c486b16))
* redact legacy stored segment errors; test exact-key redaction wiring ([68ac185](https://github.com/namnhfreelancer/epubtrans/commit/68ac1857f3b30ecff88592f6bb485d3382d020a4))
* **web:** align the hints job with main's locks, scheduled estimates and compare-and-set saves ([36317c9](https://github.com/namnhfreelancer/epubtrans/commit/36317c9ad438e1656eb152fec9549a5176ca9748))
* **web:** cache bundled export fonts in the service worker for offline use ([232437f](https://github.com/namnhfreelancer/epubtrans/commit/232437fc7d3afef11a52fb4462696b45fe0a1f1a))
* **web:** debounce the cost estimate, stop the reader retry from starting a full run, lock guide editors, save samples with compare-and-set ([3e1854f](https://github.com/namnhfreelancer/epubtrans/commit/3e1854f424479855e8d3c4b18108b454a44f4175))
* **web:** keep book settings consistent across tabs ([b1e8609](https://github.com/namnhfreelancer/epubtrans/commit/b1e8609538de10f7ccf089405d63917a2515da60))
* **web:** keep edits safe when the same book is open in several tabs ([0b75df6](https://github.com/namnhfreelancer/epubtrans/commit/0b75df6be740f026c8c50c0106148ba09dc44a6b)), closes [#3](https://github.com/namnhfreelancer/epubtrans/issues/3)
* **web:** open preview links without opener, strip network hints, keep foliate-js notice ([86c1f33](https://github.com/namnhfreelancer/epubtrans/commit/86c1f335124beef0b102e786ba42db90be11ed66))
* **web:** price the confirmed settings and never overwrite a hand edit on tool retranslation ([a09f59a](https://github.com/namnhfreelancer/epubtrans/commit/a09f59ab3374561382018b0ea871dfcd64705cfa))
* **web:** report failed and hand-edited sample segments in the WebMCP tools ([6b2eb2f](https://github.com/namnhfreelancer/epubtrans/commit/6b2eb2f625ba80d2d1c626729ff2150330d2f9eb))
* **web:** report failed sample segments, count only reviewable drafts, debounce the sample estimate ([625b554](https://github.com/namnhfreelancer/epubtrans/commit/625b55422ebd4c8b6cb741f3e252e6d57a2d9cb9))
* **web:** reuse the scheduled hints plan on Generate instead of rescanning the book ([d2b5a02](https://github.com/namnhfreelancer/epubtrans/commit/d2b5a0277739a9006b0710a587973a815a1fe96d))
* **web:** start only the confirmed run and guard hand edits, deletes and redirects in WebMCP tools ([4c3e129](https://github.com/namnhfreelancer/epubtrans/commit/4c3e129eebd8ea1d4db43cbd539565f78d33e49f))
* **web:** stop hints runs on a language change and save nested settings field by field ([33e3ba4](https://github.com/namnhfreelancer/epubtrans/commit/33e3ba40ded85eebfc2938ed0de324c118085eda))
* **web:** stop jobs for books deleted in another tab and test the compare-and-set loss path ([f301fd4](https://github.com/namnhfreelancer/epubtrans/commit/f301fd4e146f1551713fa921ff7197c03d2c5dc4))
* **web:** use core secret redaction for WebMCP outputs, redacting strings before serializing ([b3b476f](https://github.com/namnhfreelancer/epubtrans/commit/b3b476f43f3004f22749e4c6fd55fa66aec56156))
* **web:** wait for the chapter list in the error-navigation e2e; show the blocked hint on a locked resume button ([e55a547](https://github.com/namnhfreelancer/epubtrans/commit/e55a547b86d22ec5d2d3cd95a43ae82943662e35))

## [3.0.0](https://github.com/namnhfreelancer/epubtrans/compare/v2.12.0...v3.0.0) (2026-10-30)


### ⚠ BREAKING CHANGES

* rewrite epubtrans v3 as browser BYOK web app and CLI
* rewrite epubtrans v3 as browser BYOK web app and CLI ([#2](https://github.com/namnhfreelancer/epubtrans/issues/2))
* remove legacy Go v2 implementation
* fix unpack command

### Features

* add file utility functions ([1cf204a](https://github.com/namnhfreelancer/epubtrans/commit/1cf204a844cea0bae9059d4425894259d201ae92))
* add Gemini AI integration for generating translation guidelines ([a835d91](https://github.com/namnhfreelancer/epubtrans/commit/a835d918e36ad65b2f20e38ae7bf08d24dabcc84))
* add prepare command to automate EPUB preprocessing ([52d52a8](https://github.com/namnhfreelancer/epubtrans/commit/52d52a8fc50edc3acb50117bd68e65c8a9502962))
* add v3 rewrite plan ([ca0fa39](https://github.com/namnhfreelancer/epubtrans/commit/ca0fa3946cd4a8cd3e8de1df42e0a1bfd625a2ff))
* allow slyting command ([fd3c35b](https://github.com/namnhfreelancer/epubtrans/commit/fd3c35b9a5f1def00edc5b6a56abd94461a4a95f))
* **cli:** add Bun single-binary CLI with translate, resume, export, models and presets ([879b5f3](https://github.com/namnhfreelancer/epubtrans/commit/879b5f3a6dea9405d6bf51b27ad0dc4a597bf58e))
* **cmd:** add self-upgrade functionality and refactor version handling ([70d91c0](https://github.com/namnhfreelancer/epubtrans/commit/70d91c07a4696b87d210579fba29b6e99e763efa))
* **core:** add environment-agnostic book translation engine ([626868b](https://github.com/namnhfreelancer/epubtrans/commit/626868b28ca1e9a726c3675e2d6b69ec4053a2ff))
* enhance translation instruction handling ([c6673e2](https://github.com/namnhfreelancer/epubtrans/commit/c6673e26e17b2057340c054a969ade266db1aee7))
* enhance translation system with guidelines persistence and prompt presets ([2019f24](https://github.com/namnhfreelancer/epubtrans/commit/2019f2465e789bec003d39102689836437769ee5))
* impelement batch ([87142e9](https://github.com/namnhfreelancer/epubtrans/commit/87142e9c1245e04c552deedb0ba60244b21ebad9))
* improve ([32e8543](https://github.com/namnhfreelancer/epubtrans/commit/32e8543f70961cad5b245e76de77fd9ff92f1950))
* improve by batch translate ([aee876d](https://github.com/namnhfreelancer/epubtrans/commit/aee876d0cde10ca25f19ffee947cdfe393e954ec))
* improve command docs and example ([ddacd2e](https://github.com/namnhfreelancer/epubtrans/commit/ddacd2e11f2faf068c5bc01cc08a6a7777f633b3))
* improve the eidtor ([b949086](https://github.com/namnhfreelancer/epubtrans/commit/b949086fe86c8ee46193ee69e3b0992dad09d06e))
* improve translation prompts for psychology and technical content ([1e0ecc2](https://github.com/namnhfreelancer/epubtrans/commit/1e0ecc293f6c4e8b56582eeab6e639421bfdb334))
* install CLI binaries from GitHub releases with checksum verification ([3fa194f](https://github.com/namnhfreelancer/epubtrans/commit/3fa194f9d829754250cd12694a063313a20111b1))
* **install:** add installation guide and scripts ([fb4fd3f](https://github.com/namnhfreelancer/epubtrans/commit/fb4fd3f90701d8db78161eada3e3d87f6b091003))
* remove numWorkers flag from translate command ([d4012db](https://github.com/namnhfreelancer/epubtrans/commit/d4012dbc0be804cfdcb0e0710030cb15af0d2a15))
* rewrite epubtrans v3 as browser BYOK web app and CLI ([8256fd4](https://github.com/namnhfreelancer/epubtrans/commit/8256fd4e4415a6b8c929dc877e68e725d8d37427))
* rewrite epubtrans v3 as browser BYOK web app and CLI ([#2](https://github.com/namnhfreelancer/epubtrans/issues/2)) ([8256fd4](https://github.com/namnhfreelancer/epubtrans/commit/8256fd4e4415a6b8c929dc877e68e725d8d37427))
* **scripts:** remove unused imports in epub-translator-colab.ipynb ([a9bedf0](https://github.com/namnhfreelancer/epubtrans/commit/a9bedf0309df869008e614a47b566fc1e2355c16))
* **scripts:** update colab notebook ([e6301b2](https://github.com/namnhfreelancer/epubtrans/commit/e6301b21db0e8307a0d15cbb15bf0b21c9a24b2e))
* support colab ([7e1ad2e](https://github.com/namnhfreelancer/epubtrans/commit/7e1ad2ee10de7c7124077a402f5e4e5155893ee7))
* support language config ([8f2c740](https://github.com/namnhfreelancer/epubtrans/commit/8f2c740d442773bb3c9efe121a62410e200beea6))
* support multiple prompt ([1b25986](https://github.com/namnhfreelancer/epubtrans/commit/1b25986daeb88813ea9c42d8dc095c0caa8337bf))
* support serve command ([57e3414](https://github.com/namnhfreelancer/epubtrans/commit/57e34141dbddd63a6aab67bf97bd99fc72e91bcd))
* **toc:** open table of contents links in new tab ([7108fa2](https://github.com/namnhfreelancer/epubtrans/commit/7108fa2be9acc1013e328691944db6c4d844b9e0))
* **translation:** enhance translation system and add metadata tracking ([e6a22b4](https://github.com/namnhfreelancer/epubtrans/commit/e6a22b41f3d45e03d23b7d9680da7ad90e9ca1fb))
* **translator:** improve translation process and error handling ([3f0fd66](https://github.com/namnhfreelancer/epubtrans/commit/3f0fd66fcc5f1f1a8c8ab83939935aad935fdf6a))
* update build config ([f82e39f](https://github.com/namnhfreelancer/epubtrans/commit/f82e39f1b212b0cb143fc5b35b8c399cfd8231f3))
* update build config ([1d110ef](https://github.com/namnhfreelancer/epubtrans/commit/1d110efbcc33c15e22e80589ba5e92584a5d864f))
* Update translation logic and metadata tracking ([e4342e4](https://github.com/namnhfreelancer/epubtrans/commit/e4342e41e0b29408579b5c58cde11aa387ba859e))
* **upgrade:** improve checksum verification and binary installation ([0210aca](https://github.com/namnhfreelancer/epubtrans/commit/0210acab019cabf1f729fd7a642b7edb48c32701))
* **web:** add static BYOK web app for translating books in the browser ([0714c90](https://github.com/namnhfreelancer/epubtrans/commit/0714c9021fc4f7a3353f840a5263f503ebfed816))


### Bug Fixes

* **ci:** publish the release only after the CLI binaries are attached ([2cd0504](https://github.com/namnhfreelancer/epubtrans/commit/2cd0504d62f7ecf103eb10ed96bb7052e7e17fc7))
* **cli:** exit with 130 on Ctrl-C at the confirmation prompt ([827d90e](https://github.com/namnhfreelancer/epubtrans/commit/827d90e972b1346579acf3c4ca88ee77d7d16f61))
* **cli:** keep EPUBTRANS_API_KEY working for default-provider projects ([b200c65](https://github.com/namnhfreelancer/epubtrans/commit/b200c65779a485d04595638003c4e94aaec5c793))
* **cli:** never send EPUBTRANS_API_KEY to a provider chosen only by a project file ([21305cb](https://github.com/namnhfreelancer/epubtrans/commit/21305cb307649992985fc9eb300b085d7db01c85))
* **cli:** never send the API key to an endpoint taken from a project file ([c4b1787](https://github.com/namnhfreelancer/epubtrans/commit/c4b178780d44e5e1eaef1db16660a0cf59804d4c))
* **core:** close remaining source-book script vectors in exported packages ([24f3389](https://github.com/namnhfreelancer/epubtrans/commit/24f3389dbce4797a8498b1adf6856ae557cadf1a))
* **core:** drop aria-label on nav so exports pass epubcheck ([781e64d](https://github.com/namnhfreelancer/epubtrans/commit/781e64d7d0c9a539eaa6ffd879b4bb0dd4d25e41))
* **core:** keep script vectors out of exported EPUBs ([a3bd368](https://github.com/namnhfreelancer/epubtrans/commit/a3bd3681128d095508d6928e453b1099e8a7ff9a))
* **core:** never overwrite a segment edited during a translation run ([d04abc8](https://github.com/namnhfreelancer/epubtrans/commit/d04abc863cc93aed85da3ce03fae2f45acbc1e3d))
* **core:** sanitize every markup file of exported packages ([b63457e](https://github.com/namnhfreelancer/epubtrans/commit/b63457eaf6eea4020f06e32848e68900ae1b11c6))
* correct serve assest ([768735e](https://github.com/namnhfreelancer/epubtrans/commit/768735e1ad5fba47dde882b804f257289fc9f306))
* fix unpack command ([8a30cf7](https://github.com/namnhfreelancer/epubtrans/commit/8a30cf72a46b19314e26093ae8c8f4fc77ed11ce))
* remove unused folder ([cf12268](https://github.com/namnhfreelancer/epubtrans/commit/cf1226834bc5a38d22ef2ef6ab3716582e227017))
* **translator:** improve error handling and logging ([8cb3a00](https://github.com/namnhfreelancer/epubtrans/commit/8cb3a005566310b28c0e8c9ee2ba61bcf2b455a3))
* update error message ([0a292f9](https://github.com/namnhfreelancer/epubtrans/commit/0a292f985763eff2f759521f7b55082fb290e6d4))
* update originalContent on blur in enableContentEditable function ([8241aad](https://github.com/namnhfreelancer/epubtrans/commit/8241aada33da27f41fc9480f0ccce8c9c8b7ada8))
* **util:** improve error handling and add tests for GetUnzipDestination ([e9690ba](https://github.com/namnhfreelancer/epubtrans/commit/e9690ba0eb95885789ddac2208c08fb901441902))
* **web:** lock reader edit and retranslate while a job runs ([9260688](https://github.com/namnhfreelancer/epubtrans/commit/9260688eb1debced416d2724926b9f9608c154dc))
* **web:** warn that a remembered key is exposed to the shared Pages origin ([a28b8ce](https://github.com/namnhfreelancer/epubtrans/commit/a28b8ce7be237c1468f96969509cc59c5e7c566a))


### Miscellaneous Chores

* remove legacy Go v2 implementation ([5c3e659](https://github.com/namnhfreelancer/epubtrans/commit/5c3e65935c6a8f916f1c828753ae44095a05f44c))

## [2.12.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.11.0...v2.12.0) (2025-03-06)


### Features

* add file utility functions ([1cf204a](https://github.com/nguyenvanduocit/epubtrans/commit/1cf204a844cea0bae9059d4425894259d201ae92))
* add Gemini AI integration for generating translation guidelines ([a835d91](https://github.com/nguyenvanduocit/epubtrans/commit/a835d918e36ad65b2f20e38ae7bf08d24dabcc84))
* add prepare command to automate EPUB preprocessing ([52d52a8](https://github.com/nguyenvanduocit/epubtrans/commit/52d52a8fc50edc3acb50117bd68e65c8a9502962))
* enhance translation system with guidelines persistence and prompt presets ([2019f24](https://github.com/nguyenvanduocit/epubtrans/commit/2019f2465e789bec003d39102689836437769ee5))
* improve translation prompts for psychology and technical content ([1e0ecc2](https://github.com/nguyenvanduocit/epubtrans/commit/1e0ecc293f6c4e8b56582eeab6e639421bfdb334))

## [2.11.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.10.0...v2.11.0) (2024-11-02)


### Features

* impelement batch ([87142e9](https://github.com/nguyenvanduocit/epubtrans/commit/87142e9c1245e04c552deedb0ba60244b21ebad9))
* improve by batch translate ([aee876d](https://github.com/nguyenvanduocit/epubtrans/commit/aee876d0cde10ca25f19ffee947cdfe393e954ec))
* support multiple prompt ([1b25986](https://github.com/nguyenvanduocit/epubtrans/commit/1b25986daeb88813ea9c42d8dc095c0caa8337bf))

## [2.10.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.9.0...v2.10.0) (2024-09-09)


### Features

* **toc:** open table of contents links in new tab ([7108fa2](https://github.com/nguyenvanduocit/epubtrans/commit/7108fa2be9acc1013e328691944db6c4d844b9e0))

## [2.9.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.8.0...v2.9.0) (2024-09-09)


### Features

* enhance translation instruction handling ([c6673e2](https://github.com/nguyenvanduocit/epubtrans/commit/c6673e26e17b2057340c054a969ade266db1aee7))

## [2.8.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.7.0...v2.8.0) (2024-09-09)


### Features

* improve the eidtor ([b949086](https://github.com/nguyenvanduocit/epubtrans/commit/b949086fe86c8ee46193ee69e3b0992dad09d06e))


### Bug Fixes

* correct serve assest ([768735e](https://github.com/nguyenvanduocit/epubtrans/commit/768735e1ad5fba47dde882b804f257289fc9f306))
* remove unused folder ([cf12268](https://github.com/nguyenvanduocit/epubtrans/commit/cf1226834bc5a38d22ef2ef6ab3716582e227017))
* update originalContent on blur in enableContentEditable function ([8241aad](https://github.com/nguyenvanduocit/epubtrans/commit/8241aada33da27f41fc9480f0ccce8c9c8b7ada8))

## [2.7.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.6.0...v2.7.0) (2024-08-26)


### Features

* improve ([32e8543](https://github.com/nguyenvanduocit/epubtrans/commit/32e8543f70961cad5b245e76de77fd9ff92f1950))
* **translation:** enhance translation system and add metadata tracking ([e6a22b4](https://github.com/nguyenvanduocit/epubtrans/commit/e6a22b41f3d45e03d23b7d9680da7ad90e9ca1fb))

## [2.6.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.5.1...v2.6.0) (2024-08-19)


### Features

* Update translation logic and metadata tracking ([e4342e4](https://github.com/nguyenvanduocit/epubtrans/commit/e4342e41e0b29408579b5c58cde11aa387ba859e))

## [2.5.1](https://github.com/nguyenvanduocit/epubtrans/compare/v2.5.0...v2.5.1) (2024-08-13)


### Bug Fixes

* update error message ([0a292f9](https://github.com/nguyenvanduocit/epubtrans/commit/0a292f985763eff2f759521f7b55082fb290e6d4))

## [2.5.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.4.0...v2.5.0) (2024-08-13)


### Features

* **translator:** improve translation process and error handling ([3f0fd66](https://github.com/nguyenvanduocit/epubtrans/commit/3f0fd66fcc5f1f1a8c8ab83939935aad935fdf6a))

## [2.4.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.3.1...v2.4.0) (2024-08-12)


### Features

* **scripts:** update colab notebook ([e6301b2](https://github.com/nguyenvanduocit/epubtrans/commit/e6301b21db0e8307a0d15cbb15bf0b21c9a24b2e))

## [2.3.1](https://github.com/nguyenvanduocit/epubtrans/compare/v2.3.0...v2.3.1) (2024-08-12)


### Bug Fixes

* **util:** improve error handling and add tests for GetUnzipDestination ([e9690ba](https://github.com/nguyenvanduocit/epubtrans/commit/e9690ba0eb95885789ddac2208c08fb901441902))

## [2.3.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.2.0...v2.3.0) (2024-08-12)


### Features

* **scripts:** remove unused imports in epub-translator-colab.ipynb ([a9bedf0](https://github.com/nguyenvanduocit/epubtrans/commit/a9bedf0309df869008e614a47b566fc1e2355c16))


### Bug Fixes

* **translator:** improve error handling and logging ([8cb3a00](https://github.com/nguyenvanduocit/epubtrans/commit/8cb3a005566310b28c0e8c9ee2ba61bcf2b455a3))

## [2.2.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.1.0...v2.2.0) (2024-08-12)


### Features

* remove numWorkers flag from translate command ([d4012db](https://github.com/nguyenvanduocit/epubtrans/commit/d4012dbc0be804cfdcb0e0710030cb15af0d2a15))

## [2.1.0](https://github.com/nguyenvanduocit/epubtrans/compare/v2.0.0...v2.1.0) (2024-08-12)


### Features

* support colab ([7e1ad2e](https://github.com/nguyenvanduocit/epubtrans/commit/7e1ad2ee10de7c7124077a402f5e4e5155893ee7))

## [2.0.0](https://github.com/nguyenvanduocit/epubtrans/compare/v1.6.0...v2.0.0) (2024-08-12)


### ⚠ BREAKING CHANGES

* fix unpack command

### Bug Fixes

* fix unpack command ([8a30cf7](https://github.com/nguyenvanduocit/epubtrans/commit/8a30cf72a46b19314e26093ae8c8f4fc77ed11ce))

## [1.6.0](https://github.com/nguyenvanduocit/epubtrans/compare/v1.5.0...v1.6.0) (2024-08-12)


### Features

* **upgrade:** improve checksum verification and binary installation ([0210aca](https://github.com/nguyenvanduocit/epubtrans/commit/0210acab019cabf1f729fd7a642b7edb48c32701))

## [1.5.0](https://github.com/nguyenvanduocit/epubtrans/compare/v1.4.0...v1.5.0) (2024-08-12)


### Features

* **cmd:** add self-upgrade functionality and refactor version handling ([70d91c0](https://github.com/nguyenvanduocit/epubtrans/commit/70d91c07a4696b87d210579fba29b6e99e763efa))

## [1.4.0](https://github.com/nguyenvanduocit/epubtrans/compare/v1.3.0...v1.4.0) (2024-08-12)


### Features

* improve command docs and example ([ddacd2e](https://github.com/nguyenvanduocit/epubtrans/commit/ddacd2e11f2faf068c5bc01cc08a6a7777f633b3))

## [1.3.0](https://github.com/nguyenvanduocit/epubtrans/compare/v1.2.0...v1.3.0) (2024-08-12)


### Features

* update build config ([f82e39f](https://github.com/nguyenvanduocit/epubtrans/commit/f82e39f1b212b0cb143fc5b35b8c399cfd8231f3))
* update build config ([1d110ef](https://github.com/nguyenvanduocit/epubtrans/commit/1d110efbcc33c15e22e80589ba5e92584a5d864f))

## [1.2.0](https://github.com/nguyenvanduocit/epubtrans/compare/v1.1.0...v1.2.0) (2024-08-12)


### Features

* **install:** add installation guide and scripts ([fb4fd3f](https://github.com/nguyenvanduocit/epubtrans/commit/fb4fd3f90701d8db78161eada3e3d87f6b091003))

## [1.1.0](https://github.com/nguyenvanduocit/epubtrans/compare/v1.0.0...v1.1.0) (2024-08-12)


### Features

* allow slyting command ([fd3c35b](https://github.com/nguyenvanduocit/epubtrans/commit/fd3c35b9a5f1def00edc5b6a56abd94461a4a95f))
* support language config ([8f2c740](https://github.com/nguyenvanduocit/epubtrans/commit/8f2c740d442773bb3c9efe121a62410e200beea6))
* support serve command ([57e3414](https://github.com/nguyenvanduocit/epubtrans/commit/57e34141dbddd63a6aab67bf97bd99fc72e91bcd))

## 1.0.0 (2024-08-02)


### Features

* support language config ([8f2c740](https://github.com/nguyenvanduocit/epubtrans/commit/8f2c740d442773bb3c9efe121a62410e200beea6))
* support serve command ([57e3414](https://github.com/nguyenvanduocit/epubtrans/commit/57e34141dbddd63a6aab67bf97bd99fc72e91bcd))

## 1.0.0 (2024-07-31)


### Features

* support auto release ([081d9a5](https://github.com/nguyenvanduocit/book-translate-toolkit/commit/081d9a5ed44a52968b8431550b5109b246359e60))
