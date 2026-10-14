/* Vocabulary follows src/lexer/lexer.js, utils/data-types.js and parseModule's contextual IMPORT. */
'use strict';
window.APIForgeEditor = (() => {
    const types = new Set(['INT', 'STRING', 'FLOAT', 'BOOLEAN', 'ENUM', 'DATE', 'TIMESTAMP', 'UUID']);
    const modifiers = new Set(['PRIMARY', 'KEY', 'REQUIRED', 'UNIQUE', 'MIN', 'MAX', 'MIN_LENGTH', 'MAX_LENGTH', 'DEFAULT']);
    const relations = new Set(['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']);
    const escape = text => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    function color(line) {
        return line.replace(/\/\/[^\n]*|"[^"\n]*"?|[A-Za-z_][A-Za-z_0-9]*|-?\d+(?:\.\d+)?|[^A-Za-z_0-9"/\-]+|./g, (word, offset) => {
            let kind = '';
            if (word.startsWith('//')) kind = 'comment';
            else if (word.startsWith('"')) kind = 'string';
            else if (word === 'ENTITY' || word === 'RELATION' || (word === 'IMPORT' && /^\s*$/.test(line.slice(0, offset)) && /^\s+"/.test(line.slice(offset + word.length)))) kind = 'keyword';
            else if (types.has(word)) kind = 'type';
            else if (modifiers.has(word)) kind = 'modifier';
            else if (relations.has(word)) kind = 'relation';
            else if (/^(TRUE|FALSE)$/.test(word)) kind = 'boolean';
            else if (/^-?\d/.test(word)) kind = 'number';
            else if (/^[A-Za-z_]/.test(word)) kind = 'identifier';
            return kind ? `<span class="dsl-${kind}">${escape(word)}</span>` : escape(word);
        });
    }
    let editor, highlights, gutter, backdrop, errors = new Set(), frame = 0;
    let renderedSource = null, renderedErrors = '', activeLine = 0;
    function active() {
        if (!editor) return;
        const line = editor.value.slice(0, editor.selectionStart).split('\n').length;
        if (line !== activeLine) {
            highlights.children[activeLine - 1]?.classList.remove('active-line');
            highlights.children[line - 1]?.classList.add('active-line'); activeLine = line;
        }
        const status = document.getElementById('ide-cursor');
        if (status) status.textContent = `Ln ${line}, Col ${editor.selectionStart - editor.value.lastIndexOf('\n', editor.selectionStart - 1)}`;
    }
    function align() {
        if (!editor || !editor.clientWidth) return;
        // Match the textarea's content viewport, excluding both native scrollbars.
        backdrop.style.width = editor.clientWidth + 'px';
        backdrop.style.height = editor.clientHeight + 'px';
        gutter.style.height = editor.clientHeight + 'px';
        highlights.style.width = editor.clientWidth + 'px';
        const rows = [...highlights.children];
        const heights = rows.map(row => row.getBoundingClientRect().height);
        [...gutter.children].forEach((row, index) => { row.style.height = heights[index] + 'px'; });
        backdrop.scrollTop = editor.scrollTop; backdrop.scrollLeft = editor.scrollLeft; gutter.scrollTop = editor.scrollTop;
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(align); }
    function render(errorSet = errors) {
        if (!editor) return;
        errors = errorSet;
        const source = editor.value, errorKey = [...errors].join(',');
        if (source !== renderedSource || renderedErrors !== errorKey) {
            renderedSource = source; renderedErrors = errorKey;
            const lines = source.split('\n');
            const bounded = source.length <= 150000 && lines.length <= 4000;
            editor.classList.toggle('syntax-active', bounded);
            highlights.hidden = !bounded; gutter.hidden = !bounded || document.documentElement.dataset.lineNumbers === 'off';
            if (bounded) {
                highlights.innerHTML = lines.map((line, i) => `<div class="dsl-line${errors.has(i + 1) ? ' highlight-error' : ''}">${color(line) || '<br>'}</div>`).join('');
                gutter.innerHTML = lines.map((_, i) => `<div data-line="${i + 1}" class="${errors.has(i + 1) ? 'line-error' : ''}">${i + 1}</div>`).join('');
            } else { highlights.replaceChildren(); gutter.replaceChildren(); }
            document.getElementById('ide-editor-mode').textContent = bounded ? 'APIForge DSL · UTF-8' : 'Large source · plain text mode';
            activeLine = 0;
        }
        active(); schedule();
    }
    function start() {
        editor = document.getElementById('dsl-editor'); highlights = document.getElementById('editor-highlights');
        gutter = document.getElementById('line-numbers'); backdrop = document.getElementById('editor-backdrop');
        editor.addEventListener('input', () => render());
        editor.addEventListener('scroll', align);
        document.addEventListener('selectionchange', () => { if (document.activeElement === editor) active(); });
        new ResizeObserver(schedule).observe(editor);
        render();
    }
    function settings() { renderedSource = null; render(); }
    return { start, render, settings, color };
})();
