import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const files=readdirSync('tests').filter(f=>f.endsWith('.test.mjs')).map(f=>`tests/${f}`);
const child=spawn(process.execPath,['--test',...files],{stdio:'inherit'});
child.on('exit',code=>process.exit(code||0));
