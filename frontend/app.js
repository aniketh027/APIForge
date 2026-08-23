/**
 * ============================================================
 * APIForge Frontend - Client-Side Application
 * ============================================================
 *
 * Vanilla JavaScript — no frameworks.
 * Communicates with POST /api/compile to run the compiler
 * pipeline and display results from every phase.
 *
 * Features:
 * - Line-accurate error highlighting (gutter & editor)
 * - Enhanced error cards with code excerpts and pointer arrows
 * - Dynamic compilation summary metrics
 * - Interactive clickable status bar phases
 * - Clean state management
 *
 * ============================================================
 */

// ── Constants ───────────────────────────────────────────────

const EXAMPLE_DSL = `ENTITY Student

id INT PRIMARY KEY
name STRING REQUIRED
email STRING UNIQUE
age INT
cgpa FLOAT`;

const PHASE_ORDER = ['lexer', 'parser', 'semantic', 'ir', 'optimizer', 'codegen'];

const TAB_IDS = [
    'tokens', 'ast', 'symboltable', 'ir',
    'optimized-ir', 'sql', 'api', 'swagger'
];

const PHASE_TAB_MAP = {
    lexer: 'tokens',
    parser: 'ast',
    semantic: 'symboltable',
    ir: 'ir',
    optimizer: 'optimized-ir',
    codegen: 'sql'
};

// ── DOM References ──────────────────────────────────────────

const editor           = document.getElementById('dsl-editor');
const lineNumbers      = document.getElementById('line-numbers');
const editorBackdrop   = document.getElementById('editor-backdrop');
const editorHighlights = document.getElementById('editor-highlights');
const compileBtn       = document.getElementById('compile-btn');
const clearBtn         = document.getElementById('clear-btn');
const exampleBtn       = document.getElementById('example-btn');
const downloadBtn      = document.getElementById('download-btn');
const downloadSection  = document.getElementById('download-section');
const errorPanel       = document.getElementById('error-panel');
const summaryPanel     = document.getElementById('compilation-summary');

// Set of line numbers with compiler errors (1-indexed)
const errorLines = new Set();

// Store last successful compilation for download
let lastCompileResult = null;

// ═════════════════════════════════════════════════════════════
// LINE NUMBERS & EDITOR HIGHLIGHTS (TASK 1 & TASK 6)
// ═════════════════════════════════════════════════════════════

function updateLineNumbers() {
    const lines = editor.value.split('\n');
    lineNumbers.innerHTML = lines.map((_, i) => {
        const lineNum = i + 1;
        const isError = errorLines.has(lineNum);
        const cls = isError ? 'line-error' : '';
        return `<div class="${cls}" data-line="${lineNum}">${lineNum}</div>`;
    }).join('');
}

function updateEditorHighlights() {
    if (!editorHighlights) return;
    const lines = editor.value.split('\n');
    editorHighlights.innerHTML = lines.map((_, i) => {
        const lineNum = i + 1;
        const isError = errorLines.has(lineNum);
        return `<div class="${isError ? 'highlight-error' : ''}"></div>`;
    }).join('');
}

function syncScroll() {
    lineNumbers.scrollTop = editor.scrollTop;
    if (editorBackdrop) {
        editorBackdrop.scrollTop = editor.scrollTop;
        editorBackdrop.scrollLeft = editor.scrollLeft;
    }
}

function clearErrorHighlights() {
    errorLines.clear();
    updateLineNumbers();
    updateEditorHighlights();
}

// ═════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═════════════════════════════════════════════════════════════

function switchTab(tabId) {
    // Deactivate all tabs and panes
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.output-pane').forEach(pane => pane.classList.remove('active'));

    // Activate selected
    const tabBtn = document.getElementById('tab-' + tabId);
    const pane = document.getElementById('output-' + tabId);
    if (tabBtn) tabBtn.classList.add('active');
    if (pane) pane.classList.add('active');
}

// ═════════════════════════════════════════════════════════════
// STATUS BAR & CLICKABLE PHASES (TASK 4 & TASK 5)
// ═════════════════════════════════════════════════════════════

function setPhaseStatus(phase, status) {
    const el = document.getElementById('status-' + phase);
    if (!el) return;
    const icon = el.querySelector('.status-icon');
    icon.className = 'status-icon ' + status;
    if (status === 'success') icon.textContent = '✓';
    else if (status === 'error') icon.textContent = '✗';
    else icon.textContent = '○';
}

function resetAllStatus() {
    PHASE_ORDER.forEach(phase => setPhaseStatus(phase, 'pending'));
}

function applyPhaseStatuses(phases, isSuccess, failingPhase) {
    if (!phases) return;

    if (isSuccess) {
        PHASE_ORDER.forEach(phase => setPhaseStatus(phase, 'success'));
        return;
    }

    // Determine the failing phase index
    let failedIndex = failingPhase ? PHASE_ORDER.indexOf(failingPhase) : -1;
    if (failedIndex === -1) {
        failedIndex = PHASE_ORDER.findIndex(p => phases[p] === false);
    }

    PHASE_ORDER.forEach((phase, idx) => {
        if (failedIndex === -1) {
            setPhaseStatus(phase, phases[phase] ? 'success' : 'error');
        } else if (idx < failedIndex) {
            setPhaseStatus(phase, 'success');
        } else {
            // Failing phase and all subsequent phases marked with ✗
            setPhaseStatus(phase, 'error');
        }
    });
}

function setupPhaseClickHandlers() {
    document.querySelectorAll('.status-item').forEach(item => {
        item.addEventListener('click', () => {
            const phase = item.getAttribute('data-phase');
            if (phase && PHASE_TAB_MAP[phase]) {
                switchTab(PHASE_TAB_MAP[phase]);
            }
            if (errorPanel.classList.contains('visible')) {
                errorPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    });
}

// ═════════════════════════════════════════════════════════════
// COMPILATION SUMMARY (TASK 3)
// ═════════════════════════════════════════════════════════════

function renderSummary(data) {
    if (!summaryPanel) return;

    const entitiesCount = (data.ast && Array.isArray(data.ast.entities))
        ? data.ast.entities.length
        : (data.symbolTable ? Object.keys(data.symbolTable).length : 0);

    let fieldsCount = 0;
    if (data.ast && Array.isArray(data.ast.entities)) {
        fieldsCount = data.ast.entities.reduce((sum, e) => sum + (e.fields ? e.fields.length : 0), 0);
    } else if (data.symbolTable) {
        Object.keys(data.symbolTable).forEach(eName => {
            if (data.symbolTable[eName].fields) {
                fieldsCount += Object.keys(data.symbolTable[eName].fields).length;
            }
        });
    }

    const optimizationsCount = (data.optimizations && Array.isArray(data.optimizations))
        ? data.optimizations.length
        : 0;

    const filesCount = (data.generatedFiles && Array.isArray(data.generatedFiles))
        ? data.generatedFiles.length
        : 0;

    summaryPanel.classList.add('visible');
    summaryPanel.innerHTML = `
        <div class="summary-header">
            <span class="summary-icon">✓</span>
            <span class="summary-title">Compilation Successful</span>
        </div>
        <div class="summary-grid">
            <div class="summary-item">
                <span class="summary-label">Entities:</span>
                <span class="summary-value">${entitiesCount}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Fields:</span>
                <span class="summary-value">${fieldsCount}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Optimizations:</span>
                <span class="summary-value">${optimizationsCount}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Files Generated:</span>
                <span class="summary-value">${filesCount}</span>
            </div>
        </div>
    `;
}

function hideSummary() {
    if (!summaryPanel) return;
    summaryPanel.classList.remove('visible');
    summaryPanel.innerHTML = '';
}

// ═════════════════════════════════════════════════════════════
// ENHANCED ERROR DISPLAY & HIGHLIGHTING (TASK 1 & TASK 2)
// ═════════════════════════════════════════════════════════════

function showError(phase, errors) {
    errorPanel.classList.add('visible');
    const phaseHeader = `${(phase || 'COMPILER').toUpperCase()} ERROR`;
    const sourceLines = editor.value.split('\n');

    // Register all error lines for highlighting
    errorLines.clear();

    const formattedErrors = (errors || []).map(err => {
        let line = err.line || null;
        let column = err.column || null;
        let message = err.message || String(err);

        // Extract line/column from message if not directly set
        if (!line) {
            const m = message.match(/line\s+(\d+)/i);
            if (m) line = parseInt(m[1], 10);
        }
        if (!column) {
            const m = message.match(/column\s+(\d+)/i);
            if (m) column = parseInt(m[1], 10);
        }

        if (line) {
            errorLines.add(line);
        }

        // Clean up message prefix if redundant
        let displayMessage = message;
        displayMessage = displayMessage.replace(/^Syntax Error at line \d+, column \d+:\s*/i, '');
        displayMessage = displayMessage.replace(/^Semantic Error:\s*/i, '');

        // Location text
        let locationText = '';
        if (line && column) {
            locationText = `Line ${line}, Column ${column}`;
        } else if (line) {
            locationText = `Line ${line}`;
        }

        // Source excerpt
        let excerptHtml = '';
        if (line && line >= 1 && line <= sourceLines.length) {
            const lineContent = sourceLines[line - 1];
            let pointerLine = '';

            if (column && column >= 1) {
                const colIdx = column - 1;
                let tokenLen = 1;

                // Try finding token in quotes (e.g. 'name' in Duplicate field 'name')
                const quoteMatch = displayMessage.match(/['"]([^'"]+)['"]/);
                if (quoteMatch && quoteMatch[1]) {
                    const token = quoteMatch[1];
                    const idxInLine = lineContent.indexOf(token);
                    if (idxInLine !== -1 && idxInLine <= colIdx) {
                        tokenLen = token.length;
                    }
                } else if (lineContent.length > colIdx) {
                    const remaining = lineContent.slice(colIdx);
                    const wordMatch = remaining.match(/^([a-zA-Z0-9_]+)/);
                    if (wordMatch) {
                        tokenLen = wordMatch[1].length;
                    }
                }

                pointerLine = ' '.repeat(Math.max(0, colIdx)) + '^'.repeat(Math.max(1, tokenLen));
            }

            excerptHtml = `
                <div class="error-excerpt">
                    <div class="error-source-line">${escapeHtml(lineContent)}</div>
                    ${pointerLine ? `<div class="error-pointer-line">${escapeHtml(pointerLine)}</div>` : ''}
                </div>
            `;
        }

        return `
            <div class="error-card">
                <div class="error-phase-title">${escapeHtml(phaseHeader)}</div>
                ${locationText ? `<div class="error-location">${escapeHtml(locationText)}</div>` : ''}
                ${excerptHtml}
                <div class="error-message-text">${escapeHtml(displayMessage)}</div>
            </div>
        `;
    }).join('');

    errorPanel.innerHTML = formattedErrors;

    // Apply visual highlights to editor and line numbers
    updateLineNumbers();
    updateEditorHighlights();
}

function hideError() {
    errorPanel.classList.remove('visible');
    errorPanel.innerHTML = '';
    clearErrorHighlights();
}

// ═════════════════════════════════════════════════════════════
// RENDER: TOKENS
// ═════════════════════════════════════════════════════════════

function renderTokens(tokens) {
    if (!tokens || tokens.length === 0) {
        return '<p class="output-placeholder">No tokens to display.</p>';
    }

    const typeClass = {
        KEYWORD: 'token-keyword',
        DATATYPE: 'token-datatype',
        MODIFIER: 'token-modifier',
        IDENTIFIER: 'token-identifier',
        RELATION_TYPE: 'token-relation-type',
        EOF: 'token-eof'
    };

    const rows = tokens.map((t, i) => {
        const cls = typeClass[t.type] || '';
        return `<tr>
            <td>${i + 1}</td>
            <td class="${cls}">${escapeHtml(t.type)}</td>
            <td>${escapeHtml(t.value)}</td>
            <td>${t.line}</td>
            <td>${t.column}</td>
        </tr>`;
    }).join('');

    return `<table class="token-table">
        <thead><tr><th>#</th><th>Type</th><th>Value</th><th>Line</th><th>Column</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

// ═════════════════════════════════════════════════════════════
// RENDER: AST
// ═════════════════════════════════════════════════════════════

function renderAST(ast) {
    if (!ast || !ast.entities) {
        return '<p class="output-placeholder">No AST to display.</p>';
    }

    let html = '<div class="ast-tree">';
    html += '<div class="ast-node">Program</div>';

    const hasRelations = ast.relations && ast.relations.length > 0;

    ast.entities.forEach((entity, eIdx) => {
        const isLast = !hasRelations && (eIdx === ast.entities.length - 1);
        const prefix = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';

        html += `<div class="ast-node">${prefix}Entity: <span class="ast-entity">"${escapeHtml(entity.name)}"</span> <span class="ast-line">(line ${entity.line})</span></div>`;

        entity.fields.forEach((field, fIdx) => {
            const isLastField = fIdx === entity.fields.length - 1;
            const fPrefix = isLastField ? '└── ' : '├── ';
            const constraints = field.constraints && field.constraints.length > 0
                ? ` <span class="ast-constraint">[${field.constraints.join(', ')}]</span>`
                : '';
            html += `<div class="ast-node">${childPrefix}${fPrefix}Field: <span class="ast-field">${escapeHtml(field.name)}</span> (<span class="ast-type">${escapeHtml(field.dataType)}</span>)${constraints}</div>`;
        });
    });

    if (hasRelations) {
        ast.relations.forEach((rel, rIdx) => {
            const isLast = rIdx === ast.relations.length - 1;
            const prefix = isLast ? '└── ' : '├── ';
            html += `<div class="ast-node">${prefix}Relation: <span class="ast-entity">${escapeHtml(rel.sourceEntity)}</span> --<span class="ast-field">${escapeHtml(rel.name)}</span>--> <span class="ast-entity">${escapeHtml(rel.targetEntity)}</span> <span class="ast-constraint">[${escapeHtml(rel.relationType)}]</span> <span class="ast-line">(line ${rel.line})</span></div>`;
        });
    }

    html += '</div>';
    return html;
}

// ═════════════════════════════════════════════════════════════
// RENDER: SYMBOL TABLE
// ═════════════════════════════════════════════════════════════

function renderSymbolTable(symbolTable) {
    if (!symbolTable || Object.keys(symbolTable).length === 0) {
        return '<p class="output-placeholder">No symbol table to display.</p>';
    }

    let rows = '';
    Object.keys(symbolTable).forEach(entityName => {
        const entity = symbolTable[entityName];
        const fieldNames = Object.keys(entity.fields);
        fieldNames.forEach((fieldName, fIdx) => {
            const field = entity.fields[fieldName];
            const constraints = field.constraints && field.constraints.length > 0
                ? field.constraints.map(c => `<span class="symbol-constraint">${escapeHtml(c)}</span>`).join(', ')
                : '—';
            rows += `<tr>
                <td class="symbol-entity">${fIdx === 0 ? escapeHtml(entityName) : ''}</td>
                <td class="symbol-field">${escapeHtml(fieldName)}</td>
                <td class="symbol-type">${escapeHtml(field.dataType)}</td>
                <td>${constraints}</td>
                <td>${field.line || '—'}</td>
            </tr>`;
        });
    });

    return `<table class="symbol-table">
        <thead><tr><th>Entity</th><th>Field</th><th>Type</th><th>Constraints</th><th>Line</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

// ═════════════════════════════════════════════════════════════
// RENDER: IR INSTRUCTIONS
// ═════════════════════════════════════════════════════════════

function renderIR(ir, label) {
    if (!ir || !ir.instructions || ir.instructions.length === 0) {
        return `<p class="output-placeholder">No ${label || 'IR'} to display.</p>`;
    }

    let html = '<div class="ir-list">';
    ir.instructions.forEach((inst, i) => {
        const num = `<span class="ir-num">${(i + 1).toString().padStart(2, ' ')}.</span>`;
        if (inst.op === 'CREATE_ENTITY') {
            html += `<div class="ir-instruction">${num} <span class="ir-op">CREATE_ENTITY</span> <span class="ir-entity">${escapeHtml(inst.entity)}</span></div>`;
        } else if (inst.op === 'ADD_FIELD') {
            const cStr = inst.constraints && inst.constraints.length > 0
                ? ` <span class="ir-constraint">[${inst.constraints.join(', ')}]</span>`
                : '';
            html += `<div class="ir-instruction">${num} <span class="ir-op">ADD_FIELD</span> <span class="ir-entity">${escapeHtml(inst.entity)}</span>.<span class="ir-field">${escapeHtml(inst.field)}</span> <span class="ir-type">${escapeHtml(inst.dataType)}</span>${cStr}</div>`;
        }
    });
    html += '</div>';
    return html;
}

function renderOptimizedIR(data) {
    let html = '';

    if (data.optimizations && data.optimizations.length > 0) {
        const origCount = data.ir ? data.ir.instructions.length : '?';
        const optCount = data.optimizedIR ? data.optimizedIR.instructions.length : '?';
        html += `<div class="ir-summary">✓ ${data.optimizations.length} optimization(s) applied — instructions: ${origCount} → ${optCount}</div>`;
        data.optimizations.forEach(opt => {
            html += `<div class="ir-summary" style="margin-top:0.25rem;">• ${escapeHtml(opt.pass)}: ${escapeHtml(opt.description)}</div>`;
        });
    } else {
        html += '<div class="ir-summary">✓ No optimizations required — IR is already optimal</div>';
    }

    if (data.warnings && data.warnings.length > 0) {
        data.warnings.forEach(w => {
            html += `<div class="ir-summary" style="border-color:var(--warning);background:#1c1800;color:var(--warning);">⚠ ${escapeHtml(w)}</div>`;
        });
    }

    html += renderIR(data.optimizedIR, 'Optimized IR');
    return html;
}

// ═════════════════════════════════════════════════════════════
// RENDER: SQL
// ═════════════════════════════════════════════════════════════

function renderSQL(files) {
    const sqlFile = files.find(f => f.path.endsWith('.sql'));
    if (!sqlFile) return '<p class="output-placeholder">No SQL generated.</p>';

    const highlighted = highlightSQL(sqlFile.content);
    return `<pre>${highlighted}</pre>`;
}

function highlightSQL(sql) {
    const keywords = [
        'CREATE', 'TABLE', 'DROP', 'IF', 'EXISTS', 'NOT', 'NULL',
        'PRIMARY', 'KEY', 'AUTO_INCREMENT', 'UNIQUE', 'INSERT',
        'INTO', 'VALUES', 'SELECT', 'FROM', 'WHERE', 'UPDATE',
        'SET', 'DELETE', 'DEFAULT', 'DATABASE', 'USE'
    ];
    const types = ['INT', 'VARCHAR', 'FLOAT', 'BOOLEAN', 'TEXT', 'DATE', 'DATETIME'];

    let result = escapeHtml(sql);

    result = result.replace(/(--.*)/g, '<span class="sql-comment">$1</span>');

    keywords.forEach(kw => {
        const re = new RegExp('\\b(' + kw + ')\\b', 'g');
        result = result.replace(re, '<span class="sql-keyword">$1</span>');
    });

    types.forEach(t => {
        const re = new RegExp('\\b(' + t + '(?:\\(\\d+\\))?)\\b', 'g');
        result = result.replace(re, '<span class="sql-type">$1</span>');
    });

    return result;
}

// ═════════════════════════════════════════════════════════════
// RENDER: API FILES
// ═════════════════════════════════════════════════════════════

function renderAPIFiles(files) {
    if (!files || files.length === 0) {
        return '<p class="output-placeholder">No API files generated.</p>';
    }

    const apiFiles = files.filter(f =>
        !f.path.endsWith('.sql') &&
        !f.path.endsWith('swagger.json') &&
        !f.path.endsWith('.env.example')
    );

    return apiFiles.map((file, i) => {
        return `<div class="api-file">
            <div class="api-file-header" onclick="toggleApiFile(this)">
                <span>📄 ${escapeHtml(file.path)}</span>
                <span class="toggle-icon">▾</span>
            </div>
            <div class="api-file-content${i === 0 ? ' expanded' : ''}">
                <pre>${escapeHtml(file.content)}</pre>
            </div>
        </div>`;
    }).join('');
}

function toggleApiFile(headerEl) {
    const content = headerEl.nextElementSibling;
    const icon = headerEl.querySelector('.toggle-icon');
    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        icon.textContent = '▸';
    } else {
        content.classList.add('expanded');
        icon.textContent = '▾';
    }
}
window.toggleApiFile = toggleApiFile;

// ═════════════════════════════════════════════════════════════
// RENDER: SWAGGER
// ═════════════════════════════════════════════════════════════

function renderSwagger(files) {
    const swaggerFile = files.find(f => f.path.endsWith('swagger.json'));
    if (!swaggerFile) return '<p class="output-placeholder">No Swagger spec generated.</p>';

    let content = swaggerFile.content;
    try {
        if (typeof content === 'string') {
            content = JSON.stringify(JSON.parse(content), null, 2);
        } else {
            content = JSON.stringify(content, null, 2);
        }
    } catch (e) {
        // use as-is
    }

    return `<pre>${escapeHtml(content)}</pre>`;
}

// ═════════════════════════════════════════════════════════════
// UTILITY
// ═════════════════════════════════════════════════════════════

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ═════════════════════════════════════════════════════════════
// CLEAR STATE (TASK 6)
// ═════════════════════════════════════════════════════════════

function clearAll() {
    editor.value = '';
    clearErrorHighlights();
    hideError();
    hideSummary();
    resetAllStatus();
    lastCompileResult = null;
    downloadSection.classList.remove('visible');

    TAB_IDS.forEach(id => {
        const pane = document.getElementById('output-' + id);
        if (pane) pane.innerHTML = '';
    });

    switchTab('tokens');
}

// ═════════════════════════════════════════════════════════════
// LOAD EXAMPLE (TASK 6)
// ═════════════════════════════════════════════════════════════

function loadExample() {
    editor.value = EXAMPLE_DSL;
    clearErrorHighlights();
    hideError();
    hideSummary();
    resetAllStatus();
    downloadSection.classList.remove('visible');

    TAB_IDS.forEach(id => {
        const pane = document.getElementById('output-' + id);
        if (pane) pane.innerHTML = '';
    });

    switchTab('tokens');
}

// ═════════════════════════════════════════════════════════════
// COMPILE (TASK 1, 2, 3, 5, 6)
// ═════════════════════════════════════════════════════════════

async function compile() {
    const source = editor.value.trim();
    if (!source) {
        hideSummary();
        showError('input', [{ message: 'Please enter some DSL code before compiling.' }]);
        return;
    }

    // Reset previous UI state
    hideError();
    hideSummary();
    clearErrorHighlights();
    resetAllStatus();
    lastCompileResult = null;
    downloadSection.classList.remove('visible');
    TAB_IDS.forEach(id => {
        const pane = document.getElementById('output-' + id);
        if (pane) pane.innerHTML = '';
    });

    // Show loading
    compileBtn.classList.add('loading');
    compileBtn.textContent = '⏳ Compiling...';

    try {
        const response = await fetch('/api/compile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: editor.value })
        });

        const data = await response.json();

        // Update phase statuses
        applyPhaseStatuses(data.phases, data.success, data.phase);

        if (data.success) {
            // ── Render compilation summary & output tabs ──
            lastCompileResult = data;
            renderSummary(data);

            document.getElementById('output-tokens').innerHTML = renderTokens(data.tokens);
            document.getElementById('output-ast').innerHTML = renderAST(data.ast);
            document.getElementById('output-symboltable').innerHTML = renderSymbolTable(data.symbolTable);
            document.getElementById('output-ir').innerHTML = renderIR(data.ir, 'IR');
            document.getElementById('output-optimized-ir').innerHTML = renderOptimizedIR(data);
            document.getElementById('output-sql').innerHTML = renderSQL(data.generatedFiles);
            document.getElementById('output-api').innerHTML = renderAPIFiles(data.generatedFiles);
            document.getElementById('output-swagger').innerHTML = renderSwagger(data.generatedFiles);

            // Show download button
            downloadSection.classList.add('visible');

            // Switch to tokens tab
            switchTab('tokens');
        } else {
            // ── Error occurred ──
            hideSummary();
            showError(data.phase || 'unknown', data.errors || [{ message: 'Unknown compilation error.' }]);

            // Still render partial results if available
            if (data.tokens) {
                document.getElementById('output-tokens').innerHTML = renderTokens(data.tokens);
            }
            if (data.ast) {
                document.getElementById('output-ast').innerHTML = renderAST(data.ast);
            }
            if (data.symbolTable) {
                document.getElementById('output-symboltable').innerHTML = renderSymbolTable(data.symbolTable);
            }
            if (data.ir) {
                document.getElementById('output-ir').innerHTML = renderIR(data.ir, 'IR');
            }
        }
    } catch (err) {
        hideSummary();
        showError('network', [{ message: 'Failed to connect to the compiler server. Make sure it is running.' }]);
    } finally {
        compileBtn.classList.remove('loading');
        compileBtn.textContent = '▶ Compile';
    }
}

// ═════════════════════════════════════════════════════════════
// DOWNLOAD
// ═════════════════════════════════════════════════════════════

function downloadProject() {
    if (!lastCompileResult || !lastCompileResult.generatedFiles) return;

    let content = '';
    lastCompileResult.generatedFiles.forEach(file => {
        content += `${'='.repeat(60)}\n`;
        content += `FILE: ${file.path}\n`;
        content += `${'='.repeat(60)}\n\n`;
        content += file.content;
        content += '\n\n';
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'apiforge-generated-project.txt';
    a.click();
    URL.revokeObjectURL(url);
}

// ═════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Editor event listeners
    editor.addEventListener('input', () => {
        if (errorLines.size > 0) {
            clearErrorHighlights();
            hideError();
        } else {
            updateLineNumbers();
            updateEditorHighlights();
        }
    });

    editor.addEventListener('scroll', syncScroll);

    // Buttons
    compileBtn.addEventListener('click', compile);
    clearBtn.addEventListener('click', clearAll);
    exampleBtn.addEventListener('click', loadExample);
    downloadBtn.addEventListener('click', downloadProject);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            if (tabId) switchTab(tabId);
        });
    });

    // Clickable status bar phases
    setupPhaseClickHandlers();

    // Tab key inserts spaces
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
            updateLineNumbers();
            updateEditorHighlights();
        }
    });

    // Ctrl+Enter / Cmd+Enter to compile
    editor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            compile();
        }
    });

    // Load example by default
    loadExample();

    // Initial rendering
    updateLineNumbers();
    updateEditorHighlights();
});
