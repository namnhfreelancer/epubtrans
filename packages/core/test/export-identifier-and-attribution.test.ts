import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { attributionText, exportEpub, exportIdentifier, importBook, loadProjectFile, type Project, saveProjectFile } from '../src';
import { sha1, uuidV5 } from '../src/util/name-based-uuid';
import { readZip } from '../src/util/zip-archive';
import { buildEpub2Book, EPUB2_IDENTIFIER } from './epub2-fixture';
import { env, fakeTranslate, readFixture, unzipText } from './test-helpers';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function translated(bytes: Uint8Array, name: string): Promise<Project> {
  const project = await importBook(bytes, name, env);
  for (const s of project.chapters.flatMap((c) => c.segments)) {
    s.translationHtml = fakeTranslate(s.sourceHtml);
    s.status = 'translated';
  }
  return project;
}

const ENCRYPTION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
<enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/font.otf"/></enc:CipherData></enc:EncryptedData>
</encryption>`;

describe('name-based UUIDs', () => {
  it('SHA-1 matches the FIPS test vectors', () => {
    expect(hex(sha1(strToU8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(strToU8('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(strToU8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
  });

  it('UUID v5 matches the RFC example (DNS namespace, python.org)', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('export identifiers are stable and differ by target language and mode', () => {
    const id = exportIdentifier('urn:isbn:123', 'vi', 'bilingual');
    expect(id).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(exportIdentifier('urn:isbn:123', 'VI', 'bilingual')).toBe(id);
    expect(exportIdentifier('urn:isbn:123', 'fr', 'bilingual')).not.toBe(id);
    expect(exportIdentifier('urn:isbn:123', 'vi', 'translation-only')).not.toBe(id);
    expect(exportIdentifier('urn:isbn:124', 'vi', 'bilingual')).not.toBe(id);
  });
});

describe('export identifier', () => {
  it('gives the export its own unique identifier and keeps the source id (EPUB 3)', async () => {
    const project = await translated(readFixture('a-modest-proposal.epub'), 'a.epub');
    const out = await exportEpub(project, 'bilingual', env);
    const opf = unzipText(out, 'OEBPS/content.opf');
    const expected = exportIdentifier('http://www.gutenberg.org/1080', 'vi', 'bilingual');
    expect(opf).toContain('unique-identifier="epubtrans-uid"');
    expect(opf).toContain(`<dc:identifier id="epubtrans-uid">${expected}</dc:identifier>`);
    expect(opf).toContain('<dc:identifier id="id">http://www.gutenberg.org/1080</dc:identifier>');
    expect(opf).toContain('<dc:source>http://www.gutenberg.org/1080</dc:source>');
    // The same export again gives the same identifier.
    expect(unzipText(await exportEpub(project, 'bilingual', env), 'OEBPS/content.opf')).toContain(expected);
  });

  it('updates the NCX uid of EPUB 2 books', async () => {
    const project = await translated(buildEpub2Book(), 'b.epub');
    const out = await exportEpub(project, 'translation-only', env);
    const expected = exportIdentifier(EPUB2_IDENTIFIER, 'vi', 'translation-only');
    const opf = unzipText(out, 'OEBPS/content.opf');
    expect(opf).toContain('unique-identifier="epubtrans-uid"');
    expect(opf).toContain(`<dc:identifier id="bookid" opf:scheme="UUID">${EPUB2_IDENTIFIER}</dc:identifier>`);
    expect(unzipText(out, 'OEBPS/toc.ncx')).toContain(`<meta name="dtb:uid" content="${expected}"`);
  });

  it('keeps the source identifier when fonts are obfuscated (encryption.xml)', async () => {
    const book = buildEpub2Book(new Map([['META-INF/encryption.xml', strToU8(ENCRYPTION_XML)]]));
    const project = await translated(book, 'b.epub');
    const out = await exportEpub(project, 'bilingual', env);
    const opf = unzipText(out, 'OEBPS/content.opf');
    expect(readZip(out).has('META-INF/encryption.xml')).toBe(true);
    expect(opf).toContain('unique-identifier="bookid"');
    expect(opf).not.toContain('epubtrans-uid');
    expect(unzipText(out, 'OEBPS/toc.ncx')).toContain(`content="${EPUB2_IDENTIFIER}"`);
  });
});

describe('attribution', () => {
  it('is off by default and opt-in per book', async () => {
    const project = await translated(readFixture('a-modest-proposal.epub'), 'a.epub');
    project.settings.model = 'claude-opus-5.5';
    expect(readZip(await exportEpub(project, 'bilingual', env)).has('OEBPS/epubtrans-attribution.xhtml')).toBe(false);
    project.settings.attribution = true;
    const out = await exportEpub(project, 'bilingual', env);
    const page = unzipText(out, 'OEBPS/epubtrans-attribution.xhtml');
    expect(page).toContain('<!DOCTYPE html>');
    expect(page).toContain('lang="vi" xml:lang="vi"');
    expect(page).toContain('epub:type="colophon"');
    expect(page).toContain('Dịch bằng claude-opus-5.5 với epubtrans');
    const opf = unzipText(out, 'OEBPS/content.opf');
    expect(opf).toMatch(/<itemref idref="epubtrans-attribution"\s*\/><\/spine>/);
    expect(opf).toMatch(/id="epubtrans-attribution"/);
    expect(unzipText(out, 'OEBPS/epubtrans.css')).toContain('.et-attr');
  });

  it('writes the model name as text only, falls back to English, and skips modes without a translation', async () => {
    const project = await translated(buildEpub2Book(), 'b.epub');
    project.settings = { ...project.settings, attribution: true, targetLang: 'sw', model: '<img src=x onerror=alert(1)>$&' };
    const out = await exportEpub(project, 'translation-only', env);
    const page = unzipText(out, 'OEBPS/epubtrans-attribution.xhtml');
    expect(page).toContain('Translated with &lt;img src=x onerror=alert(1)&gt;$&amp; by epubtrans');
    expect(page).not.toContain('<img');
    expect(page).toContain('XHTML 1.1');
    expect(page).toContain('xml:lang="en"');
    expect(page).not.toContain(' lang=');
    expect(readZip(await exportEpub(project, 'original', env)).has('OEBPS/epubtrans-attribution.xhtml')).toBe(false);
    for (const s of project.chapters.flatMap((c) => c.segments)) s.status = 'pending';
    expect(readZip(await exportEpub(project, 'bilingual', env)).has('OEBPS/epubtrans-attribution.xhtml')).toBe(false);
  });

  it('phrases per language', () => {
    expect(attributionText('fr-CA', 'm')).toEqual({ lang: 'fr-CA', text: 'Traduit avec m par epubtrans' });
    expect(attributionText('xx', 'm')).toEqual({ lang: 'en', text: 'Translated with m by epubtrans' });
    expect(attributionText('vi', '  ')).toEqual({ lang: 'vi', text: 'Dịch bằng AI với epubtrans' });
  });
});

describe('project files keep the export style and the attribution choice', () => {
  it('round-trips both and rejects invalid values', async () => {
    const project = await translated(buildEpub2Book(), 'b.epub');
    project.settings = { ...project.settings, attribution: true, exportStyle: { preset: 'learner', hint: { color: '#1f7a8c' } } };
    const loaded = await loadProjectFile(await saveProjectFile(project));
    expect(loaded.settings.attribution).toBe(true);
    expect(loaded.settings.exportStyle).toEqual({ preset: 'learner', hint: { color: '#1f7a8c' } });

    project.settings = { ...project.settings, attribution: false, exportStyle: undefined };
    const off = await loadProjectFile(await saveProjectFile(project));
    expect('attribution' in off.settings).toBe(false);
    expect('exportStyle' in off.settings).toBe(false);

    const bad = { ...project, settings: { ...project.settings, exportStyle: { source: { color: 'url(x)' } } } } as unknown as Project;
    await expect(loadProjectFile(await saveProjectFile(bad))).rejects.toThrow(/settings\.exportStyle\.source\.color/);
    const badFlag = { ...project, settings: { ...project.settings, attribution: 'yes' } } as unknown as Project;
    await expect(loadProjectFile(await saveProjectFile(badFlag))).rejects.toThrow(/attribution/);
  });
});
