import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { listPackage } from '@electron/asar';

const executable=path.resolve(process.argv[2]||'out/Duidu-win32-x64/Duidu.exe');
const data=process.argv[3]?path.resolve(process.argv[3]):path.resolve('.test-data',`packaged-${randomUUID()}`);
const args=[`--user-data-dir=${data}`];
const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`};
let desktop,page;
const launch=async()=>{
  desktop=await electron.launch({executablePath:executable,args,env});page=await desktop.firstWindow();
  await page.waitForFunction(()=>document.querySelector('.welcome,.workspace-heading'));
  assert.equal(await desktop.evaluate(({app})=>app.isPackaged),true);
  assert.equal(await desktop.evaluate(()=>typeof globalThis.duiduTest),'undefined');
  assert.equal(await desktop.evaluate(({app})=>app.getPath('userData')),data);
};
try{
  await launch();console.log(`Installed version: ${await desktop.evaluate(({app})=>app.getVersion())}`);
  if(process.argv[4]==='--expect-existing'){
    assert.equal(await page.getByLabel('英文译文',{exact:true}).inputValue(),'Packaged SQLite works.');console.log('PASS installer upgrade preserves existing profile');
  }else{
  await page.getByRole('button',{name:'创建第一本书'}).click();await page.getByLabel('名称',{exact:true}).fill('安装包验收');await page.locator('dialog').getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('button',{name:'添加第一章'}).click();await page.locator('dialog').getByRole('button',{name:'保存',exact:true}).click();
  await page.getByLabel('中文原文',{exact:true}).fill('安装包原文');await page.getByLabel('英文译文',{exact:true}).fill('Packaged SQLite works.');
  await page.waitForFunction(()=>document.querySelector('.save-status').textContent==='已保存');
  }
  const second=spawn(executable,args,{env,stdio:'ignore'});const [code]=await once(second,'exit');assert.equal(code,0);assert.ok(!page.isClosed());
  console.log('PASS packaged startup, SQLite, stripped Node PATH and single instance');
  const closing=desktop.waitForEvent('close');await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closing;
  await launch();assert.equal(await page.getByLabel('英文译文',{exact:true}).inputValue(),'Packaged SQLite works.');console.log('PASS packaged restart recovery');
  await fs.mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/packaged.png'});
  const asarPath=path.join(path.dirname(executable),'resources','app.asar');
  const files=listPackage(asarPath);assert.ok(!files.some(f=>/(?:^|[\\/])(?:\.env[^\\/]*|\.test-data|\.cache|output|tests)(?:[\\/]|$)/.test(f)));
  assert.ok(files.some(f=>f.endsWith('win32-x64.node')));console.log('PASS package excludes secrets/test profiles and includes native SQLite');
} finally{if(desktop?.process().exitCode===null)await desktop.close();}
