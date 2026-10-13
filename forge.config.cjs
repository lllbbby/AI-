const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AsciiSquirrel = require('./build/ascii-squirrel.cjs');
const version = require('electron/package.json').version;
const zipName = `electron-v${version}-win32-x64.zip`;
const zipDir = path.resolve('.cache/electron');
if (fs.existsSync(path.join(zipDir, zipName))) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(zipDir, zipName))).digest('hex');
  if (actual !== require('electron/checksums.json')[zipName]) throw new Error('Electron 下载校验失败，请重新下载官方运行时。');
}
module.exports = {
  packagerConfig: {
    name: 'Duidu', executableName: 'Duidu', appBundleId: 'com.duidu.desktop',
    icon: path.resolve('assets/duidu.ico'),
    ...(fs.existsSync(path.join(zipDir,zipName)) ? {electronZipDir:zipDir} : {download:{cacheRoot:zipDir,checksums:require('electron/checksums.json')}}),
    asar: { unpack: '**/*.node' },
    ignore: [/^\/(src|tests|scripts|build|eval|test-results|output|\.cache|\.test-data|out)(\/|$)/, /^\/\.env/, /^\/node_modules\/\.cache/],
    win32metadata: { CompanyName: 'Duidu', FileDescription: '对读 · 小说英译复核', ProductName: '对读' }
  },
  // better-sqlite3 13 ships Node-API binaries; rebuilding its binding.gyp would
  // unnecessarily require Visual Studio and discard its ABI-stable prebuild.
  rebuildConfig: { ignoreModules: ['better-sqlite3'] },
  makers: [
    new AsciiSquirrel({name:'Duidu',title:'对读',setupExe:`Duidu-${require('./package.json').version}-Setup.exe`,setupIcon:path.resolve('assets/duidu.ico')}),
    { name: '@electron-forge/maker-zip', platforms: ['win32'] }
  ]
};
