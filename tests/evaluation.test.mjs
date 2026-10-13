import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scoreCase } from '../eval/score.mjs';

const dataset = JSON.parse(fs.readFileSync(new URL('../eval/cases.json', import.meta.url), 'utf8'));
const sources = JSON.parse(fs.readFileSync(new URL('../eval/sources.json', import.meta.url), 'utf8'));
const examples = JSON.parse(fs.readFileSync(new URL('../app/more-examples.json', import.meta.url), 'utf8'));
const longDataset = JSON.parse(fs.readFileSync(new URL('../eval/long-cases.json', import.meta.url), 'utf8'));

test('评测样本唯一、出处可追踪；同一组对照不会跨开发组与保留组', () => {
  assert.equal(dataset.cases.length, 24);
  assert.equal(new Set(dataset.cases.map(item => item.id)).size, 24);
  const sourceIds = new Set(sources.map(item => item.id));
  const groups = new Map();
  for (const item of dataset.cases) {
    assert.ok(item.source && item.translation && item.context && item.expected.rationale);
    assert.ok(['issue', 'review', 'clean'].includes(item.expected.decision));
    for (const reference of item.references) assert.ok(sourceIds.has(reference));
    if (groups.has(item.group)) assert.equal(groups.get(item.group), item.split);
    groups.set(item.group, item.split);
  }
  assert.equal(dataset.cases.filter(item => item.split === 'development').length, 16);
  assert.equal(dataset.cases.filter(item => item.split === 'holdout').length, 8);
});

test('泛泛的修改建议不能算检出了标注问题；合理译文出现复核项算误报', () => {
  const item = dataset.cases.find(item => item.id === 'D07');
  assert.equal(scoreCase(item, { findings: [{ lossType: '表达可优化', evidence: '译文可能有问题', suggestion: '核对一下' }] }).passed, false);
  const clean = dataset.cases.find(item => item.id === 'D08');
  assert.equal(scoreCase(clean, { findings: [] }).passed, true);
  assert.equal(scoreCase(clean, { findings: [{ lossType: '心魔问题' }] }).passed, false);
});

test('页面新示例与标注文本一致，且不载入保留组', () => {
  assert.equal(examples.length, 8);
  for (const example of examples) {
    const item = dataset.cases.find(item => item.id === example.id);
    assert.equal(item.split, 'development');
    for (const field of ['source', 'translation', 'context']) assert.equal(example[field], item[field]);
    assert.equal(example.label, '自拟对照');
    for (const reference of example.references) assert.ok(sources.some(source => source.url === reference.url));
  }
});

test('一条堆满关键词的结果不能覆盖整章五项，额外未标注项也不能自动通过', () => {
  const chapter = longDataset.cases.find(item => item.id === 'C01');
  const keywords = chapter.expected.findings.flatMap(finding => finding.evidenceGroups.flat()).join(' ');
  const stacked = scoreCase(chapter, { findings: [{ lossType: '待核对', evidence: keywords, suggestion: '请复核', needsContext: true }] });
  assert.equal(stacked.passed, false);
  assert.equal(stacked.matchedCount, 1);

  const paragraph = longDataset.cases.find(item => item.id === 'P01');
  const twoExpected = [
    { lossType: '行动主体', evidence: '沈璃把钥匙交给许照，译文把动作方向调换。', suggestion: '改正钥匙的交接方向。', needsContext: false },
    { lossType: '血缘增添', evidence: '两人无血缘，译文却写为 biological 亲属。', suggestion: '删除亲生关系。', needsContext: false },
  ];
  assert.equal(scoreCase(paragraph, { findings: twoExpected }).passed, true);
  const withExtra = scoreCase(paragraph, { findings: [...twoExpected,
    { lossType: '颜色变化', evidence: '译文改变了衣服颜色。', suggestion: '修改颜色。', needsContext: false }] });
  assert.equal(withExtra.passed, false);
  assert.equal(withExtra.extraFindingCount, 1);
});
