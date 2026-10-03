const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const CodeGenerator = require('../src/codegen/codegen');
const { publishGeneratedFiles } = require('../src/codegen/publish-output');
const { baselineModule, compile } = require('./v1-hardening-helpers');

const V1 = '9d5b223b0af350a237625f4cd8dfbc700e35dd1b';
const repository = path.resolve(__dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-g19-tests-'));
const oldProject = compile('ENTITY Course\nid INT PRIMARY KEY\nname STRING');
const newProject = compile('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\nENTITY Teacher\nid INT PRIMARY KEY');
let groups = 0;

function snapshot(root) {
    if (!fs.existsSync(root)) return null;
    const result = {};
    function visit(directory, prefix = '') {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const name = prefix + entry.name;
            const target = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) result[name] = 'link:' + fs.readlinkSync(target);
            else if (entry.isDirectory()) { result[name + '/'] = 'directory'; visit(target, name + '/'); }
            else result[name] = fs.readFileSync(target).toString('base64');
        }
    }
    visit(root);
    return result;
}

function filesOnDisk(root) {
    return Object.fromEntries(Object.entries(snapshot(root)).filter(([name]) => !name.endsWith('/')));
}

function expectedFiles(files) {
    return Object.fromEntries(files.map(file => [file.path, Buffer.from(file.content, 'utf8').toString('base64')]));
}

function temporaryEntries(root) {
    return fs.readdirSync(root).filter(name => name.startsWith('.output.apiforge-g19-'));
}

function seed(root) {
    const output = path.join(root, 'output');
    publishGeneratedFiles(oldProject.files, output);
    fs.writeFileSync(path.join(output, '.env'), Buffer.from([0, 255, 10, 13]));
    fs.writeFileSync(path.join(output, 'user-notes.txt'), 'keep user notes\n');
    fs.mkdirSync(path.join(output, 'user-assets', 'empty'), { recursive: true });
    fs.writeFileSync(path.join(output, 'user-assets', 'data.bin'), Buffer.from([1, 0, 254]));
    fs.mkdirSync(path.join(output, 'models', 'obsolete', 'empty'), { recursive: true });
    fs.writeFileSync(path.join(output, 'models', 'obsolete', 'legacy.js'), 'stale');
    return output;
}

function expectError(action, expected) {
    assert.throws(action, error => {
        assert.equal(error, expected, 'The original filesystem Error must propagate');
        assert.equal(error.code, expected.code);
        assert.equal(error.diagnostic, undefined, 'I/O errors must not become compiler diagnostics');
        return true;
    });
}

function ioError(message, code = 'EIO') { return Object.assign(new Error(message), { code }); }

function test(name, action) {
    const root = fs.mkdtempSync(path.join(temporaryRoot, 'case-'));
    action(root);
    groups++;
    console.log(`PASS ${name}`);
}

try {
    for (const hadOutput of [true, false]) {
        test(`${hadOutput ? 'A' : 'B'}: partial staging write at every generated file`, root => {
            for (let failAt = 1; failAt <= newProject.files.length; failAt++) {
                const run = fs.mkdtempSync(path.join(root, 'write-'));
                const output = hadOutput ? seed(run) : path.join(run, 'output');
                const before = snapshot(output);
                const failure = ioError(`injected partial write ${failAt}`, 'ENOSPC');
                let writes = 0;
                const adapter = Object.create(fs);
                adapter.writeFileSync = (target, content, encoding) => {
                    assert.deepEqual(snapshot(output), before, 'Published bytes must not change during staging');
                    assert(path.relative(run, target).split(path.sep)[0].startsWith('.output.apiforge-g19-stage-'));
                    if (++writes === failAt) {
                        fs.writeFileSync(target, 'PARTIAL');
                        throw failure;
                    }
                    fs.writeFileSync(target, content, encoding);
                };
                expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
                assert.deepEqual(snapshot(output), before);
                assert.deepEqual(temporaryEntries(run), []);
                assert.equal(failure.outputPublication.published, false);
            }
        });
    }

    test('C: second rename failure restores every previous byte', root => {
        const output = seed(root), before = snapshot(output);
        const failure = ioError('injected publication rename', 'EPERM');
        const adapter = Object.create(fs);
        let renames = 0;
        adapter.renameSync = (from, to) => {
            if (++renames === 2) {
                assert.equal(snapshot(output), null);
                const backup = temporaryEntries(root).find(name => name.includes('backup-'));
                assert.deepEqual(snapshot(path.join(root, backup, 'previous')), before);
                assert.equal(path.dirname(from), path.dirname(output));
                assert.deepEqual(filesOnDisk(from)['models/Student.js'], expectedFiles(newProject.files)['models/Student.js']);
                throw failure;
            }
            fs.renameSync(from, to);
        };
        expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
        assert.equal(renames, 3);
        assert.deepEqual(snapshot(output), before);
        assert.deepEqual(temporaryEntries(root), []);
    });

    test('D/E/F: first publication and repeated exact replacement, with user entries preserved', root => {
        const originalCwd = process.cwd();
        try {
            process.chdir(root);
            const first = CodeGenerator.generate(oldProject.optimized);
            const output = path.join(root, 'output');
            assert.deepEqual(filesOnDisk(output), expectedFiles(first.files));
            assert.deepEqual(temporaryEntries(root), []);
            seed(root);
            const userEntries = Object.fromEntries(Object.entries(filesOnDisk(output)).filter(([name]) => name.startsWith('user-') || name === '.env'));
            for (const project of [newProject, oldProject, newProject, newProject]) {
                const result = CodeGenerator.generate(project.optimized, true);
                assert.deepEqual(result, { success: true, files: project.files });
                assert.deepEqual(filesOnDisk(output), { ...expectedFiles(project.files), ...userEntries });
                assert(fs.statSync(path.join(output, 'user-assets', 'empty')).isDirectory());
                assert(!fs.existsSync(path.join(output, 'models', 'obsolete')));
                assert.deepEqual(temporaryEntries(root), []);
            }
        } finally { process.chdir(originalCwd); }
    });

    test('G: every valid sample matches frozen V1 in memory and on disk', root => {
        const frozen = baselineModule('src/codegen/codegen.js', V1);
        let projects = 0, files = 0;
        for (const name of fs.readdirSync(path.join(repository, 'samples')).filter(name => name.endsWith('.apiforge'))) {
            const source = fs.readFileSync(path.join(repository, 'samples', name), 'utf8');
            let current;
            try { current = compile(source); } catch { continue; }
            const original = frozen.generate(current.optimized, false);
            assert.deepEqual(current.files, original.files, name);
            const output = path.join(root, 'output');
            publishGeneratedFiles(current.files, output);
            assert.deepEqual(filesOnDisk(output), expectedFiles(original.files), name);
            assert.deepEqual(temporaryEntries(root), []);
            projects++; files += original.files.length;
        }
        assert.equal(projects, 7);
        assert.equal(files, 79);
        console.log(`Compatibility: ${projects} sample projects, ${files} generated files byte-identical to ${V1}`);
    });

    test('first rename failure leaves the original output and cleans both reservations', root => {
        const output = seed(root), before = snapshot(output);
        const failure = ioError('injected old-output move', 'EBUSY');
        const adapter = Object.create(fs);
        adapter.renameSync = () => { throw failure; };
        expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
        assert.deepEqual(snapshot(output), before);
        assert.deepEqual(temporaryEntries(root), []);
    });

    test('failed first publication keeps destination absent', root => {
        const output = path.join(root, 'output');
        const failure = ioError('injected first publication', 'EPERM');
        const adapter = Object.create(fs);
        adapter.renameSync = () => { throw failure; };
        expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
        assert.equal(snapshot(output), null);
        assert.deepEqual(temporaryEntries(root), []);
    });

    test('rollback failure retains the complete old backup and the original error', root => {
        const output = seed(root), before = snapshot(output);
        const failure = ioError('original publication error', 'EPERM');
        const rollback = ioError('injected rollback error', 'EBUSY');
        const adapter = Object.create(fs);
        let renames = 0;
        adapter.renameSync = (from, to) => {
            if (++renames === 2) throw failure;
            if (renames === 3) throw rollback;
            fs.renameSync(from, to);
        };
        expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
        assert.equal(failure.rollbackError, rollback);
        assert.match(failure.message, /original publication error.*Rollback failed.*Previous output retained/);
        assert.equal(snapshot(output), null);
        assert.equal(failure.outputPublication.published, false);
        assert.equal(failure.outputPublication.staging, null);
        assert.deepEqual(snapshot(path.join(failure.outputPublication.backup, 'previous')), before);
        assert.equal(temporaryEntries(root).length, 1);
    });

    test('staging cleanup failure adds context without replacing the write error', root => {
        const output = seed(root), before = snapshot(output);
        const failure = ioError('original write error', 'ENOSPC');
        const cleanup = ioError('injected staging cleanup', 'EACCES');
        const adapter = Object.create(fs);
        adapter.writeFileSync = () => { throw failure; };
        adapter.rmSync = () => { throw cleanup; };
        expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
        assert.deepEqual(snapshot(output), before);
        assert.deepEqual(failure.cleanupErrors, [cleanup]);
        assert.match(failure.message, /Cleanup failed.*Could not remove staging directory/);
        assert.equal(temporaryEntries(root).length, 1);
        assert(fs.existsSync(failure.outputPublication.staging));
    });

    test('backup cleanup failure reports committed output and never rolls it back', root => {
        const output = seed(root);
        const failure = ioError('injected backup cleanup', 'EACCES');
        const adapter = Object.create(fs);
        let renames = 0;
        adapter.renameSync = (from, to) => { renames++; fs.renameSync(from, to); };
        adapter.rmSync = () => { throw failure; };
        expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
        assert.equal(renames, 2);
        assert.equal(failure.outputPublication.published, true);
        assert.equal(failure.rollbackError, undefined);
        assert.match(failure.message, /already published.*Could not remove backup directory/);
        assert.deepEqual(fs.readFileSync(path.join(output, 'models', 'Student.js')), Buffer.from(newProject.files.find(file => file.path === 'models/Student.js').content));
        assert(!fs.existsSync(path.join(output, 'models', 'Course.js')));
        assert.equal(temporaryEntries(root).length, 1);
    });

    test('user-entry copying failure leaves published output unchanged', root => {
        const output = seed(root), before = snapshot(output);
        const failure = ioError('injected preservation copy', 'EIO');
        const adapter = Object.create(fs);
        adapter.cpSync = () => { throw failure; };
        expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
        assert.deepEqual(snapshot(output), before);
        assert.deepEqual(temporaryEntries(root), []);
    });

    test('staged read failure and silent write corruption prevent publication', root => {
        const output = seed(root), before = snapshot(output);
        const failure = ioError('injected readback failure');
        const adapter = Object.create(fs);
        adapter.readFileSync = () => { throw failure; };
        expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
        assert.deepEqual(snapshot(output), before);
        assert.deepEqual(temporaryEntries(root), []);
        adapter.readFileSync = fs.readFileSync;
        adapter.writeFileSync = target => fs.writeFileSync(target, 'CORRUPTED');
        assert.throws(() => publishGeneratedFiles(newProject.files, output, adapter), /validation failed/);
        assert.deepEqual(snapshot(output), before);
        assert.deepEqual(temporaryEntries(root), []);
    });

    test('temporary reservation failures leave the destination unchanged', root => {
        for (const failAt of [1, 2]) {
            const run = fs.mkdtempSync(path.join(root, 'reserve-'));
            const output = seed(run), before = snapshot(output);
            const failure = ioError(`injected reservation ${failAt}`, 'ENOSPC');
            const adapter = Object.create(fs);
            let reservations = 0;
            adapter.mkdtempSync = prefix => {
                assert.equal(path.dirname(prefix), path.dirname(output));
                assert(prefix.includes('.output.apiforge-g19-'));
                if (++reservations === failAt) throw failure;
                return fs.mkdtempSync(prefix);
            };
            expectError(() => publishGeneratedFiles(newProject.files, output, adapter), failure);
            assert.deepEqual(snapshot(output), before);
            assert.deepEqual(temporaryEntries(run), []);
        }
    });

    test('path escapes and duplicate destinations are rejected before staging', root => {
        const output = seed(root), before = snapshot(output);
        const outside = path.join(root, 'outside.txt');
        fs.writeFileSync(outside, 'OUTSIDE');
        for (const files of [
            [{ path: '../outside.txt', content: 'BAD' }],
            [{ path: path.join(output, 'server.js'), content: 'BAD' }],
            [{ path: 'server.js', content: 'ONE' }, { path: './server.js', content: 'TWO' }],
            [{ path: 'server.js', content: null }]
        ]) assert.throws(() => publishGeneratedFiles(files, output));
        assert.deepEqual(snapshot(output), before);
        assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE');
        assert.deepEqual(temporaryEntries(root), []);
    });

    test('unsafe destination and managed-directory shapes fail without mutation', root => {
        const output = path.join(root, 'output');
        fs.writeFileSync(output, 'ROOT FILE');
        assert.throws(() => publishGeneratedFiles(newProject.files, output), /must be a real directory/);
        assert.equal(fs.readFileSync(output, 'utf8'), 'ROOT FILE');
        fs.unlinkSync(output);
        fs.mkdirSync(output);
        fs.mkdirSync(path.join(output, 'database'));
        fs.writeFileSync(path.join(output, 'database', 'schema.sql'), 'OLD SCHEMA');
        fs.writeFileSync(path.join(output, 'config'), 'NOT A DIRECTORY');
        const before = snapshot(output);
        assert.throws(() => publishGeneratedFiles(newProject.files, output), /'config' must be a real directory/);
        assert.deepEqual(snapshot(output), before, 'The original G19 reproduction must now preserve the schema');
        assert.deepEqual(temporaryEntries(root), []);
    });

    test('output and managed directory links cannot redirect publication', root => {
        const outside = path.join(root, 'outside');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'keep.txt'), 'OUTSIDE');
        const output = path.join(root, 'output');
        const linkType = process.platform === 'win32' ? 'junction' : 'dir';
        fs.symlinkSync(outside, output, linkType);
        assert.throws(() => publishGeneratedFiles(newProject.files, output), /must be a real directory/);
        fs.unlinkSync(output);
        seed(root);
        fs.rmSync(path.join(output, 'config'), { recursive: true });
        fs.symlinkSync(outside, path.join(output, 'config'), linkType);
        const before = snapshot(output);
        assert.throws(() => publishGeneratedFiles(newProject.files, output), /'config' must be a real directory/);
        assert.deepEqual(snapshot(output), before);
        assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'OUTSIDE');
        assert.deepEqual(temporaryEntries(root), []);
    });

    test('unique sibling staging does not collide with interrupted-run material', root => {
        const orphan = path.join(root, '.output.apiforge-g19-stage-orphan');
        fs.mkdirSync(orphan);
        fs.writeFileSync(path.join(orphan, 'sentinel'), 'KEEP');
        const output = path.join(root, 'output');
        for (let i = 0; i < 3; i++) publishGeneratedFiles(newProject.files, output);
        assert.deepEqual(temporaryEntries(root), [path.basename(orphan)]);
        assert.equal(fs.readFileSync(path.join(orphan, 'sentinel'), 'utf8'), 'KEEP');
    });

    test('CLI preserves its diagnostic/exit contract and surfaces publication context', root => {
        for (const mode of ['write', 'publish', 'cleanup']) {
            const run = fs.mkdtempSync(path.join(root, mode + '-'));
            const output = seed(run), before = snapshot(output);
            const source = path.join(run, 'source.apiforge');
            fs.writeFileSync(source, 'ENTITY Student\nid INT PRIMARY KEY\nname STRING');
            const preload = path.join(run, 'inject.cjs');
            fs.writeFileSync(preload, `
                const fs = require('fs');
                const mode = ${JSON.stringify(mode)};
                const error = Object.assign(new Error('G19_INJECTED_' + mode), { code: 'EPERM' });
                if (mode === 'write') {
                    const original = fs.writeFileSync;
                    let writes = 0;
                    fs.writeFileSync = (...args) => { if (++writes === 2) throw error; return original(...args); };
                } else if (mode === 'publish') {
                    const original = fs.renameSync;
                    let renames = 0;
                    fs.renameSync = (...args) => { if (++renames === 2) throw error; return original(...args); };
                } else fs.rmSync = () => { throw error; };
            `);
            const result = spawnSync(process.execPath, ['--require', preload, path.join(repository, 'index.js'), source], {
                cwd: run, encoding: 'utf8', windowsHide: true, timeout: 30000
            });
            assert.equal(result.error, undefined);
            assert.equal(result.status, 1);
            assert.match(result.stdout, /Internal compiler failure during codegen/);
            assert.match(result.stdout, /Compilation stopped during codegen/);
            assert.match(result.stderr, new RegExp('\\[OUTPUT\\] G19_INJECTED_' + mode));
            if (mode === 'cleanup') {
                assert.match(result.stderr, /already published.*Could not remove backup directory/);
                assert(fs.existsSync(path.join(output, 'models', 'Student.js')));
                assert.equal(temporaryEntries(run).length, 1);
            } else {
                assert.deepEqual(snapshot(output), before);
                assert.deepEqual(temporaryEntries(run), []);
            }
        }
    });

    console.log(`Atomic output publication: ${groups} groups passed; 0 failed.`);
} finally {
    const relative = path.relative(os.tmpdir(), temporaryRoot);
    assert(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
