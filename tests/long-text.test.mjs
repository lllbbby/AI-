import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findQuoteLocation, getParagraphs, getReviewSettings, SOURCE_LIMIT, TRANSLATION_LIMIT } from '../lib/text.mjs';
import { readInput, validateInput, validateResult, validateSourceFacts, analyzeWithModel } from '../lib/analysis.mjs';
import { scoreCase } from '../eval/score.mjs';

const examples = JSON.parse(fs.readFileSync(new URL('../app/long-examples.json', import.meta.url), 'utf8'));
const dataset = JSON.parse(fs.readFileSync(new URL('../eval/long-cases.json', import.meta.url), 'utf8'));

test('章节的英文超过旧上限时完整保留，原译长度分别校验', async () => {
  const chapter = examples.find(item => item.id === 'C01');
  assert.ok(chapter.source.length > 2000 && chapter.translation.length > 6000);
  const input = validateInput(chapter);
  assert.equal(input.translation, chapter.translation);
  assert.equal(input.source, chapter.source);
  assert.deepEqual(await readInput(new Request('http://localhost/api/analyze', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})), input);
  assert.throws(() => validateInput({...input, source:'文'.repeat(SOURCE_LIMIT+1)}), error => error.code === 'INPUT_TOO_LONG');
  assert.throws(() => validateInput({...input, translation:'a'.repeat(TRANSLATION_LIMIT+1)}), error => error.code === 'INPUT_TOO_LONG');
});

test('原译各自定位，引文跨段或多处出现时不虚构一一对应位置', () => {
  const source = '  第一段。\r\n \r\n第二段。\r\n\r\n第三段。  ';
  const paragraphs = getParagraphs(source);
  assert.equal(paragraphs.length,3);
  for (const paragraph of paragraphs) assert.equal(source.slice(paragraph.start,paragraph.end),paragraph.text);
  assert.equal(findQuoteLocation(source,'第二段').first,2);
  assert.equal(findQuoteLocation('First and second.\n\nThird.','Third.').first,2);
  assert.equal(findQuoteLocation(source,'第二段。\r\n\r\n第三段').last,3);
  assert.equal(findQuoteLocation('钥匙。\n\n钥匙。','钥匙').ambiguous,true);
  assert.equal(findQuoteLocation(source,'不存在'),null);
});

test('一章可返回八项并提高输出预算，超出数量或伪造引文仍拒绝', async () => {
  const input=validateInput(examples.find(item=>item.id==='C01'));
  const finding={lossType:'测试差异',severity:'中',sourceQuote:'铜钥匙',translationQuote:'brass key',evidence:'测试依据',suggestion:'核对上下文。',suggestedTranslation:'',needsContext:true};
  const result={summary:'章节检查',findings:Array.from({length:8},()=>finding),contextNote:'核对背景。'};
  assert.equal(validateResult(result,input).findings.length,8);
  assert.throws(()=>validateResult({...result,findings:[...result.findings,finding]},input));
  assert.throws(()=>validateResult({...result,findings:[{...finding,sourceQuote:'不存在的引文'}]},input));
  assert.throws(()=>validateResult({...result,findings:[{...finding,supportingSourceQuote:'不存在的前文'}]},input));
  assert.throws(()=>validateResult({...result,contextNote:''},input));
  const config={endpoint:'https://example.invalid/chat/completions',apiKey:'private-test-token',model:'test-model',provider:'测试模型',deepseek:false};
  let requests=0;
  const facts=[{kind:'状态与原因',detail:'许照脚踝有伤，留在门边接应。',sourceQuote:getParagraphs(input.source)[1].text}];
  await analyzeWithModel(input,config,{chapterReading:true,fetchImpl:async(_url,options)=>{
    requests++;
    const body=JSON.parse(options.body);
    assert.equal(JSON.parse(body.messages[1].content).source,input.source);
    if(requests===1){
      assert.equal(JSON.parse(body.messages[1].content).translation,undefined);
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({facts})}}]});
    }
    assert.equal(JSON.parse(body.messages[1].content).translation,input.translation);
    assert.deepEqual(JSON.parse(body.messages[1].content).sourceFacts,facts);
    assert.equal(body.max_tokens,5200);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
  }});
  assert.equal(requests,2);
  assert.equal(getReviewSettings({source:'一句话',translation:'One sentence.'}).maxFindings,4);
});

test('章节阅读笔记须有真实引文，两步共用取消信号', async () => {
  const input=validateInput(examples.find(item=>item.id==='C01'));
  assert.throws(()=>validateSourceFacts({facts:[{kind:'人物',detail:'虚构背景',sourceQuote:'从未出现的前文'}]},input),error=>error.code==='INVALID_RESULT');
  const verified={kind:'状态与原因',detail:'许照左脚有伤。',sourceQuote:'许照的左脚在上个月受过伤'};
  assert.deepEqual(validateSourceFacts({facts:[verified,{kind:'人物',detail:'虚构背景',sourceQuote:'从未出现的前文'}]},input),[verified]);
  const controller=new AbortController();
  const config={endpoint:'https://example.invalid/chat/completions',apiKey:'private-test-token',model:'test-model',provider:'测试模型',deepseek:false};
  let requests=0;
  await assert.rejects(analyzeWithModel(input,config,{chapterReading:true,signal:controller.signal,fetchImpl:async(_url,options)=>{
    requests++;
    options.signal.throwIfAborted();
    controller.abort();
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({facts:[]})}}]});
  }}),error=>error.code==='CANCELLED');
  assert.equal(requests,1);
});

test('长文本标注检查每个问题；参考译文与页面示例可追踪', () => {
  assert.equal(dataset.cases.length,6);
  for(const example of examples){
    const issue=dataset.cases.find(item=>item.id===example.id);
    const clean=dataset.cases.find(item=>item.group===example.id && item.expected.decision==='clean');
    assert.equal(issue.source,example.source);
    assert.equal(issue.translation,example.translation);
    assert.equal(clean.translation,example.referenceTranslation);
    assert.equal(scoreCase(clean,{findings:[]}).passed,true);
    assert.equal(scoreCase(issue,{findings:[]}).passed,false);
  }
  const issue=dataset.cases.find(item=>item.id==='P01');
  const partial={lossType:'血缘被增添',evidence:'两人没有血缘，却被写成 biological 亲生兄妹。',suggestion:'去掉亲属解释。',needsContext:false};
  const score=scoreCase(issue,{findings:[partial]});
  assert.equal(score.matchedCount,1);
  assert.equal(score.expectedCount,2);
  assert.equal(score.passed,false);
});
