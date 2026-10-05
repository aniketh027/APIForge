/**
 * ============================================================
 * LEXER (Tokenizer) - Phase 1 of the Compiler Pipeline
 * ============================================================
 * 
 * The lexer is the FIRST phase of any compiler. Its job is to
 * read the raw source code (a string of characters) and break
 * it into a list of "tokens" — meaningful units of the language.
 * 
 * For example, given:    ENTITY Student
 * The lexer produces:    [{ type: 'KEYWORD', value: 'ENTITY' },
 *                         { type: 'IDENTIFIER', value: 'Student' }]
 * 
 * Think of the lexer like a "word splitter" that also classifies
 * each word into a category (keyword, identifier, data type, etc.)
 * 
 * ── How it works (high level) ──
 * 
 * 1. We maintain a "cursor" pointing to the current character.
 * 2. We skip whitespace and comments.
 * 3. When we find a letter or underscore, we read the entire
 *    word (letters, digits, underscores) and classify it:
 *      - Is it a keyword?   → KEYWORD token
 *      - Is it a data type? → DATATYPE token
 *      - Is it a modifier?  → MODIFIER token
 *      - Otherwise          → IDENTIFIER token
 * 4. When we find a digit, we read a number literal (integer
 *    or decimal) and produce a NUMBER token.
 * 5. When we find a double-quote, we read a string literal
 *    (up to the closing quote) and produce a STRING_LITERAL.
 * 6. Any other unexpected character is a lexical error.
 * 7. At the end, we append an EOF token.
 * 
 * ── Token Types ──
 * 
 * KEYWORD         → ENTITY, RELATION
 * DATATYPE        → INT, STRING, FLOAT, BOOLEAN, ENUM, DATE, TIMESTAMP
 * LPAREN / RPAREN / COMMA → (, ), , (ENUM value delimiters)
 * MODIFIER        → PRIMARY, KEY, REQUIRED, UNIQUE, MIN, MAX,
 *                   MIN_LENGTH, MAX_LENGTH, DEFAULT
 * RELATION_TYPE   → ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
 * IDENTIFIER      → any user-defined name (e.g., Student, age)
 * NUMBER          → numeric literals (e.g., 17, 8.5)
 * STRING_LITERAL  → quoted strings (e.g., "active")
 * BOOLEAN_LITERAL → TRUE, FALSE
 * EOF             → marks the end of input
 * 
 * ── Token Shape ──
 * 
 * Each token is a plain object:
 *   {
 *     type:   "KEYWORD",   // token category
 *     value:  "ENTITY",    // the actual text
 *     line:   1,           // line number (1-indexed)
 *     column: 1            // column number (1-indexed)
 *   }
 * 
 * ============================================================
 */

// ── Reserved Word Tables ────────────────────────────────────
// We look up each word we read in these sets to classify it.
// If it's not in any set, it's treated as an IDENTIFIER.

/**
 * Language keywords.
 * ENTITY - Entity declaration
 * RELATION - Relationship declaration
 */
const { attachDiagnostic } = require('../utils/diagnostics');

const KEYWORDS = new Set([
    'ENTITY',
    'RELATION'
]);

const PUNCTUATION = { '(': 'LPAREN', ')': 'RPAREN', ',': 'COMMA' };

/**
 * Supported relationship types.
 * Defines the cardinality between entities:
 *   ONE_TO_ONE
 *   ONE_TO_MANY
 *   MANY_TO_ONE
 *   MANY_TO_MANY
 */
const RELATION_TYPES = new Set([
    'ONE_TO_ONE',
    'ONE_TO_MANY',
    'MANY_TO_ONE',
    'MANY_TO_MANY'
]);

/**
 * Supported data types.
 * These map to MySQL types during code generation.
 *   INT     → INT
 *   STRING  → VARCHAR(255)
 *   FLOAT   → FLOAT
 *   BOOLEAN → TINYINT(1)
 *   DATE    → DATE
 *   TIMESTAMP → TIMESTAMP
 */
const { SUPPORTED_DATA_TYPES } = require('../utils/temporal');
const DATA_TYPES = new Set(SUPPORTED_DATA_TYPES);

/**
 * Field modifiers / constraints.
 * PRIMARY and KEY are separate tokens — the parser
 * will later combine them into a single PRIMARY KEY constraint.
 * MIN, MAX, MIN_LENGTH, MAX_LENGTH, and DEFAULT are validation/default modifiers —
 * the parser reads a following value token for each.
 */
const MODIFIERS = new Set([
    'PRIMARY',
    'KEY',
    'REQUIRED',
    'UNIQUE',
    'MIN',
    'MAX',
    'MIN_LENGTH',
    'MAX_LENGTH',
    'DEFAULT'
]);

/**
 * Boolean literal values.
 * TRUE and FALSE are recognized as BOOLEAN_LITERAL tokens.
 */
const BOOLEAN_LITERALS = new Set([
    'TRUE',
    'FALSE'
]);


// ── Helper Functions ────────────────────────────────────────

/**
 * isAlpha(ch)
 * Returns true if the character is a letter (a-z, A-Z)
 * or an underscore. These are valid starting characters
 * for identifiers.
 */
function isAlpha(ch) {
    return /[a-zA-Z_]/.test(ch);
}

/**
 * isDigit(ch)
 * Returns true if the character is a decimal digit (0-9).
 */
function isDigit(ch) {
    return /[0-9]/.test(ch);
}

/**
 * isAlphaNumeric(ch)
 * Returns true if the character is a letter, digit, or
 * underscore. These are valid characters INSIDE an identifier
 * (but an identifier cannot START with a digit).
 */
function isAlphaNumeric(ch) {
    return /[a-zA-Z0-9_]/.test(ch);
}

/**
 * isWhitespace(ch)
 * Returns true for spaces, tabs, and carriage returns.
 * Note: newlines (\n) are handled separately so we can
 * increment the line counter.
 */
function isWhitespace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\r';
}


// ── Token Factory ───────────────────────────────────────────

/**
 * createToken(type, value, line, column)
 * 
 * Creates a token object. Having a factory function keeps
 * the token shape consistent across the entire lexer.
 * 
 * @param {string} type   - Token category (KEYWORD, DATATYPE, etc.)
 * @param {string} value  - The actual text from the source code
 * @param {number} line   - Line number where the token starts (1-indexed)
 * @param {number} column - Column number where the token starts (1-indexed)
 * @returns {Object}      - The token object
 */
function createToken(type, value, line, column, endColumn) {
    return { type, value, line, column, ...(endColumn ? { endLine: line, endColumn } : {}) };
}


// ── Main Tokenizer ──────────────────────────────────────────

/**
 * tokenize(sourceCode)
 * 
 * The main function of the lexer. Takes the entire source
 * code as a string and returns an array of tokens.
 * 
 * Algorithm:
 *   1. Start at position 0, line 1, column 1.
 *   2. Loop through every character:
 *      a. If newline → increment line, reset column, continue.
 *      b. If whitespace → skip, increment column, continue.
 *      c. If "//" → skip the rest of the line (comment).
 *      d. If letter/underscore → read full word, classify it.
 *      e. If digit → read number literal (integer or decimal).
 *      f. If double-quote → read string literal.
 *      g. Anything else → error (unexpected character).
 *   3. Append an EOF token at the end.
 *   4. Return the token array.
 * 
 * @param {string} sourceCode - The raw .apiforge source code
 * @returns {Array}           - Array of token objects
 * @throws {Error}            - On lexical errors (with line/column info)
 */
function tokenize(sourceCode) {
    // Strip leading UTF-8 Byte Order Mark (BOM) if present
    if (typeof sourceCode === 'string' && sourceCode.charCodeAt(0) === 0xFEFF) {
        sourceCode = sourceCode.slice(1);
    }

    const tokens = [];     // Output array — we push tokens here
    let pos = 0;           // Current position in the source string
    let line = 1;          // Current line number (1-indexed)
    let column = 1;        // Current column number (1-indexed)

    // ── Main scanning loop ──────────────────────────────────
    // We process one character at a time. The variable `pos`
    // advances through the source code string.

    while (pos < sourceCode.length) {
        const ch = sourceCode[pos];

        if (PUNCTUATION[ch]) {
            tokens.push(createToken(PUNCTUATION[ch], ch, line, column, column + 1));
            pos++;
            column++;
            continue;
        }

        // ── Case 1: Newline ─────────────────────────────────
        // When we hit a newline, move to the next line and
        // reset the column counter. Don't produce a token.
        if (ch === '\n') {
            line++;
            column = 1;
            pos++;
            continue;
        }

        // ── Case 2: Whitespace (space, tab, carriage return) ─
        // Skip it. These are not meaningful in our DSL.
        if (isWhitespace(ch)) {
            pos++;
            column++;
            continue;
        }

        // ── Case 3: Single-line comment (//) ────────────────
        // If we see "//", skip everything until end of line.
        // Comments are for humans, not for the compiler.
        if (ch === '/' && pos + 1 < sourceCode.length && sourceCode[pos + 1] === '/') {
            // Advance past all characters until newline or EOF
            while (pos < sourceCode.length && sourceCode[pos] !== '\n') {
                pos++;
                column++;
            }
            // Don't increment line here — the newline character
            // will be handled by Case 1 in the next iteration.
            continue;
        }

        // ── Case 4: Word (letter or underscore) ─────────────
        // Read the full word, then look it up in our reserved
        // word tables to classify it.
        if (isAlpha(ch)) {
            const startColumn = column;
            let word = '';

            // Keep reading while we see letters, digits, or underscores
            while (pos < sourceCode.length && isAlphaNumeric(sourceCode[pos])) {
                word += sourceCode[pos];
                pos++;
                column++;
            }

            // Classify the word:
            //   1. Check if it's a keyword  (e.g., ENTITY, RELATION)
            //   2. Check if it's a relation type (e.g., ONE_TO_ONE, MANY_TO_MANY)
            //   3. Check if it's a data type (e.g., INT, STRING)
            //   4. Check if it's a boolean literal (TRUE, FALSE)
            //   5. Check if it's a modifier  (e.g., PRIMARY, REQUIRED, MIN, MIN_LENGTH, DEFAULT)
            //   6. Otherwise, it's an identifier (e.g., Student, ENROLLS_IN)

            let type;

            if (KEYWORDS.has(word)) {
                type = 'KEYWORD';
            } else if (RELATION_TYPES.has(word)) {
                type = 'RELATION_TYPE';
            } else if (DATA_TYPES.has(word)) {
                type = 'DATATYPE';
            } else if (BOOLEAN_LITERALS.has(word)) {
                type = 'BOOLEAN_LITERAL';
            } else if (MODIFIERS.has(word)) {
                type = 'MODIFIER';
            } else {
                type = 'IDENTIFIER';
            }

            tokens.push(createToken(type, word, line, startColumn, column));
            continue;
        }

        // ── Case 5: Number literal ──────────────────────────
        // Read an integer or decimal number (e.g., 17, -5, 8.5, -3.14).
        // Used as values for MIN, MAX, MIN_LENGTH, MAX_LENGTH, and DEFAULT modifiers.
        if (isDigit(ch) || (ch === '-' && pos + 1 < sourceCode.length && isDigit(sourceCode[pos + 1]))) {
            const startColumn = column;
            let numStr = '';

            if (ch === '-') {
                numStr += '-';
                pos++;
                column++;
            }

            // Read integer part
            while (pos < sourceCode.length && isDigit(sourceCode[pos])) {
                numStr += sourceCode[pos];
                pos++;
                column++;
            }

            // Check for decimal point
            if (pos < sourceCode.length && sourceCode[pos] === '.' &&
                pos + 1 < sourceCode.length && isDigit(sourceCode[pos + 1])) {
                numStr += sourceCode[pos]; // consume '.'
                pos++;
                column++;

                // Read fractional part
                while (pos < sourceCode.length && isDigit(sourceCode[pos])) {
                    numStr += sourceCode[pos];
                    pos++;
                    column++;
                }
            }

            if (sourceCode[pos] === '.') {
                const err = new Error(`Lexical Error at line ${line}, column ${column}: Malformed numeric literal.`);
                err.line = line;
                err.column = column;
                err.code = 'MALFORMED_NUMBER';
                err.userMessage = numStr.includes('.')
                    ? 'Malformed numeric literal: a number cannot contain multiple decimal points.'
                    : 'Malformed numeric literal: expected a digit after the decimal point.';
                throw attachDiagnostic(err, 'lexer', { line, column, endLine: line, endColumn: column + 1 },
                    err.code, numStr.includes('.') ? 'Use a single decimal point in a number.'
                        : 'A decimal point must be followed by a digit, for example 8.0.');
            }

            // If followed by a letter/underscore, it's an invalid identifier
            if (pos < sourceCode.length && isAlpha(sourceCode[pos])) {
                let badToken = numStr;
                while (pos < sourceCode.length && isAlphaNumeric(sourceCode[pos])) {
                    badToken += sourceCode[pos];
                    pos++;
                    column++;
                }
                const err = new Error(
                    `Lexical Error at line ${line}, column ${startColumn}: ` +
                    `Identifier "${badToken}" cannot start with a digit.`
                );
                err.line = line;
                err.column = startColumn;
                err.code = 'INVALID_IDENTIFIER';
                err.userMessage = `Identifier "${badToken}" cannot start with a digit at line ${line}, column ${startColumn}.`;
                throw attachDiagnostic(err, 'lexer', { line, column: startColumn, endLine: line, endColumn: column });
            }

            tokens.push(createToken('NUMBER', numStr, line, startColumn, column));
            continue;
        }

        // ── Case 6: String literal ("...") ──────────────────
        // Read a double-quoted string. The token value contains
        // only the content (without the quotes).
        if (ch === '"') {
            const startColumn = column;
            pos++;      // skip opening quote
            column++;
            let str = '';

            while (pos < sourceCode.length && sourceCode[pos] !== '"' && sourceCode[pos] !== '\n') {
                str += sourceCode[pos];
                pos++;
                column++;
            }

            if (pos >= sourceCode.length || sourceCode[pos] === '\n') {
                const err = new Error(
                    `Lexical Error at line ${line}, column ${startColumn}: ` +
                    `Unterminated string literal.`
                );
                err.line = line;
                err.column = startColumn;
                err.code = 'UNTERMINATED_STRING';
                err.userMessage = `Unterminated string literal at line ${line}, column ${startColumn}.`;
                throw attachDiagnostic(err, 'lexer', { line, column: startColumn, endLine: line, endColumn: column });
            }

            pos++;      // skip closing quote
            column++;

            tokens.push(createToken('STRING_LITERAL', str, line, startColumn, column));
            continue;
        }

        // Negative number support: '-' followed by a digit
        if (ch === '-' && pos + 1 < sourceCode.length && isDigit(sourceCode[pos + 1])) {
            const startColumn = column;
            let num = '-';
            pos++;
            column++;
            
            while (pos < sourceCode.length && isDigit(sourceCode[pos])) {
                num += sourceCode[pos];
                pos++;
                column++;
            }
            
            // Handle decimal part
            if (pos < sourceCode.length && sourceCode[pos] === '.' && pos + 1 < sourceCode.length && isDigit(sourceCode[pos + 1])) {
                num += '.';
                pos++;
                column++;
                while (pos < sourceCode.length && isDigit(sourceCode[pos])) {
                    num += sourceCode[pos];
                    pos++;
                    column++;
                }
            }
            
            tokens.push(createToken('NUMBER', num, line, startColumn, column));
            continue;
        }

        // ── Case 7: Unexpected character ────────────────────
        // If we reach here, the character is not a letter,
        // digit, whitespace, newline, quote, or comment starter.
        // It's something our DSL doesn't understand (e.g., @, #, $).
        const err = new Error(
            `Lexical Error at line ${line}, column ${column}: ` +
            `Unexpected character '${ch}' (char code ${ch.charCodeAt(0)}).`
        );
        err.line = line;
        err.column = column;
        err.code = 'UNEXPECTED_CHARACTER';
        err.userMessage = `Unexpected character '${ch}' at line ${line}, column ${column}.`;
        throw attachDiagnostic(err, 'lexer', { line, column, endLine: line, endColumn: column + 1 });
    }

    // ── Append EOF token ────────────────────────────────────
    // Every compiler's lexer produces an EOF (End Of File)
    // token. This tells the parser "there's nothing left to
    // read" and simplifies parsing logic (the parser can
    // always check the next token without worrying about
    // array bounds).

    tokens.push(createToken('EOF', 'EOF', line, column));

    return tokens;
}


// ── Exports ─────────────────────────────────────────────────

module.exports = {
    tokenize
};
