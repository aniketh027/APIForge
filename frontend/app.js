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
    },
    { name: 'ENUM Account', code: `ENTITY Account
id INT PRIMARY KEY
email STRING REQUIRED UNIQUE
status ENUM("active", "suspended", "closed") DEFAULT "active"` },
    { name: 'DATE and TIMESTAMP Event', code: `ENTITY Event
id INT PRIMARY KEY
eventDate DATE REQUIRED
createdAt TIMESTAMP
publishedAt TIMESTAMP DEFAULT "2026-10-05T12:30:00Z"` },
    { name: 'UUID User and Groups', code: `ENTITY User
id UUID PRIMARY KEY
email STRING REQUIRED UNIQUE
token UUID
ENTITY Group
id UUID PRIMARY KEY
label STRING
RELATION User JOINS Group MANY_TO_MANY` }
];

const PROFESSOR_DEMO = {
    name: 'Professor Demo — Project Workspace',
    code: `ENTITY User

id UUID PRIMARY KEY
name STRING REQUIRED MIN_LENGTH 2 MAX_LENGTH 80
email STRING REQUIRED UNIQUE
role ENUM("student", "faculty", "admin") DEFAULT "student"
active BOOLEAN DEFAULT TRUE
joinedAt DATE REQUIRED

ENTITY Project

id INT PRIMARY KEY
title STRING REQUIRED MIN_LENGTH 3 MAX_LENGTH 120
status ENUM("planned", "active", "completed") DEFAULT "planned"
progress INT MIN 0 MAX 100 DEFAULT 0
createdAt TIMESTAMP

ENTITY Task

id INT PRIMARY KEY
title STRING REQUIRED MIN_LENGTH 2 MAX_LENGTH 120
priority INT MIN 1 MAX 5 DEFAULT 3
done BOOLEAN DEFAULT FALSE

RELATION User OWNS Project ONE_TO_MANY
RELATION Project HAS Task ONE_TO_MANY`
};

let currentExampleIndex = 0;
const EXAMPLE_DSL = EXAMPLES[0].code;

const PHASE_ORDER = ['lexer', 'parser', 'semantic', 'ir', 'optimizer', 'codegen'];

const TAB_IDS = [
    'tokens', 'ast', 'diagram', 'symboltable', 'ir',
    'optimized-ir', 'sql', 'endpoints', 'api', 'swagger'
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
const demoBtn          = document.getElementById('demo-btn');
const downloadBtn      = document.getElementById('download-btn');
const downloadSection  = document.getElementById('download-section');
const errorPanel       = document.getElementById('error-panel');
const summaryPanel     = document.getElementById('compilation-summary');
const summaryContent   = document.getElementById('compilation-summary-content');
const exampleName      = document.getElementById('example-name');
const pipelineState    = document.getElementById('pipeline-state');
const headerStatus     = document.getElementById('header-status');
const headerStatusText = document.getElementById('header-status-text');
const targetButtons    = document.querySelectorAll('.target-option');
const TARGET_LABELS    = { mysql: 'MySQL', postgres: 'PostgreSQL' };

// Set of line numbers with compiler errors (1-indexed)
const errorLines = new Set();

// Store last successful compilation for download
let lastCompileResult = null;
let isCompiling = false;
let selectedTarget = 'mysql';
// Changes to the target or loaded source invalidate pending compilation output.
let targetRevision = 0;

function selectTarget(target) {
    if (target === selectedTarget) return;
    selectedTarget = target;
    targetRevision++;
    targetButtons.forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.target === target));
    });
    clearErrorHighlights();
    hideError();
    hideSummary();
    lastCompileResult = null;
    downloadSection.classList.remove('visible');
    resetAllStatus();
    resetOutputPanes('Target changed', `Compile again to generate ${TARGET_LABELS[target]} output.`);
}

function emptyState(title = 'No compilation yet', message = 'Write APIForge DSL and press Compile, or load an example.') {
    return `<div class="output-placeholder">
        <div class="empty-state">
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

function applyPhaseStatuses(phases, isSuccess, failingPhase, phaseStates) {
    if (phaseStates) {
        PHASE_ORDER.forEach(phase => setPhaseStatus(phase,
            phaseStates[phase] === 'succeeded' ? 'success' : phaseStates[phase] === 'failed' ? 'error' : 'skipped'));
        if (pipelineState) pipelineState.textContent = isSuccess ? 'All phases completed' : `${formatPhaseName(failingPhase || 'compiler')} failed`;
        return;
    }
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

function renderSummary(data, target = 'mysql') {
    if (!summaryPanel || !summaryContent) return;
    const targetLabel = target === 'postgres' ? 'PostgreSQL' : 'MySQL';

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
    const warningsCount = (data.warnings || []).length;

    summaryPanel.classList.add('visible');
    summaryContent.innerHTML = `
        <span class="summary-icon" aria-hidden="true">✓</span>
        <div class="summary-body">
            <div class="summary-title">Compiled successfully</div>
            <div class="summary-grid">
                <span class="summary-item"><span class="summary-value">${entitiesCount}</span>${entitiesCount === 1 ? 'entity' : 'entities'}</span>
                <span class="summary-item"><span class="summary-value">${fieldsCount}</span>${fieldsCount === 1 ? 'field' : 'fields'}</span>
                <span class="summary-item"><span class="summary-value">${optimizationsCount}</span>${optimizationsCount === 1 ? 'optimization' : 'optimizations'}</span>
                <span class="summary-item"><span class="summary-value">${filesCount}</span>${filesCount === 1 ? 'file' : 'files'}</span>
                <span class="summary-item"><span class="summary-value">${targetLabel}</span>target</span>
                ${warningsCount ? `<span class="summary-item summary-warning"><span class="summary-value">${warningsCount}</span>${warningsCount === 1 ? 'warning' : 'warnings'}</span>` : ''}
            </div>
            ${renderWarnings(data.warnings || [])}
        </div>
    `;
}

function renderWarnings(warnings) {
    if (!warnings.length) return '';
    return `<div class="warning-list" role="region" aria-label="Compiler warnings">${warnings.map(warning => {
        const frames = APIForgeSourceFrame.sourceFrame(editor.value, warning);
        const excerpt = frames.length ? `<pre class="warning-excerpt">${frames.map(frame =>
            `${frame.line} | ${escapeHtml(frame.text)}${frame.pointer ? `\n${' '.repeat(String(frame.line).length)} | ${escapeHtml(frame.pointer)}` : ''}`
        ).join('\n')}</pre>` : '';
        return `<div class="warning-item">
            <div class="warning-heading">${escapeHtml(formatPhaseName(warning.phase))} warning
                <span class="warning-code" title="${escapeHtml(warning.symbol)}">${escapeHtml(warning.code)}</span>
            </div>
            <div class="warning-message">${escapeHtml(warning.message)}</div>
            ${excerpt}
            ${warning.hint ? `<div class="warning-hint">Hint: ${escapeHtml(warning.hint)}</div>` : ''}
        </div>`;
    }).join('')}</div>`;
}

function hideSummary() {
    if (!summaryPanel || !summaryContent) return;
    summaryPanel.classList.remove('visible');
    summaryContent.innerHTML = '';
}

// ═════════════════════════════════════════════════════════════
// ENHANCED ERROR DISPLAY & HIGHLIGHTING (TASK 1 & TASK 2)
// ═════════════════════════════════════════════════════════════

function showError(phase, errors) {
    errorPanel.classList.add('visible');
    const phaseHeader = `${formatPhaseName(phase || 'compiler')} error`;

    // Register all error lines for highlighting
    errorLines.clear();

    const formattedErrors = (errors || []).map(err => {
        const diagnostic = err.diagnostic || err;
        let line = diagnostic.line || null;
        let column = diagnostic.column || null;
        let message = err.diagnostic ? diagnostic.message : err.userMessage || err.message || String(err);

        // Extract line/column from message if not directly set
        if (!err.diagnostic && !line) {
            const m = message.match(/line\s+(\d+)/i);
            if (m) line = parseInt(m[1], 10);
        }
        if (!err.diagnostic && !column) {
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

        const frames = APIForgeSourceFrame.sourceFrame(editor.value, { ...diagnostic, line, column });
        frames.forEach(frame => errorLines.add(frame.line));
        const excerptHtml = frames.length ? `<div class="error-excerpt">${frames.map(frame => `
            <div class="error-source-line"><span class="error-line-number">${frame.line} │</span>${escapeHtml(frame.text)}</div>
            ${frame.pointer ? `<div class="error-pointer-line">${escapeHtml(frame.pointer)}</div>` : ''}
        `).join('')}</div>` : '';

        return `
            <div class="error-card">
                <div class="error-heading">
                    <div class="error-phase-title">${escapeHtml(err.diagnostic ? `${formatPhaseName(diagnostic.phase)} error` : phaseHeader)}</div>
                    ${diagnostic.code ? `<span class="error-code" title="${escapeHtml(diagnostic.symbol || diagnostic.code)}">${escapeHtml(diagnostic.code)}</span>` : ''}
                </div>
                <div class="error-message-text">${escapeHtml(displayMessage)}</div>
                ${excerptHtml}
                ${diagnostic.hint ? `<div class="error-location">Hint: ${escapeHtml(diagnostic.hint)}</div>` : ''}
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
            html += `<div class="ast-node">${childPrefix}${fPrefix}Field: <span class="ast-field">${escapeHtml(field.name)}</span> (<span class="ast-type">${escapeHtml(displayDataType(field))}</span>)${constraints}${valStr}${defStr}</div>`;
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

function displayDataType(field) {
    return field.dataType === 'ENUM'
        ? `ENUM(${field.enumValues.map(value => JSON.stringify(value)).join(', ')})`
        : field.dataType;
}

// Logical model only: declaration order and relationships come directly from AST.
// Geometry is local to this render; no separate compilation-result cache is used.
function renderSchemaDiagram(ast) {
    const entities = Array.isArray(ast?.entities)
        ? ast.entities.filter(entity => entity && typeof entity.name === 'string') : [];
    if (!entities.length) return emptyState('No schema diagram available.', 'Compile a program containing entities.');

    const relations = Array.isArray(ast?.relations)
        ? ast.relations.filter(relation => relation &&
            ['name', 'sourceEntity', 'targetEntity', 'relationType'].every(key => typeof relation[key] === 'string')) : [];
    const cardWidth = 220, gap = 32;
    const width = entities.length * (cardWidth + gap) - gap;
    const markers = { PRIMARY_KEY: 'PRIMARY KEY', REQUIRED: 'REQUIRED', UNIQUE: 'UNIQUE' };
    let laneTop = 0;
    const lanes = relations.map(relation => {
        // Allow long legal identifiers to wrap without colliding with another lane.
        const height = 12 + 18 * (Math.ceil(relation.name.length / 18) + Math.ceil(relation.relationType.length / 18));
        const lane = { relation, labelTop: laneTop, y: laneTop + height };
        laneTop += height + 16;
        return lane;
    });
    const cardTop = relations.length ? laneTop + 12 : 0;
    const cards = entities.map((entity, index) => {
        const fields = Array.isArray(entity.fields) ? entity.fields.filter(field => field && typeof field.name === 'string') : [];
        return `<article class="schema-entity" aria-labelledby="schema-entity-${index}">
            <h3 id="schema-entity-${index}" class="schema-entity-name">${escapeHtml(entity.name)}</h3>
            <ul class="schema-fields" aria-label="Declared fields of ${escapeHtml(entity.name)}">${fields.map(field => {
                // Keep displayDataType's ENUM formatting while tolerating incomplete input.
                const type = typeof field.dataType === 'string' ? displayDataType({ ...field,
                    enumValues: Array.isArray(field.enumValues) ? field.enumValues.filter(value => typeof value === 'string') : [] }) : 'Unknown type';
                const constraints = Array.isArray(field.constraints) ? field.constraints : [];
                return `<li class="schema-field"><span class="schema-field-name">${escapeHtml(field.name)}</span>
                    <span class="schema-field-type">${escapeHtml(type)}</span>
                    <span class="schema-constraints">${Object.entries(markers).filter(([key]) => constraints.includes(key))
                        .map(([, label]) => `<span class="schema-constraint">${label}</span>`).join('')}</span></li>`;
            }).join('')}</ul></article>`;
    }).join('');
    let paths = '';
    const labels = lanes.map(({ relation, labelTop, y }, index) => {
        const source = entities.findIndex(entity => entity.name === relation.sourceEntity);
        const target = entities.findIndex(entity => entity.name === relation.targetEntity);
        // Separate attachment points also make self and reciprocal relations visible.
        const sourceX = source * (cardWidth + gap) + cardWidth * (2 * index + 1) / (2 * relations.length + 1);
        const targetX = target * (cardWidth + gap) + cardWidth * (2 * index + 2) / (2 * relations.length + 1);
        if (source >= 0 && target >= 0) {
            paths += `<path class="schema-connector" data-relation-index="${index}" d="M ${sourceX} ${cardTop} V ${y} H ${targetX} V ${cardTop}" marker-end="url(#schema-arrow)"/>`;
        }
        // Unknown endpoints in incomplete input stay textual; never fabricate a card.
        const center = source >= 0 && target >= 0 ? (sourceX + targetX) / 2 : width / 2;
        return `<li class="schema-relation" style="left:${Math.max(0, Math.min(width - 200, center - 100))}px;top:${labelTop}px"
            data-source="${escapeHtml(relation.sourceEntity)}" data-target="${escapeHtml(relation.targetEntity)}">
            <span class="sr-only">From ${escapeHtml(relation.sourceEntity)} to ${escapeHtml(relation.targetEntity)}: </span>
            <span class="schema-relation-name">${escapeHtml(relation.name)}</span>
            <span class="schema-cardinality">${escapeHtml(relation.relationType)}</span>
            ${source < 0 || target < 0 ? '<span class="schema-cardinality">Endpoint unavailable</span>' : ''}</li>`;
    }).join('');
    return `<p class="schema-caption">Logical DSL model · declared fields${relations.length ? ' · arrows point to the target entity' : ' · no declared relationships'}</p>
        <div class="schema-scroll" role="region" aria-label="Entity relationship diagram" tabindex="0">
            <div class="schema-board" style="width:${width}px">
                <svg class="schema-connectors" width="${width}" height="${cardTop + 2}" aria-hidden="true" focusable="false">
                    <defs><marker id="schema-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>${paths}</svg>
                <ul class="schema-relations" aria-label="Declared relationships">${labels}</ul>
                <div class="schema-entities" style="grid-template-columns:repeat(${entities.length},${cardWidth}px);padding-top:${cardTop}px">${cards}</div>
            </div>
        </div>`;
}

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
                <td class="symbol-type">${escapeHtml(displayDataType(field))}</td>
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
            html += `<div class="ir-instruction">${num}<div class="ir-content"><span class="ir-op">ADD_FIELD</span> <span class="ir-entity">${escapeHtml(inst.entity)}</span>.<span class="ir-field">${escapeHtml(inst.field)}</span> <span class="ir-type">${escapeHtml(displayDataType(inst))}</span>${cStr}${vStr}${dStr}</div></div>`;
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

    html += renderIR(data.optimizedIR, 'Optimized IR');
    return html;
}

// ═════════════════════════════════════════════════════════════
// RENDER: SQL
// ═════════════════════════════════════════════════════════════

const COPY_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="8" y="8" width="11" height="11" rx="2"></rect>
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
</svg>`;

const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m5 12 4 4L19 6"></path>
</svg>`;

const copyResetTimers = new WeakMap();

function renderCopyControl(label) {
    const safeLabel = escapeHtml(label);
    return `<button class="copy-control" type="button" data-copy-label="${safeLabel}" aria-label="Copy ${safeLabel}" title="Copy">
        ${COPY_ICON_SVG}
    </button>`;
}

function resetCopyControl(button) {
    const label = button.dataset.copyLabel || 'generated code';
    button.classList.remove('copied', 'copy-failed');
    button.setAttribute('aria-label', `Copy ${label}`);
    button.setAttribute('title', 'Copy');
    button.innerHTML = COPY_ICON_SVG;
    copyResetTimers.delete(button);
}

function showCopyFeedback(button, state) {
    const existingTimer = copyResetTimers.get(button);
    if (existingTimer) clearTimeout(existingTimer);

    const label = button.dataset.copyLabel || 'generated code';
    if (state === 'copied') {
        button.classList.add('copied');
        button.classList.remove('copy-failed');
        button.setAttribute('aria-label', `Copied ${label}`);
        button.setAttribute('title', 'Copied');
        button.innerHTML = CHECK_ICON_SVG;
    } else {
        button.classList.add('copy-failed');
        button.classList.remove('copied');
        button.setAttribute('aria-label', `Copy failed for ${label}`);
        button.setAttribute('title', 'Copy failed');
    }

    copyResetTimers.set(button, setTimeout(() => resetCopyControl(button), 1300));
}

async function copyGeneratedCode(button) {
    const copyScope = button.closest('[data-copy-scope]');
    const source = copyScope && copyScope.querySelector('[data-copy-source]');
    if (!source) return;

    try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('Clipboard API unavailable');
        }
        await navigator.clipboard.writeText(source.textContent);
        showCopyFeedback(button, 'copied');
    } catch (error) {
        showCopyFeedback(button, 'failed');
    }
}

function renderSQL(files) {
    const sqlFile = files.find(f => f.path.endsWith('.sql'));
    if (!sqlFile) return '<p class="output-placeholder">No SQL generated.</p>';

    const highlighted = highlightSQL(sqlFile.content);
    return `<div class="generated-code-block" data-copy-scope>
        <div class="code-file-header">
            <span>${escapeHtml(sqlFile.path)}</span>
            <span class="code-file-actions">
                <span class="code-file-meta">Generated SQL</span>
                ${renderCopyControl(sqlFile.path)}
            </span>
        </div>
        <pre data-copy-source>${highlighted}</pre>
    </div>`;
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
    const types = ['INT', 'VARCHAR', 'CHAR', 'FLOAT', 'BOOLEAN', 'ENUM', 'TEXT', 'DATE', 'TIMESTAMP', 'DATETIME'];

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
            <div class="api-file-content${i === 0 ? ' expanded' : ''}" data-copy-scope>
                <div class="api-file-toolbar">
                    <span class="code-file-meta">Generated file</span>
                    ${renderCopyControl(file.path)}
                </div>
                <pre${/\.md$/i.test(file.path) ? ' class="api-file-markdown"' : ''} data-copy-source>${escapeHtml(file.content)}</pre>
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
// RENDER: ENDPOINTS
// ═════════════════════════════════════════════════════════════

// OpenAPI owns the endpoint surface; preserve path order and use REST method order.
function renderEndpoints(files) {
    const swaggerFile = Array.isArray(files)
        ? files.find(file => file.path === 'swagger.json') : null;
    if (!swaggerFile) return '<p class="output-placeholder">No endpoints generated.</p>';

    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    let spec;
    try {
        spec = JSON.parse(swaggerFile.content);
        if (!isObject(spec) || (spec.paths !== undefined && !isObject(spec.paths))) {
            return '<p class="output-placeholder">Unable to read generated endpoints.</p>';
        }
    } catch (error) {
        return '<p class="output-placeholder">Unable to read generated endpoints.</p>';
    }

    const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];
    const endpoints = [];
    Object.entries(spec.paths || {}).forEach(([path, item]) => {
        if (!path.startsWith('/') || !isObject(item)) return;
        methods.forEach(method => {
            if (Object.prototype.hasOwnProperty.call(item, method) && isObject(item[method])) {
                endpoints.push({ method: method.toUpperCase(), path });
            }
        });
    });
    if (!endpoints.length) return '<p class="output-placeholder">No endpoints generated.</p>';

    return `<div class="endpoint-view">
        <p class="endpoint-count">${endpoints.length} generated ${endpoints.length === 1 ? 'endpoint' : 'endpoints'}</p>
        <ul class="endpoint-list" aria-label="Generated endpoints">${endpoints.map(endpoint => `
            <li class="endpoint-row">
                <span class="endpoint-method">${endpoint.method}</span>
                <code class="endpoint-path">${escapeHtml(endpoint.path)}</code>
            </li>`).join('')}
        </ul>
    </div>`;
}

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

    return `<div class="generated-code-block" data-copy-scope>
        <div class="code-file-header">
            <span>swagger.json</span>
            <span class="code-file-actions">
                <span class="code-file-meta">OpenAPI specification</span>
                ${renderCopyControl('swagger.json')}
            </span>
        </div>
        <pre data-copy-source>${escapeHtml(content)}</pre>
    </div>`;
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
    targetRevision++;
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

function loadDemo() {
    targetRevision++;
    editor.value = PROFESSOR_DEMO.code;
    if (exampleName) exampleName.textContent = PROFESSOR_DEMO.name;
    clearErrorHighlights();
    hideError();
    hideSummary();
    lastCompileResult = null;
    downloadSection.classList.remove('visible');
    resetAllStatus();
    resetOutputPanes('Demo ready', `${PROFESSOR_DEMO.name} is loaded. Press Compile to generate ${TARGET_LABELS[selectedTarget]} output.`);
    switchTab('tokens');
    editor.scrollTop = 0;
    editor.scrollLeft = 0;
    syncScroll();
}

function loadExample() {
    targetRevision++;
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
    const target = selectedTarget;
    const revision = targetRevision;

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
            body: JSON.stringify({ source: editor.value, target })
        });

        const data = await response.json();
        // Target changes and source resets invalidate output from an earlier request.
        if (revision !== targetRevision) return;
        setCompilerAvailability(true);

        // Update phase statuses
        applyPhaseStatuses(data.phases, data.success, data.phase, data.phaseStates);

        if (data.success) {
            // ── Render compilation summary & output tabs ──
            lastCompileResult = data;
            renderSummary(data, target);

            document.getElementById('output-tokens').innerHTML = renderTokens(data.tokens);
            document.getElementById('output-ast').innerHTML = renderAST(data.ast);
            document.getElementById('output-diagram').innerHTML = renderSchemaDiagram(data.ast);
            document.getElementById('output-symboltable').innerHTML = renderSymbolTable(data.symbolTable);
            document.getElementById('output-ir').innerHTML = renderIR(data.ir, 'IR');
            document.getElementById('output-optimized-ir').innerHTML = renderOptimizedIR(data);
            document.getElementById('output-sql').innerHTML = renderSQL(data.generatedFiles);
            document.getElementById('output-endpoints').innerHTML = renderEndpoints(data.generatedFiles);
            document.getElementById('output-api').innerHTML = renderAPIFiles(data.generatedFiles);
            document.getElementById('output-swagger').innerHTML = renderSwagger(data.generatedFiles);

            // Show download button
            downloadSection.classList.add('visible');

            // Switch to tokens tab
            switchTab('tokens');
        } else {
            // ── Error occurred ──
            hideSummary();
            showError(data.phase || 'unknown', data.diagnostics?.map(diagnostic => ({ diagnostic })) || data.errors || [{ message: 'Unknown compilation error.' }]);
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
        if (revision !== targetRevision) return;
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
    demoBtn.addEventListener('click', loadDemo);
    downloadBtn.addEventListener('click', downloadProject);
    targetButtons.forEach(button => {
        button.addEventListener('click', () => selectTarget(button.dataset.target));
    });

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

    document.querySelector('.output-content').addEventListener('click', (event) => {
        const copyControl = event.target.closest('.copy-control');
        if (copyControl) copyGeneratedCode(copyControl);
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
