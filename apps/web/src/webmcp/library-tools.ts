import { repository } from '../lib/app-services';
import { isJobRunningElsewhere } from '../lib/cross-tab-job-lock';
import { deleteBookFromDevice } from '../lib/delete-book-from-device';
import { dialogText } from '../lib/format';
import { BookImportError, isProjectFileName, readProjectFromFile } from '../lib/import-book-file';
import { pushNotice } from '../lib/notices';
import { addProject } from '../lib/project-store';
import { countSegments } from '../lib/segment-counts';
import { getJobState } from '../lib/translation-jobs';
import { fetchBookFromUrl, parseBookUrl } from './fetch-book-from-url';
import { busyFailure, englishMessage, findBook, isFailure, type ToolContext } from './tool-context';
import { BOOK_ID, objectSchema, type ToolSpec } from './tool-definition';
import { clip, fail, fitList, ok, untrustedText } from './tool-result';

const MAX_LISTED_BOOKS = 30;

/** Library tools: list, import from a URL, delete. */
export function libraryTools(ctx: ToolContext): ToolSpec[] {
  return [
    {
      name: 'list_books',
      title: 'List books',
      description:
        'Lists the books in the local library, most recently changed first (up to 30): id, title, author, target language, translated/total/failed segment counts and the translation job status. Use the id with the other tools. Titles come from the books themselves.',
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      run: async () => {
        const books = await repository.listProjects();
        const items = books.slice(0, MAX_LISTED_BOOKS).map((b) => ({
          id: b.id,
          title: untrustedText(b.title, 100),
          ...(b.author ? { author: untrustedText(b.author, 60) } : {}),
          targetLang: b.targetLang,
          done: b.done,
          total: b.total,
          errors: b.errors,
          job: getJobState(b.id).status,
        }));
        return fitList(items, (shown) => ok({ count: books.length, books: shown }));
      },
    },
    {
      name: 'import_book_from_url',
      title: 'Import a book from a URL',
      description:
        'Downloads a DRM-free EPUB, MOBI, AZW3, FB2 or .epubtrans file from an https URL into the library after the user approves the host in the page. The host must allow downloads from web pages (CORS); many sites do not, and then the user drops the file on the library page instead. Returns the new book id.',
      inputSchema: objectSchema({ url: { type: 'string', description: 'Absolute https:// URL of the book file.', maxLength: 2048 } }, ['url']),
      annotations: { untrustedContentHint: true },
      run: async (args, signal) => {
        const url = parseBookUrl(args.string('url'));
        if (isFailure(url)) return url;
        const question = ctx.t('webmcp.importConfirm', { host: dialogText(url.host, 120), url: dialogText(url.href, 300) });
        if (!ctx.confirm(ctx.t('webmcp.agentAsks', { question }))) return ok({ imported: false, reason: 'declined' });
        const file = await fetchBookFromUrl(ctx, url, signal);
        if (isFailure(file)) return file;
        let project: Awaited<ReturnType<typeof readProjectFromFile>>;
        try {
          project = await readProjectFromFile(file);
        } catch (err) {
          const kind = err instanceof BookImportError ? err.kind : 'generic';
          return fail(`${englishMessage(`import.error.${kind}`)} (${clip(err instanceof Error ? err.message : String(err), 200)})`);
        }
        if (isProjectFileName(file.name) && (await repository.exists(project.id))) {
          return fail('This project is already in the library.', 'Only the user can replace it: ask them to drop the file on the library page.');
        }
        await addProject(project);
        pushNotice('success', ctx.t('library.imported', { title: project.title }));
        ctx.navigate({ name: 'book', id: project.id, tab: 'setup' });
        return ok({
          bookId: project.id,
          title: untrustedText(project.title, 100),
          segments: countSegments(project).total,
          sourceLang: project.settings.sourceLang,
          targetLang: project.settings.targetLang,
        });
      },
    },
    {
      name: 'delete_book',
      title: 'Delete a book',
      description:
        'Deletes a book and its translation progress from this device after the user confirms in the page. A running translation, sample or guideline generation of the book is stopped first. This cannot be undone.',
      inputSchema: objectSchema({ bookId: BOOK_ID }, ['bookId']),
      annotations: { consequentialHint: true, untrustedContentHint: true },
      run: async (args) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const title = project.title;
        if (await isJobRunningElsewhere(project.id)) return busyFailure('busy-elsewhere');
        const question = ctx.t('library.deleteConfirm', { title: dialogText(title, 120) });
        if (!ctx.confirm(ctx.t('webmcp.agentAsks', { question }))) return ok({ deleted: false, reason: 'declined' });
        // A job may have started in another tab while the dialog was open.
        if (await isJobRunningElsewhere(project.id)) return busyFailure('busy-elsewhere');
        await deleteBookFromDevice(project.id);
        pushNotice('info', ctx.t('library.deleted', { title }));
        ctx.navigate({ name: 'library' });
        return ok({ deleted: true, bookId: project.id, title: untrustedText(title, 100) });
      },
    },
  ];
}
