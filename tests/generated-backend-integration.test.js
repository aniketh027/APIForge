const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const SemanticAnalyzer = require('../src/semantic/analyzer');
const IRGenerator = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const CodeGenerator = require('../src/codegen/codegen');

const repositoryRoot = path.resolve(__dirname, '..');
const repositoryOutput = path.join(repositoryRoot, 'output');
const requiredDependencies = ['dotenv', 'express', 'mysql2'];
const expectedHealthBody = {
    status: 'UP',
    message: 'APIForge server running smoothly'
};

let activeChild = null;
let temporaryProjectRoot = null;
let handlingSignal = false;

function boundedOutput(value, limit = 12000) {
    if (!value) return '(no output)';
    return value.length <= limit ? value : `[...truncated...]\n${value.slice(-limit)}`;
}

function appendBounded(current, chunk, limit = 100000) {
    const combined = current + chunk.toString();
    return combined.length <= limit ? combined : combined.slice(-limit);
}

function removeTemporaryProject() {
    if (!temporaryProjectRoot || !fs.existsSync(temporaryProjectRoot)) return;
    fs.rmSync(temporaryProjectRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200
    });
}

function killProcessTreeSync(child) {
    if (!child || !child.pid || child.exitCode !== null) return;

    if (process.platform === 'win32') {
        spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
        });
        return;
    }

    try {
        process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
        if (error.code !== 'ESRCH') throw error;
    }
}

function handleTerminationSignal(signal) {
    if (handlingSignal) return;
    handlingSignal = true;

    try {
        killProcessTreeSync(activeChild);
        removeTemporaryProject();
    } catch (error) {
        console.error(`Cleanup after ${signal} failed: ${error.message}`);
    }

    process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => handleTerminationSignal('SIGINT'));
process.on('SIGTERM', () => handleTerminationSignal('SIGTERM'));

function snapshotDirectory(root) {
    if (!fs.existsSync(root)) return null;

    const snapshot = {};

    function visit(directory, relativeDirectory = '') {
        const entries = fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            const relativePath = path.posix.join(
                relativeDirectory.split(path.sep).join(path.posix.sep),
                entry.name
            );
            const absolutePath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                visit(absolutePath, relativePath);
            } else if (entry.isFile()) {
                snapshot[relativePath] = crypto
                    .createHash('sha256')
                    .update(fs.readFileSync(absolutePath))
                    .digest('hex');
            } else {
                snapshot[relativePath] = `special:${entry.isSymbolicLink() ? fs.readlinkSync(absolutePath) : entry.name}`;
            }
        }
    }

    visit(root);
    return snapshot;
}

function compileRepresentativeProject() {
    const source = [
        'ENTITY Widget',
        '',
        'id INT PRIMARY KEY',
        'name STRING REQUIRED'
    ].join('\n');

    const tokens = Lexer.tokenize(source);
    const ast = Parser.parse(tokens);
    const semantic = SemanticAnalyzer.analyze(ast);
    assert.deepStrictEqual(semantic.errors, [], 'Representative DSL should pass semantic analysis');

    const ir = IRGenerator.generate(ast, semantic);
    const optimized = Optimizer.optimize(ir);
    return CodeGenerator.generate(optimized.ir, false).files;
}

function materializeGeneratedFiles(root, files) {
    for (const file of files) {
        const target = path.resolve(root, file.path);
        const relative = path.relative(root, target);
        assert.ok(
            relative && !relative.startsWith('..') && !path.isAbsolute(relative),
            `Generated path must stay inside the temporary project: ${file.path}`
        );
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content, 'utf8');
    }
}

function npmInvocation(args) {
    if (process.platform === 'win32') {
        return {
            command: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', `npm ${args.join(' ')}`]
        };
    }
    return { command: 'npm', args };
}

function runCommand(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env || process.env,
            detached: true,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        activeChild = child;

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killProcessTreeSync(child);
        }, options.timeoutMs);

        child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
        child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
        child.once('error', error => {
            clearTimeout(timer);
            if (activeChild === child) activeChild = null;
            reject(error);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            if (activeChild === child) activeChild = null;
            resolve({ code, signal, stdout, stderr, timedOut });
        });
    });
}

function startCommand(command, args, options) {
    const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    activeChild = child;

    const state = {
        child,
        stdout: '',
        stderr: '',
        spawnError: null,
        exited: false,
        code: null,
        signal: null
    };

    child.stdout.on('data', chunk => { state.stdout = appendBounded(state.stdout, chunk); });
    child.stderr.on('data', chunk => { state.stderr = appendBounded(state.stderr, chunk); });
    child.once('error', error => {
        state.spawnError = error;
    });
    child.once('close', (code, signal) => {
        state.exited = true;
        state.code = code;
        state.signal = signal;
        if (activeChild === child) activeChild = null;
    });

    return state;
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function stopProcessTree(state) {
    if (!state || !state.child.pid || state.exited || state.child.exitCode !== null) return;

    if (process.platform === 'win32') {
        const result = spawnSync('taskkill.exe', ['/pid', String(state.child.pid), '/T', '/F'], {
            windowsHide: true,
            encoding: 'utf8'
        });
        if (result.status !== 0 && !state.exited) {
            throw new Error(`taskkill failed (${result.status}): ${boundedOutput(result.stderr || result.stdout)}`);
        }
    } else {
        try {
            process.kill(-state.child.pid, 'SIGTERM');
        } catch (error) {
            if (error.code !== 'ESRCH') throw error;
        }

        const gracefulDeadline = Date.now() + 2000;
        while (!state.exited && Date.now() < gracefulDeadline) {
            await delay(50);
        }
        if (!state.exited) {
            try {
                process.kill(-state.child.pid, 'SIGKILL');
            } catch (error) {
                if (error.code !== 'ESRCH') throw error;
            }
        }
    }

    const exitDeadline = Date.now() + 5000;
    while (!state.exited && Date.now() < exitDeadline) {
        await delay(50);
    }
    assert.ok(state.exited || state.child.exitCode !== null, 'Generated server process tree did not terminate');
}

function acquireFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(error => error ? reject(error) : resolve(address.port));
        });
    });
}

function assertPortReleased(port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', error => {
            reject(new Error(`Port ${port} is still occupied after server cleanup: ${error.message}`));
        });
        server.listen(port, '127.0.0.1', () => {
            server.close(error => error ? reject(error) : resolve());
        });
    });
}

function requestHealth(port) {
    return new Promise((resolve, reject) => {
        const request = http.get({
            hostname: '127.0.0.1',
            port,
            path: '/health',
            timeout: 1000
        }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ statusCode: response.statusCode, body }));
        });
        request.once('timeout', () => request.destroy(new Error('Health request timed out')));
        request.once('error', reject);
    });
}

async function waitForHealth(port, serverState, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
        if (serverState.spawnError) {
            throw new Error(`Could not start the generated backend: ${serverState.spawnError.message}`);
        }
        if (serverState.exited) {
            throw new Error(
                `Generated server exited before becoming healthy (code ${serverState.code}, signal ${serverState.signal || 'none'}).\n` +
                `stdout:\n${boundedOutput(serverState.stdout)}\n` +
                `stderr:\n${boundedOutput(serverState.stderr)}`
            );
        }

        try {
            const response = await requestHealth(port);
            if (response.statusCode !== 200) {
                throw new Error(`GET /health returned HTTP ${response.statusCode}: ${response.body}`);
            }

            let parsed;
            try {
                parsed = JSON.parse(response.body);
            } catch (error) {
                throw new Error(`GET /health returned invalid JSON: ${response.body}`);
            }
            assert.deepStrictEqual(parsed, expectedHealthBody);
            return response;
        } catch (error) {
            lastError = error;
        }

        await delay(100);
    }

    throw new Error(
        `Timed out after ${timeoutMs}ms waiting for GET /health on port ${port}. ` +
        `Last error: ${lastError ? lastError.message : 'none'}\n` +
        `stdout:\n${boundedOutput(serverState.stdout)}\n` +
        `stderr:\n${boundedOutput(serverState.stderr)}`
    );
}

async function main() {
    const outputBefore = snapshotDirectory(repositoryOutput);
    const cleanupErrors = [];
    let failure = null;
    let serverState = null;
    let serverPort = null;

    try {
        temporaryProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-generated-integration-'));
        const generatedFiles = compileRepresentativeProject();
        materializeGeneratedFiles(temporaryProjectRoot, generatedFiles);

        const expectedFiles = [
            'package.json',
            'README.md',
            'server.js',
            'models/Widget.js',
            'controllers/widgetController.js',
            'routes/widgetRoutes.js'
        ];
        for (const relativePath of expectedFiles) {
            assert.ok(fs.existsSync(path.join(temporaryProjectRoot, relativePath)), `Expected generated ${relativePath}`);
        }

        const generatedPackage = JSON.parse(fs.readFileSync(
            path.join(temporaryProjectRoot, 'package.json'),
            'utf8'
        ));
        assert.strictEqual(generatedPackage.scripts.start, 'node server.js');
        for (const dependency of requiredDependencies) {
            assert.ok(generatedPackage.dependencies[dependency], `Expected direct dependency ${dependency}`);
        }

        const install = npmInvocation(['install', '--no-audit', '--no-fund', '--loglevel=error']);
        const installResult = await runCommand(install.command, install.args, {
            cwd: temporaryProjectRoot,
            timeoutMs: 300000,
            env: { ...process.env, npm_config_update_notifier: 'false' }
        });
        assert.ok(
            !installResult.timedOut && installResult.code === 0,
            `npm install failed${installResult.timedOut ? ' (timed out)' : ''} ` +
            `(exit ${installResult.code}, signal ${installResult.signal || 'none'}).\n` +
            `stdout:\n${boundedOutput(installResult.stdout)}\n` +
            `stderr:\n${boundedOutput(installResult.stderr)}`
        );

        for (const dependency of requiredDependencies) {
            const installedManifest = path.join(temporaryProjectRoot, 'node_modules', dependency, 'package.json');
            assert.ok(fs.existsSync(installedManifest), `Expected installed direct dependency ${dependency}`);
            JSON.parse(fs.readFileSync(installedManifest, 'utf8'));
        }

        const port = await acquireFreePort();
        serverPort = port;
        const start = npmInvocation(['start']);
        serverState = startCommand(start.command, start.args, {
            cwd: temporaryProjectRoot,
            env: { ...process.env, PORT: String(port) }
        });

        await waitForHealth(port, serverState, 30000);
        console.log(`Generated backend integration passed on ephemeral port ${port}.`);
    } catch (error) {
        failure = error;
    } finally {
        try {
            await stopProcessTree(serverState);
            if (serverPort !== null) await assertPortReleased(serverPort);
        } catch (error) {
            cleanupErrors.push(`Process cleanup failed: ${error.message}`);
        }

        try {
            removeTemporaryProject();
            assert.ok(
                !temporaryProjectRoot || !fs.existsSync(temporaryProjectRoot),
                `Temporary project still exists: ${temporaryProjectRoot}`
            );
        } catch (error) {
            cleanupErrors.push(`Temporary-directory cleanup failed: ${error.message}`);
        }

        try {
            assert.deepStrictEqual(
                snapshotDirectory(repositoryOutput),
                outputBefore,
                'Repository output/ changed during generated-backend integration'
            );
        } catch (error) {
            cleanupErrors.push(error.message);
        }
    }

    if (failure || cleanupErrors.length > 0) {
        const messages = [];
        if (failure) messages.push(failure.stack || failure.message);
        messages.push(...cleanupErrors);
        throw new Error(messages.join('\n\n'));
    }

    console.log('Server process, temporary project, and repository output cleanup verified.');
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
