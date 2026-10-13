const MakerSquirrel = require('@electron-forge/maker-squirrel').default;
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Squirrel's legacy rcedit cannot open Unicode paths. Stage only the installer
// output and icon in a generated ASCII temp directory, then copy artifacts back.
module.exports = class AsciiSquirrel extends MakerSquirrel {
  async make(options) {
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'duidu-installer-'));
    const originalIcon = this.config.setupIcon;
    try {
      if (originalIcon) { const icon=path.join(stage,'duidu.ico');await fs.copyFile(originalIcon,icon);this.config.setupIcon=icon; }
      const artifacts = await super.make({...options,makeDir:stage});
      const destination=path.join(options.makeDir,'squirrel.windows',options.targetArch);
      await fs.mkdir(destination,{recursive:true});
      const copied=[];
      for(const source of artifacts){const target=path.join(destination,path.basename(source));await fs.copyFile(source,target);copied.push(target);}
      return copied;
    } finally {
      this.config.setupIcon=originalIcon;
      if(path.dirname(stage)!==path.resolve(os.tmpdir()))throw new Error('Invalid temporary installer path');
      await fs.rm(stage,{recursive:true,force:true});
    }
  }
};
