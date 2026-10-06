'use strict';
const fs = require('fs'), path = require('path');
const { fail, filesystemError } = require('./errors');

function wellFormed(value) {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
}
function validateSpecifier(value, location) {
    if (typeof value !== 'string' || !value || value.startsWith('/') ||
        /^[A-Za-z]:/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
        /[\\:\x00-\x1f\x7f*?]/.test(value) || !wellFormed(value)) fail('INVALID_IMPORT_PATH', location);
    const segments = value.split('/');
    if (segments.some(s => !s) || !segments.at(-1).endsWith('.apiforge')) fail('INVALID_IMPORT_PATH', location);
    return segments;
}
function physicalKey(stat, location) {
    if (typeof stat?.dev !== 'bigint' || stat.dev < 0n || typeof stat?.ino !== 'bigint' || stat.ino <= 0n) {
        fail('IMPORT_IDENTITY_AMBIGUOUS', location);
    }
    return stat.dev.toString() + ':' + stat.ino.toString();
}
function contained(root, target) {
    const relative = path.relative(root, target);
    return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}
function stable(a, b) {
    return ['dev','ino','size','mtimeNs','ctimeNs'].every(key => a[key] === b[key]);
}
function validateOptions(options) {
    for (const key of ['maxModules','maxSourceBytes']) {
        if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key] <= 0)) {
            throw new TypeError(key + ' must be a positive safe integer.');
        }
    }
    if (options.root !== undefined && (typeof options.root !== 'string' || !options.root || options.root.includes('\0'))) {
        fail('INVALID_COMPILATION_ROOT');
    }
}

class FilesystemResolver {
    constructor(entryPath, options = {}, io = fs) {
        validateOptions(options);
        if (typeof entryPath !== 'string' || !entryPath || entryPath.includes('\0')) throw new TypeError('entryPath must be a nonempty native path.');
        this.io = io; this.cwd = process.cwd(); this.canonicalKeys = new Map();
        if (options.root !== undefined) {
            try {
                this.root = io.realpathSync.native(path.resolve(this.cwd, options.root), { encoding: 'utf8' });
                const stat = io.statSync(this.root, { bigint: true });
                if (!stat.isDirectory()) fail('INVALID_COMPILATION_ROOT');
                this.rootKey = physicalKey(stat);
            } catch (error) {
                if (error.diagnostic) throw error;
                fail('INVALID_COMPILATION_ROOT');
            }
        }
        let entry;
        try { entry = io.realpathSync.native(path.resolve(this.cwd, entryPath), { encoding: 'utf8' }); }
        catch (error) { filesystemError(error); }
        if (this.root === undefined) {
            this.root = path.dirname(entry);
            try { this.rootKey = physicalKey(io.statSync(this.root, { bigint: true })); }
            catch (error) { filesystemError(error); }
        }
        this.entry = this.reference(entry);
    }
    ancestry(target, location) {
        const chain = []; let directory = path.dirname(target);
        for (;;) {
            const stat = this.io.statSync(directory, { bigint: true });
            if (!stat.isDirectory()) fail('IMPORT_NOT_FILE', location);
            const key = physicalKey(stat, location); chain.push(key);
            if (key === this.rootKey) return chain.reverse();
            const parent = path.dirname(directory);
            if (parent === directory) fail('IMPORT_OUTSIDE_ROOT', location);
            directory = parent;
        }
    }
    reference(canonical, location) {
        try {
            if (!contained(this.root, canonical)) fail('IMPORT_OUTSIDE_ROOT', location);
            const base = this.ancestry(canonical, location);
            const stat = this.io.statSync(canonical, { bigint: true });
            if (!stat.isFile()) fail('IMPORT_NOT_FILE', location);
            const key = physicalKey(stat, location);
            const previous = this.canonicalKeys.get(canonical);
            if (previous !== undefined && previous !== key) fail('IMPORT_SOURCE_CHANGED', location);
            this.canonicalKeys.set(canonical, key);
            return { canonical, key, base, stat, displayPath: path.relative(this.root, canonical).split(path.sep).join('/') };
        } catch (error) { filesystemError(error, location); }
    }
    resolve(specifier, importer, location) {
        const segments = validateSpecifier(specifier, location);
        const candidate = path.resolve(path.dirname(importer.canonical), ...segments);
        if (!contained(this.root, candidate)) fail('IMPORT_OUTSIDE_ROOT', location);
        try {
            return this.reference(this.io.realpathSync.native(candidate, { encoding: 'utf8' }), location);
        } catch (error) { filesystemError(error, location); }
    }
    read(reference, location, remainingBytes = Infinity, captured) {
        let descriptor;
        try {
            if (reference.stat.size > (remainingBytes === Infinity ? reference.stat.size : BigInt(remainingBytes))) {
                fail('IMPORT_RESOURCE_LIMIT', location);
            }
            let before, after, buffer;
            if (captured) {
                before = captured.before; after = captured.after; buffer = captured.buffer;
            } else {
                const flags = this.io.constants.O_RDONLY | (this.io.constants.O_NONBLOCK || 0) | (this.io.constants.O_NOFOLLOW || 0);
                descriptor = this.io.openSync(reference.canonical, flags);
                before = this.io.fstatSync(descriptor, { bigint: true });
                if (!before.isFile()) fail('IMPORT_NOT_FILE', location);
                if (physicalKey(before, location) !== reference.key || !stable(reference.stat, before)) fail('IMPORT_SOURCE_CHANGED', location);
                if (remainingBytes === Infinity) buffer = this.io.readFileSync(descriptor);
                else {
                    const chunks = []; let total = 0;
                    for (;;) {
                        const chunk = Buffer.alloc(Math.min(65536, remainingBytes - total + 1));
                        const count = this.io.readSync(descriptor, chunk, 0, chunk.length, null);
                        if (!count) break;
                        total += count;
                        if (total > remainingBytes) fail('IMPORT_RESOURCE_LIMIT', location);
                        chunks.push(chunk.subarray(0, count));
                    }
                    buffer = Buffer.concat(chunks, total);
                }
                after = this.io.fstatSync(descriptor, { bigint: true });
            }
            physicalKey(before, location); physicalKey(after, location);
            if (!before.isFile() || !after.isFile()) fail('IMPORT_NOT_FILE', location);
            if (!stable(reference.stat, before) || !stable(before, after) || BigInt(buffer.length) !== after.size) {
                fail('IMPORT_SOURCE_CHANGED', location);
            }
            if (buffer.length > remainingBytes) fail('IMPORT_RESOURCE_LIMIT', location);
            return { source: buffer.toString('utf8'), byteLength: buffer.length };
        } catch (error) { filesystemError(error, location); }
        finally { if (descriptor !== undefined) this.io.closeSync(descriptor); }
    }
}

// The old CLI can inspect syntax before it needs graph identity guarantees.
// Captured opened-file evidence is adopted if imports are recognized, without rereading.
function captureEntry(entryPath) {
    const descriptor = fs.openSync(entryPath, 'r');
    try {
        const before = fs.fstatSync(descriptor, { bigint: true });
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor, { bigint: true });
        return { before, after, buffer, source: buffer.toString('utf8') };
    } finally { fs.closeSync(descriptor); }
}
module.exports = { FilesystemResolver, validateSpecifier, physicalKey, contained, validateOptions, captureEntry };
