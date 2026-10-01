const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const SemanticAnalyzer = require('../src/semantic/analyzer');
const IRGenerator = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const CodeGenerator = require('../src/codegen/codegen');

const expectedHealthBody = {
    status: 'UP',
    message: 'APIForge server running smoothly'
};

function boundedOutput(value, limit = 12000) {
    if (!value) return '(no output)';
    return value.length <= limit ? value : `[...truncated...]\n${value.slice(-limit)}`;
}

function appendBounded(current, chunk, limit = 100000) {
    const combined = current + chunk.toString();
    return combined.length <= limit ? combined : combined.slice(-limit);
}

function removeTemporaryDirectory(directory) {
    if (!directory || !fs.existsSync(directory)) return;
    fs.rmSync(directory, {
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

function compileProject(source) {
    const tokens = Lexer.tokenize(source);
    const ast = Parser.parse(tokens);
    const semantic = SemanticAnalyzer.analyze(ast);
    assert.deepStrictEqual(semantic.errors, [], 'Integration-test DSL should pass semantic analysis');

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
        if (options.onChild) options.onChild(child);

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
            if (options.onChild) options.onChild(null);
            reject(error);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            if (options.onChild) options.onChild(null);
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
    if (options.onChild) options.onChild(child);

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
        if (options.onChild) options.onChild(null);
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

function requestHttp(port, method, requestPath, body) {
    return new Promise((resolve, reject) => {
        const serializedBody = body === undefined ? null : JSON.stringify(body);
        const request = http.request({
            hostname: '127.0.0.1',
            port,
            path: requestPath,
            method,
            timeout: 2000,
            headers: serializedBody === null ? {} : {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(serializedBody)
            }
        }, response => {
            let responseBody = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { responseBody += chunk; });
            response.on('end', () => {
                let json = null;
                if (responseBody) {
                    try {
                        json = JSON.parse(responseBody);
                    } catch (error) {
                        // Callers report the raw body when JSON is required.
                    }
                }
                resolve({ statusCode: response.statusCode, headers: response.headers, body: responseBody, json });
            });
        });
        request.once('timeout', () => request.destroy(new Error(`${method} ${requestPath} timed out`)));
        request.once('error', reject);
        if (serializedBody !== null) request.write(serializedBody);
        request.end();
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
            const response = await requestHttp(port, 'GET', '/health');
            if (response.statusCode !== 200) {
                throw new Error(`GET /health returned HTTP ${response.statusCode}: ${response.body}`);
            }
            assert.deepStrictEqual(response.json, expectedHealthBody);
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

module.exports = {
    acquireFreePort,
    assertPortReleased,
    boundedOutput,
    compileProject,
    killProcessTreeSync,
    materializeGeneratedFiles,
    npmInvocation,
    removeTemporaryDirectory,
    requestHttp,
    runCommand,
    snapshotDirectory,
    startCommand,
    stopProcessTree,
    waitForHealth
};
