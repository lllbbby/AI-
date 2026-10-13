import { getParagraphs, findQuoteLocation } from '../lib/text.mjs';

function ParagraphText({ paragraph, selection }) {
  const start = Math.max(paragraph.start, selection?.start ?? paragraph.end);
  const end = Math.min(paragraph.end, selection?.end ?? paragraph.start);
  if (start >= end) return paragraph.text;
  return <>{paragraph.text.slice(0, start - paragraph.start)}<mark>{paragraph.text.slice(start - paragraph.start, end - paragraph.start)}</mark>{paragraph.text.slice(end - paragraph.start)}</>;
}

export default function QuoteEvidence({ side, text, quote, title, longText }) {
  const label = title || (side === 'source' ? '原文' : '译文');
  const location = findQuoteLocation(text, quote);
  const position = !location ? '' : location.ambiguous ? ' · 多处出现'
    : ` · 第${location.first}${location.last !== location.first ? `—${location.last}` : ''}段`;
  const surrounding = location && !location.ambiguous
    ? getParagraphs(text).filter(paragraph => paragraph.number >= location.first - 1 && paragraph.number <= location.last + 1) : [];
  return <div className="quote-evidence">
    <div className="quote-heading"><span>{label}{position}</span></div>
    {quote ? <blockquote className="evidence-excerpt" tabIndex={quote.length > 400 ? 0 : undefined} lang={side === 'translation' ? 'en' : 'zh'}>{quote}</blockquote> : <p>未找到对应表达。</p>}
    {longText && surrounding.length > 0 && <details className="inline-context"><summary>查看{label}前后文</summary><div className="inline-paragraphs" role="region" aria-label={`${label}引文前后文`} tabIndex={0}>{surrounding.map(paragraph => <div className="reading-paragraph" key={paragraph.number}><span>第{paragraph.number}段</span><p lang={side === 'translation' ? 'en' : 'zh'}><ParagraphText paragraph={paragraph} selection={location} /></p></div>)}</div></details>}
    {location?.ambiguous && <p className="quote-ambiguity">这段引文重复出现，请结合全文确认位置。</p>}
  </div>;
}

