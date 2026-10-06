'use strict';
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { fail } = require('./errors');
function containedPath(root, name) {
    // Validate both Windows and POSIX syntax on either operating system.
    if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\\')
        || name.includes(':') || path.posix.isAbsolute(name) || path.win32.isAbsolute(name)
        || name.split('/').some(part => !part || part === '.' || part === '..')) fail('LIVE_START_FAILED');
    const target = path.resolve(root, name);
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('LIVE_START_FAILED');
    return target;
}
async function createProject() { return fs.mkdtemp(path.join(os.tmpdir(), 'apiforge-live-')); }
async function materialize(root, files) {
    const seen = new Set();
    // Validate the entire array before writing, including platform alias collisions.
    const entries = files.map(file => {
        const target = containedPath(root, file.path);
        const key = process.platform === 'win32' ? target.toLowerCase() : target;
        if (seen.has(key) || typeof file.content !== 'string') fail('LIVE_START_FAILED');
        seen.add(key); return [target, file.content];
    });
    for (const [target, content] of entries) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, { flag: 'wx' });
    }
}
async function removeProject(root) {
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
module.exports = { containedPath, createProject, materialize, removeProject };
