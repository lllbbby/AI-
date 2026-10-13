// Opt-in: exactly two paid, short-text requests using the existing environment.
// Credentials stay in memory and safeStorage in a separate, ignored test profile.
import { _electron as electron } from 'playwright';
import { getConfig } from '../lib/analysis.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const config=getConfig();if(!config)throw new Error('没有可用的模型环境配置。');
const baseUrl=config.endpoint.replace(/\/chat\/completions$/,'');
const desktop=await electron.launch({args:['.'],env:{...process.env,DUIDU_TEST_MODE:'1',DUIDU_TEST_DATA:path.resolve('.test-data',`live-${randomUUID()}`)}});
try{
  const page=await desktop.firstWindow();await page.waitForFunction(()=>document.querySelector('.welcome'));
  await desktop.evaluate((_,settings)=>globalThis.duiduTest.handlers.saveSettings(settings),{baseUrl,model:config.model,key:config.apiKey});
  const connection=await page.evaluate(()=>window.duidu.testConnection());assert.ok(connection.lastTest);console.log(`PASS real connection: ${config.provider} / ${config.model}`);
  const c=await page.evaluate(async()=>{const b=await window.duidu.createBook({title:'真实 API 短文本验收'});const c=await window.duidu.createChapter({bookId:b.id,title:'否定句验收'});return window.duidu.saveDraft({id:c.id,expectedRevision:0,source:'他没有拔剑。',translation:'He drew his sword.',context:''});});
  const check=await page.evaluate(c=>window.duidu.analyze({chapterId:c.id,expectedRevision:c.revision,expectedBookRevision:0,requestId:crypto.randomUUID()}),c);
  assert.ok(check.result.findings.length>0);assert.equal(check.snapshot.translation,'He drew his sword.');
  const f=check.result.findings[0];await page.evaluate(({id,fid})=>window.duidu.saveReview({checkId:id,findingId:fid,decision:'change',note:'真实 API 验收备注'}),{id:check.id,fid:f.id});
  assert.equal(await desktop.evaluate((_,id)=>Object.values(globalThis.duiduTest.store.check(id).reviews)[0].note,check.id),'真实 API 验收备注');
  console.log(`PASS real analysis + persisted review: ${check.result.findings.length} finding(s); no retries`);
}finally{await desktop.close();}
