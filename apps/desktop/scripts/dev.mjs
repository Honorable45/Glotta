import { spawn } from 'node:child_process';

// Le terminal de VS Code définit cette variable, qui ferait tourner Electron comme un simple Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;

const child = spawn('electron-vite', ['dev'], { stdio: 'inherit', shell: true, env });
child.on('exit', (code) => process.exit(code ?? 1));
