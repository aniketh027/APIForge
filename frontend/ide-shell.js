/* One application, four views. Navigation and appearance never call a backend. */
'use strict';
window.APIForgeIDE = (() => {
    const byId = id => document.getElementById(id);
    let views, current = 'editor';
    function navigate(name, focus = false) {
        if (!views?.[name]) return;
        current = name;
        for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
        document.querySelectorAll('[data-workspace]').forEach(button => {
            button.setAttribute('aria-current', button.dataset.workspace === name ? 'page' : 'false');
        });
        byId('ide-workspace-label').textContent = { editor: 'DSL Editor', inspector: 'Compiler Inspector', projects: 'Saved Projects', persistent: 'Persistent API' }[name];
        if (name === 'persistent') byId('persistent-workspace').open = true;
        if (focus) views[name].querySelector('h2, summary')?.focus({ preventScroll: true });
        APIForgeEditor.settings();
    }
    function openProjectList() {
        navigate('projects');
        byId('project-dialog').showModal();
    }
    function start() {
        document.documentElement.classList.add('ide-enabled');
        const shell = document.querySelector('.app-shell'), workbench = document.querySelector('.workbench');
        const sidebar = document.createElement('nav'); sidebar.className = 'ide-sidebar'; sidebar.setAttribute('aria-label', 'Workspaces');
        sidebar.innerHTML = `<div class="ide-sidebar-title">WORKSPACE <button id="ide-collapse" title="Collapse sidebar" aria-label="Collapse sidebar" aria-expanded="true">☰</button></div>
            <button data-workspace="editor" title="DSL Editor"><span aria-hidden="true">⌘</span><span class="nav-label">DSL Editor</span></button>
            <button data-workspace="inspector" title="Compiler Inspector"><span aria-hidden="true">▤</span><span class="nav-label">Compiler Inspector</span></button>
            <button data-workspace="projects" title="Saved Projects"><span aria-hidden="true">▱</span><span class="nav-label">Saved Projects</span></button>
            <button data-workspace="persistent" title="Persistent API"><span aria-hidden="true">◉</span><span class="nav-label">Persistent API</span></button>
            <div class="ide-sidebar-foot"><span class="ide-sidebar-note">SIX PHASES. ONE SOURCE.</span><button id="ide-settings" title="Settings"><span aria-hidden="true">⚙</span><span class="nav-label">Settings</span></button></div>`;
        workbench.before(sidebar);
        const projects = document.createElement('section'); projects.id = 'ide-projects'; projects.className = 'ide-workspace';
        projects.innerHTML = `<div class="inspector-heading"><div><h2 tabindex="-1">Saved Projects</h2><p class="panel-meta">Local drafts and acknowledged revisions</p></div><span class="ide-chip">LOCAL STORAGE</span></div><div id="ide-project-split"><div id="ide-project-left"></div><div id="ide-project-detail"><p class="ide-eyebrow">CURRENT WORKSPACE</p><h3 id="ide-project-title">Untitled project</h3><p id="ide-project-meta"></p><p id="ide-project-id"></p><p>Open explicitly lists saved projects. Opening a saved version preserves your draft until you confirm replacement.</p><h4>Source preview <span class="panel-meta">current local draft</span></h4><pre id="ide-project-source" tabindex="0"></pre></div></div>`;
        workbench.append(projects);
        byId('ide-project-left').append(byId('project-workspace')); // Open remains a native modal in the top layer.
        const persistent = byId('persistent-workspace'); workbench.append(persistent);
        views = { editor: document.querySelector('.editor-panel'), inspector: document.querySelector('.output-panel'), projects, persistent };
        for (const view of Object.values(views)) {
            view.classList.add('ide-workspace');
            view.querySelector('h2, summary')?.setAttribute('tabindex', '-1');
        }
        const header = document.querySelector('.app-header');
        const identity = document.createElement('div'); identity.className = 'ide-identity';
        identity.innerHTML = '<strong id="ide-project-name">Untitled project</strong><span id="ide-save-state">Not saved</span>';
        header.insertBefore(identity, byId('header-status'));
        const actions = document.createElement('div'); actions.className = 'ide-header-actions';
        actions.innerHTML = '<button id="ide-save" class="btn" type="button" title="Save project">Save</button>';
        actions.prepend(document.querySelector('.target-control')); actions.append(byId('compile-btn')); header.append(actions);
        const fileHeader = document.querySelector('.editor-header');
        fileHeader.append(byId('clear-btn'));
        document.querySelector('.editor-toolbar').remove();
        const editorArea = document.createElement('div'); editorArea.id = 'ide-editor-split';
        const sourceArea = document.querySelector('.editor-wrapper'); sourceArea.before(editorArea); editorArea.append(sourceArea);
        const diagnostics = document.createElement('section'); diagnostics.id = 'ide-diagnostics';
        diagnostics.innerHTML = '<div class="ide-diagnostics-heading"><strong>COMPILATION</strong><button id="ide-diagnostics-toggle" class="btn btn-quiet" aria-expanded="true">Collapse</button><button id="ide-inspect" class="btn btn-quiet">Open Compiler Inspector →</button></div><div id="ide-diagnostic-detail"></div>';
        editorArea.append(diagnostics); diagnostics.append(document.querySelector('.pipeline'));
        const footer = document.createElement('footer'); footer.className = 'ide-statusbar';
        footer.innerHTML = '<span id="ide-workspace-label">DSL Editor</span><span id="ide-editor-mode">APIForge DSL · UTF-8</span><span id="ide-cursor">Ln 1, Col 1</span>';
        shell.append(footer);
        // Put summary ahead of tabs without changing its identity or its render contract.
        document.querySelector('.tab-bar').before(byId('compilation-summary'));
        APIForgeSplits.attach(editorArea, sourceArea, diagnostics, { key: 'Editor and diagnostics', vertical: true, initial: 78, minimum: 100 });
        APIForgeSplits.attach(byId('ide-project-split'), byId('ide-project-left'), byId('ide-project-detail'), { key: 'Projects and preview', initial: 38, minimum: 220 });
        sidebar.querySelectorAll('[data-workspace]').forEach(button => {
            button.setAttribute('aria-label', button.title);
            button.addEventListener('click', () => navigate(button.dataset.workspace, true));
        });
        byId('ide-collapse').addEventListener('click', () => {
            const collapsed = shell.classList.toggle('sidebar-collapsed');
            byId('ide-collapse').setAttribute('aria-expanded', String(!collapsed));
            byId('ide-collapse').setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        });
        byId('ide-inspect').addEventListener('click', () => navigate('inspector', true));
        byId('ide-diagnostics-toggle').addEventListener('click', () => {
            const collapsed = editorArea.classList.toggle('diagnostics-collapsed');
            byId('ide-diagnostics-toggle').textContent = collapsed ? 'Expand' : 'Collapse';
            byId('ide-diagnostics-toggle').setAttribute('aria-expanded', String(!collapsed));
        });
        settings(); saveDialog();
        const sync = () => {
            byId('ide-project-name').textContent = byId('project-name').value || 'Untitled project';
            byId('ide-save-state').textContent = byId('project-status').textContent;
            byId('ide-save-state').dataset.state = byId('project-status').dataset.state;
            byId('ide-save').disabled = byId('project-save').disabled;
            byId('ide-project-title').textContent = byId('ide-project-name').textContent;
            byId('ide-project-meta').textContent = document.querySelector('.target-option[aria-pressed="true"]').textContent + ' · ' + byId('project-revision').textContent + ' · ' + byId('project-status').textContent;
            byId('ide-project-id').textContent = byId('project-workspace').dataset.projectId || 'This draft has no saved identity yet.';
            const preview = byId('dsl-editor').value;
            byId('ide-project-source').textContent = preview ? preview.slice(0, 20000) + (preview.length > 20000 ? '\n… Preview truncated. Full source remains in the editor.' : '') : 'No source yet.';
            byId('ide-diagnostic-detail').textContent = byId('error-panel').classList.contains('visible') ? byId('error-panel').textContent.trim().replace(/\s+/g, ' ').slice(0, 600) : byId('pipeline-state').textContent;
        };
        new MutationObserver(sync).observe(byId('project-workspace'), { childList: true, subtree: true, attributes: true });
        new MutationObserver(sync).observe(byId('pipeline-state'), { childList: true, subtree: true });
        new MutationObserver(sync).observe(byId('error-panel'), { childList: true, subtree: true, attributes: true });
        byId('dsl-editor').addEventListener('input', sync);
        byId('project-name').addEventListener('input', sync);
        const enhanceFiles = () => {
            const pane = byId('output-api');
            if (!pane.querySelector('.api-file') || pane.querySelector('.ide-file-list')) return;
            const files = [...pane.children], list = document.createElement('div'), viewer = document.createElement('div');
            list.className = 'ide-file-list'; viewer.className = 'ide-file-viewer';
            list.setAttribute('aria-label', 'Generated file explorer');
            for (const file of files) {
                const header = file.querySelector('.api-file-header'); if (!header) continue;
                const button = document.createElement('button'); button.type = 'button'; button.textContent = header.querySelector('span').textContent;
                button.addEventListener('click', () => {
                    if (header.getAttribute('aria-expanded') !== 'true') header.click();
                    file.scrollIntoView({ block: 'start' });
                    list.querySelectorAll('button').forEach(item => item.classList.toggle('selected', item === button));
                });
                list.append(button); viewer.append(file);
            }
            const split = document.createElement('div'); split.className = 'ide-files'; split.append(list, viewer); pane.append(split);
            APIForgeSplits.attach(split, list, viewer, { key: 'Generated files and code', initial: 25, minimum: 150 });
        };
        new MutationObserver(enhanceFiles).observe(byId('output-api'), { childList: true });
        runtimePanels(byId('persistent-builder'), byId('persistent-response'), 'Persistent request and response');
        new MutationObserver(() => {
            const builder = byId('live-body-control')?.parentElement;
            if (builder && !builder.querySelector('.ide-request-response')) runtimePanels(builder, byId('live-response'), 'Live request and response');
        }).observe(byId('output-live-api'), { childList: true });
        APIForgeEditor.start(); sync(); navigate('editor');
    }
    function runtimePanels(builder, response, key) {
        if (!builder || !response) return;
        const split = document.createElement('div'), request = document.createElement('div'), result = document.createElement('section');
        split.className = 'ide-request-response'; request.className = 'ide-request-controls';
        const heading = document.createElement('h4'); heading.textContent = 'HTTP RESPONSE'; result.append(heading);
        if (builder.contains(response)) {
            [...builder.children].filter(node => node !== response).forEach(node => request.append(node));
            builder.append(split);
        } else {
            builder.before(split); request.append(builder);
        }
        result.append(response); split.append(request, result);
        APIForgeSplits.attach(split, request, result, { key, vertical: true, initial: 55, minimum: 100 });
        if (key.startsWith('Persistent')) {
            const visibility = () => { split.hidden = builder.hidden && response.childNodes.length === 0; };
            new MutationObserver(visibility).observe(builder, { attributes: true, attributeFilter: ['hidden'] });
            new MutationObserver(visibility).observe(response, { childList: true }); visibility();
        }
    }
    function endpoints(files) {
        let paths;
        try { paths = JSON.parse(files.find(file => file.path === 'swagger.json').content).paths; } catch { return; }
        const list = byId('output-endpoints').querySelector('.endpoint-list'); if (!list) return;
        const split = document.createElement('div'), detail = document.createElement('section');
        split.className = 'ide-endpoints'; detail.className = 'ide-endpoint-detail'; detail.setAttribute('aria-label', 'Endpoint details'); detail.tabIndex = 0;
        list.before(split); split.append(list, detail);
        function select(row) {
            list.querySelectorAll('.endpoint-row').forEach(item => item.querySelector('button').setAttribute('aria-pressed', String(item === row)));
            const method = row.querySelector('.endpoint-method').textContent, route = row.querySelector('.endpoint-path').textContent;
            const operation = paths?.[route]?.[method.toLowerCase()];
            detail.replaceChildren();
            const heading = document.createElement('h3'); heading.textContent = method + ' ' + route; detail.append(heading);
            const description = document.createElement('p'); description.textContent = operation?.summary || 'Generated operation'; detail.append(description);
            const label = document.createElement('h4'); label.textContent = 'Parameters and request'; detail.append(label);
            const pre = document.createElement('pre'); pre.textContent = JSON.stringify({ parameters: operation?.parameters || [], ...(operation?.requestBody ? { requestBody: operation.requestBody } : {}), responses: operation?.responses || {} }, null, 2); detail.append(pre);
        }
        for (const row of list.querySelectorAll('.endpoint-row')) {
            // Keep the published list/listitem semantics and give the action its own native button.
            const button = document.createElement('button'); button.type = 'button'; button.className = 'ide-endpoint-select';
            button.append(...row.childNodes); row.append(button);
            button.addEventListener('click', () => select(row));
        }
        APIForgeSplits.attach(split, list, detail, { key: 'Endpoints and details', initial: 42, minimum: 200 });
        select(list.firstElementChild);
    }
    function modal(id, opener) {
        const dialog = byId(id);
        opener.addEventListener('click', () => dialog.showModal());
        dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => {
            if (dialog.open) return;
            // Native modal close restores focus synchronously. Do not steal a newer
            // keyboard destination when the queued close event is delivered.
            if ((document.activeElement === document.body || dialog.contains(document.activeElement)) && !opener.disabled) opener.focus();
        });
        return dialog;
    }
    function settings() {
        modal('ide-settings-dialog', byId('ide-settings'));
        const font = byId('ide-font'), wrap = byId('ide-wrap'), numbers = byId('ide-numbers'), theme = byId('ide-theme');
        function apply() {
            const root = document.documentElement;
            root.style.setProperty('--editor-font-size', font.value + 'px');
            root.style.setProperty('--editor-line-height', Number(font.value) * 1.65 + 'px');
            root.dataset.wrap = wrap.checked ? 'on' : 'off'; root.dataset.lineNumbers = numbers.checked ? 'on' : 'off'; root.dataset.theme = theme.value;
            byId('dsl-editor').wrap = wrap.checked ? 'soft' : 'off';
            byId('ide-font-value').textContent = font.value + ' px'; APIForgeEditor.settings();
        }
        [font, wrap, numbers, theme].forEach(control => control.addEventListener('input', apply));
        byId('ide-reset-panels').addEventListener('click', () => {
            APIForgeSplits.reset(); byId('ide-editor-split').classList.remove('diagnostics-collapsed');
            byId('ide-diagnostics-toggle').textContent = 'Collapse'; byId('ide-diagnostics-toggle').setAttribute('aria-expanded', 'true');
        });
        byId('ide-reset-all').addEventListener('click', () => {
            font.value = '14'; wrap.checked = false; numbers.checked = true; theme.value = 'default';
            byId('ide-reset-panels').click(); document.querySelector('.app-shell').classList.remove('sidebar-collapsed');
            byId('ide-collapse').setAttribute('aria-expanded', 'true');
            byId('ide-collapse').setAttribute('aria-label', 'Collapse sidebar'); apply();
        });
        apply();
    }
    function saveDialog() {
        const dialog = modal('ide-save-dialog', byId('ide-save'));
        byId('ide-save').addEventListener('click', () => {
            byId('ide-save-name').value = byId('project-name').value;
            byId('ide-save-meta').textContent = document.querySelector('.target-option[aria-pressed="true"]').textContent + ' · ' + byId('project-status').textContent + ' · ' + byId('project-revision').textContent;
            byId('ide-save-name').focus();
        });
        byId('ide-save-form').addEventListener('submit', event => {
            event.preventDefault();
            if (byId('project-save').disabled) return;
            byId('project-name').value = byId('ide-save-name').value;
            byId('project-name').dispatchEvent(new Event('input', { bubbles: true }));
            // The original control retains its single handler and exact save protocol.
            byId('project-save').click(); dialog.close(); navigate('projects');
        });
    }
    return { start, navigate, openProjectList, endpoints, get current() { return current; } };
})();
