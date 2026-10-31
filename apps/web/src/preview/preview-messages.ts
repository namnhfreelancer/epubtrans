import { useCallback } from 'react';
import { useI18n } from '../i18n/i18n-context';
import { formatMessage, type Locale, type MessageParams } from '../i18n/translate-message';

/**
 * Strings of the preview tab. Kept beside the feature (same locales and `{placeholder}` syntax as the app dictionary)
 * so the preview stays a self-contained module; the tab label itself lives in the app dictionary.
 */
const en = {
  'preview.loading': 'Building the preview…',
  'preview.updating': 'Updating…',
  'preview.failed': 'Preview failed: {message}',
  'preview.mode': 'Layout',
  'preview.device': 'Device',
  'preview.device.kindle': 'Kindle (6.8")',
  'preview.device.phone': 'Phone',
  'preview.device.tablet': 'Tablet',
  'preview.device.desktop': 'Desktop',
  'preview.theme': 'Theme',
  'preview.theme.light': 'Light',
  'preview.theme.sepia': 'Sepia',
  'preview.theme.dark': 'Dark',
  'preview.flow': 'Display',
  'preview.flow.paginated': 'Pages',
  'preview.flow.scrolled': 'Scroll',
  'preview.fontSize': 'Font size',
  'preview.fontSmaller': 'Smaller text',
  'preview.fontLarger': 'Larger text',
  'preview.showIssues': 'Show issues',
  'preview.issueBadge': 'Error',
  'preview.prev': 'Previous page',
  'preview.next': 'Next page',
  'preview.progress': '{percent}%',
  'preview.contents': 'Contents',
  'preview.noContents': 'This book has no table of contents.',
  'preview.search': 'Search',
  'preview.searchPlaceholder': 'Search in book',
  'preview.searching': 'Searching… {percent}%',
  'preview.searchResults': '{n} results',
  'preview.noResults': 'No results.',
  'preview.clearSearch': 'Clear',
  'preview.hint': 'Click a paragraph to open it in the editor. Device, theme and font settings only affect this preview, never the exported file.',
  'preview.frameLabel': 'Book preview',
} as const;

type PreviewMessageKey = keyof typeof en;

const vi: Record<PreviewMessageKey, string> = {
  'preview.loading': 'Đang dựng bản xem trước…',
  'preview.updating': 'Đang cập nhật…',
  'preview.failed': 'Không xem trước được: {message}',
  'preview.mode': 'Bố cục',
  'preview.device': 'Thiết bị',
  'preview.device.kindle': 'Kindle (6,8")',
  'preview.device.phone': 'Điện thoại',
  'preview.device.tablet': 'Máy tính bảng',
  'preview.device.desktop': 'Máy tính',
  'preview.theme': 'Giao diện',
  'preview.theme.light': 'Sáng',
  'preview.theme.sepia': 'Giấy cũ',
  'preview.theme.dark': 'Tối',
  'preview.flow': 'Hiển thị',
  'preview.flow.paginated': 'Lật trang',
  'preview.flow.scrolled': 'Cuộn',
  'preview.fontSize': 'Cỡ chữ',
  'preview.fontSmaller': 'Chữ nhỏ hơn',
  'preview.fontLarger': 'Chữ lớn hơn',
  'preview.showIssues': 'Hiện đoạn có vấn đề',
  'preview.issueBadge': 'Lỗi',
  'preview.prev': 'Trang trước',
  'preview.next': 'Trang sau',
  'preview.progress': '{percent}%',
  'preview.contents': 'Mục lục',
  'preview.noContents': 'Sách này không có mục lục.',
  'preview.search': 'Tìm',
  'preview.searchPlaceholder': 'Tìm trong sách',
  'preview.searching': 'Đang tìm… {percent}%',
  'preview.searchResults': '{n} kết quả',
  'preview.noResults': 'Không có kết quả.',
  'preview.clearSearch': 'Xoá',
  'preview.hint': 'Bấm vào một đoạn để mở nó trong trình sửa. Thiết bị, giao diện và cỡ chữ chỉ áp dụng cho bản xem trước, không bao giờ vào tệp xuất.',
  'preview.frameLabel': 'Bản xem trước sách',
};

export const PREVIEW_MESSAGES: Record<Locale, Record<PreviewMessageKey, string>> = { en, vi };

export type PreviewTranslate = (key: PreviewMessageKey, params?: MessageParams) => string;

/** Preview strings in the current interface language. */
export function usePreviewText(): PreviewTranslate {
  const { locale } = useI18n();
  return useCallback((key, params) => formatMessage(PREVIEW_MESSAGES[locale][key] ?? en[key], params), [locale]);
}
