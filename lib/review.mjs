export const REVIEW_DECISIONS = { change: '准备修改', keep: '保留译文', context: '查前文再定' };

export function isReviewOutdated(input, snapshot) {
  return Boolean(snapshot && ['source', 'translation', 'context'].some(key =>
    (input[key] || '').trim() !== (snapshot[key] || '').trim()));
}

export function buildReviewReport({ result, snapshot, reviews = {}, outdated = false }) {
  const lines = ['# 译文复核记录', '',
    `检查时间：${snapshot.checkedAt}`, `分析服务：${result.provider || '模型服务'}`,
    `文本状态：${outdated ? '输入已改动；以下引文与判断对应上次检查，尚未重新检查' : '对应本次检查文本'}`,
    '', '模型提供核对线索，编辑记录表示处理意向，不表示译文已完成修改。', '', result.summary];
  if (result.contextNote) lines.push('', `待补充背景：${result.contextNote}`);
  if (!result.findings.length) lines.push('', '未发现明显问题，不代表译文完全正确。');
  result.findings.forEach((finding, index) => {
    const review = reviews[index] || {};
    lines.push('', `## ${index + 1}. ${finding.lossType}`, '',
      `复核优先级：${finding.severity === '高' ? '优先核对' : finding.severity === '中' ? '建议核对' : '酌情调整'}`,
      `原文：${finding.sourceQuote}`, `译文：${finding.translationQuote || '未找到对应表达'}`);
    if (finding.supportingSourceQuote) lines.push(`相关原文：${finding.supportingSourceQuote}`);
    if (finding.supportingContextQuote) lines.push(`补充背景：${finding.supportingContextQuote}`);
    lines.push('', `模型判断：${finding.evidence}`, `模型建议：${finding.suggestion}`);
    if (finding.suggestedTranslation) lines.push(`参考改译：${finding.suggestedTranslation}`);
    if (finding.needsContext) lines.push(`待确认：${finding.contextQuestion || result.contextNote}`);
    lines.push('', `编辑决定：${REVIEW_DECISIONS[review.decision] || '未记录'}`,
      `编辑备注：${review.note?.trim() || '未填写'}`);
  });
  return `${lines.join('\n')}\n`;
}
