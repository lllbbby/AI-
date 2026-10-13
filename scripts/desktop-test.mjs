import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const data=path.resolve('.test-data',randomUUID());
const output=path.resolve('output/playwright');await fs.mkdir(output,{recursive:true});
let desktop,page;const errors=[];
const launch=async()=>{
  desktop=await electron.launch({args:['.'],env:{...process.env,DUIDU_TEST_MODE:'1',DUIDU_TEST_DATA:data}});
  page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.duidu&&document.querySelector('.welcome,.workspace-heading'));
  await desktop.evaluate(()=>{if(!globalThis.duiduTest)throw new Error('Test controls unavailable');});
};
const main=fn=>desktop.evaluate(fn);
const saved=()=>page.waitForFunction(()=>document.querySelector('.save-status')?.textContent==='已保存');
const input={source:'他没有拔剑。',translation:'He drew his sword.',context:''};
const installModel=async(mode='success')=>{
  await desktop.evaluate((_,mode)=>{
    const t=globalThis.duiduTest;t.jobs.analyze=async(input,config)=>{
      if(mode==='fail')throw Object.assign(new Error('受控服务暂时不可用'),{code:'MODEL_ERROR'});
      if(mode==='late')await new Promise(r=>{t.releaseLate=r;});
      return {provider:'受控测试',model:config.model,summary:'否定被反转。',contextNote:'',findings:[{
        lossType:'动作变化',severity:'高',sourceQuote:'没有拔剑',translationQuote:'drew his sword',
        evidence:'原文没有拔剑，译文写成拔剑。',suggestion:'保留否定。',suggestedTranslation:'He did not draw his sword.',needsContext:false
      }]};
    };
  },mode);
};
const checkpoint=label=>console.log(`PASS ${label}`);
try {
  await launch();console.log((await page.locator('body').innerText()).slice(0,800));
  await page.getByRole('button',{name:'创建第一本书'}).click();await page.getByLabel('名称',{exact:true}).fill('回归测试书');
  await page.locator('dialog').getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('button',{name:'添加第一章'}).click();await page.getByLabel('名称',{exact:true}).fill('第一章');
  await page.locator('dialog').getByRole('button',{name:'保存',exact:true}).click();
  await page.getByLabel('中文原文',{exact:true}).fill(input.source);await page.getByLabel('英文译文',{exact:true}).fill(input.translation);await saved();
  assert.equal(await main(()=>globalThis.duiduTest.store.listChapters(globalThis.duiduTest.store.listBooks()[0].id)[0].translation),input.translation);
  checkpoint('书籍章节创建、800 ms 自动保存和 SQLite 原生依赖');
  await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByLabel('API 根地址').fill('https://example.invalid');await page.getByLabel('模型名称').fill('controlled');await page.getByLabel('API 密钥',{exact:true}).fill('controlled-secret');
  await page.locator('dialog').getByRole('button',{name:'保存',exact:true}).click();
  const secretCheck=await main(({safeStorage})=>{const value=globalThis.duiduTest.store.getSetting('encryptedKey');return {encrypted:!value.includes('controlled-secret'),decrypts:safeStorage.decryptString(Buffer.from(value,'base64'))==='controlled-secret'};});
  assert.deepEqual(secretCheck,{encrypted:true,decrypts:true});checkpoint('safeStorage 加密和受限 preload');
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');assert.equal(await page.evaluate(()=>typeof window.duidu.readFile),'undefined');
  await installModel();await page.getByRole('button',{name:'检查译文'}).click();await page.getByText('1 项待核对',{exact:true}).waitFor();
  await page.getByRole('button',{name:'保留译文',exact:true}).click();await page.getByLabel('编辑备注',{exact:true}).fill('第一轮原有备注');await saved();
  const first=await main(()=>{const s=globalThis.duiduTest.store,c=s.listChapters(s.listBooks()[0].id)[0];return s.listChecks(c.id)[0].id;});
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'workbench-wide.png')});
  await main(()=>globalThis.duiduTest.window.setSize(1050,900));await page.screenshot({path:path.join(output,'workbench-narrow.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>{const a=document.querySelector('.editor-panel').getBoundingClientRect(),b=document.querySelector('.results-panel').getBoundingClientRect();return b.top>=a.bottom-1&&document.documentElement.scrollWidth<=innerWidth;}));
  await main(()=>globalThis.duiduTest.window.setSize(1440,960));checkpoint('证据展示、决定备注与窄窗口布局');
  await installModel('fail');await page.getByRole('button',{name:'重新检查当前文本'}).click();await page.getByRole('alert').filter({hasText:'受控服务暂时不可用'}).waitFor();assert.equal(await page.getByLabel('编辑备注',{exact:true}).inputValue(),'第一轮原有备注');
  await installModel('late');await page.getByRole('button',{name:'重新检查当前文本'}).click();await page.getByRole('button',{name:'取消检查',exact:true}).waitFor();
  await page.getByLabel('英文译文',{exact:true}).fill('He drew his sword. A draft edit.');await main(()=>globalThis.duiduTest.releaseLate());await saved();
  assert.equal(await main(()=>globalThis.duiduTest.store.listChecks(globalThis.duiduTest.store.listChapters(globalThis.duiduTest.store.listBooks()[0].id)[0].id).length),1);
  assert.equal(await page.getByLabel('编辑备注',{exact:true}).inputValue(),'第一轮原有备注');checkpoint('重新检查失败、编辑自动取消和迟到结果隔离');
  // A failing database transaction must leave the latest UI draft and keep navigation blocked.
  await main(()=>globalThis.duiduTest.store.db.exec("CREATE TRIGGER simulate_full BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT,'disk full'); END"));
  await page.getByLabel('英文译文',{exact:true}).fill('He drew his sword. Unsaved latest.');await page.getByText('保存失败',{exact:true}).waitFor();
  await page.getByRole('button',{name:'新建章节',exact:true}).click();assert.equal(await page.locator('dialog:visible').count(),0);assert.equal(await page.getByLabel('英文译文',{exact:true}).inputValue(),'He drew his sword. Unsaved latest.');
  await main(()=>globalThis.duiduTest.store.db.exec('DROP TRIGGER simulate_full'));await page.getByRole('button',{name:'重试保存',exact:true}).click();await saved();checkpoint('保存失败留稿、阻止切章、显式重试');
  await page.getByRole('button',{name:'新建章节',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('第二章');await page.locator('dialog').getByRole('button',{name:'保存',exact:true}).click();
  await page.getByLabel('中文原文',{exact:true}).fill('第二章原文');await page.getByLabel('英文译文',{exact:true}).fill('Second chapter draft');
  await page.locator('.chapter-name').filter({hasText:'第一章'}).click();await page.waitForFunction(()=>document.querySelector('#translation').value==='He drew his sword. Unsaved latest.');
  await page.locator('.chapter-name').filter({hasText:'第二章'}).click();await page.waitForFunction(()=>document.querySelector('#translation').value==='Second chapter draft');
  await page.locator('.chapter-name').filter({hasText:'第一章'}).click();await page.waitForFunction(()=>document.querySelector('#translation').value==='He drew his sword. Unsaved latest.');checkpoint('切章立即等待保存且稿件不串章');
  await installModel();await page.getByRole('button',{name:'重新检查当前文本'}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="检查历史"]')?.options.length===2);
  await page.getByLabel('编辑备注',{exact:true}).fill('第二轮备注');await saved();await page.getByLabel('检查历史',{exact:true}).selectOption(first);
  assert.equal(await page.getByLabel('编辑备注',{exact:true}).inputValue(),'第一轮原有备注');checkpoint('多轮历史与独立备注');
  // Replace only file dialogs. The actual UTF-8 parsing, exports and backup import still run in main.
  const importedFile=path.join(data,'import.md');await fs.writeFile(importedFile,'# 标题\n他没有拔剑。','utf8');
  await desktop.evaluate(({dialog},filename)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filename]});},importedFile);
  await page.locator('.editor-column').first().getByRole('button',{name:'导入',exact:true}).click();assert.equal(await page.locator('.import-preview').innerText(),'# 标题\n他没有拔剑。');await page.getByRole('button',{name:'确认替换',exact:true}).click();await saved();
  assert.equal(await page.getByLabel('中文原文',{exact:true}).inputValue(),'# 标题\n他没有拔剑。');
  await page.getByRole('button',{name:'文本版本',exact:true}).click();const originalVersion=await main(()=>{const s=globalThis.duiduTest.store,c=s.listChapters(s.listBooks()[0].id)[0];return s.listVersions(c.id).find(v=>s.version(v.id).payload.source==='他没有拔剑。');});
  await page.locator('.version-list button').filter({hasText:originalVersion.reason}).first().click();await page.getByRole('button',{name:'恢复为新草稿',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#source').value==='他没有拔剑。');await saved();checkpoint('Markdown 纯文本导入、替换前版本与人工恢复');
  const backupPath=path.join(data,'backup.json'),translationPath=path.join(data,'translation.txt'),reportPath=path.join(data,'review.md');
  const saveTo=filename=>desktop.evaluate(({dialog},filename)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:filename});},filename);
  await saveTo(translationPath);await page.getByRole('button',{name:'导出译文',exact:true}).click();await page.getByText(`已保存：${translationPath}`,{exact:true}).waitFor();assert.equal(await fs.readFile(translationPath,'utf8'),await page.getByLabel('英文译文',{exact:true}).inputValue());
  await saveTo(reportPath);await page.getByRole('button',{name:'导出记录',exact:true}).click();await page.getByText(`已保存：${reportPath}`,{exact:true}).waitFor();assert.match(await fs.readFile(reportPath,'utf8'),/第一轮原有备注/);
  await saveTo(backupPath);await page.getByRole('button',{name:'备份这本书 ↗',exact:true}).click();await page.getByText(`已保存：${backupPath}`,{exact:true}).waitFor();assert.ok(!(await fs.readFile(backupPath,'utf8')).includes('controlled-secret'));
  await desktop.evaluate(({dialog},filename)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filename]});},backupPath);
  await page.getByRole('button',{name:'导入书籍备份',exact:true}).click();await page.locator('.book-name').filter({hasText:'导入副本'}).waitFor();assert.equal(await page.getByLabel('编辑备注',{exact:true}).inputValue(),'第二轮备注');checkpoint('TXT、复核 Markdown、JSON 备份与新副本导入');
  // Graceful close must flush edits made less than 800ms before exit.
  await page.getByLabel('英文译文',{exact:true}).fill('Final edit immediately before exit');
  const exiting=desktop.waitForEvent('close');await main(()=>globalThis.duiduTest.window.close());await exiting;
  await launch();assert.equal(await page.getByLabel('英文译文',{exact:true}).inputValue(),'Final edit immediately before exit');assert.equal(await page.getByLabel('编辑备注',{exact:true}).inputValue(),'第二轮备注');
  assert.equal(await main(()=>globalThis.duiduTest.jobs.active),null);checkpoint('正常退出等待保存、重启恢复且不重发请求');
  // Failed saves also block normal exit until the user retries.
  await main(()=>globalThis.duiduTest.store.db.exec("CREATE TRIGGER simulate_full BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT,'disk full'); END"));
  await page.getByLabel('英文译文',{exact:true}).fill('Exit blocked draft');await main(()=>globalThis.duiduTest.window.close());await page.getByRole('alert').filter({hasText:'尚未退出'}).waitFor();assert.equal(await page.getByLabel('英文译文',{exact:true}).inputValue(),'Exit blocked draft');
  await main(()=>globalThis.duiduTest.store.db.exec('DROP TRIGGER simulate_full'));await page.getByRole('button',{name:'重试保存',exact:true}).click();await saved();checkpoint('保存失败阻止正常退出');
  assert.deepEqual(errors,[]);console.log(`Desktop regression complete; screenshots: ${output}`);
} finally {if(desktop?.process().exitCode===null)await desktop.close();}
