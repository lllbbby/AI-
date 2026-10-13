import { app, BrowserWindow, ipcMain, dialog, safeStorage, Menu } from 'electron';
import squirrel from 'electron-squirrel-startup';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store, AppError, combineContext } from './store.mjs';
import { Jobs } from './jobs.mjs';
import { buildReviewReport, isReviewOutdated } from '../lib/review.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const testMode=!app.isPackaged && process.env.DUIDU_TEST_MODE==='1';
const dataArgument=process.argv.find(value=>value.startsWith('--user-data-dir='));
if(dataArgument)app.setPath('userData',path.resolve(dataArgument.slice('--user-data-dir='.length)));
if(testMode && process.env.DUIDU_TEST_DATA)app.setPath('userData',path.resolve(process.env.DUIDU_TEST_DATA));
if(squirrel){app.quit();} else if(!app.requestSingleInstanceLock()){app.quit();} else {
  let window,store,jobs,quitting=false,closeId=null;
  const trusted = event => Boolean(window && event.sender===window.webContents && event.senderFrame===window.webContents.mainFrame);
  const publicSettings = () => { const value=store.getSetting('model',{baseUrl:'https://api.deepseek.com',model:'deepseek-v4-pro'});return {baseUrl:value.baseUrl,model:value.model,hasKey:Boolean(store.getSetting('encryptedKey')),lastTest:store.getSetting('lastTest')}; };
  const secretSettings = () => {
    const settings=publicSettings(), encrypted=store.getSetting('encryptedKey');
    if(!encrypted)return {...settings,key:''};
    try{return {...settings,key:safeStorage.decryptString(Buffer.from(encrypted,'base64'))};}
    catch{throw new AppError('密钥无法在当前 Windows 用户下解密，请重新填写。','KEY_UNAVAILABLE');}
  };
  const cleanName = value => value.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100) || '对读';
  const writeExport=async(contents,filename,extension) => {
    const selected=await dialog.showSaveDialog(window,{defaultPath:filename,filters:[{name:extension.toUpperCase(),extensions:[extension]}]});
    if(selected.canceled || !selected.filePath)return null;
    const temporary=`${selected.filePath}.${randomUUID()}.tmp`;
    try {await fs.writeFile(temporary,contents,'utf8');await fs.rename(temporary,selected.filePath);return {path:selected.filePath};}
    catch {await fs.rm(temporary,{force:true}).catch(()=>{});throw new AppError('文件保存失败，请检查目录权限和剩余空间后重试。','FILE_WRITE_FAILED');}
  };
  const handlers={
    bootstrap:()=>({books:store.listBooks(),settings:publicSettings(),version:app.getVersion(),dataDirectory:app.getPath('userData'),lastChapterId:store.getSetting('lastChapterId')}),
    listBooks:()=>store.listBooks(),
    createBook:args=>store.createBook(args.title),
    updateBook:args=>{jobs.cancel();return store.updateBook(args);},
    listChapters:args=>store.listChapters(args.bookId),
    createChapter:args=>store.createChapter(args),
    getChapter:args=>{const chapter=store.chapter(args.id);store.setSetting('lastChapterId',chapter.id);return chapter;},
    saveDraft:args=>{jobs.cancel();return store.saveDraft(args);},
    updateChapter:args=>{jobs.cancel();return store.updateChapter(args);},
    reorder:args=>store.reorder(args),
    listVersions:args=>store.listVersions(args.chapterId),
    getVersion:args=>store.version(args.id),
    restoreVersion:args=>{jobs.cancel();return store.restoreVersion(args);},
    listChecks:args=>store.listChecks(args.chapterId),
    getCheck:args=>store.check(args.id),
    saveReview:args=>store.saveReview(args),
    analyze:args=>jobs.run(args), cancel:args=>jobs.cancel(args?.requestId),
    getSettings:()=>publicSettings(),
    saveSettings:args=>{
      if(typeof args?.baseUrl!=='string'||typeof args?.model!=='string'||typeof args?.key!=='string'||args.key.length>2000||args.model.length>200||!args.model.trim())throw new AppError('请填写接口根地址和模型名称。');
      let url;try{url=new URL(args.baseUrl);}catch{throw new AppError('接口地址无效。');}
      const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
      if((url.protocol!=='https:'&&!(url.protocol==='http:'&&local))||url.username||url.password||url.search||url.hash||url.pathname.endsWith('/chat/completions'))throw new AppError('请填写 HTTPS 接口根地址，不包含 /chat/completions 或查询参数。');
      if(args.key && !safeStorage.isEncryptionAvailable())throw new AppError('Windows 密钥加密暂不可用，请重试。','KEY_UNAVAILABLE');
      if(args.key && !args.key.trim())throw new AppError('API 密钥不能只有空白字符。');
      const encrypted=args.key?safeStorage.encryptString(args.key.trim()).toString('base64'):null;
      store.db.transaction(()=>{
        store.setSetting('model',{baseUrl:url.href.replace(/\/$/,''),model:args.model.trim()});
        if(encrypted)store.setSetting('encryptedKey',encrypted);
        if(args.clearKey)store.setSetting('encryptedKey',null);
        store.setSetting('lastTest',null);
      })();return publicSettings();
    },
    testConnection:async()=>{const result=await jobs.testConnection();store.setSetting('lastTest',{...result,at:new Date().toISOString()});return publicSettings();},
    readText:async()=>{
      const picked=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'纯文本',extensions:['txt','md','markdown']}]});
      if(picked.canceled)return null;
      const filename=picked.filePaths[0];const stat=await fs.stat(filename);if(stat.size>4*1024*1024)throw new AppError('文件超过 4 MB，请先按章节拆分。');
      try{const content=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(filename));return {name:path.basename(filename),text:content};}
      catch{throw new AppError('无法读取 UTF-8 文本，请检查文件编码及读取权限。','FILE_READ_FAILED');}
    },
    exportDraft:args=>writeExport(args.translation,'未保存的译文草稿.txt','txt'),
    exportTranslation:args=>{const c=store.chapter(args.chapterId);return writeExport(c.translation,`${cleanName(c.title)}-译文.txt`,'txt');},
    exportReview:args=>{
      const check=store.check(args.checkId),chapter=store.chapter(check.chapterId),book=store.book(chapter.bookId);
      const reviews=Object.fromEntries(check.result.findings.map((f,i)=>[i,check.reviews[f.id]||{}]));
      const report=buildReviewReport({result:check.result,snapshot:check.snapshot,reviews,outdated:isReviewOutdated({...chapter,context:combineContext(book.context,chapter.context)},check.snapshot)});
      return writeExport(`${report}\n模型：${check.modelConfig.model}\n提示词摘要：${check.promptHash}\n`,`${cleanName(chapter.title)}-复核-${check.createdAt.replace(/[^0-9]/g,'')}.md`,'md');
    },
    exportBook:args=>{const backup=store.exportBook(args.bookId);return writeExport(JSON.stringify(backup,null,2),`${cleanName(backup.book.title)}-对读备份.json`,'json');},
    importBook:async()=>{
      const picked=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'对读书籍备份',extensions:['json']}]});if(picked.canceled)return null;
      const stat=await fs.stat(picked.filePaths[0]);if(stat.size>50*1024*1024)throw new AppError('备份超过 50 MB，暂不支持导入。');
      let backup;try{backup=JSON.parse(await fs.readFile(picked.filePaths[0],'utf8'));}catch{throw new AppError('备份文件无法读取或 JSON 格式无效。');}
      return store.importBook(backup);
    }
  };
  ipcMain.handle('duidu:call',async(event,method,args)=>{
    try {
      if(!trusted(event)||!Object.hasOwn(handlers,method))throw new AppError('不允许的操作。','FORBIDDEN');
      if(args!==undefined&&(args===null||typeof args!=='object'||Array.isArray(args)||Buffer.byteLength(JSON.stringify(args))>4*1024*1024))throw new AppError('提交内容无效或过长。');
      return {ok:true,value:await handlers[method](args)};
    } catch(error) {
      const known=error instanceof AppError || typeof error?.code==='string' && !error.code.startsWith('SQLITE');
      return {ok:false,error:{code:known?error.code:'SAVE_FAILED',message:known?error.message:'操作未完成。请检查磁盘空间和目录权限；当前草稿仍保留，可重试或导出。'}};
    }
  });
  ipcMain.on('duidu:close-response',(event,payload)=>{if(!trusted(event)||payload?.id!==closeId)return;closeId=null;if(payload.success===true){jobs.cancel();quitting=true;window.close();} });
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(async()=>{
  try{store=new Store(path.join(app.getPath('userData'),'duidu.sqlite'));}catch{dialog.showErrorBox('无法打开对读数据','本地数据无法打开。请检查文件权限，或保留数据目录后重新安装最新版本。');app.quit();}
  if(store){
    jobs=new Jobs(store,secretSettings);
    window=new BrowserWindow({width:1440,height:960,minWidth:1000,minHeight:700,title:'对读',backgroundColor:'#f4f1eb',show:false,webPreferences:{preload:path.join(directory,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    Menu.setApplicationMenu(null);
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
    window.on('close',event=>{if(!quitting){event.preventDefault();if(!closeId){closeId=randomUUID();window.webContents.send('duidu:close-request',closeId);}}});
    window.webContents.on('render-process-gone',()=>{closeId=null;dialog.showErrorBox('界面已停止','已保存内容仍在。请重新打开软件；未完成保存的编辑可能需要恢复。');quitting=true;app.quit();});
    window.once('ready-to-show',()=>window.show());
    if(!app.isPackaged && process.env.DUIDU_DEV_URL==='http://127.0.0.1:5173')await window.loadURL(process.env.DUIDU_DEV_URL);
    else await window.loadFile(path.join(directory,'../dist/index.html'));
    if(testMode)globalThis.duiduTest={store,jobs,handlers,window};
    app.on('before-quit',event=>{if(!quitting && window && !window.isDestroyed()){event.preventDefault();window.close();}});
    app.on('will-quit',()=>{jobs.cancel();store.close();});
    app.on('window-all-closed',()=>app.quit());
  }
  }).catch(()=>{dialog.showErrorBox('启动失败','对读未能启动。请保留数据目录，重新打开软件。');app.exit(1);});
}
