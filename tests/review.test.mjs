import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewReport, isReviewOutdated } from '../lib/review.mjs';

const snapshot = { source: '他没有拔剑。', translation: 'He drew his sword.', context: '剑尚在鞘中。', checkedAt: '2026年10月6日 12:00' };
const result = { provider: '测试服务', summary: '否定被反转。', findings: [{ lossType: '动作变化', sourceQuote: '没有拔剑', translationQuote: 'drew his sword', evidence: '否定变化。', suggestion: '保留否定。', suggestedTranslation: 'He did not draw his sword.', needsContext: false }] };

test('修改译文或背景后标记旧结果；只改边缘空白不标记', () => {
  assert.equal(isReviewOutdated(snapshot, snapshot), false);
  assert.equal(isReviewOutdated({ ...snapshot, source: ` ${snapshot.source}\n` }, snapshot), false);
  assert.equal(isReviewOutdated({ ...snapshot, translation: 'He did not draw his sword.' }, snapshot), true);
  assert.equal(isReviewOutdated({ ...snapshot, context: '剑已拔出。' }, snapshot), true);
  assert.equal(isReviewOutdated(snapshot, null), false);
});

test('导出明确区分模型建议与编辑决定，旧引文不冒充修改后的文本', () => {
  const report = buildReviewReport({ result, snapshot, reviews: { 0: { decision: 'keep', note: '需核对前文。' } }, outdated: true });
  assert.match(report, /编辑决定：保留译文/);
  assert.match(report, /编辑备注：需核对前文。/);
  assert.match(report, /以下引文与判断对应上次检查/);
  assert.match(report, /译文：drew his sword/);
  assert.match(report, /参考改译：He did not draw his sword\./);
  const unreviewed = buildReviewReport({ result, snapshot });
  assert.match(unreviewed, /编辑决定：未记录/);
  assert.match(unreviewed, /不表示译文已完成修改/);
});

test('没有问题的记录仍保留全局待确认背景', () => {
  const report = buildReviewReport({ result: { ...result, findings: [], contextNote: '请补充角色此前使用的称呼。' }, snapshot });
  assert.match(report, /待补充背景：请补充角色此前使用的称呼。/);
  assert.match(report, /未发现明显问题，不代表译文完全正确。/);
});
