const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    acquireFreePort,
    assertPortReleased,
    boundedOutput,
    compileProject,
    killProcessTreeSync,
    materializeGeneratedFiles,
    npmInvocation,
    removeTemporaryDirectory,
    runCommand,
    snapshotDirectory,
    startCommand,
    stopProcessTree,
    waitForHealth
} = require('./generated-backend-test-helpers');

const repositoryRoot = path.resolve(__dirname, '..');
const repositoryOutput = path.join(repositoryRoot, 'output');
const requiredDependencies = ['dotenv', 'express', 'mysql2'];

let activeChild = null;
let temporaryProjectRoot = null;
let handlingSignal = false;

function handleTerminationSignal(signal) {
    if (handlingSignal) return;
    handlingSignal = true;

    try {
        killProcessTreeSync(activeChild);
        removeTemporaryDirectory(temporaryProjectRoot);
    } catch (error) {
        console.error(`Cleanup after ${signal} failed: ${error.message}`);
    }

    process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => handleTerminationSignal('SIGINT'));
process.on('SIGTERM', () => handleTerminationSignal('SIGTERM'));

function compileRepresentativeProject() {
    const source = [
        'ENTITY Widget',
        '',
        'id INT PRIMARY KEY',
        'name STRING REQUIRED'
    ].join('\n');
    return compileProject(source);
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
            env: { ...process.env, npm_config_update_notifier: 'false' },
            onChild: child => { activeChild = child; }
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
            env: { ...process.env, PORT: String(port) },
            onChild: child => { activeChild = child; }
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
            removeTemporaryDirectory(temporaryProjectRoot);
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
