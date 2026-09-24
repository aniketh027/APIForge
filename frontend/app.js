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

const EXAMPLES = [
    {
        name: 'Basic Student Entity',
        code: `ENTITY Student

id INT PRIMARY KEY
name STRING REQUIRED MIN_LENGTH 2 MAX_LENGTH 80
email STRING UNIQUE
age INT
cgpa FLOAT`
    },
    {
        name: 'Relationships (M:N)',
        code: `ENTITY Student

id INT PRIMARY KEY
name STRING REQUIRED

ENTITY Course

id INT PRIMARY KEY
title STRING REQUIRED

RELATION Student ENROLLS_IN Course MANY_TO_MANY`
    },
    {
        name: 'Validations & Defaults',
        code: `ENTITY Student

id INT PRIMARY KEY
name STRING REQUIRED
age INT MIN 18 MAX 60 DEFAULT 25
status STRING DEFAULT "active" MIN_LENGTH 3 MAX_LENGTH 20
cgpa FLOAT MIN 0.0 MAX 10.0 DEFAULT 8.5
active BOOLEAN DEFAULT TRUE`
    }
];

let currentExampleIndex = 0;
const EXAMPLE_DSL = EXAMPLES[0].code;

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
const exampleName      = document.getElementById('example-name');
const pipelineState    = document.getElementById('pipeline-state');
const headerStatus     = document.getElementById('header-status');
const headerStatusText = document.getElementById('header-status-text');

// Set of line numbers with compiler errors (1-indexed)
const errorLines = new Set();

// Store last successful compilation for download
let lastCompileResult = null;
let isCompiling = false;

function emptyState(title = 'No compilation yet', message = 'Write APIForge DSL and press Compile, or load an example.') {
    return `<div class="output-placeholder">
        <div class="empty-state">
            <span class="empty-state-mark" aria-hidden="true">{ }</span>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(message)}</span>
        </div>
    </div>`;
}

function resetOutputPanes(title, message) {
    TAB_IDS.forEach(id => {
        const pane = document.getElementById('output-' + id);
        if (pane) pane.innerHTML = emptyState(title, message);
    });
}

function setCompilerAvailability(isAvailable) {
    if (!headerStatus || !headerStatusText) return;
    headerStatus.classList.toggle('unavailable', !isAvailable);
    headerStatusText.textContent = isAvailable ? 'Compiler ready' : 'Compiler unavailable';
}

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
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
        btn.setAttribute('tabindex', '-1');
    });
    document.querySelectorAll('.output-pane').forEach(pane => {
        pane.classList.remove('active');
        pane.hidden = true;
    });

    // Activate selected
    const tabBtn = document.getElementById('tab-' + tabId);
    const pane = document.getElementById('output-' + tabId);
    if (tabBtn) {
        tabBtn.classList.add('active');
        tabBtn.setAttribute('aria-selected', 'true');
        tabBtn.setAttribute('tabindex', '0');
    }
    if (pane) {
        pane.classList.add('active');
        pane.hidden = false;
    }
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
    else if (status === 'skipped') icon.textContent = '–';
    else if (status === 'active') icon.textContent = '•';
    else icon.textContent = '○';
    const readableStatus = status === 'error' ? 'failed' : status;
    el.setAttribute('aria-label', `${el.querySelector('.status-label').textContent} phase: ${readableStatus}`);
}

function resetAllStatus() {
    PHASE_ORDER.forEach(phase => setPhaseStatus(phase, 'pending'));
    if (pipelineState) pipelineState.textContent = 'Waiting for compilation';
}

function applyPhaseStatuses(phases, isSuccess, failingPhase) {
    if (!phases) return;

    if (isSuccess) {
        PHASE_ORDER.forEach(phase => setPhaseStatus(phase, 'success'));
        if (pipelineState) pipelineState.textContent = 'All phases completed';
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
        } else if (idx === failedIndex) {
            setPhaseStatus(phase, 'error');
        } else {
            setPhaseStatus(phase, 'skipped');
        }
    });

    if (pipelineState) pipelineState.textContent = `${formatPhaseName(failingPhase || PHASE_ORDER[failedIndex] || 'compiler')} failed`;
}

function formatPhaseName(phase) {
    if (phase === 'codegen') return 'CodeGen';
    if (phase === 'ir') return 'IR';
    return phase ? phase.charAt(0).toUpperCase() + phase.slice(1) : 'Compiler';
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
        <span class="summary-icon" aria-hidden="true">✓</span>
        <div class="summary-body">
            <div class="summary-title">Compiled successfully</div>
            <div class="summary-grid">
                <span class="summary-item"><span class="summary-value">${entitiesCount}</span>${entitiesCount === 1 ? 'entity' : 'entities'}</span>
                <span class="summary-item"><span class="summary-value">${fieldsCount}</span>${fieldsCount === 1 ? 'field' : 'fields'}</span>
                <span class="summary-item"><span class="summary-value">${optimizationsCount}</span>${optimizationsCount === 1 ? 'optimization' : 'optimizations'}</span>
                <span class="summary-item"><span class="summary-value">${filesCount}</span>${filesCount === 1 ? 'file' : 'files'}</span>
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
    const phaseHeader = `${formatPhaseName(phase || 'compiler')} error`;
    const sourceLines = editor.value.split('\n');

    // Register all error lines for highlighting
    errorLines.clear();

    const formattedErrors = (errors || []).map(err => {
        let line = err.line || null;
        let column = err.column || null;
        let message = err.userMessage || err.message || String(err);

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
                    <div class="error-source-line"><span class="error-line-number">${line} │</span>${escapeHtml(lineContent)}</div>
                    ${pointerLine ? `<div class="error-pointer-line">${escapeHtml(pointerLine)}</div>` : ''}
                </div>
            `;
        }

        return `
            <div class="error-card">
                <div class="error-heading">
                    <div class="error-phase-title">${escapeHtml(phaseHeader)}</div>
                    ${err.code ? `<span class="error-code">${escapeHtml(err.code)}</span>` : ''}
                </div>
                <div class="error-message-text">${escapeHtml(displayMessage)}</div>
                ${excerptHtml}
                ${locationText ? `<div class="error-location">${escapeHtml(locationText)}</div>` : ''}
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
            <td class="table-index">${String(i + 1).padStart(2, '0')}</td>
            <td class="${cls}">${escapeHtml(t.type)}</td>
            <td>${escapeHtml(t.value)}</td>
            <td class="table-location">${t.line}:${t.column}</td>
        </tr>`;
    }).join('');

    return `<div class="table-shell"><table class="token-table">
        <thead><tr><th>#</th><th>Type</th><th>Value</th><th>Location</th></tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`;
}

// ═════════════════════════════════════════════════════════════
// RENDER: AST
// ═════════════════════════════════════════════════════════════

function renderAST(ast) {
    if (!ast || !ast.entities) {
        return '<p class="output-placeholder">No AST to display.</p>';
    }

    let html = '<div class="ast-tree">';
    html += '<div class="ast-node ast-root">Program</div>';

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
            let valStr = '';
            if (Array.isArray(field.validations) && field.validations.length > 0) {
                const vals = field.validations.map(v => `${v.type} ${v.value}`).join(', ');
                valStr = ` <span class="symbol-validation">[${escapeHtml(vals)}]</span>`;
            }
            let defStr = '';
            if (field.defaultValue !== null && field.defaultValue !== undefined) {
                const defVal = typeof field.defaultValue.value === 'string' ? `"${field.defaultValue.value}"` : field.defaultValue.value;
                defStr = ` <span class="symbol-default">[DEFAULT ${escapeHtml(String(defVal))}]</span>`;
            }
            html += `<div class="ast-node">${childPrefix}${fPrefix}Field: <span class="ast-field">${escapeHtml(field.name)}</span> (<span class="ast-type">${escapeHtml(field.dataType)}</span>)${constraints}${valStr}${defStr}</div>`;
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
        if (!entity || !entity.fields) return;
        const fieldNames = Object.keys(entity.fields);
        fieldNames.forEach((fieldName, fIdx) => {
            const field = entity.fields[fieldName];
            const constraints = field.constraints && field.constraints.length > 0
                ? field.constraints.map(c => `<span class="symbol-constraint">${escapeHtml(c)}</span>`).join(', ')
                : '—';
            const validations = Array.isArray(field.validations) && field.validations.length > 0
                ? field.validations.map(v => `${v.type} ${v.value}`).join(', ')
                : '—';
            const defaultVal = (field.defaultValue !== null && field.defaultValue !== undefined)
                ? (typeof field.defaultValue.value === 'string' ? `"${field.defaultValue.value}"` : String(field.defaultValue.value))
                : '—';

            rows += `<tr>
                <td class="symbol-entity">${fIdx === 0 ? escapeHtml(entityName) : ''}</td>
                <td class="symbol-field">${escapeHtml(fieldName)}</td>
                <td class="symbol-type">${escapeHtml(field.dataType)}</td>
                <td>${constraints}</td>
                <td class="symbol-validation">${escapeHtml(validations)}</td>
                <td class="symbol-default">${escapeHtml(defaultVal)}</td>
                <td class="symbol-line">${field.line || '—'}</td>
            </tr>`;
        });
    });

    return `<div class="table-shell"><table class="symbol-table">
        <thead><tr><th>Entity</th><th>Field</th><th>Type</th><th>Constraints</th><th>Validations</th><th>Default</th><th>Line</th></tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`;
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
        const num = `<span class="ir-num">${(i + 1).toString().padStart(2, '0')}</span>`;
        if (inst.op === 'CREATE_ENTITY') {
            html += `<div class="ir-instruction">${num}<div class="ir-content"><span class="ir-op">CREATE_ENTITY</span> <span class="ir-entity">${escapeHtml(inst.entity)}</span></div></div>`;
        } else if (inst.op === 'ADD_FIELD') {
            const cStr = inst.constraints && inst.constraints.length > 0
                ? ` <span class="ir-constraint">[${inst.constraints.join(', ')}]</span>`
                : '';
            let vStr = '';
            if (Array.isArray(inst.validations) && inst.validations.length > 0) {
                const vals = inst.validations.map(v => `${v.type} ${v.value}`).join(', ');
                vStr = ` <span class="ir-validation">[${escapeHtml(vals)}]</span>`;
            }
            let dStr = '';
            if (inst.defaultValue !== null && inst.defaultValue !== undefined) {
                const defVal = typeof inst.defaultValue.value === 'string' ? `"${inst.defaultValue.value}"` : inst.defaultValue.value;
                dStr = ` <span class="ir-default">[DEFAULT ${escapeHtml(String(defVal))}]</span>`;
            }
            html += `<div class="ir-instruction">${num}<div class="ir-content"><span class="ir-op">ADD_FIELD</span> <span class="ir-entity">${escapeHtml(inst.entity)}</span>.<span class="ir-field">${escapeHtml(inst.field)}</span> <span class="ir-type">${escapeHtml(inst.dataType)}</span>${cStr}${vStr}${dStr}</div></div>`;
        } else if (inst.op === 'CREATE_RELATION') {
            html += `<div class="ir-instruction">${num}<div class="ir-content"><span class="ir-op">CREATE_RELATION</span> <span class="ir-entity">${escapeHtml(inst.sourceEntity)}</span> <span class="ir-field">${escapeHtml(inst.relationName)}</span> <span class="ir-entity">${escapeHtml(inst.targetEntity)}</span> <span class="ir-constraint">[${escapeHtml(inst.relationType)}]</span></div></div>`;
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
            html += `<div class="ir-summary">${escapeHtml(opt.pass)}: ${escapeHtml(opt.description)}</div>`;
        });
    } else {
        html += '<div class="ir-summary">✓ No optimizations required — IR is already optimal</div>';
    }

    if (data.warnings && data.warnings.length > 0) {
        data.warnings.forEach(w => {
            html += `<div class="ir-summary warning">Warning: ${escapeHtml(w)}</div>`;
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
    return `<div class="code-file-header"><span>${escapeHtml(sqlFile.path)}</span><span class="code-file-meta">Generated SQL</span></div><pre>${highlighted}</pre>`;
}

function highlightSQL(sql) {
    const keywords = [
        'CREATE', 'TABLE', 'DROP', 'IF', 'EXISTS', 'NOT', 'NULL',
        'PRIMARY', 'KEY', 'AUTO_INCREMENT', 'UNIQUE', 'INSERT',
        'INTO', 'VALUES', 'SELECT', 'FROM', 'WHERE', 'UPDATE',
        'SET', 'DELETE', 'DEFAULT', 'DATABASE', 'USE',
        'FOREIGN', 'REFERENCES', 'CHECK', 'CASCADE', 'ON', 'AND',
        'ALTER', 'ADD', 'COLUMN', 'CONSTRAINT'
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
        !f.path.endsWith('swagger.json')
    );

    return apiFiles.map((file, i) => {
        return `<div class="api-file">
            <button class="api-file-header" type="button" aria-expanded="${i === 0 ? 'true' : 'false'}">
                <span>${escapeHtml(file.path)}</span>
                <span class="toggle-icon">${i === 0 ? '▾' : '▸'}</span>
            </button>
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
        headerEl.setAttribute('aria-expanded', 'false');
    } else {
        content.classList.add('expanded');
        icon.textContent = '▾';
        headerEl.setAttribute('aria-expanded', 'true');
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

    return `<div class="code-file-header"><span>swagger.json</span><span class="code-file-meta">OpenAPI specification</span></div><pre>${escapeHtml(content)}</pre>`;
}

// ═════════════════════════════════════════════════════════════
// UTILITY
// ═════════════════════════════════════════════════════════════

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
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

    if (exampleName) exampleName.textContent = 'Untitled source';
    resetOutputPanes('No compilation yet', 'Write APIForge DSL and press Compile, or load an example.');

    switchTab('tokens');
}

// ═════════════════════════════════════════════════════════════
// LOAD EXAMPLE (TASK 6)
// ═════════════════════════════════════════════════════════════

function loadExample() {
    const example = EXAMPLES[currentExampleIndex % EXAMPLES.length];
    currentExampleIndex++;
    editor.value = example.code;
    if (exampleName) exampleName.textContent = example.name;
    exampleBtn.title = `Loaded: ${example.name} (Click to load next example)`;
    clearErrorHighlights();
    hideError();
    hideSummary();
    resetAllStatus();
    downloadSection.classList.remove('visible');

    resetOutputPanes('Ready to compile', `${example.name} is loaded in the editor.`);

    switchTab('tokens');
}

// ═════════════════════════════════════════════════════════════
// COMPILE (TASK 1, 2, 3, 5, 6)
// ═════════════════════════════════════════════════════════════

async function compile() {
    if (isCompiling) return;

    const source = editor.value.trim();
    if (!source) {
        hideSummary();
        resetAllStatus();
        lastCompileResult = null;
        downloadSection.classList.remove('visible');
        resetOutputPanes('No source to compile', 'Write APIForge DSL or load an example before compiling.');
        showError('input', [{ message: 'Please enter some DSL code before compiling.' }]);
        if (pipelineState) pipelineState.textContent = 'No source to compile';
        return;
    }

    // Reset previous UI state
    hideError();
    hideSummary();
    clearErrorHighlights();
    resetAllStatus();
    lastCompileResult = null;
    downloadSection.classList.remove('visible');
    resetOutputPanes('Compilation running', 'Results will appear when the compiler responds.');

    // Show loading
    isCompiling = true;
    compileBtn.disabled = true;
    compileBtn.setAttribute('aria-busy', 'true');
    compileBtn.classList.add('loading');
    compileBtn.querySelector('.button-icon').textContent = '◌';
    compileBtn.querySelector('.button-label').textContent = 'Compiling';
    if (pipelineState) pipelineState.textContent = 'Compilation running';

    try {
        const response = await fetch('/api/compile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: editor.value })
        });

        const data = await response.json();
        setCompilerAvailability(true);

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
            resetOutputPanes(
                `Unavailable after ${formatPhaseName(data.phase || 'compiler')} failure`,
                'This output was not produced because compilation stopped earlier.'
            );

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
        setCompilerAvailability(false);
        hideSummary();
        showError('network', [{ message: 'Failed to connect to the compiler server. Make sure it is running.' }]);
        resetOutputPanes('Compiler unavailable', 'No output was produced because the compiler server could not be reached.');
        if (pipelineState) pipelineState.textContent = 'Compiler unavailable';
    } finally {
        isCompiling = false;
        compileBtn.disabled = false;
        compileBtn.removeAttribute('aria-busy');
        compileBtn.classList.remove('loading');
        compileBtn.querySelector('.button-icon').textContent = '▶';
        compileBtn.querySelector('.button-label').textContent = 'Compile';
    }
}

// ═════════════════════════════════════════════════════════════
// DOWNLOAD
// ═════════════════════════════════════════════════════════════

function createZip(files) {
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[n] = c;
    }
    function crc32(buf) {
        let crc = 0 ^ (-1);
        for (let i = 0; i < buf.length; i++) {
            crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
        }
        return (crc ^ (-1)) >>> 0;
    }

    const enc = new TextEncoder();
    const parts = [];
    const cdEntries = [];
    let offset = 0;

    for (const f of files) {
        const nameBytes = enc.encode(f.path.replace(/^\//, ''));
        const dataBytes = enc.encode(f.content);
        const crc = crc32(dataBytes);
        const size = dataBytes.length;

        const lh = new Uint8Array(30 + nameBytes.length);
        const lhView = new DataView(lh.buffer);
        lhView.setUint32(0, 0x04034b50, true);
        lhView.setUint16(4, 20, true);
        lhView.setUint16(6, 0, true);
        lhView.setUint16(8, 0, true);
        lhView.setUint16(10, 0, true);
        lhView.setUint16(12, 0, true);
        lhView.setUint32(14, crc, true);
        lhView.setUint32(18, size, true);
        lhView.setUint32(22, size, true);
        lhView.setUint16(26, nameBytes.length, true);
        lhView.setUint16(28, 0, true);
        lh.set(nameBytes, 30);

        parts.push(lh);
        parts.push(dataBytes);

        const cd = new Uint8Array(46 + nameBytes.length);
        const cdView = new DataView(cd.buffer);
        cdView.setUint32(0, 0x02014b50, true);
        cdView.setUint16(4, 20, true);
        cdView.setUint16(6, 20, true);
        cdView.setUint16(8, 0, true);
        cdView.setUint16(10, 0, true);
        cdView.setUint16(12, 0, true);
        cdView.setUint14 ? null : null;
        cdView.setUint32(16, crc, true);
        cdView.setUint32(20, size, true);
        cdView.setUint32(24, size, true);
        cdView.setUint16(28, nameBytes.length, true);
        cdView.setUint16(30, 0, true);
        cdView.setUint16(32, 0, true);
        cdView.setUint16(34, 0, true);
        cdView.setUint16(36, 0, true);
        cdView.setUint32(38, 0, true);
        cdView.setUint32(42, offset, true);
        cd.set(nameBytes, 46);
        cdEntries.push(cd);

        offset += lh.length + dataBytes.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const cd of cdEntries) {
        parts.push(cd);
        cdSize += cd.length;
    }

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, files.length, true);
    eocdView.setUint16(10, files.length, true);
    eocdView.setUint32(12, cdSize, true);
    eocdView.setUint32(16, cdOffset, true);
    eocdView.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
}

function downloadProject() {
    if (!lastCompileResult || !lastCompileResult.generatedFiles) return;

    try {
        const zipBlob = createZip(lastCompileResult.generatedFiles);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'apiforge-project.zip';
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
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
}

// ═════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Editor event listeners
    editor.addEventListener('input', () => {
        if (exampleName) exampleName.textContent = 'Modified source';
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
        btn.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const tabs = Array.from(document.querySelectorAll('.tab-btn'));
            const current = tabs.indexOf(btn);
            let target = current;
            if (event.key === 'ArrowRight') target = (current + 1) % tabs.length;
            if (event.key === 'ArrowLeft') target = (current - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') target = 0;
            if (event.key === 'End') target = tabs.length - 1;
            switchTab(tabs[target].getAttribute('data-tab'));
            tabs[target].focus();
        });
    });

    document.getElementById('output-api').addEventListener('click', (event) => {
        const header = event.target.closest('.api-file-header');
        if (header) toggleApiFile(header);
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
