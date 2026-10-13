import React, { useEffect, useRef, useState } from 'react';
import { SaveQueue } from './save-queue.mjs';
import { isReviewOutdated, REVIEW_DECISIONS } from '../lib/review.mjs';
import { getLengthError } from '../lib/text.mjs';
import QuoteEvidence from './QuoteEvidence';
import examples from '../app/long-examples.json';

const api=window.duidu;
const stamp=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const combined=(a='',b='')=>[a.trim(),b.trim()].filter(Boolean).join('\n\n');
const emptyReview={decision:'',note:'',revision:0};

export default function App(){
  const [books,setBooks]=useState([]),[bookId,setBookId]=useState(''),[chapters,setChapters]=useState([]),[chapter,setChapter]=useState(null);
  const [checks,setChecks]=useState([]),[check,setCheck]=useState(null),[versions,setVersions]=useState([]);
  const [settings,setSettings]=useState(null),[status,setStatus]=useState('saved'),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [appInfo,setAppInfo]=useState({});
  const [busy,setBusy]=useState(false),[checking,setChecking]=useState(false),[filter,setFilter]=useState('all'),[showArchived,setShowArchived]=useState(false);
  const [modal,setModal]=useState(null),[fields,setFields]=useState({}),[expanded,setExpanded]=useState([]),[copyFallback,setCopyFallback]=useState(null);
  const chapterRef=useRef(null),checkRef=useRef(null),booksRef=useRef([]),queueRef=useRef(null),reviewQueues=useRef(new Map()),timer=useRef(null),activeRequest=useRef(null),dialogRef=useRef(null),copyRef=useRef(null);
  chapterRef.current=chapter;checkRef.current=check;booksRef.current=books;
  const book=books.find(b=>b.id===bookId);
  const saveStatus=(next,issue)=>{setStatus(next);if(issue)setError(issue.message);};
  if(!queueRef.current)queueRef.current=new SaveQueue(async(value,expectedRevision)=>{
    const saved=await api.saveDraft({...value,expectedRevision});
    setChapters(list=>list.map(c=>c.id===saved.id?{...c,revision:saved.revision,updatedAt:saved.updatedAt}:c));
    if(chapterRef.current?.id===saved.id){chapterRef.current={...chapterRef.current,revision:saved.revision};setChapter(c=>c?.id===saved.id?{...c,revision:saved.revision}:c);}
    return saved;
  },saveStatus);
  const flush=async()=>{clearTimeout(timer.current);await queueRef.current.flush();for(const queue of reviewQueues.current.values())await queue.flush();setStatus('saved');};
  const stop=()=>{const id=activeRequest.current;activeRequest.current=null;setChecking(false);if(id)api.cancel({requestId:id}).catch(()=>{});};
  const schedule=()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>flush().catch(e=>setError(e.message)),800);};
  const guarded=async action=>{if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const loadChapter=async id=>{
    if(!id){queueRef.current.reset(0);setChapter(null);setCheck(null);setChecks([]);setVersions([]);return;}
    const c=await api.getChapter({id});const [history,versions]=await Promise.all([api.listChecks({chapterId:id}),api.listVersions({chapterId:id})]);
    queueRef.current.reset(c.revision);reviewQueues.current.clear();chapterRef.current=c;setChapter(c);setChecks(history);setVersions(versions);setFilter('all');
    const latest=history[0]?await api.getCheck({id:history[0].id}):null;checkRef.current=latest;setCheck(latest);setExpanded(latest?.result.findings[0]?[latest.result.findings[0].id]:[]);setStatus('saved');
  };
  const loadBook=async(id,preferred)=>{setBookId(id);const list=await api.listChapters({bookId:id});setChapters(list);await loadChapter(list.find(c=>c.id===preferred&&!c.archived)?.id||list.find(c=>!c.archived)?.id);};
  const navigate=action=>guarded(async()=>{await flush();stop();await action();});
  useEffect(()=>{let mounted=true;(async()=>{try{const data=await api.bootstrap();if(!mounted)return;setBooks(data.books);booksRef.current=data.books;setSettings(data.settings);setAppInfo({version:data.version,dataDirectory:data.dataDirectory});
    let selected=data.books.find(b=>!b.archived);if(data.lastChapterId){for(const b of data.books.filter(b=>!b.archived)){const list=await api.listChapters({bookId:b.id});if(list.some(c=>c.id===data.lastChapterId&&!c.archived)){selected=b;break;}}}
    if(selected)await loadBook(selected.id,data.lastChapterId);
  }catch(e){setError(e.message);}})();return()=>{mounted=false;clearTimeout(timer.current);};},[]);
  const flushRef=useRef(flush);flushRef.current=flush;
  useEffect(()=>api.onCloseRequest(async id=>{try{await flushRef.current();await api.cancel({});api.finishClose(id,true);}catch(e){setError(`尚未退出：${e.message}`);api.finishClose(id,false);}}),[]);
  useEffect(()=>{if(!modal)return;dialogRef.current?.showModal();},[modal]);
  useEffect(()=>{if(!copyFallback)return;copyRef.current?.showModal();copyRef.current?.querySelector('textarea')?.select();},[copyFallback]);
  useEffect(()=>{const onKey=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();flushRef.current().then(()=>setNotice('稿件与备注已保存。')).catch(e=>setError(e.message));}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  const edit=(key,value)=>{stop();setError('');const next={...chapterRef.current,[key]:value};chapterRef.current=next;setChapter(next);queueRef.current.stage({id:next.id,source:next.source,translation:next.translation,context:next.context});schedule();};
  const review=(findingId,patch)=>{
    const current=checkRef.current,old=current.reviews[findingId]||emptyReview;const value={...old,...patch};
    const next={...current,reviews:{...current.reviews,[findingId]:value}};checkRef.current=next;setCheck(next);
    const key=`${current.id}:${findingId}`;let queue=reviewQueues.current.get(key);
    if(!queue){queue=new SaveQueue(async(draft,expectedRevision)=>{const saved=await api.saveReview({...draft,expectedRevision});if(checkRef.current?.id===saved.checkId){const latest=checkRef.current;const updated={...latest,reviews:{...latest.reviews,[findingId]:{...latest.reviews[findingId],revision:saved.revision}}};checkRef.current=updated;setCheck(updated);}return saved;},saveStatus);queue.reset(old.revision||0);reviewQueues.current.set(key,queue);}
    queue.stage({checkId:current.id,findingId,decision:value.decision,note:value.note});schedule();
  };
  const open=(type,data={})=>{setFields(data);setModal(type);};
  const closeModal=()=>{if(!busy){dialogRef.current?.close();setModal(null);}};
  const refreshBook=async updated=>{const all=await api.listBooks();setBooks(all);booksRef.current=all;if(updated?.id)await loadBook(updated.id);};
  const saveModal=()=>guarded(async()=>{
    await flush();stop();
    if(modal==='newBook'){const b=await api.createBook({title:fields.title});await refreshBook(b);}
    if(modal==='newChapter'){const c=await api.createChapter({bookId,title:fields.title});setChapters(await api.listChapters({bookId}));await loadChapter(c.id);}
    if(modal==='book'){const b=await api.updateBook({id:book.id,title:fields.title,context:fields.context,expectedRevision:book.revision});setBooks(await api.listBooks());if(check)setCheck({...check});setNotice('书籍背景已保存，下次检查会使用新背景。');}
    if(modal==='chapter'){const c=await api.updateChapter({id:chapter.id,title:fields.title,expectedRevision:queueRef.current.revision});queueRef.current.reset(c.revision);setChapter(c);setChapters(await api.listChapters({bookId}));}
    if(modal==='settings'){setSettings(await api.saveSettings({baseUrl:fields.baseUrl,model:fields.model,key:fields.key||'',clearKey:fields.clearKey||false}));setNotice('模型设置已保存。');}
    if(modal==='importText'){const next={...chapterRef.current,[fields.side]:fields.text};queueRef.current.stage({id:next.id,source:next.source,translation:next.translation,context:next.context,reason:`导入 ${fields.name}`.slice(0,100)});setChapter(next);chapterRef.current=next;await flush();setVersions(await api.listVersions({chapterId:chapter.id}));}
    if(modal==='restore'){const c=await api.restoreVersion({chapterId:chapter.id,versionId:fields.id,expectedRevision:queueRef.current.revision});queueRef.current.reset(c.revision);setChapter(c);chapterRef.current=c;setVersions(await api.listVersions({chapterId:c.id}));setNotice('已恢复为新草稿，原有版本仍保留。');}
    dialogRef.current?.close();setModal(null);
  });
  const archive=(kind,item)=>navigate(async()=>{
    if(kind==='book'){await api.updateBook({id:item.id,archived:!item.archived,expectedRevision:item.revision});const all=await api.listBooks();setBooks(all);const next=all.find(b=>!b.archived);if(next)await loadBook(next.id);else{setBookId('');await loadChapter(null);}}
    else{await api.updateChapter({id:item.id,archived:!item.archived,expectedRevision:item.id===chapter?.id?queueRef.current.revision:item.revision});await loadBook(bookId);}
  });
  const move=(kind,item,direction)=>navigate(async()=>{const list=kind==='books'?books:chapters;const index=list.findIndex(x=>x.id===item.id),target=index+direction;if(target<0||target>=list.length)return;const ids=list.map(x=>x.id);[ids[index],ids[target]]=[ids[target],ids[index]];await api.reorder({kind,ids,bookId});if(kind==='books')setBooks(await api.listBooks());else setChapters(await api.listChapters({bookId}));});
  const chooseCheck=id=>navigate(async()=>{const selected=await api.getCheck({id});setCheck(selected);checkRef.current=selected;setExpanded(selected.result.findings[0]?[selected.result.findings[0].id]:[]);reviewQueues.current.clear();setFilter('all');});
  const analyze=async()=>{
    if(checking||busy)return;setError('');
    try{await flush();const c=chapterRef.current,b=booksRef.current.find(b=>b.id===c.bookId);const issue=getLengthError({...c,context:combined(b.context,c.context)});if(issue)throw new Error(issue.message);
      const requestId=crypto.randomUUID();activeRequest.current=requestId;setChecking(true);
      try{const result=await api.analyze({chapterId:c.id,expectedRevision:queueRef.current.revision,expectedBookRevision:b.revision,requestId});if(activeRequest.current!==requestId)return;
        setCheck(result);checkRef.current=result;reviewQueues.current.clear();setChecks(await api.listChecks({chapterId:c.id}));setVersions(await api.listVersions({chapterId:c.id}));setExpanded(result.result.findings[0]?[result.result.findings[0].id]:[]);setFilter('all');setNotice('检查结果已保存，请逐项查证。');
      }catch(e){if(activeRequest.current===requestId&&e.code!=='CANCELLED')setError(e.message);}
      finally{if(activeRequest.current===requestId){activeRequest.current=null;setChecking(false);}}
    }catch(e){setError(e.message);}
  };
  const importText=side=>guarded(async()=>{await flush();stop();const file=await api.readText();if(file)open('importText',{...file,side});});
  const exported=result=>{if(result)setNotice(`已保存：${result.path}`);};
  const copy=async value=>{try{await navigator.clipboard.writeText(value);setNotice('已复制参考改译，请核对后粘贴。');}catch{setCopyFallback(value);}};
  const outdated=check&&chapter&&isReviewOutdated({...chapter,context:combined(book?.context,chapter.context)},check.snapshot);
  const findings=check?.result.findings||[],recorded=findings.filter(f=>check.reviews[f.id]?.decision).length;
  const visible=findings.filter(f=>filter==='all'||!check.reviews[f.id]?.decision);
  const focusFinding=id=>{setExpanded(previous=>previous.includes(id)?previous:[...previous,id]);requestAnimationFrame(()=>document.getElementById(`finding-${id}`)?.querySelector('button')?.focus());requestAnimationFrame(()=>document.getElementById(`finding-${id}`)?.scrollIntoView({block:'nearest'}));};
  const statusText={dirty:'待保存',saving:'保存中…',saved:'已保存',error:'保存失败'}[status];

  return <div className="app-shell">
    <header className="app-header"><div className="brand">对读<span>小说英译复核</span></div><div className="header-actions"><span className={`save-status ${status}`} role="status">{statusText}</span><button disabled={busy} onClick={()=>guarded(async()=>{await flush();setNotice('稿件与备注已保存。');})}>保存 <kbd>Ctrl S</kbd></button><button onClick={()=>navigate(async()=>open('settings',{...settings,key:''}))}>模型设置</button></div></header>
    <div className="app-body"><aside className="sidebar"><div className="sidebar-heading"><h2>我的书籍</h2><button aria-label="新建书籍" onClick={()=>navigate(async()=>open('newBook',{title:''}))}>＋</button></div>
      <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>显示归档</label>
      <div className="book-list">{books.filter(b=>showArchived||!b.archived).map(b=><div className={`book-item ${bookId===b.id?'selected':''}`} key={b.id}><button className="book-name" onClick={()=>navigate(()=>loadBook(b.id))}>{b.archived?'▧':'▤'} {b.title}</button><details className="row-menu"><summary aria-label={`${b.title}操作`}>···</summary><div><button onClick={()=>move('books',b,-1)}>上移</button><button onClick={()=>move('books',b,1)}>下移</button><button onClick={()=>archive('book',b)}>{b.archived?'恢复书籍':'归档书籍'}</button></div></details></div>)}</div>
      {book&&<><div className="sidebar-heading chapter-heading"><h2>章节</h2><button aria-label="新建章节" disabled={book.archived} onClick={()=>navigate(async()=>open('newChapter',{title:`第 ${chapters.filter(c=>!c.archived).length+1} 章`}))}>＋</button></div><div className="chapter-list">{chapters.filter(c=>showArchived||!c.archived).map((c,index)=><div className={`chapter-item ${chapter?.id===c.id?'selected':''}`} key={c.id}><button className="chapter-name" onClick={()=>navigate(()=>loadChapter(c.id))}><span>{String(index+1).padStart(2,'0')}</span>{c.title}{c.archived?'（归档）':''}</button><details className="row-menu"><summary aria-label={`${c.title}操作`}>···</summary><div><button onClick={()=>move('chapters',c,-1)}>上移</button><button onClick={()=>move('chapters',c,1)}>下移</button><button onClick={()=>archive('chapter',c)}>{c.archived?'恢复章节':'归档章节'}</button></div></details></div>)}</div><button className="sidebar-link" onClick={()=>navigate(async()=>open('book',{title:book.title,context:book.context}))}>书籍背景与名称 ↗</button><button className="sidebar-link" onClick={()=>navigate(async()=>exported(await api.exportBook({bookId}))) }>备份这本书 ↗</button></>}
      <div className="sidebar-bottom"><button onClick={()=>navigate(async()=>{const b=await api.importBook();if(b)await refreshBook(b);})}>导入书籍备份</button><span>稿件与记录保存在本机</span></div>
    </aside>
    <main className="workspace" aria-busy={busy}>
      {error&&<div className="banner error-banner" role="alert"><span>{error}</span>{status==='error'&&<><button onClick={()=>guarded(flush)}>重试保存</button><button onClick={()=>guarded(async()=>exported(await api.exportDraft({translation:chapterRef.current?.translation||''})))}>导出当前译文草稿</button></>}<button aria-label="关闭错误提示" onClick={()=>setError('')}>×</button></div>}
      {notice&&<div className="banner notice-banner" role="status"><span>{notice}</span><button aria-label="关闭通知" onClick={()=>setNotice('')}>×</button></div>}
      {!chapter?<section className="welcome"><span className="eyebrow">从一章开始</span><h1>让每一次修改<br/>都有据可查。</h1><p>保存原译、发现变化，留下你的编辑判断。</p><div className="welcome-actions"><button className="primary" onClick={()=>open(book?'newChapter':'newBook',{title:book?'第一章':''})}>{book?'添加第一章':'创建第一本书'} ＋</button><button onClick={()=>navigate(async()=>{const b=await api.createBook({title:'示例 · 夜入旧驿'});const c=await api.createChapter({bookId:b.id,title:'夜入旧驿（自拟）'});const sample=examples.find(x=>x.id==='C01');await api.saveDraft({id:c.id,expectedRevision:0,source:sample.source,translation:sample.translation,context:sample.context||'',reason:'载入自拟示例'});setBooks(await api.listBooks());await loadBook(b.id,c.id);})}>载入自拟章节示例</button></div></section>:<>
        <div className="workspace-heading"><div><span className="eyebrow">{book?.title}</span><h1>{chapter.title}<button className="icon-button" aria-label="重命名章节" onClick={()=>navigate(async()=>open('chapter',{title:chapter.title}))}>✎</button></h1></div><div className="workspace-actions"><button onClick={()=>navigate(async()=>{setVersions(await api.listVersions({chapterId:chapter.id}));open('versions',{});})}>文本版本</button><button onClick={()=>navigate(async()=>exported(await api.exportTranslation({chapterId:chapter.id})))}>导出译文</button></div></div>
        <div className="working-grid"><section className="editor-panel"><div className="panel-heading"><h2>原译对照</h2><span>原译段落独立编号</span></div><div className="editor-pair">{[['source','中文原文',12000],['translation','英文译文',48000]].map(([side,label,limit])=><div className="editor-column" key={side}><div className="field-heading"><label htmlFor={side}>{label}</label><button onClick={()=>importText(side)}>导入</button><span className={chapter[side].length>limit?'over-limit':''}>{chapter[side].length.toLocaleString()} / {limit.toLocaleString()}</span></div><textarea id={side} aria-label={label} spellCheck={side==='translation'} lang={side==='translation'?'en':'zh'} value={chapter[side]} onChange={e=>edit(side,e.target.value)} placeholder={side==='source'?'粘贴一章中文原文…':'粘贴对应英文译文…'}/></div>)}</div>
          <details className="chapter-context"><summary>本章补充背景 <span>合并书籍背景后 {combined(book?.context,chapter.context).length} / 3,000</span></summary><label className="sr-only" htmlFor="context">本章补充背景</label><textarea id="context" value={chapter.context} onChange={e=>edit('context',e.target.value)} rows={3} placeholder="本章已确认的人物关系、事实或统一译法…"/>{book?.context&&<p className="shared-context">书籍共用背景：{book.context}</p>}</details>
          <div className="analysis-actions"><button className="primary" disabled={checking||busy||chapter.archived||book?.archived} onClick={analyze}>{checking?'正在对照原译…':check?'重新检查当前文本':'检查译文'} ↗</button>{checking&&<button onClick={()=>{stop();setNotice('已取消，稿件和旧检查记录保留。');}}>取消检查</button>}<span>{settings?.hasKey?'检查时将原译和背景发送至你配置的模型服务。':'请先在模型设置中填写 API 密钥。'}</span></div>
        </section>
        <section className="results-panel"><div className="panel-heading"><h2>编辑复核</h2>{check&&<button onClick={()=>navigate(async()=>exported(await api.exportReview({checkId:check.id})))}>导出记录</button>}</div>
          {checks.length>0&&<label className="history-picker">检查历史<select aria-label="检查历史" value={check?.id||''} onChange={e=>chooseCheck(e.target.value)}>{checks.map((c,i)=><option key={c.id} value={c.id}>{i===0?'最新 · ':''}{stamp(c.createdAt)} · {c.modelConfig.model}</option>)}</select></label>}
          {!check?<div className="empty-results"><span>↳</span><h3>{checking?'正在阅读这一章':'等待第一轮检查'}</h3><p>{checking?'可继续编辑或取消。完成后，结果会保存到这一章。':'检查后在这里查证引文、记录决定与备注。'}</p><small>模型可能误判或遗漏，最终修改由你决定。</small></div>:<>
            {outdated&&<p className="outdated" role="status">文本或背景已改变。以下引文属于这轮检查的历史快照。</p>}{checking&&<p className="outdated" role="status">正在重新检查，旧结果与备注保留。</p>}
            <div className="result-overview"><span className="eyebrow">{stamp(check.createdAt)}</span><h3>{findings.length?`${findings.length} 项待核对`:'未发现明显问题'}</h3><p>{check.result.summary}</p></div>
            {findings.length>0&&<div className="result-toolbar"><span>已记录 {recorded}/{findings.length}</span><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>全部</button><button aria-pressed={filter==='unrecorded'} onClick={()=>setFilter('unrecorded')}>未记录</button><select aria-label="定位问题" value="" onChange={e=>{setFilter('all');focusFinding(e.target.value);}}><option value="">定位问题…</option>{findings.map((f,i)=><option key={f.id} value={f.id}>{i+1}. {f.lossType}</option>)}</select></div>}
            {visible.length===0&&findings.length>0&&<p className="complete-message">每项都已记录决定，可导出复核记录。</p>}
            {visible.map(f=>{const r=check.reviews[f.id]||emptyReview,index=findings.indexOf(f);return <article className="finding" id={`finding-${f.id}`} key={f.id}><button className="finding-title" aria-expanded={expanded.includes(f.id)} onClick={()=>setExpanded(old=>old.includes(f.id)?old.filter(id=>id!==f.id):[...old,f.id])}><span>{index+1}. {f.lossType}</span><span>{expanded.includes(f.id)?'−':'＋'}</span></button><div className="finding-meta"><span>{f.sourceLocation?.ambiguous?'原文多处出现':f.sourceLocation?`原文第 ${f.sourceLocation.first} 段`:'原文引文'}</span><span>{f.severity==='高'?'优先核对':f.severity==='中'?'建议核对':'酌情调整'}</span>{r.decision&&<b>✓ {REVIEW_DECISIONS[r.decision]}</b>}</div>{f.needsContext&&<p className="context-question">需确认：{f.contextQuestion||check.result.contextNote}</p>}
              {expanded.includes(f.id)&&<div className="finding-body"><QuoteEvidence side="source" text={check.snapshot.source} quote={f.sourceQuote} longText/><QuoteEvidence side="translation" text={check.snapshot.translation} quote={f.translationQuote} longText/>{f.supportingSourceQuote&&<details><summary>相关原文依据</summary><QuoteEvidence side="source" text={check.snapshot.source} quote={f.supportingSourceQuote} longText/></details>}{f.supportingContextQuote&&<div className="supporting-context"><span>补充背景</span><p>{f.supportingContextQuote}</p></div>}<details><summary>模型判断</summary><p>{f.evidence}</p></details><div className="suggestion"><span className="eyebrow">修改建议</span><p>{f.suggestion}</p>{f.suggestedTranslation&&<><blockquote lang="en">{f.suggestedTranslation}</blockquote><button onClick={()=>copy(f.suggestedTranslation)}>复制参考改译</button></>}</div><div className="decision-buttons">{Object.entries(REVIEW_DECISIONS).map(([key,label])=><button key={key} aria-pressed={r.decision===key} onClick={()=>review(f.id,{decision:r.decision===key?'':key})}>{r.decision===key?'✓ ':''}{label}</button>)}</div><label className="note-label" htmlFor={`note-${f.id}`}>编辑备注</label><textarea id={`note-${f.id}`} rows={2} maxLength={2000} value={r.note} onChange={e=>review(f.id,{note:e.target.value})} placeholder="记录理由、统一译法或要查的前文…"/></div>}
            </article>;})}
            {check.result.contextNote&&<p className="context-question">待补充背景：{check.result.contextNote}</p>}<p className="result-footnote">由 {check.result.provider} 分析。可能误判或遗漏；记录决定不代表译文已修复。</p>
          </>}
        </section></div>
      </>}
    </main></div>
    {modal&&<dialog ref={dialogRef} className={`modal ${modal==='importText'||modal==='restore'?'wide-modal':''}`} onCancel={e=>{if(busy)e.preventDefault();else setModal(null);}}><form onSubmit={e=>{e.preventDefault();saveModal();}}><div className="modal-heading"><h2>{{newBook:'创建书籍',newChapter:'添加章节',book:'书籍背景与名称',chapter:'重命名章节',settings:'模型设置',versions:'文本版本',restore:'恢复文本版本',importText:'确认导入文本'}[modal]}</h2><button type="button" aria-label="关闭窗口" disabled={busy} onClick={closeModal}>×</button></div>
      {['newBook','newChapter','book','chapter'].includes(modal)&&<label>名称<input autoFocus required maxLength={120} value={fields.title||''} onChange={e=>setFields({...fields,title:e.target.value})}/></label>}
      {modal==='book'&&<label>共用背景与术语约定<textarea rows={8} value={fields.context||''} onChange={e=>setFields({...fields,context:e.target.value})} placeholder="人物关系、世界观和全书统一译法…"/><small>检查时与本章背景合并，合计最多 3,000 字符。</small></label>}
      {modal==='settings'&&<><p className="modal-description">密钥加密保存在本机。点击检查时，文本会发送到以下接口。</p><label>API 根地址<input required value={fields.baseUrl||''} onChange={e=>setFields({...fields,baseUrl:e.target.value})}/></label><label>模型名称<input required value={fields.model||''} onChange={e=>setFields({...fields,model:e.target.value})}/></label><label>API 密钥<input type="password" autoComplete="off" value={fields.key||''} onChange={e=>setFields({...fields,key:e.target.value,clearKey:false})} placeholder={settings?.hasKey?'已保存；留空保留现有密钥':'填写你自己的 API 密钥'}/></label>{settings?.hasKey&&<label className="check-label"><input type="checkbox" checked={fields.clearKey||false} onChange={e=>setFields({...fields,clearKey:e.target.checked,key:''})}/>清除已保存密钥</label>}<div className="connection-test"><button type="button" disabled={busy||checking} onClick={()=>guarded(async()=>{setSettings(await api.saveSettings({baseUrl:fields.baseUrl,model:fields.model,key:fields.key||'',clearKey:fields.clearKey||false}));setFields({...fields,key:'',clearKey:false});const updated=await api.testConnection();setSettings(updated);setNotice('连接测试通过。');})}>保存并测试连接</button><small>发送固定短文本，会产生一次 API 调用。</small>{settings?.lastTest&&<p>最近成功：{stamp(settings.lastTest.at)}</p>}</div></>}
      {modal==='settings'&&<p className="data-location">对读 {appInfo.version}<br/>数据目录：<code>{appInfo.dataDirectory}</code></p>}
      {modal==='versions'&&<div className="version-list">{versions.map(v=><button type="button" key={v.id} onClick={()=>guarded(async()=>{const version=await api.getVersion({id:v.id});open('restore',version);})}><span>{stamp(v.createdAt)}</span><b>{v.reason}</b><span>查看与恢复 →</span></button>)}<p>恢复会生成新草稿，原有版本与检查记录继续保留。</p></div>}
      {modal==='restore'&&<><p>确认后恢复原文、译文和本章背景。当前草稿已保存，可再次从版本列表找回。</p><div className="preview-pair"><div><h3>中文原文</h3><pre>{fields.payload?.source}</pre></div><div><h3>英文译文</h3><pre lang="en">{fields.payload?.translation}</pre></div></div>{fields.payload?.context&&<pre>{fields.payload.context}</pre>}</>}
      {modal==='importText'&&<><p>{fields.name} · {fields.text.length.toLocaleString()} 字符 · 将替换{fields.side==='source'?'中文原文':'英文译文'}，当前版本已保存。</p><pre className="import-preview">{fields.text}</pre></>}
      {error&&<p className="modal-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" disabled={busy} onClick={closeModal}>关闭</button>{modal!=='versions'&&<button className="primary" disabled={busy} type="submit">{busy?'正在处理…':modal==='restore'?'恢复为新草稿':modal==='importText'?'确认替换':'保存'}</button>}</div></form></dialog>}
    {copyFallback&&<dialog ref={copyRef} className="modal" onClose={()=>setCopyFallback(null)}><h2>手动复制</h2><p>文字已选中，请按 Ctrl+C。</p><textarea readOnly value={copyFallback} rows={8}/><button onClick={()=>copyRef.current.close()}>关闭</button></dialog>}
  </div>;
}
