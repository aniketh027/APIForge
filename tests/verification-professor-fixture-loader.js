'use strict';
// Read-only, exact-path loader. Original frontend tests and physical files stay intact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');
const BASE = 'f3c781c03641d2e421e517c5ac89a1e3804f4407';
const BLOB = 'ca16552befad4c12b62d88522fdbb21e63303c13';
const RELATIVE = 'tests/fixtures/professor-workspace.apiforge';
const root = process.env.APIFORGE_VERIFY_FIXTURE_ROOT;
const repository = process.env.APIFORGE_VERIFY_GIT_REPOSITORY;
if (!root || !repository || !path.isAbsolute(root) || !path.isAbsolute(repository)) throw Error('Explicit verification roots required');
const exact = path.resolve(root, RELATIVE);
const read = fs.readFileSync;
const git = args => execFileSync('git', ['-C', repository, ...args], { windowsHide: true });
if (git(['rev-parse', BASE + ':' + RELATIVE]).toString().trim() !== BLOB) throw Error('Approved fixture ref identity differs');
const bytes = git(['cat-file', 'blob', BLOB]);
const blob = value => crypto.createHash('sha1').update('blob ' + value.length + '\0').update(value).digest('hex');
if (blob(bytes) !== BLOB || bytes.includes(13)) throw Error('Approved fixture blob identity or LF format differs');
const physical = read(exact);
// This proves checkout conversion only. No bytes are written to any fixture.
if (blob(Buffer.from(physical.toString('utf8').replace(/\r\n/g, '\n'))) !== BLOB) throw Error('Physical fixture contains a substantive change');
fs.readFileSync = function(file, options) {
    let value = file instanceof URL ? fileURLToPath(file) : Buffer.isBuffer(file) ? file.toString() : file;
    if (typeof value !== 'string' || path.resolve(value).toLowerCase() !== exact.toLowerCase()) return read.apply(this, arguments);
    if (options !== 'utf8' && options !== 'utf-8') throw Error('Unexpected exact fixture read mode');
    console.log('VERIFICATION_FIXTURE_READ approved Git blob ' + BLOB);
    return bytes.toString('utf8');
};
console.log('VERIFICATION_FIXTURE_LOADER exact=' + exact + ' blob=' + BLOB);
