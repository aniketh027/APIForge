/**
 * ============================================================
 * ERROR UTILITIES - Shared Diagnostics Helpers
 * ============================================================
 *
 * Small, target-independent helpers used across the compiler
 * phases to produce friendlier diagnostics:
 *
 *   levenshtein(a, b)           → edit distance between two strings
 *   suggestClosest(word, ...)   → nearest candidate within a threshold
 *   didYouMeanSuffix(word, ...) → " Did you mean 'X'?" (or "")
 *   formatCodeFrame(src, ...)   → a source excerpt with a caret marker
 *   formatUserFacingError(err)  → human-friendly user error message
 *
 * These have NO dependencies on the lexer/parser/AST so they can
 * be unit-tested in isolation and reused by any phase or the CLI.
 *
 * ============================================================
 */

/**
 * levenshtein(a, b)
 *
 * Classic dynamic-programming edit distance: the minimum number
 * of single-character insertions, deletions, or substitutions
 * required to turn string `a` into string `b`.
 *
 * Comparison is case-sensitive — the DSL keywords, data types,
 * and relation types are all uppercase, so a mistyped token like
 * "STRIMG" sits distance 1 from "STRING".
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} edit distance (>= 0)
 */
function levenshtein(a, b) {
    a = String(a);
    b = String(b);

    const m = a.length;
    const n = b.length;

    if (m === 0) return n;
    if (n === 0) return m;

    // Single-row rolling DP to keep it O(min(m, n)) space.
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        const curr = new Array(n + 1);
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,       // deletion
                curr[j - 1] + 1,   // insertion
                prev[j - 1] + cost // substitution
            );
        }
        prev = curr;
    }

    return prev[n];
}

/**
 * suggestClosest(word, candidates, maxDistance = 2)
 *
 * Returns the candidate closest to `word` by edit distance, but
 * only if it is within `maxDistance`. Otherwise returns null.
 *
 * The threshold of 2 keeps suggestions relevant: a genuine typo
 * ("STRIMG" → "STRING") is offered, while an unrelated word
 * ("VARCHAR" vs the four DSL types) yields nothing.
 *
 * @param {string} word
 * @param {Array<string>} candidates
 * @param {number} [maxDistance=2]
 * @returns {string|null}
 */
function suggestClosest(word, candidates, maxDistance = 2) {
    if (!word || !Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }

    let best = null;
    let bestDist = Infinity;

    for (const candidate of candidates) {
        const dist = levenshtein(word, candidate);
        if (dist < bestDist) {
            bestDist = dist;
            best = candidate;
        }
    }

    return bestDist <= maxDistance ? best : null;
}

/**
 * didYouMeanSuffix(word, candidates, maxDistance = 2)
 *
 * Produces a ready-to-append hint. If a close candidate exists
 * (and it isn't the word itself), returns " Did you mean 'X'?"
 * — note the leading space so it appends cleanly after a message
 * that ends in a period. Otherwise returns "".
 *
 * @param {string} word
 * @param {Array<string>} candidates
 * @param {number} [maxDistance=2]
 * @returns {string}
 */
function didYouMeanSuffix(word, candidates, maxDistance = 2) {
    const suggestion = suggestClosest(word, candidates, maxDistance);
    if (suggestion && suggestion !== word) {
        return ` Did you mean '${suggestion}'?`;
    }
    return '';
}

/**
 * formatCodeFrame(source, line, column, length = 1)
 *
 * Renders a single-line source excerpt with a caret underline,
 * similar to what modern compilers print:
 *
 *     5 | name INT
 *       |      ^
 *
 * `line` and `column` are 1-based. If `line` falls outside the
 * source, an empty string is returned. If `column` is not a
 * positive integer, only the source line is shown (no caret).
 *
 * @param {string} source - Full source text
 * @param {number} line   - 1-based line number
 * @param {number} column - 1-based column number (optional)
 * @param {number} [length=1] - Number of caret characters
 * @returns {string}
 */
function formatCodeFrame(source, line, column, length = 1) {
    const { sourceFrame } = require('./source-frame');
    const location = { line, column };
    if (Number.isInteger(column) && column > 0) {
        location.endLine = line;
        location.endColumn = column + Math.max(1, Number.isInteger(length) ? length : 1);
    }
    return sourceFrame(source, location).map(frame => {
        const gutter = `${frame.line} | `;
        const text = `${gutter}${frame.text}`;
        return frame.pointer ? `${text}\n${' '.repeat(String(frame.line).length)} | ${frame.pointer}` : text;
    }).join('\n');
}

/**
 * formatUserFacingError(err)
 *
 * Extracts a human-friendly user-facing message from an error object,
 * favoring custom userMessage properties while cleanly falling back.
 *
 * @param {Object|string} err
 * @returns {string}
 */
function formatUserFacingError(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err.userMessage) return err.userMessage;
    let msg = err.message || String(err);
    msg = msg.replace(/^Syntax Error at line \d+, column \d+:\s*/i, '');
    msg = msg.replace(/^Semantic Error:\s*/i, '');
    return msg;
}

module.exports = {
    levenshtein,
    suggestClosest,
    didYouMeanSuffix,
    formatCodeFrame,
    formatUserFacingError
};
