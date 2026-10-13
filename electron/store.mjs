import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateResult } from '../lib/analysis.mjs';
import { findQuoteLocation } from '../lib/text.mjs';

export class AppError extends Error {
  constructor(message, code = 'INVALID_INPUT') { super(message); this.code = code; }
}
const now = () => new Date().toISOString();
const parse = value => JSON.parse(value);
const text = (value, max = 1000000) => {
  if (typeof value !== 'string' || value.length > max) throw new AppError('文本格式无效或内容过长。');
  return value;
};
const title = value => { const v = text(value, 120).trim(); if (!v) throw new AppError('请填写名称。'); return v; };
const revision = value => { if (!Number.isSafeInteger(value) || value < 0) throw new AppError('版本号无效。'); return value; };
export const combineContext = (book, chapter) => [book.trim(), chapter.trim()].filter(Boolean).join('\n\n');
const decodeChapter = row => row && { ...row, archived: Boolean(row.archived) };
const safeModelConfig = value => Object.fromEntries(['baseUrl','endpoint','model','longText','chapter','maxFindings','maxTokens','timeoutMs','temperature','responseFormat','chapterReading'].filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));

export class Store {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma('foreign_keys = ON'); this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL');
    const version = this.db.pragma('user_version', { simple: true });
    if (version > 1) { this.db.close(); throw new AppError('数据来自较新的对读版本，请更新软件后打开。', 'NEWER_DATABASE'); }
    if (version === 0) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE books (id TEXT PRIMARY KEY,title TEXT NOT NULL,context TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
        CREATE TABLE chapters (id TEXT PRIMARY KEY,bookId TEXT NOT NULL REFERENCES books(id),title TEXT NOT NULL,source TEXT NOT NULL DEFAULT '',translation TEXT NOT NULL DEFAULT '',context TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
        CREATE TABLE versions (id TEXT PRIMARY KEY,chapterId TEXT NOT NULL REFERENCES chapters(id),payload TEXT NOT NULL,reason TEXT NOT NULL,createdAt TEXT NOT NULL);
        CREATE TABLE checks (id TEXT PRIMARY KEY,chapterId TEXT NOT NULL REFERENCES chapters(id),snapshot TEXT NOT NULL,result TEXT NOT NULL,modelConfig TEXT NOT NULL,promptHash TEXT NOT NULL,createdAt TEXT NOT NULL);
        CREATE TABLE reviews (checkId TEXT NOT NULL REFERENCES checks(id),findingId TEXT NOT NULL,decision TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(checkId,findingId));
        CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE INDEX chapters_book ON chapters(bookId,position);
        CREATE INDEX versions_chapter ON versions(chapterId,createdAt);
        CREATE INDEX checks_chapter ON checks(chapterId,createdAt);
        PRAGMA user_version = 1;
      `);
    })();
  }
  close() { this.db.close(); }
  getSetting(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? parse(row.value) : fallback; }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  listBooks() { return this.db.prepare('SELECT * FROM books ORDER BY position,createdAt').all().map(row => ({ ...row, archived: Boolean(row.archived) })); }
  book(id) { const row = this.db.prepare('SELECT * FROM books WHERE id=?').get(text(id, 100)); if (!row) throw new AppError('找不到这本书。', 'NOT_FOUND'); return row; }
  createBook(name) {
    const id = randomUUID(), at = now();
    this.db.prepare('INSERT INTO books (id,title,position,createdAt,updatedAt) VALUES (?,?,?,?,?)').run(id,title(name),this.listBooks().length,at,at);
    return this.book(id);
  }
  updateBook({ id, title: name, context, archived, expectedRevision }) {
    return this.db.transaction(() => {
      const old = this.book(id); if (old.revision !== revision(expectedRevision)) throw new AppError('书籍已改变，请重新打开后再修改。', 'CONFLICT');
      this.db.prepare('UPDATE books SET title=?,context=?,archived=?,revision=revision+1,updatedAt=? WHERE id=?').run(name === undefined ? old.title : title(name),context === undefined ? old.context : text(context),archived === undefined ? old.archived : archived ? 1 : 0,now(),id);
      return this.book(id);
    })();
  }
  listChapters(bookId) { this.book(bookId); return this.db.prepare('SELECT * FROM chapters WHERE bookId=? ORDER BY position,createdAt').all(bookId).map(decodeChapter); }
  chapter(id) { const row = this.db.prepare('SELECT * FROM chapters WHERE id=?').get(text(id,100)); if (!row) throw new AppError('找不到这一章。','NOT_FOUND'); return decodeChapter(row); }
  createChapter({ bookId, title: name }) {
    this.book(bookId); const id = randomUUID(), at = now();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO chapters (id,bookId,title,position,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(id,bookId,title(name),this.listChapters(bookId).length,at,at);
      this.addVersion(this.chapter(id),'创建章节');
    })(); return this.chapter(id);
  }
  addVersion(chapter, reason) {
    const payload = { source: chapter.source, translation: chapter.translation, context: chapter.context };
    this.db.prepare('INSERT INTO versions VALUES (?,?,?,?,?)').run(randomUUID(),chapter.id,JSON.stringify(payload),reason,now());
  }
  saveDraft({ id, expectedRevision, source, translation, context, reason = '自动保存' }) {
    const values = { source: text(source), translation: text(translation), context: text(context) }; text(reason,100);
    return this.db.transaction(() => {
      const old = this.chapter(id); if (old.revision !== revision(expectedRevision)) throw new AppError('稿件版本发生冲突。当前草稿已保留，请导出草稿后重新打开章节。','CONFLICT');
      if (Object.keys(values).every(key => values[key] === old[key])) return old;
      this.db.prepare('UPDATE chapters SET source=?,translation=?,context=?,revision=revision+1,updatedAt=? WHERE id=?').run(values.source,values.translation,values.context,now(),id);
      const saved = this.chapter(id); this.addVersion(saved,reason); return saved;
    })();
  }
  updateChapter({ id, title: name, archived, expectedRevision }) {
    return this.db.transaction(() => {
      const old = this.chapter(id); if (old.revision !== revision(expectedRevision)) throw new AppError('章节已改变，请重新打开后再修改。','CONFLICT');
      this.db.prepare('UPDATE chapters SET title=?,archived=?,revision=revision+1,updatedAt=? WHERE id=?').run(name === undefined ? old.title : title(name),archived === undefined ? Number(old.archived) : archived ? 1 : 0,now(),id);
      return this.chapter(id);
    })();
  }
  reorder({ kind, ids, bookId }) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new AppError('排序内容无效。');
    const rows = kind === 'books' ? this.listBooks() : kind === 'chapters' ? this.listChapters(bookId) : null;
    if (!rows || ids.length !== rows.length || ids.some(id => !rows.some(row => row.id === id))) throw new AppError('列表已改变，请刷新后重新排序。','CONFLICT');
    const stmt = this.db.prepare(`UPDATE ${kind} SET position=? WHERE id=?`);
    this.db.transaction(() => ids.forEach((id,index) => stmt.run(index,id)))(); return true;
  }
  listVersions(chapterId) { this.chapter(chapterId); return this.db.prepare('SELECT id,reason,createdAt FROM versions WHERE chapterId=? ORDER BY rowid DESC').all(chapterId); }
  version(id) { const row = this.db.prepare('SELECT * FROM versions WHERE id=?').get(text(id,100)); if (!row) throw new AppError('找不到该版本。','NOT_FOUND'); return { ...row,payload: parse(row.payload) }; }
  restoreVersion({ chapterId, versionId, expectedRevision }) {
    const saved = this.version(versionId); if (saved.chapterId !== chapterId) throw new AppError('版本不属于当前章节。');
    return this.saveDraft({ id: chapterId,expectedRevision,...saved.payload,reason: '恢复历史版本' });
  }
  saveCheck({ chapterId, expectedRevision, expectedBookRevision, snapshot, result, modelConfig, promptHash }) {
    return this.db.transaction(() => {
      const chapter = this.chapter(chapterId), book = this.book(chapter.bookId);
      if (chapter.revision !== expectedRevision || book.revision !== expectedBookRevision) throw new AppError('检查期间文本已改变，本次结果未覆盖当前稿件。','STALE_RESULT');
      const id = randomUUID(), at = now();
      const valid = validateResult(result,snapshot);
      const stored = { ...valid,provider: text(result.provider || '',100),model: text(result.model || '',200),findings: valid.findings.map(f => ({ ...f,id: randomUUID(),sourceLocation: findQuoteLocation(snapshot.source,f.sourceQuote),translationLocation: findQuoteLocation(snapshot.translation,f.translationQuote) })) };
      const stamped = { ...snapshot,checkedAt: at,bookContext: book.context,chapterContext: chapter.context };
      this.db.prepare('INSERT INTO checks VALUES (?,?,?,?,?,?,?)').run(id,chapterId,JSON.stringify(stamped),JSON.stringify(stored),JSON.stringify(modelConfig),promptHash,at);
      return this.check(id);
    })();
  }
  listChecks(chapterId) { this.chapter(chapterId); return this.db.prepare('SELECT id,createdAt,modelConfig FROM checks WHERE chapterId=? ORDER BY rowid DESC').all(chapterId).map(row => ({ ...row,modelConfig: parse(row.modelConfig) })); }
  check(id) {
    const row = this.db.prepare('SELECT * FROM checks WHERE id=?').get(text(id,100)); if (!row) throw new AppError('找不到这轮检查。','NOT_FOUND');
    const reviews = Object.fromEntries(this.db.prepare('SELECT * FROM reviews WHERE checkId=?').all(id).map(review => [review.findingId,review]));
    return { ...row,snapshot: parse(row.snapshot),result: parse(row.result),modelConfig: parse(row.modelConfig),reviews };
  }
  saveReview({ checkId, findingId, decision, note, expectedRevision = 0 }) {
    if (!['','change','keep','context'].includes(decision)) throw new AppError('编辑决定无效。'); text(note,2000); revision(expectedRevision);
    return this.db.transaction(() => {
      const check = this.check(checkId); if (!check.result.findings.some(f => f.id === findingId)) throw new AppError('问题不属于这轮检查。');
      const old = check.reviews[findingId]; if ((old?.revision || 0) !== expectedRevision) throw new AppError('备注版本发生冲突，当前内容已保留。','CONFLICT');
      this.db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?) ON CONFLICT(checkId,findingId) DO UPDATE SET decision=excluded.decision,note=excluded.note,revision=excluded.revision').run(checkId,findingId,decision,note,expectedRevision+1);
      return { checkId,findingId,decision,note,revision: expectedRevision+1 };
    })();
  }
  exportBook(id) {
    const book = this.book(id);
    const chapters = this.listChapters(id).map(chapter => ({ ...chapter,versions: this.listVersions(chapter.id).map(v => this.version(v.id)),checks: this.listChecks(chapter.id).map(c => this.check(c.id)) }));
    return { format:'duidu-book',schemaVersion:1,exportedAt:now(),book:{ ...book,chapters } };
  }
  importBook(backup) {
    if (!backup || backup.format !== 'duidu-book' || backup.schemaVersion !== 1 || !backup.book || !Array.isArray(backup.book.chapters) || backup.book.chapters.length > 10000) throw new AppError('不是可识别的对读书籍备份。');
    // Validate all material before writing. Settings and secrets are never imported.
    title(backup.book.title); text(backup.book.context);
    for (const c of backup.book.chapters) {
      title(c.title); ['source','translation','context'].forEach(k => text(c[k]));
      if (!Array.isArray(c.versions) || !Array.isArray(c.checks)) throw new AppError('备份缺少版本或检查记录。');
      for (const v of c.versions) { text(v.reason,100); text(v.createdAt,100); ['source','translation','context'].forEach(k => text(v.payload?.[k])); }
      for (const check of c.checks) {
        ['source','translation','context'].forEach(k => text(check.snapshot?.[k])); validateResult(check.result,check.snapshot);
        text(check.promptHash,100); text(check.createdAt,100); text(check.modelConfig?.model,200); text(check.modelConfig?.baseUrl,2000);
        if (!check.reviews || typeof check.reviews !== 'object' || Array.isArray(check.reviews)) throw new AppError('备份复核记录无效。');
        for (const r of Object.values(check.reviews)) { if (!['','change','keep','context'].includes(r.decision)) throw new AppError('备份编辑决定无效。'); text(r.note,2000); }
      }
    }
    return this.db.transaction(() => {
      const book = this.createBook(`${backup.book.title.slice(0,110)}（导入副本）`);
      this.updateBook({ id:book.id,context:backup.book.context,expectedRevision:0 });
      for (const source of [...backup.book.chapters].sort((a,b) => a.position-b.position)) {
        const chapter = this.createChapter({ bookId:book.id,title:source.title });
        this.saveDraft({ id:chapter.id,expectedRevision:0,source:source.source,translation:source.translation,context:source.context,reason:'导入备份' });
        for (const v of [...source.versions].reverse()) this.db.prepare('INSERT INTO versions VALUES (?,?,?,?,?)').run(randomUUID(),chapter.id,JSON.stringify(v.payload),v.reason,v.createdAt);
        for (const check of [...source.checks].reverse()) {
          const id = randomUUID(); const result = { ...check.result,findings:check.result.findings.map(f => ({ ...f,id:randomUUID() })) };
          this.db.prepare('INSERT INTO checks VALUES (?,?,?,?,?,?,?)').run(id,chapter.id,JSON.stringify(check.snapshot),JSON.stringify(result),JSON.stringify(safeModelConfig(check.modelConfig)),check.promptHash,text(check.createdAt,100));
          check.result.findings.forEach((f,index) => { const r = check.reviews[f.id]; if (r) this.saveReview({ checkId:id,findingId:result.findings[index].id,decision:r.decision,note:r.note }); });
        }
        if (source.archived) this.updateChapter({ id:chapter.id,archived:true,expectedRevision:this.chapter(chapter.id).revision });
      }
      return this.book(book.id);
    })();
  }
}

