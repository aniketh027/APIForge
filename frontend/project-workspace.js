/* M2C: same-origin HTTP client and in-memory project workspace. No persistence on load. */
'use strict';
window.APIForgeProjects = (() => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const HASH = /^[0-9a-f]{64}$/;
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    // Fixed safe UI text. Never render arbitrary server exception/message fields.
    const ERRORS = Object.freeze({
        PROJECT_API_DISABLED: 'Saved projects require starting the server with APIFORGE_PROJECT_API=1. The editor and compiler remain available.',
        PROJECT_API_TOKEN_INVALID: 'The project session expired. Reconnect Project API, then choose your action again. No save was replayed.',
        PROJECT_API_NOT_LOCAL: 'Saved projects require a direct local loopback connection.',
        PROJECT_API_ORIGIN_REFUSED: 'The browser origin was refused by the Project API.',
        PROJECT_API_REQUEST_INVALID: 'The project request was refused.',
        PROJECT_API_JSON_INVALID: 'The project request could not be read as UTF-8 JSON.',
        PROJECT_API_BODY_TOO_LARGE: 'The project request exceeds the permitted size.',
        PROJECT_API_MEDIA_UNSUPPORTED: 'The Project API requires UTF-8 JSON.',
        PROJECT_API_ENDPOINT_NOT_FOUND: 'The project endpoint is unavailable.',
        PROJECT_API_STOPPING: 'The Project API is shutting down. Reconnect after it restarts.',
        PROJECT_STORE_MISSING: 'Saved-project storage is missing. For first use, choose Initialize Storage explicitly. Established missing storage needs manual resolution.',
        PROJECT_STORE_EXISTS: 'Storage already exists. Initialization cannot adopt or replace it. Use Open to inspect an existing valid store.',
        PROJECT_STORE_RUNTIME_UNSUPPORTED: 'Saved-project storage requires a supported Node 24.14.0+ SQLite runtime.',
        PROJECT_STORE_PLATFORM_UNSUPPORTED: 'Saved-project storage requires Windows x64 and its private local storage bootstrap.',
        PROJECT_STORE_BUSY: 'Saved-project storage is busy. You may choose Save again with the same acknowledged revision.',
        PROJECT_STORE_UNSAFE: 'Storage admission was refused. Manual resolution is required; no repair was attempted.',
        PROJECT_STORE_IDENTITY_MISMATCH: 'Storage identity changed. Manual resolution is required.',
        PROJECT_STORE_INCOMPATIBLE: 'The saved-project format is incompatible. Manual resolution is required.',
        PROJECT_STORE_CORRUPT: 'Saved-project storage is inconsistent. Manual resolution is required.',
        PROJECT_STORE_RECOVERY_REQUIRED: 'Storage is incomplete or unexpected. Manual resolution is required.',
        PROJECT_STORE_CLOSED: 'Saved-project storage is closed. Reconnect and inspect it.',
        PROJECT_STORE_STORAGE_FAILURE: 'The project storage operation failed. Your local draft is preserved.',
        PROJECT_REVISION_CONFLICT: 'Another editor saved a newer revision. Your draft and acknowledged revision are preserved. Inspect the saved version before saving again.',
        PROJECT_REVISION_LIMIT: 'The project has reached its revision limit.',
        PROJECT_COMMIT_UNCERTAIN: 'The commit may have succeeded; reopen and inspect the committed revision before retrying.',
        PROJECT_NOT_FOUND: 'The saved project or revision was not found. Your workspace is preserved.',
        PROJECT_INVALID_INPUT: 'The Project Store refused the project arguments.',
        PROJECT_INVALID_ID: 'The Project API refused the project identifier.',
        PROJECT_INVALID_NAME: 'Enter a nonempty name of at most 128 Unicode characters and 512 UTF-8 bytes, without control or format characters.',
        PROJECT_INVALID_TARGET: 'The Project Store accepts only MySQL or PostgreSQL targets.',
        PROJECT_INVALID_SOURCE: 'The source must be valid UTF-8 and at most 1 MiB. Incomplete DSL and empty source are allowed.',
        PROJECT_INVALID_REVISION: 'The Project Store refused the committed revision.',
        PROJECT_CLIENT_NETWORK: 'The Project API connection was lost.',
        PROJECT_CLIENT_SERVER_ERROR: 'The Project API reported an unknown server error. Your local draft is preserved.',
        PROJECT_CLIENT_RESPONSE_INVALID: 'The Project API returned an unexpected response.'
    });
    function failure(code, possibleCommit = false) {
        const error = new Error(ERRORS[code]);
        error.code = code; error.possibleCommit = possibleCommit;
        return error;
    }
    function keys(value, expected) {
        return value !== null && typeof value === 'object' && !Array.isArray(value) &&
            Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
    }
    function record(value, withSource = true) {
        const fields = ['id', 'name', 'target', 'revision', 'sourceHash', 'createdAt', 'updatedAt'];
        if (withSource) fields.push('source');
        return keys(value, fields) && UUID.test(value.id) && typeof value.name === 'string' &&
            ['mysql', 'postgres'].includes(value.target) && Number.isSafeInteger(value.revision) && value.revision > 0 &&
            HASH.test(value.sourceHash) && ISO.test(value.createdAt) && ISO.test(value.updatedAt) &&
            (!withSource || typeof value.source === 'string');
    }
    function client() {
        let token = null, pendingSession = null;
        async function request(path, method, body, validate, expectedStatus, session = false) {
            const mutation = method !== 'GET';
            const headers = mutation ? { 'Content-Type': 'application/json' } : {};
            if (!session) headers['X-APIForge-Project-Token'] = await getSession();
            const controller = new AbortController();
            const deadline = setTimeout(() => controller.abort(), 45000);
            try {
                let response, envelope;
                try {
                    response = await fetch('/api/projects' + path, {
                        method, headers, credentials: 'omit', mode: 'same-origin', cache: 'no-store',
                        signal: controller.signal, ...(mutation ? { body: JSON.stringify(body) } : {})
                    });
                } catch { throw failure('PROJECT_CLIENT_NETWORK', mutation); }
                try { envelope = await response.json(); }
                catch { throw failure('PROJECT_CLIENT_RESPONSE_INVALID', mutation); }
                if (keys(envelope, ['success', 'error']) && envelope.success === false &&
                    keys(envelope.error, ['code', 'message']) && typeof envelope.error.message === 'string' && typeof envelope.error.code === 'string' &&
                    !response.ok) {
                    if (!Object.hasOwn(ERRORS, envelope.error.code) || envelope.error.code.startsWith('PROJECT_CLIENT_')) {
                        throw failure('PROJECT_CLIENT_SERVER_ERROR', mutation);
                    }
                    if (envelope.error.code === 'PROJECT_API_TOKEN_INVALID') token = null;
                    throw failure(envelope.error.code);
                }
                if (response.status !== expectedStatus || !keys(envelope, ['success', 'data']) ||
                    envelope.success !== true || !validate(envelope.data)) {
                    throw failure('PROJECT_CLIENT_RESPONSE_INVALID', mutation);
                }
                return envelope.data;
            } finally { clearTimeout(deadline); }
        }
        async function getSession() {
            if (token) return token;
            if (!pendingSession) pendingSession = request('/session', 'GET', undefined,
                data => keys(data, ['token', 'tokenHeader']) && typeof data.token === 'string' && HASH.test(data.token) &&
                    data.tokenHeader === 'x-apiforge-project-token', 200, true)
                .then(data => { token = data.token; return token; }).finally(() => { pendingSession = null; });
            return pendingSession;
        }
        return {
            reconnect() { token = null; return getSession(); },
            initialize: () => request('/initialize', 'POST', {}, data => keys(data, ['storeId']) && UUID.test(data.storeId), 201),
            list: () => request('', 'GET', undefined, data => Array.isArray(data) && data.every(item => record(item, false)), 200),
            get: id => request('/' + id, 'GET', undefined, data => record(data) && data.id === id, 200),
            create: snapshot => request('', 'POST', snapshot, data => record(data) && data.revision === 1 && same(data, snapshot), 201),
            save: (id, revision, changes, snapshot) => request('/' + id, 'PUT', { expectedRevision: revision, changes },
                data => record(data) && data.id === id && data.revision === revision + 1 && same(data, snapshot), 200)
        };
    }
    const same = (a, b) => a.name === b.name && a.target === b.target && a.source === b.source;
    const snapshotOf = value => ({ name: value.name, target: value.target, source: value.source });
    const displaySource = source => source.replace(/\r\n?/g, '\n');

    function start({ editor, workspaceName, getTarget, restore }) {
        const element = id => document.getElementById(id);
        const name = element('project-name'), area = element('project-workspace');
        const dialog = element('project-dialog'), list = element('project-list');
        const api = client();
        let id = null, revision = null, saved = null, sourceAnchor = '';
        let generation = 0, editVersion = 0, operation = null, active = false;
        let issue = null, notice = '', noticeError = false, tokenInvalid = false, preview = null, opener = null;
        function current() {
            // Textareas render CR/CRLF as LF. Retain the exact saved string when
            // the displayed source matches it, including after an exact revert.
            const source = saved && editor.value === displaySource(saved.source) ? saved.source
                : editor.value === displaySource(sourceAnchor) ? sourceAnchor : editor.value;
            return { name: name.value, target: getTarget(), source };
        }
        function unsaved() {
            const value = current();
            return saved ? !same(value, saved) : value.name !== '' || value.source !== '' || value.target !== 'mysql';
        }
        function render() {
            const locked = ['save', 'initialize', 'reconnect'].includes(operation?.kind);
            element('project-new').disabled = element('project-open').disabled = locked;
            element('project-save').disabled = !!operation || !!issue || tokenInvalid;
            for (const control of ['project-initialize', 'project-reconnect', 'project-inspect']) element(control).disabled = !!operation;
            list.querySelectorAll('button').forEach(button => { button.disabled = !!operation; });
            area.dataset.projectId = id || '';
            area.setAttribute('aria-busy', String(!!operation));
            const status = element('project-status');
            const state = operation?.kind === 'save' ? 'saving' : issue || (saved ? unsaved() ? 'unsaved' : 'saved' : 'draft');
            status.dataset.state = state;
            status.textContent = { saving: 'Saving…', conflict: 'Conflict · local draft preserved', uncertain: 'Save unconfirmed',
                unsaved: 'Unsaved changes', saved: 'Saved', draft: 'Not saved' }[state];
            element('project-revision').textContent = revision === null ? 'No committed revision' : 'Revision ' + revision;
            element('project-notice').hidden = !notice;
            element('project-message').textContent = notice;
            element('project-message').setAttribute('role', noticeError ? 'alert' : 'status');
            element('project-notice').classList.toggle('project-error', noticeError);
            element('project-inspect').hidden = element('project-keep').hidden = !issue;
            element('project-inspect').textContent = id ? 'Inspect latest saved version' : 'Inspect saved projects';
            workspaceName.textContent = active || name.value ? name.value || 'Untitled project'
                : editor.value ? 'Modified source' : 'Untitled source';
        }
        function tell(message, error = false) { notice = message; noticeError = error; render(); }
        function changed() {
            editVersion++;
            if (!noticeError) notice = '';
            render();
        }
        function begin(kind) {
            const ticket = ++generation;
            operation = { kind, ticket }; render(); return ticket;
        }
        const valid = ticket => generation === ticket;
        function finish(ticket) { if (valid(ticket)) { operation = null; render(); } }
        function report(error, kind) {
            tokenInvalid = error.code === 'PROJECT_API_TOKEN_INVALID' || tokenInvalid;
            if (kind === 'save') {
                if (error.code === 'PROJECT_REVISION_CONFLICT') issue = 'conflict';
                if (error.code === 'PROJECT_COMMIT_UNCERTAIN' || error.possibleCommit) issue = 'uncertain';
            }
            let message = error.code + ': ' + error.message;
            if (issue === 'uncertain') message += ' Your local draft is preserved. Inspect saved projects before retrying.' +
                (!id ? ' The first save may have created a project whose UUID was not acknowledged. Creating another draft may duplicate it.' : '');
            if (kind === 'initialize' && error.possibleCommit) message += ' Storage may have been created. Use Open to inspect it before another initialization attempt.';
            if (error.code === 'PROJECT_STORE_MISSING' || tokenInvalid) element('project-storage').open = true;
            tell(message, true);
        }
        function confirmDiscard() {
            return (!unsaved() && !issue) || window.confirm('Discard the current unsaved project changes and replace this workspace? Your local draft will be lost.');
        }
        function closeDialog() { if (dialog.open) dialog.close(); }
        function install(value) {
            id = value?.id || null; revision = value?.revision || null;
            saved = value ? snapshotOf(value) : null; sourceAnchor = value?.source || '';
            active = true; issue = null; notice = ''; noticeError = false;
            name.value = value?.name || '';
            restore(sourceAnchor, value?.target || 'mysql');
            render();
        }
        function newProject() {
            if (['save', 'initialize', 'reconnect'].includes(operation?.kind) || !confirmDiscard()) return;
            ++generation; operation = null; closeDialog(); install(null); name.focus();
        }
        async function saveProject() {
            if (operation || issue || tokenInvalid) return;
            const submitted = current(), acknowledgedId = id, acknowledgedRevision = revision;
            const changes = {};
            if (saved) for (const field of ['name', 'target', 'source']) if (submitted[field] !== saved[field]) changes[field] = submitted[field];
            if (saved && !Object.keys(changes).length) { tell('Already saved at revision ' + revision + '.'); return; }
            const ticket = begin('save');
            try {
                const result = acknowledgedId ? await api.save(acknowledgedId, acknowledgedRevision, changes, submitted) : await api.create(submitted);
                if (!valid(ticket)) return;
                id = result.id; revision = result.revision; saved = submitted; sourceAnchor = submitted.source; active = true;
                tell('Saved revision ' + revision + (unsaved() ? '. Newer local edits remain unsaved.' : '.'));
            } catch (error) { if (valid(ticket)) report(error, 'save'); }
            finally { finish(ticket); }
        }
        function showDialog(title, description) {
            opener = document.activeElement;
            element('project-dialog-title').textContent = title;
            element('project-dialog-description').textContent = description;
            element('project-dialog-status').textContent = 'Loading…';
            list.replaceChildren(); preview = null; element('project-preview').hidden = true;
            if (!dialog.open) dialog.showModal();
        }
        async function loadProject(projectId, inspect = false) {
            if (!inspect && !confirmDiscard()) return;
            const ticket = begin('load'), version = editVersion;
            element('project-dialog-status').textContent = 'Loading saved version…';
            try {
                const result = await api.get(projectId);
                if (!valid(ticket)) return;
                if (version !== editVersion) {
                    tell('Workspace changed while loading. Select the project again to open it.', true);
                    element('project-dialog-status').textContent = notice; return;
                }
                if (inspect) {
                    preview = result; list.replaceChildren();
                    element('project-preview-meta').textContent = result.name + ' · ' + (result.target === 'mysql' ? 'MySQL' : 'PostgreSQL') + ' · Revision ' + result.revision;
                    element('project-preview-source').textContent = result.source;
                    element('project-preview').hidden = false;
                    element('project-dialog-status').textContent = 'Your local draft is unchanged. Load this saved version only if you want to replace it.';
                    element('project-load-snapshot').focus();
                } else {
                    install(result); finish(ticket); closeDialog(); tell('Opened saved revision ' + revision + '.');
                }
            } catch (error) {
                if (valid(ticket)) { report(error, 'load'); element('project-dialog-status').textContent = notice; }
            } finally { finish(ticket); }
        }
        async function openProjects() {
            if (['save', 'initialize', 'reconnect'].includes(operation?.kind)) return;
            showDialog('Open project', 'Saved projects are listed in UUID order. Select one to open it. Unsaved edits require confirmation before replacement.');
            const ticket = begin('list');
            try {
                const summaries = await api.list();
                if (!valid(ticket)) return;
                element('project-dialog-status').textContent = summaries.length ? 'Select a saved project.' : 'No saved projects yet. Create a draft with New, then choose Save.';
                for (const summary of summaries) {
                    const row = document.createElement('div'); row.setAttribute('role', 'listitem');
                    const button = document.createElement('button'); button.type = 'button'; button.className = 'project-choice';
                    const title = document.createElement('strong'); title.textContent = summary.name;
                    const meta = document.createElement('span'); meta.textContent = (summary.target === 'mysql' ? 'MySQL' : 'PostgreSQL') + ' · Revision ' + summary.revision + ' · ' + summary.id;
                    button.append(title, meta); button.dataset.projectId = summary.id;
                    button.addEventListener('click', () => { if (!operation) loadProject(summary.id); });
                    row.append(button); list.append(row);
                }
            } catch (error) {
                if (valid(ticket)) { report(error, 'list'); element('project-dialog-status').textContent = notice; }
            } finally { finish(ticket); }
        }
        function inspectSaved() {
            if (operation) return;
            if (!id) { openProjects(); return; }
            showDialog('Inspect saved version', 'Read the current saved revision before choosing whether to replace your local draft.');
            loadProject(id, true);
        }
        async function initialize() {
            if (operation || !window.confirm('Initialize Storage creates the private local saved-project store. Existing storage is never replaced or repaired. Continue?')) return;
            const ticket = begin('initialize');
            try { await api.initialize(); if (valid(ticket)) tell('Storage initialized. Choose Save explicitly when your draft is ready.'); }
            catch (error) { if (valid(ticket)) report(error, 'initialize'); }
            finally { finish(ticket); }
        }
        async function reconnect() {
            if (operation) return;
            const ticket = begin('reconnect');
            try {
                await api.reconnect();
                if (valid(ticket)) { tokenInvalid = false; tell('Project API reconnected. No mutation was replayed.' + (issue ? ' Inspect the saved version before saving again.' : ' Choose Open or Save explicitly.')); }
            } catch (error) { if (valid(ticket)) report(error, 'reconnect'); }
            finally { finish(ticket); }
        }
        element('project-new').addEventListener('click', newProject);
        element('project-open').addEventListener('click', openProjects);
        element('project-save').addEventListener('click', saveProject);
        element('project-initialize').addEventListener('click', initialize);
        element('project-reconnect').addEventListener('click', reconnect);
        element('project-inspect').addEventListener('click', inspectSaved);
        element('project-keep').addEventListener('click', () => editor.focus());
        element('project-dialog-close').addEventListener('click', closeDialog);
        element('project-load-snapshot').addEventListener('click', () => {
            if (!preview || !confirmDiscard()) return;
            ++generation; operation = null; install(preview); closeDialog(); tell('Loaded saved revision ' + revision + '.');
        });
        dialog.addEventListener('close', () => {
            if (['list', 'load'].includes(operation?.kind)) { ++generation; operation = null; }
            preview = null; render();
            if (opener?.isConnected && !opener.disabled) opener.focus();
        });
        dialog.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const controls = [...dialog.querySelectorAll('button:not([disabled]), [tabindex="0"]')]
                .filter(control => control.getClientRects().length);
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        name.addEventListener('input', changed);
        window.addEventListener('beforeunload', event => {
            if (!unsaved() && !issue) return;
            event.preventDefault(); event.returnValue = '';
        });
        render();
        return { changed, canClear: () => (!active && !name.value) || !unsaved() ||
            window.confirm('Clear the source and discard its unsaved edits? The project identity and committed revision are kept.') };
    }
    return { start };
})();
