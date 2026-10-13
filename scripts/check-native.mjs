import Database from 'better-sqlite3';
const db=new Database(':memory:');
console.log('SQLite native binding ready:',db.prepare('select sqlite_version() as version').get().version);
db.close();
