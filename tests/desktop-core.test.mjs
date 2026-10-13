import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Jobs } from '../electron/jobs.mjs';
import { SaveQueue } from '../src/save-queue.mjs';

const input={source:'他没有拔剑。',translation:'He drew his sword.',context:''};
const result={summary:'否定被反转。',contextNote:'',provider:'受控测试',model:'controlled',findings:[{
  lossType:'动作变化',severity:'高',sourceQuote:'没有拔剑',translationQuote:'drew his sword',
  evidence:'原文没有拔剑，译文写成拔剑。',suggestion:'保留否定。',suggestedTranslation:'He did not draw his sword.',needsContext:false
}]};
const settings=()=>({baseUrl:'https://example.invalid',model:'controlled',key:'test-secret-not-real'});
function fixture(t){
  const dir=mkdtempSync(path.join(tmpdir(),'duidu-test-')),filename=path.join(dir,'duidu.sqlite'),store=new Store(filename);
  t.after(()=>{if(store.db.open)store.close();rmSync(dir,{recursive:true,force:true});});
  const book=store.createBook('测试书籍'),c=store.createChapter({bookId:book.id,title:'第一章'});
  const chapter=store.saveDraft({id:c.id,expectedRevision:0,...input});
  const args={chapterId:c.id,expectedRevision:chapter.revision,expectedBookRevision:book.revision,requestId:'test-request'};
  return {store,book,chapter,args,filename};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('稿件版本冲突保留数据库和历史；恢复产生新版本，不跨章',t=>{
  const {store,chapter,book}=fixture(t),before=store.listVersions(chapter.id);
  assert.throws(()=>store.saveDraft({id:chapter.id,expectedRevision:0,...input,translation:'wrong'}),e=>e.code==='CONFLICT');
  assert.equal(store.chapter(chapter.id).translation,input.translation);assert.equal(store.listVersions(chapter.id).length,before.length);
  store.saveDraft({id:chapter.id,expectedRevision:chapter.revision,...input,translation:'He did not draw his sword.'});
  const restored=store.restoreVersion({chapterId:chapter.id,versionId:before[0].id,expectedRevision:chapter.revision+1});
  assert.equal(restored.translation,input.translation);assert.equal(store.listVersions(chapter.id).length,before.length+2);
  const other=store.createChapter({bookId:book.id,title:'第二章'});
  assert.throws(()=>store.restoreVersion({chapterId:other.id,versionId:before[0].id,expectedRevision:0}));
});

test('磁盘写入失败时事务回滚，不留下半份稿件',t=>{
  const {store,chapter}=fixture(t),before=store.listVersions(chapter.id);
  store.db.exec("CREATE TRIGGER simulate_full BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT,'disk full'); END");
  assert.throws(()=>store.saveDraft({id:chapter.id,expectedRevision:chapter.revision,...input,translation:'new text'}));
  assert.equal(store.chapter(chapter.id).revision,chapter.revision);assert.equal(store.chapter(chapter.id).translation,input.translation);
  assert.deepEqual(store.listVersions(chapter.id),before);
});

test('书籍备份往返保留历史快照、决定与备注，并建立新 ID；不包含密钥',t=>{
  const {store,book,chapter,args}=fixture(t);
  store.setSetting('encryptedKey','encrypted-private-value');
  const first=store.saveCheck({...args,snapshot:input,result,modelConfig:{baseUrl:settings().baseUrl,model:settings().model},promptHash:'hash'});
  const findingId=first.result.findings[0].id;
  store.saveReview({checkId:first.id,findingId,decision:'keep',note:'核对前文后决定保留。'});
  store.saveCheck({...args,snapshot:input,result,modelConfig:{baseUrl:settings().baseUrl,model:'controlled-2'},promptHash:'hash-2'});
  const backup=JSON.parse(JSON.stringify(store.exportBook(book.id)));
  assert.ok(!JSON.stringify(backup).includes('encrypted-private-value'));
  const copied=store.importBook(backup),c=store.listChapters(copied.id)[0],history=store.listChecks(c.id);
  assert.notEqual(copied.id,book.id);assert.notEqual(c.id,chapter.id);assert.equal(c.translation,chapter.translation);
  assert.equal(history.length,2);assert.equal(history[0].modelConfig.model,'controlled-2');
  const old=store.check(history[1].id),f=old.result.findings[0].id;
  assert.notEqual(f,findingId);assert.equal(old.reviews[f].decision,'keep');assert.equal(old.reviews[f].note,'核对前文后决定保留。');
  assert.deepEqual(old.snapshot,first.snapshot);
  const originalVersions=backup.book.chapters[0].versions;
  for(const v of originalVersions)assert.ok(store.listVersions(c.id).some(x=>x.reason===v.reason&&x.createdAt===v.createdAt));
  const bad=structuredClone(backup);bad.book.chapters.push({...bad.book.chapters[0],title:''});
  const count=store.listBooks().length;assert.throws(()=>store.importBook(bad));assert.equal(store.listBooks().length,count);
});

test('数据库重开恢复稿件、轮次和独立备注；较新数据拒绝降级打开',t=>{
  const {store,chapter,args,filename}=fixture(t);
  const a=store.saveCheck({...args,snapshot:input,result,modelConfig:{baseUrl:'https://example.invalid',model:'test'},promptHash:'hash'});
  const b=store.saveCheck({...args,snapshot:input,result,modelConfig:{baseUrl:'https://example.invalid',model:'test'},promptHash:'hash'});
  store.saveReview({checkId:a.id,findingId:a.result.findings[0].id,decision:'change',note:'第一轮备注'});
  store.saveReview({checkId:b.id,findingId:b.result.findings[0].id,decision:'context',note:'第二轮备注'});
  assert.throws(()=>store.saveReview({checkId:a.id,findingId:a.result.findings[0].id,decision:'keep',note:'过期覆盖',expectedRevision:0}),e=>e.code==='CONFLICT');
  store.close();const reopened=new Store(filename);
  try {assert.equal(reopened.chapter(chapter.id).translation,input.translation);assert.equal(reopened.check(a.id).reviews[a.result.findings[0].id].note,'第一轮备注');assert.equal(reopened.check(b.id).reviews[b.result.findings[0].id].note,'第二轮备注');reopened.db.pragma('user_version=2');}
  finally{reopened.close();}
  assert.throws(()=>new Store(filename),e=>e.code==='NEWER_DATABASE');
});

test('保存队列串行提交；等待中的新编辑使用成功提交后的版本号',async()=>{
  const wait=deferred(),writes=[],statuses=[];
  const queue=new SaveQueue(async(value,revision)=>{writes.push([value,revision]);if(writes.length===1)await wait.promise;return {revision:revision+1};},s=>statuses.push(s));
  queue.reset(7);queue.stage('first');const flush=queue.flush();queue.stage('latest');const also=queue.flush();
  assert.deepEqual(writes,[['first',7]]);wait.resolve();await Promise.all([flush,also]);
  assert.deepEqual(writes,[['first',7],['latest',8]]);assert.equal(queue.revision,9);assert.equal(statuses.at(-1),'saved');
});

test('保存失败保留最新草稿，阻止切章；重试只提交最新内容',async()=>{
  const wait=deferred(),writes=[];let fail=true;
  const queue=new SaveQueue(async(value,revision)=>{writes.push([value,revision]);if(fail){await wait.promise;throw new Error('disk full');}return {revision:revision+1};});
  queue.stage('old');const flushing=queue.flush();queue.stage('newest');wait.resolve();await assert.rejects(flushing,/disk full/);
  assert.equal(queue.pending,'newest');assert.equal(queue.revision,0);assert.throws(()=>queue.reset(5));
  fail=false;await queue.flush();assert.deepEqual(writes,[['old',0],['newest',0]]);assert.equal(queue.pending,null);
});

test('取消后隔离忽略 abort 的迟到结果；重检失败保留旧轮次与备注',async t=>{
  const {store,args}=fixture(t),wait=deferred();let calls=0;
  const jobs=new Jobs(store,settings,{analyze:async()=>{calls++;return wait.promise;}});
  const pending=jobs.run(args);await Promise.resolve();jobs.cancel(args.requestId);wait.resolve(result);
  await assert.rejects(pending,e=>e.code==='CANCELLED');assert.equal(store.listChecks(args.chapterId).length,0);
  const success=await new Jobs(store,settings,{analyze:async()=>result}).run(args);
  store.saveReview({checkId:success.id,findingId:success.result.findings[0].id,decision:'keep',note:'旧备注'});
  const failing=new Jobs(store,settings,{analyze:async()=>{throw new Error('network failed');}});
  await assert.rejects(failing.run(args),/network failed/);
  assert.equal(store.listChecks(args.chapterId).length,1);assert.equal(store.check(success.id).reviews[success.result.findings[0].id].note,'旧备注');assert.equal(calls,1);
});

test('修改文本或书籍背景拒收旧结果，不串章',async t=>{
  const {store,args,chapter,book}=fixture(t),wait=deferred(),jobs=new Jobs(store,settings,{analyze:()=>wait.promise});
  const pending=jobs.run(args);await Promise.resolve();store.updateBook({id:book.id,context:'人物约定已变化',expectedRevision:0});wait.resolve(result);
  await assert.rejects(pending,e=>e.code==='STALE_RESULT');assert.equal(store.listChecks(chapter.id).length,0);
});

test('解密配置等待期间也只准一个任务，取消不发起模型请求',async t=>{
  const {store,args}=fixture(t),wait=deferred();let calls=0;
  const jobs=new Jobs(store,()=>wait.promise,{analyze:async()=>{calls++;return result;}});
  const pending=jobs.run(args);
  await assert.rejects(jobs.run({...args,requestId:'second'}),e=>e.code==='BUSY');
  await assert.rejects(jobs.testConnection(),e=>e.code==='BUSY');
  jobs.cancel(args.requestId);wait.resolve(settings());await assert.rejects(pending,e=>e.code==='CANCELLED');assert.equal(calls,0);assert.equal(jobs.active,null);
});

test('超限草稿完整保存，但模型调用之前明确拒绝',async t=>{
  const {store,chapter,args}=fixture(t);const source='文'.repeat(12001);
  const c=store.saveDraft({id:chapter.id,expectedRevision:chapter.revision,...input,source});let calls=0;
  const jobs=new Jobs(store,settings,{analyze:async()=>{calls++;return result;}});
  await assert.rejects(jobs.run({...args,expectedRevision:c.revision}),e=>e.code==='INPUT_TOO_LONG');
  assert.equal(store.chapter(c.id).source,source);assert.equal(calls,0);
});

test('连接测试仅发送固定短文本，不读当前稿件，不写检查历史',async t=>{
  const {store,args}=fixture(t);let sent;
  const jobs=new Jobs(store,settings,{analyze:async value=>{sent=value;return {summary:'未发现问题',findings:[],contextNote:''};}});
  assert.equal((await jobs.testConnection()).model,'controlled');assert.equal(sent.translation,'He did not draw his sword.');assert.equal(sent.context,'');assert.equal(store.listChecks(args.chapterId).length,0);
});
