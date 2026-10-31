import { useCallback } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { formatMessage, type Locale, type MessageParams } from '../../i18n/translate-message';

/**
 * Strings of the book style editor and the style templates (export and preview tabs). Kept beside the feature, with
 * the same locales and `{placeholder}` syntax as the app dictionary, like the preview's strings.
 */
const en = {
  'style.title': 'Book style',
  'style.intro':
    'Colors, sizes and fonts of the exported book, written into its stylesheet only. No background is set, so reader themes (light, sepia, dark) keep working. Changes show in the Preview tab.',
  'style.preset': 'Preset',
  'style.preset.custom': 'Custom',
  'style.preset.classic': 'Classic (faded original)',
  'style.preset.learner': 'Learner (prominent hints)',
  'style.preset.high-contrast': 'High contrast',
  'style.preset.translation-emphasis': 'Translation emphasis',
  'style.preset.minimal': 'Minimal',
  'style.source': 'Original text',
  'style.sourceHint': 'Applies to the bilingual layouts.',
  'style.translation': 'Translation',
  'style.hints': 'Word Wise hints',
  'style.color': 'Color',
  'style.customColor': 'Custom color',
  'style.opacity': 'Opacity',
  'style.size': 'Size',
  'style.italic': 'Italic',
  'style.font': 'Font',
  'style.weight': 'Weight',
  'style.spacing': 'Space between blocks',
  'style.default': 'Default',
  'style.inherit': 'As in the book',
  'style.font.serif': 'Serif (reader’s font)',
  'style.font.sans-serif': 'Sans-serif (reader’s font)',
  'style.font.monospace': 'Monospace (reader’s font)',
  'style.font.embedded': '{family} (embedded)',
  'style.weight.normal': 'Normal',
  'style.weight.bold': 'Bold',
  'style.fontsSize': 'Embedded fonts add about {size} to the EPUB before compression (SIL Open Font License, included in the book).',
  'style.attribution': 'Add a “Translated with {model} by epubtrans” page at the end',
  'style.attributionHint': 'Off by default. A short page after the last chapter; no other page changes.',
  'style.saveFailed': 'Could not save the style: {message}',
  'style.presetConfirm': 'Replace this book’s custom style with the “{preset}” preset?',

  'templates.title': 'Style templates',
  'templates.intro':
    'Save this book’s style to reuse it for other books. Templates stay in this browser; export them to move them or use them in the CLI (--style-file).',
  'templates.empty': 'No templates yet.',
  'templates.name': 'Template name',
  'templates.save': 'Save as template',
  'templates.saved': 'Saved the template “{name}”.',
  'templates.overwriteConfirm': 'A template named “{name}” exists. Replace its style?',
  'templates.apply': 'Apply',
  'templates.applied': 'Applied “{name}” to this book.',
  'templates.rename': 'Rename',
  'templates.renamePrompt': 'New name for “{name}”',
  'templates.delete': 'Delete',
  'templates.deleteConfirm': 'Delete the template “{name}”?',
  'templates.export': 'Export',
  'templates.exportAll': 'Export all',
  'templates.import': 'Import…',
  'templates.imported': 'Imported {n} templates.',
  'templates.ignoredKeys': 'Skipped settings this version does not know (the file is from a newer version): {keys}',
  'templates.duplicate': 'A template named “{name}” already exists.',
  'templates.failed': 'Template action failed: {message}',
} as const;

export type StyleMessageKey = keyof typeof en;

const vi: Record<StyleMessageKey, string> = {
  'style.title': 'Kiểu trình bày sách',
  'style.intro':
    'Màu, cỡ chữ và phông chữ của sách xuất ra, chỉ ghi vào tệp CSS của sách. Không đặt màu nền nên các giao diện của trình đọc (sáng, giấy cũ, tối) vẫn hoạt động. Thay đổi hiện ngay trong thẻ Xem trước.',
  'style.preset': 'Mẫu có sẵn',
  'style.preset.custom': 'Tuỳ chỉnh',
  'style.preset.classic': 'Cổ điển (bản gốc mờ)',
  'style.preset.learner': 'Người học (chú thích nổi bật)',
  'style.preset.high-contrast': 'Tương phản cao',
  'style.preset.translation-emphasis': 'Nhấn mạnh bản dịch',
  'style.preset.minimal': 'Tối giản',
  'style.source': 'Văn bản gốc',
  'style.sourceHint': 'Áp dụng cho các bố cục song ngữ.',
  'style.translation': 'Bản dịch',
  'style.hints': 'Chú thích Word Wise',
  'style.color': 'Màu',
  'style.customColor': 'Màu tuỳ chọn',
  'style.opacity': 'Độ đậm',
  'style.size': 'Cỡ chữ',
  'style.italic': 'In nghiêng',
  'style.font': 'Phông chữ',
  'style.weight': 'Độ đậm nét',
  'style.spacing': 'Khoảng cách giữa các khối',
  'style.default': 'Mặc định',
  'style.inherit': 'Như trong sách',
  'style.font.serif': 'Có chân (phông của trình đọc)',
  'style.font.sans-serif': 'Không chân (phông của trình đọc)',
  'style.font.monospace': 'Đơn cách (phông của trình đọc)',
  'style.font.embedded': '{family} (nhúng vào sách)',
  'style.weight.normal': 'Thường',
  'style.weight.bold': 'Đậm',
  'style.fontsSize': 'Phông chữ nhúng làm EPUB nặng thêm khoảng {size} trước khi nén (giấy phép SIL Open Font License, có kèm trong sách).',
  'style.attribution': 'Thêm trang “Dịch bằng {model} với epubtrans” ở cuối sách',
  'style.attributionHint': 'Mặc định tắt. Một trang ngắn sau chương cuối; không trang nào khác bị thay đổi.',
  'style.saveFailed': 'Không lưu được kiểu trình bày: {message}',
  'style.presetConfirm': 'Thay kiểu trình bày tuỳ chỉnh của sách này bằng mẫu “{preset}”?',

  'templates.title': 'Mẫu kiểu trình bày',
  'templates.intro':
    'Lưu kiểu trình bày của sách này để dùng lại cho sách khác. Mẫu được lưu trong trình duyệt này; xuất ra tệp để chuyển sang máy khác hoặc dùng với CLI (--style-file).',
  'templates.empty': 'Chưa có mẫu nào.',
  'templates.name': 'Tên mẫu',
  'templates.save': 'Lưu thành mẫu',
  'templates.saved': 'Đã lưu mẫu “{name}”.',
  'templates.overwriteConfirm': 'Đã có mẫu tên “{name}”. Thay kiểu trình bày của mẫu đó?',
  'templates.apply': 'Áp dụng',
  'templates.applied': 'Đã áp dụng “{name}” cho sách này.',
  'templates.rename': 'Đổi tên',
  'templates.renamePrompt': 'Tên mới cho “{name}”',
  'templates.delete': 'Xoá',
  'templates.deleteConfirm': 'Xoá mẫu “{name}”?',
  'templates.export': 'Xuất',
  'templates.exportAll': 'Xuất tất cả',
  'templates.import': 'Nhập…',
  'templates.imported': 'Đã nhập {n} mẫu.',
  'templates.ignoredKeys': 'Đã bỏ qua các thiết lập mà phiên bản này chưa biết (tệp đến từ phiên bản mới hơn): {keys}',
  'templates.duplicate': 'Đã có mẫu tên “{name}”.',
  'templates.failed': 'Thao tác với mẫu thất bại: {message}',
};

export const STYLE_MESSAGES: Record<Locale, Record<StyleMessageKey, string>> = { en, vi };

export type StyleTranslate = (key: StyleMessageKey, params?: MessageParams) => string;

/** Style editor strings in the current interface language. */
export function useStyleText(): StyleTranslate {
  const { locale } = useI18n();
  return useCallback((key, params) => formatMessage(STYLE_MESSAGES[locale][key] ?? en[key], params), [locale]);
}
