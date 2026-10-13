import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithModel, getConfig, readInput, validateInput, validateResult } from '../lib/analysis.mjs';
import { SOURCE_LIMIT, TRANSLATION_LIMIT, CONTEXT_LIMIT } from '../lib/text.mjs';

const input = { source: '他没有拔剑。', translation: 'He drew his sword.', context: '' };
const config = { endpoint: 'https://example.invalid/chat/completions', apiKey: 'private-test-token', model: 'test-model', provider: '测试模型', deepseek: false };
const validResult = {
  summary: '译文把未发生的动作写成了已发生。',
  findings: [{
    lossType: '否定信息被反转', severity: '高', sourceQuote: '没有拔剑', translationQuote: 'drew his sword',
    evidence: '原文否定拔剑，译文说拔出了剑。', suggestion: '保留否定表达。',
    suggestedTranslation: 'He did not draw his sword.', needsContext: false,
  }],
  contextNote: '',
};

test('缺失文本、错误类型和超长文本在调用模型前拒绝', () => {
  for (const value of [null, {}, { source: ' ', translation: '' }, { source: 4, translation: 'a' }, { ...input, source: '文'.repeat(SOURCE_LIMIT + 1) }, { ...input, translation: 'a'.repeat(TRANSLATION_LIMIT + 1) }, { ...input, context: '文'.repeat(CONTEXT_LIMIT + 1) }]) {
    assert.throws(() => validateInput(value), (error) => error.status === 400);
  }
  assert.deepEqual(validateInput({ source: ' 他没有拔剑。 ', translation: ' He drew his sword. ' }), input);
});

test('提交过大或无效 JSON 时明确拒绝', async () => {
  const makeRequest = (body, headers = {}) => new Request('http://localhost/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
  });
  assert.deepEqual(await readInput(makeRequest(JSON.stringify(input))), input);
  await assert.rejects(readInput(makeRequest('{')), (error) => error.status === 400);
  await assert.rejects(readInput(makeRequest(' '.repeat(256 * 1024 + 1))), (error) => error.status === 413);
  await assert.rejects(readInput(makeRequest('{}', { 'content-type': 'text/plain' })), (error) => error.status === 415);
});

test('允许没有问题的结果，不为凑数强行生成问题', () => {
  const result = { summary: '这段文本未发现明显的信息变化', findings: [], contextNote: '' };
  assert.deepEqual(validateResult(result, input), result);
});

test('拒绝模型编造的引文以及无法展示的结果结构', () => {
  assert.deepEqual(validateResult(validResult, input), {
    ...validResult, findings: [{ ...validResult.findings[0], supportingSourceQuote: '', supportingContextQuote: '', contextQuestion: '' }],
  });
  const withContext = { ...input, context: '前文确认他没有拔剑。' };
  const quoteFromContext = validateResult({ ...validResult, findings: [{ ...validResult.findings[0],
    supportingSourceQuote: '前文确认他没有拔剑。' }] }, withContext).findings[0];
  assert.equal(quoteFromContext.supportingSourceQuote, '');
  assert.equal(quoteFromContext.supportingContextQuote, '前文确认他没有拔剑。');
  for (const change of [
    { sourceQuote: '他拔剑杀死了敌人' }, { translationQuote: 'He killed the enemy.' },
    { severity: '100分' }, { needsContext: '是' }, { evidence: '' },
  ]) {
    assert.throws(() => validateResult({ ...validResult, findings: [{ ...validResult.findings[0], ...change }] }, input), (error) => error.code === 'INVALID_RESULT');
  }
});

test('仅复用明确指向官方 DeepSeek 的现有凭证', () => {
  const env = { ANTHROPIC_AUTH_TOKEN: 'private-test-token', ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_MODEL: 'deepseek-v4-pro' };
  assert.equal(getConfig(env).endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(getConfig(env).model, 'deepseek-v4-pro');
  assert.equal(getConfig({ ...env, ANTHROPIC_BASE_URL: 'https://other.example/anthropic' }), null);
  assert.equal(getConfig({ ...env, ANTHROPIC_BASE_URL: 'https://api.deepseek.com.other.example/anthropic' }), null);
  assert.throws(() => getConfig({ LLM_API_KEY: 'key', LLM_BASE_URL: 'http://remote.example' }), (error) => error.code === 'CONFIG_ERROR');
});

test('服务端请求包含真实输入、上下文和 JSON 格式要求；结果不含密钥', async () => {
  let submitted;
  const result = await analyzeWithModel({ ...input, context: '前句说他已放下剑。' }, config, {
    fetchImpl: async (url, options) => {
      submitted = JSON.parse(options.body);
      assert.equal(url, config.endpoint);
      assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
      assert.equal(options.redirect, 'error');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(validResult) } }] });
    },
  });
  assert.deepEqual(JSON.parse(submitted.messages[1].content), { ...input, context: '前句说他已放下剑。' });
  assert.equal(submitted.response_format.type, 'json_object');
  assert.equal(result.findings[0].severity, '高');
  assert.equal(JSON.stringify(result).includes(config.apiKey), false);
});

test('服务忙、鉴权失败、超时和截断返回可读错误，不回退为静态分析', async () => {
  for (const [status, code] of [[401, 'AUTH_ERROR'], [402, 'BALANCE_ERROR'], [429, 'RATE_LIMITED'], [500, 'MODEL_ERROR']]) {
    await assert.rejects(analyzeWithModel(input, config, {
      fetchImpl: async () => new Response('sensitive upstream response', { status }),
    }), (error) => error.code === code && !error.message.includes('sensitive'));
  }
  await assert.rejects(analyzeWithModel(input, config, { fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError'); } }), (error) => error.code === 'TIMEOUT');
  await assert.rejects(analyzeWithModel(input, config, {
    fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }),
  }), (error) => error.code === 'INCOMPLETE_RESULT');
  await assert.rejects(analyzeWithModel(input, null), (error) => error.code === 'NOT_CONFIGURED');
});

test('取消后不继续返回分析结果', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(analyzeWithModel(input, config, {
    signal: controller.signal,
    fetchImpl: async (_url, options) => { options.signal.throwIfAborted(); },
  }), (error) => error.code === 'CANCELLED');
});
