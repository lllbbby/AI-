const { contextBridge, ipcRenderer } = require('electron');
const methods = ['bootstrap','listBooks','createBook','updateBook','listChapters','createChapter','getChapter','saveDraft','updateChapter','reorder','listVersions','getVersion','restoreVersion','listChecks','getCheck','saveReview','analyze','cancel','getSettings','saveSettings','testConnection','readText','exportTranslation','exportDraft','exportReview','exportBook','importBook'];
contextBridge.exposeInMainWorld('duidu', Object.freeze({
  ...Object.fromEntries(methods.map(method => [method, async args => {
    const reply = await ipcRenderer.invoke('duidu:call', method, args);
    if (!reply.ok) { const error=new Error(reply.error.message);error.code=reply.error.code;throw error; }
    return reply.value;
  }])),
  onCloseRequest(callback) { const listener=(_event,id)=>callback(id);ipcRenderer.on('duidu:close-request',listener);return ()=>ipcRenderer.removeListener('duidu:close-request',listener); },
  finishClose(id,success) { ipcRenderer.send('duidu:close-response',{id,success}); }
}));
