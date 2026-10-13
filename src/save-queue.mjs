// Serial saves preserve edits made while a previous database write is pending.
export class SaveQueue {
  constructor(write, onStatus=()=>{}) { this.write=write;this.onStatus=onStatus;this.pending=null;this.running=null;this.revision=0;this.error=null; }
  reset(revision) { if(this.running||this.pending) throw new Error('待保存内容尚未处理。');this.revision=revision;this.error=null; }
  stage(value) { this.pending=value;this.error=null;this.onStatus('dirty'); }
  async flush() {
    if(this.running) {await this.running; if(this.pending)return this.flush();return;}
    this.running=this.drain();
    try { await this.running; } finally { this.running=null; }
  }
  async drain() {
    while(this.pending) {
      const next=this.pending;this.pending=null;this.onStatus('saving');
      try { const result=await this.write(next,this.revision);this.revision=result.revision;this.error=null; }
      catch(error){if(!this.pending)this.pending=next;this.error=error;this.onStatus('error',error);throw error;}
    }
    this.onStatus('saved');
  }
}
