import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_PROMPT, validateInput, analyzeWithModel, getConfig } from '../lib/analysis.mjs';
import { AppError, combineContext } from './store.mjs';
import { getReviewSettings } from '../lib/text.mjs';

export class Jobs {
  constructor(store, config, { analyze = analyzeWithModel } = {}) { this.store=store; this.config=config; this.analyze=analyze; this.active=null; }
  cancel(id) { if (this.active && (!id || this.active.id===id)) { this.active.controller.abort(); } return true; }
  async run({ chapterId, expectedRevision, expectedBookRevision, requestId = randomUUID() }) {
    if (this.active) throw new AppError('已有检查正在结束，请稍后重试。','BUSY');
    const chapter=this.store.chapter(chapterId), book=this.store.book(chapter.bookId);
    if (chapter.revision!==expectedRevision || book.revision!==expectedBookRevision) throw new AppError('文本已改变，请保存后重新检查。','CONFLICT');
    const input={source:chapter.source,translation:chapter.translation,context:combineContext(book.context,chapter.context)};
    validateInput(input);
    if(typeof requestId!=='string'||requestId.length>100)throw new AppError('请求编号无效。');
    const job={id:requestId,controller:new AbortController()}; this.active=job;
    try {
      const settings=await this.config();
      job.controller.signal.throwIfAborted();
      const config=getConfig({LLM_API_KEY:settings.key,LLM_BASE_URL:settings.baseUrl,LLM_MODEL:settings.model});
      if (!config) throw new AppError('请先在模型设置中填写 API 密钥。','NOT_CONFIGURED');
      const result=await this.analyze(input,config,{signal:job.controller.signal});
      job.controller.signal.throwIfAborted();
      return this.store.saveCheck({chapterId,expectedRevision,expectedBookRevision,snapshot:input,result,modelConfig:{baseUrl:settings.baseUrl,endpoint:config.endpoint,model:config.model,...getReviewSettings(input),temperature:0.2,responseFormat:'json_object',chapterReading:false},promptHash:createHash('sha256').update(SYSTEM_PROMPT).digest('hex')});
    } catch(error) {
      if (job.controller.signal.aborted) throw new AppError('已取消检查，稿件和旧记录已保留。','CANCELLED');
      throw error;
    } finally { if(this.active===job) this.active=null; }
  }
  async testConnection() {
    if(this.active) throw new AppError('检查仍在运行，请先取消或等待完成。','BUSY');
    const job={id:'connection-test',controller:new AbortController()};this.active=job;
    try {
      const settings=await this.config();
      job.controller.signal.throwIfAborted();
      const config=getConfig({LLM_API_KEY:settings.key,LLM_BASE_URL:settings.baseUrl,LLM_MODEL:settings.model});
      if(!config) throw new AppError('请先保存 API 密钥。','NOT_CONFIGURED');
      await this.analyze({source:'他没有拔剑。',translation:'He did not draw his sword.',context:''},config,{signal:job.controller.signal});
      job.controller.signal.throwIfAborted();return {provider:config.provider,model:config.model};
    }
    finally { if(this.active===job)this.active=null; }
  }
}
