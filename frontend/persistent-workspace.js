/* Saved selections and owned sessions stay separate; recovery is browser memory only. */
'use strict';
window.APIForgePersistent = (() => {
    const HEX = /^[a-f0-9]{64}$/;
    const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    const STATES = ['absent', 'incomplete', 'stopped', 'running', 'occupied'];
    const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE'];
    const HEADERS = ['content-type', 'x-total-count', 'x-page', 'x-limit', 'x-total-pages'];
    const ERRORS = Object.freeze({
        PERSISTENT_DISABLED: [403, 'Start the local server with APIFORGE_PROJECT_API=1 and APIFORGE_PERSISTENT_RUNNER=1. Configure dedicated database credentials on the server. The editor, compiler and disposable Live API remain independent.'],
        PERSISTENT_NOT_LOCAL: [403, 'Use a direct local loopback connection.'],
        PERSISTENT_ORIGIN_REFUSED: [403, 'The browser origin was refused. Use the local server origin.'],
        PERSISTENT_TOKEN_INVALID: [403, 'The Persistent API token expired. Choose Reconnect Persistent API, then inspect status. No operation was replayed.'],
        PERSISTENT_REQUEST_INVALID: [400, 'The request was refused by the persistent runtime contract.'],
        PERSISTENT_JSON_INVALID: [400, 'The server requires a valid UTF-8 JSON object.'],
        PERSISTENT_MEDIA_UNSUPPORTED: [415, 'The server requires uncompressed UTF-8 JSON.'],
        PERSISTENT_BODY_TOO_LARGE: [413, 'The request exceeds the permitted size.'],
        PERSISTENT_RESPONSE_TOO_LARGE: [502, 'The generated response is too large. The request may have completed; do not replay it without inspection.'],
        PERSISTENT_ENDPOINT_NOT_FOUND: [404, 'The persistent endpoint is unavailable. Check the local server version.'],
        PERSISTENT_ENDPOINT_NOT_ALLOWED: [400, 'The server refused this generated operation.'],
        PERSISTENT_PROJECT_UNAVAILABLE: [503, 'The saved project cannot be verified. Inspect it through Open or Reconnect Project API.'],
        PERSISTENT_REVISION_MISMATCH: [409, 'The saved revision or target differs from the initialized database. Automatic schema migration is refused. Preserve the database; a schema upgrade needs a separate reviewed operation.'],
        PERSISTENT_COMPILE_FAILED: [422, 'The saved source cannot compile for this runtime. Imports are unsupported.'],
        PERSISTENT_SCHEMA_RESERVED: [422, 'The saved schema conflicts with reserved runtime metadata.'],
        PERSISTENT_ARTIFACT_CHANGED: [409, 'Generated artifact provenance changed. Automatic upgrades are refused.'],
        PERSISTENT_CONFIGURATION_UNAVAILABLE: [503, 'Configure dedicated literal-loopback credentials for the selected target on the server.'],
        PERSISTENT_DATABASE_UNAVAILABLE: [503, 'The database could not be accessed or verified. This does not establish absence.'],
        PERSISTENT_PROFILE_UNSUPPORTED: [503, 'The target database profile or durability settings are unsupported.'],
        PERSISTENT_DATABASE_MISSING: [409, 'The database is absent. Refresh Status before explicitly initializing; Run does not initialize it.'],
        PERSISTENT_DATABASE_COLLISION: [409, 'An existing database has no matching ownership attestation. Preserve it for manual inspection; it will not be adopted, reset or changed.'],
        PERSISTENT_ALREADY_INITIALIZED: [409, 'This database is already initialized. Refresh Status, then explicitly Run if stopped. Do not initialize again.'],
        PERSISTENT_INCOMPLETE: [409, 'Initialization is incomplete. Preserve the database and inspect its schema and data manually. No schema import will be replayed.'],
        PERSISTENT_PROVISION_UNCERTAIN: [500, 'Initialization may have committed partly or completely. Preserve the database. Refresh Status and arrange manual inspection; do not repeat initialization.'],
        PERSISTENT_BUSY: [409, 'A runtime claim is occupied. No competing process, automatic expiry or takeover is allowed. Stop a known owned session explicitly.'],
        PERSISTENT_CLAIM_UNCERTAIN: [500, 'Runtime ownership may have committed. Refresh Status; an unknown session ID cannot be recovered. No competing process will start.'],
        PERSISTENT_OWNERSHIP_LOST: [409, 'Runtime ownership could not be verified. Preserve state and inspect status. Replacement is refused; the request may have completed.'],
        PERSISTENT_SESSION_INVALID: [403, 'The server refused the owned session ID. Refresh Status. A lost or restarted session cannot be reconstructed.'],
        PERSISTENT_START_FAILED: [503, 'The generated API did not become healthy. Inspect status before another explicit action.'],
        PERSISTENT_REQUEST_FAILED: [502, 'The generated request may have completed. Inspect status and records before considering another explicit request.'],
        PERSISTENT_CLEANUP_FAILED: [503, 'Cleanup was not fully verified. Ownership is retained and replacement is refused. Preserve the database; only an explicit Stop of the known owned session can retry its cleanup.'],
        PERSISTENT_STOPPING: [503, 'The runtime is shutting down. Reconnect after the server restarts.']
    });
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const keys = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key));
    const selection = snapshot => snapshot && UUID.test(snapshot.projectId) && ['mysql', 'postgres'].includes(snapshot.target) &&
        Number.isSafeInteger(snapshot.revision) && snapshot.revision > 0;
    const identity = value => selection(value) ? JSON.stringify([value.projectId, value.target, value.revision]) : '';
    const payload = value => ({ projectId: value.projectId, target: value.target, expectedRevision: value.revision });
    function failure(code, uncertain = false) {
        const error = new Error(ERRORS[code]?.[1] || ({
            CLIENT_NETWORK: 'The local connection was lost or timed out.',
            CLIENT_RESPONSE: 'The server returned an unexpected UTF-8 JSON response.',
            CLIENT_DISCONNECTED: 'Reconnect Persistent API explicitly before choosing this action.'
        })[code] || 'The server response could not be verified.');
        error.code = code; error.uncertain = uncertain; return error;
    }
    async function json(response, limit) {
        const media = response.headers.get('content-type') || '';
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(media)) throw failure('CLIENT_RESPONSE');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > limit) throw failure('CLIENT_RESPONSE');
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { throw failure('CLIENT_RESPONSE'); }
    }
    async function fetchJSON(url, options, limit = 2 * 1024 * 1024) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal,
                mode: 'same-origin', credentials: 'omit', cache: 'no-store', redirect: 'error' });
            return { response, envelope: await json(response, limit) };
        } catch (error) { throw typeof error.code === 'string' ? error : failure('CLIENT_NETWORK'); }
        finally { clearTimeout(timer); }
    }
    function summary(data, selected, fields) {
        return keys(data, ['formatVersion', 'projectId', 'target', 'revision', 'state', ...fields]) &&
            data.formatVersion === 1 && identity(data) === identity(selected) && STATES.includes(data.state);
    }
    function client() {
        let token = null;
        async function call(action, body, validate) {
            const mutation = !['session', 'status'].includes(action);
            if (action !== 'session' && !token) throw failure('CLIENT_DISCONNECTED');
            try {
                const { response, envelope } = await fetchJSON('/api/persistent/' + action, {
                    method: action === 'session' ? 'GET' : 'POST',
                    headers: action === 'session' ? {} : { 'Content-Type': 'application/json', 'x-apiforge-persistent-token': token },
                    ...(action === 'session' ? {} : { body: JSON.stringify(body) })
                });
                if (!response.ok && keys(envelope, ['success', 'error']) && envelope.success === false &&
                    keys(envelope.error, ['code', 'message']) && typeof envelope.error.message === 'string' &&
                    Object.hasOwn(ERRORS, envelope.error.code) && ERRORS[envelope.error.code][0] === response.status) {
                    if (envelope.error.code === 'PERSISTENT_TOKEN_INVALID') token = null;
                    throw failure(envelope.error.code);
                }
                if (response.status !== (action === 'initialize' ? 201 : 200) ||
                    !keys(envelope, ['success', 'data']) || envelope.success !== true || !validate(envelope.data)) throw failure('CLIENT_RESPONSE');
                return envelope.data;
            } catch (error) {
                if (mutation && ['CLIENT_NETWORK', 'CLIENT_RESPONSE'].includes(error.code)) error.uncertain = true;
                throw error;
            }
        }
        return {
            connected: () => !!token,
            async connect() {
                token = null;
                const data = await call('session', undefined, data => keys(data, ['formatVersion', 'token', 'tokenHeader']) &&
                    data.formatVersion === 1 && typeof data.token === 'string' && HEX.test(data.token) && data.tokenHeader === 'x-apiforge-persistent-token');
                token = data.token;
            },
            status: selected => call('status', payload(selected), data => summary(data, selected, [])),
            initialize: selected => call('initialize', payload(selected), data => summary(data, selected, []) && data.state === 'stopped'),
            run: selected => call('start', payload(selected), data => summary(data, selected, ['sessionId', 'endpointCount']) &&
                data.state === 'running' && typeof data.sessionId === 'string' && HEX.test(data.sessionId) && Number.isSafeInteger(data.endpointCount) && data.endpointCount >= 0),
            stop: sessionId => call('stop', { sessionId }, data => keys(data, ['formatVersion', 'state']) && data.formatVersion === 1 && data.state === 'stopped'),
            request: body => call('request', body, data => keys(data, ['success', 'status', 'headers', 'body', 'durationMs']) &&
                data.success === true && Number.isInteger(data.status) && data.status >= 100 && data.status <= 599 &&
                object(data.headers) && Object.entries(data.headers).every(([key, value]) => HEADERS.includes(key) && typeof value === 'string') &&
                Number.isFinite(data.durationMs) && data.durationMs >= 0)
        };
    }
    // Only called during explicit Run. Fetch the saved source through M2B with its
    // distinct token, verify acknowledged identity, then compile that exact source.
    // This output never touches the editor or the ordinary compilation panels.
    async function savedOperations(selected) {
        const session = await fetchJSON('/api/projects/session', { method: 'GET' });
        const access = session.envelope;
        if (session.response.status !== 200 || !keys(access, ['success', 'data']) || access.success !== true ||
            !keys(access.data, ['token', 'tokenHeader']) || typeof access.data.token !== 'string' || !HEX.test(access.data.token) || access.data.tokenHeader !== 'x-apiforge-project-token') throw failure('CLIENT_RESPONSE');
        const fetched = await fetchJSON('/api/projects/' + selected.projectId, {
            method: 'GET', headers: { 'x-apiforge-project-token': access.data.token }
        });
        const record = fetched.envelope?.data;
        if (fetched.response.status !== 200 || !keys(fetched.envelope, ['success', 'data']) || fetched.envelope.success !== true ||
            !keys(record, ['id', 'name', 'target', 'revision', 'sourceHash', 'createdAt', 'updatedAt', 'source']) ||
            record.id !== selected.projectId || record.target !== selected.target || record.revision !== selected.revision ||
            record.name !== selected.name || typeof record.source !== 'string' || typeof record.sourceHash !== 'string' || !HEX.test(record.sourceHash) ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.createdAt) ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.updatedAt)) throw failure('CLIENT_RESPONSE');
        const bytes = new TextEncoder().encode(record.source);
        if (bytes.length > 1024 * 1024) throw failure('CLIENT_RESPONSE');
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== record.sourceHash) throw failure('CLIENT_RESPONSE');
        const compiled = await fetchJSON('/api/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: record.source, target: selected.target }) }, 32 * 1024 * 1024);
        if (compiled.response.status !== 200 || compiled.envelope.success !== true || !Array.isArray(compiled.envelope.generatedFiles)) throw failure('CLIENT_RESPONSE');
        const files = compiled.envelope.generatedFiles.filter(file => file.path === 'swagger.json');
        if (files.length !== 1 || typeof files[0].content !== 'string') throw failure('CLIENT_RESPONSE');
        const spec = JSON.parse(files[0].content), operations = [];
        if (!object(spec.paths) || spec.openapi !== '3.0.0') throw failure('CLIENT_RESPONSE');
        for (const [path, item] of Object.entries(spec.paths)) {
            if (!path.startsWith('/') || path.startsWith('//') || !object(item)) continue;
            const parts = path.split('/').slice(1);
            if (parts.some(part => !part || (!/^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(part) && /[{}?#\\%]/.test(part)))) continue;
            for (const method of METHODS) if (object(item[method.toLowerCase()])) {
                operations.push({ method, path, body: !!item[method.toLowerCase()].requestBody });
            }
        }
        return operations;
    }
    function start(projects) {
        const pane = document.getElementById('persistent-panel'), api = client();
        const disclosure = document.getElementById('persistent-workspace');
        const launcher = document.getElementById('persistent-launcher');
        disclosure.addEventListener('toggle', () => launcher.setAttribute('aria-expanded', String(disclosure.open)));
        launcher.addEventListener('click', () => {
            disclosure.open = !disclosure.open;
            launcher.setAttribute('aria-expanded', String(disclosure.open));
            if (disclosure.open) {
                disclosure.scrollIntoView({ block: 'nearest' });
                document.getElementById('persistent-disclosure').focus({ preventScroll: true });
            }
        });
        let selected = null, generation = 0, state = null, lastState = null, transient = '', pending = false;
        let message = 'Choose Reconnect Persistent API to connect explicitly. The local server requires APIFORGE_PROJECT_API=1 and APIFORGE_PERSISTENT_RUNNER=1, with dedicated target credentials configured server-side.';
        let owned = null, operations = [], operationIndex = 0, connected = false;
        let connectionGeneration = 0, projectGeneration = 0, stoppedProof = null;
        const projectArea = document.getElementById('project-workspace');
        const projectDialog = document.getElementById('project-dialog');
        const projectStatus = document.getElementById('project-status');
        let projectObserver = null;
        const uncertainInitialization = new Set();
        const controls = {};
        function node(tag, id, text, parent = pane) {
            const value = document.createElement(tag); if (id) { value.id = id; controls[id] = value; }
            if (text) value.textContent = text; parent.append(value); return value;
        }
        const card = node('div', null, null); card.className = 'persistent-card';
        node('h3', null, 'Persistent API', card);
        node('p', null, 'Saved revision → dedicated database → generated API. Stop retains your database and records. There is no automatic migration or runtime expiry.', card);
        node('p', 'persistent-project', '', card);
        node('p', 'persistent-identity', '', card);
        node('p', 'persistent-draft', '', card);
        const status = node('p', 'persistent-status', '', card); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const notice = node('p', 'persistent-message', '', card); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
        const reason = node('p', 'persistent-controls-reason', '', card);
        const actions = node('div', null, null, card); actions.className = 'persistent-actions';
        function button(id, text, action) {
            const value = node('button', id, text, actions); value.type = 'button'; value.className = 'btn';
            value.setAttribute('aria-describedby', 'persistent-controls-reason'); value.addEventListener('click', action); return value;
        }
        button('persistent-reconnect', 'Reconnect Persistent API', reconnect);
        button('persistent-refresh', 'Refresh Status', refresh);
        button('persistent-initialize', 'Initialize Database', initialize);
        button('persistent-run', 'Run API', run);
        button('persistent-stop', 'Stop API', stop);
        const forget = button('persistent-forget', 'Forget Stale Browser Session', forgetStaleSession);
        forget.setAttribute('aria-describedby', 'persistent-forget-reason');
        node('p', 'persistent-forget-reason', '', card);
        node('p', 'persistent-owned', '', card);
        const builder = node('div', 'persistent-builder', '', card); builder.className = 'persistent-builder';
        function label(id, text, parent = builder) { const value = node('label', null, text, parent); value.htmlFor = id; }
        label('persistent-endpoint', 'Generated endpoint (saved revision)');
        const endpoints = node('select', 'persistent-endpoint', '', builder);
        endpoints.addEventListener('change', () => { operationIndex = Number(endpoints.value); parameters(); });
        node('div', 'persistent-parameters', '', builder);
        label('persistent-query', 'Query components (optional)');
        const query = node('input', 'persistent-query', '', builder); query.placeholder = 'limit=20&page=1';
        const bodyControl = node('div', 'persistent-body-control', '', builder);
        label('persistent-body', 'JSON request body', bodyControl);
        const body = node('textarea', 'persistent-body', '', bodyControl); body.rows = 7; body.spellcheck = false; body.value = '{}';
        const send = node('button', 'persistent-send', 'Send Request', builder); send.type = 'button'; send.className = 'btn';
        send.setAttribute('aria-describedby', 'persistent-request-reason'); send.addEventListener('click', request);
        node('p', 'persistent-request-reason', '', card);
        const response = node('div', 'persistent-response', '', card); response.setAttribute('aria-label', 'Persistent generated API response'); response.setAttribute('aria-live', 'polite');
        const valid = ticket => ticket === generation;
        const matches = () => owned && identity(owned.selection) === identity(selected);
        const projectIdle = () => projectArea?.getAttribute('aria-busy') === 'false' && projectDialog?.open === false &&
            ['saved', 'unsaved'].includes(projectStatus?.dataset.state);
        function projectActivity(records) {
            if (records.some(record => record.oldValue !== record.target.getAttribute(record.attributeName))) {
                projectGeneration++; stoppedProof = null;
            }
        }
        function canForget(proof = stoppedProof) {
            projectActivity(projectObserver?.takeRecords() || []);
            return !!proof && proof === stoppedProof && !pending && connected && api.connected() &&
                projectIdle() && proof.project === projectGeneration &&
                selection(selected) && matches() && proof.session === owned &&
                proof.identity === identity(selected) && proof.connection === connectionGeneration &&
                proof.ticket === generation && state === 'stopped' && proof.result.state === 'stopped' &&
                identity(proof.result) === identity(selected);
        }
        function render() {
            card.setAttribute('aria-busy', String(pending));
            controls['persistent-project'].textContent = selection(selected) ? selected.name : 'No acknowledged saved project';
            controls['persistent-identity'].textContent = selection(selected) ? selected.projectId + ' · Saved revision ' + selected.revision + ' · ' +
                (selected.target === 'mysql' ? 'MySQL' : 'PostgreSQL') : 'Create or Open a project, then Save an acknowledged revision.';
            controls['persistent-draft'].textContent = selected?.dirty ? 'Local edits are unsaved. Runtime actions use the acknowledged saved revision, including its target. No implicit Save, schema import of draft edits or migration occurs.' : '';
            status.textContent = (state ? 'Database/runtime: ' + state : 'Database/runtime: not currently verified' +
                (lastState ? ' · Last acknowledged state: ' + lastState : '')) + (transient ? ' · ' + transient : '');
            notice.textContent = message;
            reason.textContent = !connected ? 'Persistent API is disconnected. Reconnect explicitly; no Store or database is initialized on page load.' :
                !selection(selected) ? 'Save or Open an acknowledged project before inspecting or running it.' :
                !state ? 'Refresh Status for this saved selection before Initialize or Run.' :
                state === 'absent' ? uncertainInitialization.has(identity(selected)) ? 'An earlier initialization is unconfirmed. Preserve state for manual inspection; initialization cannot be repeated from this page.' :
                'Initialize Database requires confirmation. This is separate from Initialize Storage.' :
                ['incomplete', 'occupied'].includes(state) ? 'Preserve the database. Initialization and Run are refused in this state.' :
                'Run uses the saved revision. Stop addresses only the known owned session and retains the database.';
            controls['persistent-reconnect'].disabled = pending;
            controls['persistent-refresh'].disabled = pending || !connected || !selection(selected);
            controls['persistent-initialize'].disabled = pending || !connected || !selection(selected) || state !== 'absent' || !!owned || uncertainInitialization.has(identity(selected));
            controls['persistent-run'].disabled = pending || !connected || !selection(selected) || state !== 'stopped' || !!owned;
            controls['persistent-stop'].disabled = pending || !connected || !owned;
            forget.disabled = !canForget();
            controls['persistent-forget-reason'].textContent = canForget() ?
                'Fresh Status verified this exact saved deployment as stopped. With confirmation, discard only its stale session reference in this page. The database and server ownership are unchanged.' :
                ['running', 'occupied'].includes(state) ?
                'Browser-session forgetting is refused while running or occupied. Use the existing safe lifecycle or a separately reviewed operator procedure to resolve ownership.' :
                'Forgetting requires a known session for this exact saved project, target and revision, an explicit Persistent API connection, and a fresh verified stopped Status. Finish saved-project operations and resolve any unconfirmed Save before inspecting again. It cannot recover a lost ID or repair uncertain provisioning.';
            controls['persistent-owned'].textContent = owned ? 'Known owned session: ' + owned.selection.name + ' · ' + owned.selection.target + ' · revision ' + owned.selection.revision +
                (matches() ? '. Stop remains available with unsaved edits.' : '. This belongs to a previous selection. Stop API explicitly stops that session; the current project is untouched.') :
                ['running', 'occupied'].includes(state) ? 'No owned session ID is available in this page. Reload loses ephemeral IDs. Status cannot reconstruct them; no takeover or guessed Stop is available. Preserve state for operator inspection.' : 'No owned generated API session in this page.';
            const usable = connected && !pending && matches() && state === 'running' && owned.verified && operations.length > 0;
            builder.hidden = !operations.length || !matches();
            send.disabled = !usable;
            endpoints.disabled = query.disabled = pending;
            controls['persistent-parameters'].querySelectorAll('input').forEach(input => { input.disabled = pending; });
            body.disabled = pending || !operations[operationIndex]?.body;
            controls['persistent-request-reason'].textContent = usable ? 'Only generated operations verified for this exact saved revision and target are offered. Requests are never replayed.' :
                'Request builder disabled: Run must return a known session and matching saved-project OpenAPI; runtime status and ownership must remain verified.';
        }
        function parameters() {
            const entry = operations[operationIndex]; controls['persistent-parameters'].replaceChildren();
            for (const [index, name] of (entry?.path.match(/\{[^}]+\}/g) || []).map(part => part.slice(1, -1)).entries()) {
                const id = 'persistent-param-' + index;
                label(id, 'Path parameter: ' + name, controls['persistent-parameters']);
                const input = node('input', id, '', controls['persistent-parameters']); input.dataset.parameter = name; input.required = true;
            }
            bodyControl.hidden = !entry?.body; body.disabled = !entry?.body; query.value = ''; body.value = '{}';
        }
        function installOperations(value) {
            operations = value; operationIndex = 0; endpoints.replaceChildren();
            value.forEach((entry, index) => { const option = node('option', null, entry.method + ' ' + entry.path, endpoints); option.value = String(index); });
            parameters();
        }
        function begin(text) { stoppedProof = null; generation++; pending = true; transient = text; message = ''; render(); return generation; }
        function finish() { pending = false; transient = ''; render(); }
        function report(error, action, ticket) {
            connected = connected && api.connected();
            if (action === 'request' && owned) owned.verified = false;
            if (action === 'stop' && owned) owned.verified = false;
            if (!valid(ticket)) return;
            if (action !== 'connect') { lastState = state || lastState; state = null; }
            message = error.code + ': ' + error.message + (error.uncertain ? ' This operation may have succeeded. Its outcome is unconfirmed. Refresh Status; no mutation was retried.' : '');
            if (action === 'connect') message += ' Check the local server version, APIFORGE_PROJECT_API=1 and APIFORGE_PERSISTENT_RUNNER=1. Configure dedicated target credentials server-side, then reconnect explicitly.';
            if (action === 'request') message += ' The generated request may have completed. Inspect records before another explicit request.';
        }
        async function reconnect() {
            if (pending) return;
            connectionGeneration++; connected = false;
            lastState = state || lastState; state = null;
            if (owned) owned.verified = false;
            const ticket = begin('connecting');
            try { await api.connect(); if (valid(ticket)) { connected = true; state = null; message = 'Persistent API connected. Refresh Status explicitly. No mutation was replayed.'; } }
            catch (error) { report(error, 'connect', ticket); }
            finally { finish(); }
        }
        async function refresh() {
            if (pending || !connected || !selection(selected)) return;
            const saved = selected, projectTicket = projectGeneration, ticket = begin('inspecting');
            try {
                const result = await api.status(saved);
                if (!valid(ticket)) return;
                state = result.state;
                stoppedProof = state === 'stopped' && projectIdle() && projectTicket === projectGeneration ? { session: owned, identity: identity(saved), project: projectTicket,
                    connection: connectionGeneration, ticket, result } : null;
                if (matches()) owned.verified = state === 'running';
                message = state === 'occupied' ? 'Ownership is occupied. No automatic release or takeover is available.' : 'Verified status for saved revision ' + saved.revision + '.';
            } catch (error) { report(error, 'status', ticket); }
            finally { finish(); }
        }
        function forgetStaleSession() {
            const proof = stoppedProof;
            if (!canForget(proof)) { render(); return; }
            if (!window.confirm('Forget Stale Browser Session for ' + selected.name + ' (' + selected.target +
                ', saved revision ' + selected.revision + ')? Fresh Status verified this exact deployment as stopped. ' +
                'This discards only the ephemeral session reference, request builder and old response held in this browser page. ' +
                'It does not stop a process, change the database or server-side ownership, clear an occupied claim, or recover a lost token. ' +
                'Refresh Status again before choosing Run API explicitly. Continue?')) return;
            // Confirmation does not confer authority if selection, connection or a
            // newer operation changed. Never issue an HTTP request from this action.
            if (!canForget(proof)) { render(); return; }
            generation++; stoppedProof = null; owned = null;
            state = null; lastState = null;
            installOperations([]); response.replaceChildren();
            message = 'Only local browser session memory was discarded. The database and server-side ownership were unchanged. Refresh Status explicitly before Run API; no operation was sent.';
            render();
        }
        async function initialize() {
            if (controls['persistent-initialize'].disabled) return;
            const saved = selected;
            if (!window.confirm('Initialize Database for ' + saved.name + ' (' + saved.target + ', saved revision ' + saved.revision + ')? A new dedicated persistent database may be created and its saved schema imported once. Existing data will not be reset or adopted. This is distinct from Initialize Storage for saved projects. Later source changes do not automatically migrate the database. Unsaved editor changes are excluded. Continue?')) return;
            const ticket = begin('initializing');
            try { const result = await api.initialize(saved); if (valid(ticket)) { state = result.state; message = 'Database initialized once from the saved revision. Choose Run API explicitly.'; } }
            catch (error) {
                if (error.uncertain || error.code === 'PERSISTENT_PROVISION_UNCERTAIN') uncertainInitialization.add(identity(saved));
                report(error, 'initialize', ticket);
            }
            finally { finish(); }
        }
        async function run() {
            if (controls['persistent-run'].disabled) return;
            const saved = selected, ticket = begin('starting');
            let generated = [], generatedWarning = '';
            try { generated = await savedOperations(saved); }
            catch { generatedWarning = ' Saved-project OpenAPI could not be verified. Requests are disabled; Stop remains available.'; }
            try {
                if (!valid(ticket)) return;
                const result = await api.run(saved);
                owned = { id: result.sessionId, selection: saved, verified: true, operations: [] };
                if (generated.length !== result.endpointCount) { generated = []; generatedWarning = ' Generated endpoint count differs. Requests are disabled; Stop remains available.'; }
                owned.operations = generated;
                if (valid(ticket)) { state = result.state; installOperations(generated); message = 'Run acknowledged for saved revision ' + saved.revision + '.' + generatedWarning; }
                else { owned.verified = false; }
            } catch (error) { report(error, 'start', ticket); }
            finally { finish(); }
        }
        async function stop() {
            if (controls['persistent-stop'].disabled) return;
            const session = owned, ticket = begin('stopping');
            try {
                await api.stop(session.id);
                if (owned === session) owned = null;
                if (valid(ticket) && identity(session.selection) === identity(selected)) {
                    state = 'stopped'; installOperations([]); message = 'Stop acknowledged. The database and records are retained.';
                }
            } catch (error) { report(error, 'stop', ticket); }
            finally { finish(); }
        }
        async function request() {
            if (send.disabled) return;
            const entry = operations[operationIndex], session = owned;
            let path = entry.path, data;
            try {
                for (const input of controls['persistent-parameters'].querySelectorAll('input')) {
                    const value = input.value;
                    if (!value || /[/%\\?#\s\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..') {
                        input.focus(); throw new Error('Enter a path parameter without separators, whitespace, percent escapes or dot traversal: ' + input.dataset.parameter);
                    }
                    path = path.replace('{' + input.dataset.parameter + '}', encodeURIComponent(value));
                }
                const text = query.value.replace(/^\?/, '');
                if (text) {
                    if (text.length > 4096 || /[#?\\\s\x00-\x1f\x7f]/.test(text)) throw new Error('Enter constrained key=value query components joined with &.');
                    for (const part of text.split('&')) {
                        if (!/^[A-Za-z_][A-Za-z0-9_]*=[^=]*$/.test(part)) throw new Error('Enter constrained key=value query components joined with &.');
                        const value = decodeURIComponent(part.slice(part.indexOf('=') + 1));
                        if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('Query values cannot contain control characters.');
                    }
                    path += '?' + text;
                }
                if (path.length > 8192) throw new Error('The generated path exceeds 8192 characters.');
                if (entry.body) {
                    try { data = JSON.parse(body.value); } catch { throw new Error('Enter valid JSON for the request body.'); }
                    if (!object(data)) throw new Error('Enter a JSON object for the generated request body.');
                    if (new TextEncoder().encode(JSON.stringify(data)).length > 64 * 1024) throw new Error('The JSON body exceeds 64 KiB.');
                }
            } catch (error) { message = error instanceof URIError ? 'Enter valid percent encoding in query values.' : error.message; render(); return; }
            const ticket = begin('sending');
            try {
                const result = await api.request({ sessionId: session.id, method: entry.method, path, ...(entry.body ? { body: data } : {}) });
                if (!valid(ticket) || owned !== session) return;
                response.replaceChildren();
                node('p', null, 'HTTP ' + result.status + ' · ' + result.durationMs + ' ms', response);
                node('pre', null, Object.entries(result.headers).map(([key, value]) => key + ': ' + value).join('\n'), response);
                const content = node('pre', null, typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2), response);
                content.tabIndex = 0; content.setAttribute('aria-label', 'Response body');
                message = 'Generated response acknowledged. No request was replayed.';
            } catch (error) { report(error, 'request', ticket); }
            finally { finish(); }
        }
        projects.subscribe(snapshot => {
            if (identity(snapshot) !== identity(selected)) {
                generation++; stoppedProof = null; state = null; lastState = null; if (connected) message = ''; response.replaceChildren();
                selected = snapshot;
                installOperations(matches() ? owned.operations : []);
            }
            selected = snapshot; render();
        });
        // The published metadata subscription intentionally excludes operation
        // state. Observe its existing busy/dialog signals without changing that
        // bridge or gating known-session Stop. Direct checks above also protect
        // confirmation before the observer's microtask has run.
        projectObserver = new MutationObserver(records => {
            projectActivity(records); render();
        });
        if (projectArea) projectObserver.observe(projectArea, { attributes: true, attributeFilter: ['aria-busy'], attributeOldValue: true });
        if (projectDialog) projectObserver.observe(projectDialog, { attributes: true, attributeFilter: ['open'], attributeOldValue: true });
        window.addEventListener('offline', () => {
            generation++; stoppedProof = null; connected = false;
            lastState = state || lastState; state = null;
            if (owned) owned.verified = false;
            message = 'The browser connection was lost. Reconnect Persistent API explicitly, then Refresh Status. The known session reference is retained.';
            render();
        });
        // Connecting, inspection and every mutation require explicit controls.
    }
    return Object.freeze({ start });
})();
