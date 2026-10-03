const fs = require('fs');
const path = require('path');

const MANAGED_DIRECTORIES = ['models', 'controllers', 'routes', 'config', 'database'];

function directoryExists(directory, destination, fileSystem) {
    let stats;
    try {
        stats = fileSystem.lstatSync(directory);
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        const relative = path.relative(destination, directory) || 'output';
        throw new Error(`Cannot write generated output: '${relative}' must be a real directory.`);
    }
    return true;
}

function generatedPaths(files, destination) {
    const paths = new Set();
    return files.map(file => {
        if (typeof file.path !== 'string' || typeof file.content !== 'string') {
            throw new Error('Cannot write generated output: paths and contents must be strings.');
        }
        const fullPath = path.resolve(destination, file.path);
        const relative = path.relative(destination, fullPath);
        if (!relative || relative === '..' || relative.startsWith('..' + path.sep) ||
            path.isAbsolute(relative) || path.isAbsolute(file.path)) {
            throw new Error(`Cannot write generated output outside '${destination}': ${file.path}`);
        }
        const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
        if (paths.has(key)) throw new Error(`Duplicate generated output path: ${file.path}`);
        paths.add(key);
        return { relative, content: file.content };
    });
}

/**
 * Publish one complete generated project. The filesystem argument is a narrow
 * test seam; production uses synchronous Node filesystem operations.
 * Root entries outside the generated set/managed directories remain user-owned.
 * This handles operation failures, not concurrent writers or process crashes.
 */
function publishGeneratedFiles(files, outputDirectory, fileSystem = fs) {
    const destination = path.resolve(outputDirectory);
    const parent = path.dirname(destination);
    const prefix = path.join(parent, `.${path.basename(destination)}.apiforge-g19-`);
    let staging = null;
    let backup = null;
    let previous = null;
    let oldMoved = false;
    let published = false;
    let failure = null;

    try {
        const entries = generatedPaths(files, destination);
        const hadOutput = directoryExists(destination, destination, fileSystem);
        if (hadOutput) {
            for (const name of MANAGED_DIRECTORIES) {
                directoryExists(path.join(destination, name), destination, fileSystem);
            }
        }

        // mkdtemp reserves a unique sibling on the destination's filesystem.
        staging = fileSystem.mkdtempSync(prefix + 'stage-');
        if (hadOutput) {
            const ownedRoots = new Set([...MANAGED_DIRECTORIES,
                ...entries.map(entry => entry.relative.split(path.sep)[0])]
                .map(name => process.platform === 'win32' ? name.toLowerCase() : name));
            for (const name of fileSystem.readdirSync(destination)) {
                const key = process.platform === 'win32' ? name.toLowerCase() : name;
                if (!ownedRoots.has(key)) {
                    fileSystem.cpSync(path.join(destination, name), path.join(staging, name), {
                        recursive: true, dereference: false, verbatimSymlinks: true,
                        preserveTimestamps: true
                    });
                }
            }
        }

        for (const entry of entries) {
            const target = path.join(staging, entry.relative);
            fileSystem.mkdirSync(path.dirname(target), { recursive: true });
            fileSystem.writeFileSync(target, entry.content, 'utf8');
        }
        // Read every generated file back before touching the published tree.
        for (const entry of entries) {
            const target = path.join(staging, entry.relative);
            const stats = fileSystem.lstatSync(target);
            if (!stats.isFile() || stats.isSymbolicLink() ||
                !fileSystem.readFileSync(target).equals(Buffer.from(entry.content, 'utf8'))) {
                throw new Error(`Generated output validation failed: ${entry.relative}`);
            }
        }

        if (hadOutput) {
            // Keep a reserved sibling container; the rename target is absent
            // even on Windows, where replacing an existing directory fails.
            backup = fileSystem.mkdtempSync(prefix + 'backup-');
            previous = path.join(backup, 'previous');
            fileSystem.renameSync(destination, previous);
            oldMoved = true;
        }
        fileSystem.renameSync(staging, destination);
        published = true;
        staging = null;
    } catch (error) {
        failure = error;
        if (oldMoved) {
            try {
                fileSystem.renameSync(previous, destination);
                oldMoved = false;
            } catch (rollbackError) {
                failure.rollbackError = rollbackError;
                failure.message += ` Rollback failed: ${rollbackError.message}. Previous output retained at '${previous}'.`;
            }
        }
    }

    // Never remove the only valid old tree after a failed rollback. Once the
    // new tree is published, backup cleanup failure must not trigger rollback.
    for (const [kind, directory] of [['staging', staging], ['backup', oldMoved && !published ? null : backup]]) {
        if (!directory) continue;
        try {
            fileSystem.rmSync(directory, { recursive: true, force: true });
            if (kind === 'staging') staging = null;
            else backup = null;
        } catch (cleanupError) {
            if (!failure) {
                failure = cleanupError;
                failure.message += ` New generated output is already published at '${destination}'.`;
            } else {
                (failure.cleanupErrors ||= []).push(cleanupError);
                failure.message += ` Cleanup failed: ${cleanupError.message}.`;
            }
            failure.message += ` Could not remove ${kind} directory '${directory}'.`;
        }
    }

    if (failure) {
        // Preserve the original Error object and OS code. This is runtime I/O
        // context, not a new compiler diagnostic or a changed success result.
        failure.outputPublication = { destination, published, staging, backup };
        throw failure;
    }
}

module.exports = { publishGeneratedFiles };
