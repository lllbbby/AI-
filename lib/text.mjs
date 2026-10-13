// 原译长度分别限制，避免较长的英文译文被截断。
export const SOURCE_LIMIT = 12000;
export const TRANSLATION_LIMIT = 48000;
export const CONTEXT_LIMIT = 3000;

export function getLengthError({ source, translation, context = '' }) {
  if (source.length > SOURCE_LIMIT) return { field: 'source', message: '中文原文超过 12,000 字符，请分章提交。' };
  if (translation.length > TRANSLATION_LIMIT) return { field: 'translation', message: '英文译文超过 48,000 字符，请分章提交。' };
  if (context.length > CONTEXT_LIMIT) return { field: 'context', message: '补充上下文超过 3000 字符，请缩短后重试。' };
  return null;
}

// 用空行分段，保留字符位置。原文和译文独立编号，不假定一一对应。
export function getParagraphs(text) {
  const paragraphs = [];
  let cursor = 0;
  const add = (end) => {
    const raw = text.slice(cursor, end);
    const content = raw.trim();
    if (content) {
      const start = cursor + raw.length - raw.trimStart().length;
      paragraphs.push({ number: paragraphs.length + 1, text: content, start, end: start + content.length });
    }
  };
  for (const match of text.matchAll(/\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/g)) {
    add(match.index);
    cursor = match.index + match[0].length;
  }
  add(text.length);
  return paragraphs;
}

export function findQuoteLocation(text, quote) {
  if (!quote) return null;
  const start = text.indexOf(quote);
  if (start < 0) return null;
  if (text.indexOf(quote, start + 1) >= 0) return { ambiguous: true };
  const end = start + quote.length;
  const overlap = getParagraphs(text).filter(item => item.start < end && item.end > start);
  if (!overlap.length) return null;
  return { ambiguous: false, start, end, first: overlap[0].number, last: overlap.at(-1).number };
}

export function getReviewSettings({ source, translation }) {
  const longText = source.length > 500 || translation.length > 3000
    || getParagraphs(source).length > 1 || getParagraphs(translation).length > 1;
  const chapter = source.length > 1500 || translation.length > 6000;
  return { longText, chapter, maxFindings: longText ? 8 : 4, maxTokens: longText ? 5200 : 2600, timeoutMs: longText ? 120000 : 75000 };
}
