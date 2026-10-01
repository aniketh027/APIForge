/**
 * ============================================================
 * PARSER - Phase 2 of the Compiler Pipeline
 * ============================================================
 * 
 * The parser is the SECOND phase. It takes the flat list of
 * tokens from the lexer and organizes them into a tree-shaped
 * data structure called an Abstract Syntax Tree (AST).
 * 
 * ── Parser Type: Recursive Descent ──
 * 
 * We use a "recursive descent" parser — the simplest kind of
 * parser to understand and implement. Each grammar rule gets
 * its own function:
 * 
 *   Grammar Rule          →  Parser Function
 *   ─────────────────────────────────────────
 *   Program               →  parseProgram()
 *   EntityDeclaration     →  parseEntity()
 *   FieldDeclaration      →  parseField()
 *   FieldModifiers        →  parseFieldModifiers()
 * 
 * ── Grammar (EBNF) ──
 * 
 * Program       → (EntityDecl | RelationDecl)*
 * EntityDecl    → 'ENTITY' IDENTIFIER FieldDecl+
 * FieldDecl     → IDENTIFIER DataType FieldModifier*
 * DataType      → 'INT' | 'STRING' | 'FLOAT' | 'BOOLEAN'
 * FieldModifier → 'PRIMARY' 'KEY'
 *               | 'REQUIRED'
 *               | 'UNIQUE'
 *               | 'MIN' NUMBER
 *               | 'MAX' NUMBER
 *               | 'MIN_LENGTH' NUMBER
 *               | 'MAX_LENGTH' NUMBER
 *               | 'DEFAULT' Value
 * Value         → NUMBER | STRING_LITERAL | BOOLEAN_LITERAL
 * 
 * ── User-Facing Error Messages ──
 * When unexpected tokens or EOF are encountered, the parser attaches
 * structured error metadata (`code`, `line`, `column`, `userMessage`)
 * to the thrown Error, providing human-friendly guidance while
 * preserving internal token diagnostics for test compatibility.
 * 
 * ============================================================
 */

const { ProgramNode, EntityNode, FieldNode, RelationNode } = require('../ast/ast');
const { attachDiagnostic } = require('../utils/diagnostics');
const { didYouMeanSuffix } = require('../utils/errors');

// ── Candidate lists for "did you mean?" suggestions ─────────
const DATA_TYPES = ['INT', 'STRING', 'FLOAT', 'BOOLEAN'];
const RELATION_TYPES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];

// ── Value token types that can follow MIN, MAX, DEFAULT ─────
const VALUE_TYPES = new Set(['NUMBER', 'STRING_LITERAL', 'BOOLEAN_LITERAL']);

// ── Parser Class ────────────────────────────────────────────

class Parser {
    /**
     * Constructor — stores the token array and initializes
     * the cursor position to 0 (the first token).
     * 
     * @param {Array} tokens - Token array from the lexer
     */
    constructor(tokens) {
        this.tokens = tokens;  // The token array from Phase 1
        this.pos = 0;          // Cursor: index of the current token
    }

    // ════════════════════════════════════════════════════════
    // CURSOR HELPERS
    // ════════════════════════════════════════════════════════

    /**
     * current() - Returns the token the cursor is pointing at.
     * If we've run past the end, returns the last token (EOF).
     */
    current() {
        if (this.pos < this.tokens.length) {
            return this.tokens[this.pos];
        }
        return this.tokens[this.tokens.length - 1];
    }

    /**
     * peek() - Returns the NEXT token without moving the cursor.
     * Useful for lookahead (checking what's coming next).
     */
    peek() {
        if (this.pos + 1 < this.tokens.length) {
            return this.tokens[this.pos + 1];
        }
        return this.tokens[this.tokens.length - 1];
    }

    /**
     * advance() - Returns the current token AND moves the
     * cursor forward by one position.
     */
    advance() {
        const token = this.current();
        this.pos++;
        return token;
    }

    /**
     * expect(type, value, context) - Asserts that the current token
     * matches the expected type (and optionally value).
     * If it matches, advances and returns the token.
     * If not, throws a syntax error with helpful user and internal messages.
     * 
     * @param {string} type  - Expected token type (e.g., 'IDENTIFIER')
     * @param {string} [value] - Expected token value (optional)
     * @param {Object} [context={}] - Context metadata (e.g. { after: 'ENTITY' })
     * @returns {Object} - The matched token
     * @throws {Error}  - Syntax error if expectation fails
     */
    expect(type, value, context = {}) {
        const token = this.current();

        const typeMismatch = token.type !== type;
        const valueMismatch = value !== undefined && token.value !== value;

        if (typeMismatch || valueMismatch) {
            const expected = value ? `${type} "${value}"` : type;
            let userMessage = null;
            let code = null;

            if (token.type === 'EOF') {
                if (type === 'IDENTIFIER' && context.after === 'ENTITY') {
                    code = 'MISSING_ENTITY_NAME';
                    userMessage = `Missing entity name.\nExpected an identifier after ENTITY.`;
                } else if (type === 'IDENTIFIER' && context.after === 'RELATION') {
                    code = 'MISSING_SOURCE_ENTITY';
                    userMessage = `Missing source entity name.\nExpected an identifier after RELATION.`;
                } else if (type === 'IDENTIFIER' && context.after === 'RELATION_SOURCE') {
                    code = 'MISSING_RELATION_NAME';
                    userMessage = `Missing relationship name.\nExpected an identifier.`;
                } else if (type === 'IDENTIFIER' && context.after === 'RELATION_NAME') {
                    code = 'MISSING_TARGET_ENTITY';
                    userMessage = `Missing target entity name.\nExpected an identifier.`;
                } else if (type === 'IDENTIFIER') {
                    code = 'MISSING_IDENTIFIER';
                    userMessage = `Missing identifier.\nExpected: IDENTIFIER.`;
                }
            }

            const prefix = userMessage
                ? `${userMessage.replace(/\n/g, ' ')} (Expected ${expected} but found ${token.type} "${token.value}").`
                : `Expected ${expected} but found ${token.type} "${token.value}".`;

            const err = new Error(
                `Syntax Error at line ${token.line}, column ${token.column}: ${prefix}`
            );
            err.line = token.line;
            err.column = token.column;
            err.code = code;
            err.userMessage = userMessage || `Expected ${expected} but found ${token.type} "${token.value}".`;
            throw attachDiagnostic(err, 'parser', this.current());
        }

        return this.advance();
    }

    // ════════════════════════════════════════════════════════
    // GRAMMAR RULE: Program → (EntityDecl | RelationDecl)*
    // ════════════════════════════════════════════════════════
    
    /**
     * parseProgram()
     * 
     * The top-level rule. A program is zero or more entity
     * and relationship declarations followed by EOF.
     * 
     * @returns {ProgramNode} - The root AST node
     */
    parseProgram() {
        const program = new ProgramNode();

        // Keep parsing entities and relations until we hit EOF
        while (this.current().type !== 'EOF') {
            if (this.current().type === 'KEYWORD' && this.current().value === 'ENTITY') {
                program.entities.push(this.parseEntity());
            } else if (this.current().type === 'KEYWORD' && this.current().value === 'RELATION') {
                program.relations.push(this.parseRelation());
            } else {
                const token = this.current();
                const err = new Error(
                    `Syntax Error at line ${token.line}, column ${token.column}: ` +
                    `Expected ENTITY declaration but found ${token.type} "${token.value}".`
                );
                err.line = token.line;
                err.column = token.column;
                err.code = 'EXPECTED_ENTITY_DECLARATION';
                err.userMessage = `Expected ENTITY or RELATION declaration, but found ${token.type} "${token.value}".`;
                throw attachDiagnostic(err, 'parser', this.current());
            }
        }

        return program;
    }

    // ════════════════════════════════════════════════════════
    // GRAMMAR RULE: EntityDecl → 'ENTITY' IDENTIFIER FieldDecl+
    // ════════════════════════════════════════════════════════
    
    /**
     * isAtEntityEnd() - Checks if the current token terminates
     * the current entity's field declaration list.
     * Field parsing stops when the current token is:
     * - EOF
     * - ENTITY (keyword)
     * - RELATION (keyword)
     * 
     * @returns {boolean}
     */
    isAtEntityEnd() {
        const token = this.current();
        if (token.type === 'EOF') {
            return true;
        }
        if (token.type === 'KEYWORD' && (token.value === 'ENTITY' || token.value === 'RELATION')) {
            return true;
        }
        return false;
    }

    /**
     * parseEntity()
     * 
     * Parses a single entity declaration:
     *   ENTITY Student
     *       id INT PRIMARY KEY
     *       name STRING REQUIRED
     * 
     * @returns {EntityNode}
     */
    parseEntity() {
        // Step 1: Consume the ENTITY keyword
        const entityKeyword = this.expect('KEYWORD', 'ENTITY');

        // Step 2: Expect an entity name (IDENTIFIER)
        const nameToken = this.expect('IDENTIFIER', undefined, { after: 'ENTITY' });

        // Create the entity AST node
        const entity = new EntityNode(nameToken.value, entityKeyword.line, nameToken.column);
        Object.defineProperty(entity, 'sourceLocations', { value: { name: [nameToken] } });

        // Step 3: Parse fields until we hit another ENTITY, RELATION, or EOF.
        while (!this.isAtEntityEnd()) {
            if (this.current().type === 'IDENTIFIER') {
                entity.fields.push(this.parseField());
            } else {
                const token = this.current();
                const isEof = token.type === 'EOF';
                const userMessage = isEof
                    ? `Missing field name.\nExpected an identifier.`
                    : `Expected field name (IDENTIFIER) but found ${token.type} "${token.value}".`;
                const messageDesc = isEof
                    ? `Missing field name. Expected field name (IDENTIFIER) but found EOF "EOF".`
                    : `Expected field name (IDENTIFIER) but found ${token.type} "${token.value}".`;

                const err = new Error(
                    `Syntax Error at line ${token.line}, column ${token.column}: ${messageDesc}`
                );
                err.line = token.line;
                err.column = token.column;
                err.code = isEof ? 'MISSING_FIELD_NAME' : 'INVALID_FIELD_TOKEN';
                err.userMessage = userMessage;
                throw attachDiagnostic(err, 'parser', this.current());
            }
        }

        return entity;
    }

    // ════════════════════════════════════════════════════════
    // GRAMMAR RULE: RelationDecl → 'RELATION' IDENTIFIER IDENTIFIER IDENTIFIER RelationType
    // ════════════════════════════════════════════════════════
    
    /**
     * parseRelation()
     * 
     * Parses a relationship declaration:
     *   RELATION Student ENROLLS_IN Course MANY_TO_MANY
     * 
     * @returns {RelationNode}
     */
    parseRelation() {
        // Step 1: Consume the RELATION keyword
        const relationKeyword = this.expect('KEYWORD', 'RELATION');

        // Step 2: Expect source entity name (IDENTIFIER)
        const sourceEntityToken = this.expect('IDENTIFIER', undefined, { after: 'RELATION' });

        // Step 3: Expect relationship name (IDENTIFIER)
        const nameToken = this.expect('IDENTIFIER', undefined, { after: 'RELATION_SOURCE' });

        // Step 4: Expect target entity name (IDENTIFIER)
        const targetEntityToken = this.expect('IDENTIFIER', undefined, { after: 'RELATION_NAME' });

        // Step 5: Expect relationship type (RELATION_TYPE)
        const relationTypeTok = this.current();
        if (relationTypeTok.type !== 'RELATION_TYPE') {
            const isEof = relationTypeTok.type === 'EOF';
            const suffix = isEof ? '' : didYouMeanSuffix(relationTypeTok.value, RELATION_TYPES);
            const userMessage = isEof
                ? `Missing relationship type.\nExpected one of: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY.`
                : `Expected RELATION_TYPE but found ${relationTypeTok.type} "${relationTypeTok.value}".${suffix}`;
            const messageDesc = isEof
                ? `Missing relationship type. Expected RELATION_TYPE (one of: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY) but found EOF "EOF".`
                : `Expected RELATION_TYPE but found ${relationTypeTok.type} "${relationTypeTok.value}".${suffix}`;

            const err = new Error(
                `Syntax Error at line ${relationTypeTok.line}, column ${relationTypeTok.column}: ${messageDesc}`
            );
            err.line = relationTypeTok.line;
            err.column = relationTypeTok.column;
            err.code = isEof ? 'MISSING_RELATION_TYPE' : 'INVALID_RELATION_TYPE';
            err.userMessage = userMessage;
            throw attachDiagnostic(err, 'parser', this.current());
        }
        const relationTypeToken = this.advance();

        const relation = new RelationNode(
            sourceEntityToken.value,
            nameToken.value,
            targetEntityToken.value,
            relationTypeToken.value,
            relationKeyword.line,
            sourceEntityToken.column,
            nameToken.column,
            targetEntityToken.column,
            relationTypeToken.column
        );
        Object.defineProperty(relation, 'sourceLocations', { value: {
            name: [nameToken], source: [sourceEntityToken], target: [targetEntityToken], type: [relationTypeToken]
        } });
        return relation;
    }

    // ════════════════════════════════════════════════════════
    // GRAMMAR RULE: FieldDecl → IDENTIFIER DataType FieldModifier*
    // ════════════════════════════════════════════════════════
    
    /**
     * parseField()
     * 
     * Parses a single field declaration:
     *   name STRING REQUIRED
     *   id   INT    PRIMARY KEY
     *   age  INT    MIN 17 MAX 60
     *   name STRING MIN_LENGTH 3 MAX_LENGTH 60
     *   status STRING DEFAULT "active"
     * 
     * @returns {FieldNode}
     */
    parseField() {
        // Step 1: Consume the field name (IDENTIFIER)
        const nameToken = this.advance(); // We already checked it's IDENTIFIER

        // Step 2: Expect a data type (DATATYPE token)
        const typeToken = this.current();
        if (typeToken.type !== 'DATATYPE') {
            const isEof = typeToken.type === 'EOF';
            const suffix = isEof ? '' : didYouMeanSuffix(typeToken.value, DATA_TYPES);
            const userMessage = isEof
                ? `Missing data type for field '${nameToken.value}'.\nExpected one of: INT, STRING, FLOAT, BOOLEAN.`
                : `Expected DATATYPE but found ${typeToken.type} "${typeToken.value}".${suffix}`;
            const messageDesc = isEof
                ? `Missing data type for field '${nameToken.value}'. Expected DATATYPE (one of: INT, STRING, FLOAT, BOOLEAN) but found EOF "EOF".`
                : `Expected DATATYPE but found ${typeToken.type} "${typeToken.value}".${suffix}`;

            const err = new Error(
                `Syntax Error at line ${typeToken.line}, column ${typeToken.column}: ${messageDesc}`
            );
            err.line = typeToken.line;
            err.column = typeToken.column;
            err.code = isEof ? 'MISSING_DATATYPE' : 'INVALID_DATATYPE';
            err.userMessage = userMessage;
            throw attachDiagnostic(err, 'parser', this.current());
        }
        const dataTypeToken = this.advance();

        // Step 3: Parse zero or more field modifiers (constraints, validations, defaults)
        const modifierStart = this.pos;
        const { constraints, validations, defaultValue, defaultValues } = this.parseFieldModifiers();
        const sourceLocations = { name: [nameToken], type: [dataTypeToken] };
        for (let i = modifierStart; i < this.pos; i++) {
            const token = this.tokens[i];
            if (token.type !== 'MODIFIER' || token.value === 'KEY') continue;
            const key = token.value === 'PRIMARY' ? 'PRIMARY_KEY' : token.value;
            let end = token;
            if (['PRIMARY', 'MIN', 'MAX', 'MIN_LENGTH', 'MAX_LENGTH', 'DEFAULT'].includes(token.value)) end = this.tokens[i + 1];
            (sourceLocations[key] ||= []).push({ line: token.line, column: token.column,
                ...(end.endLine ? { endLine: end.endLine, endColumn: end.endColumn } : {}) });
        }

        const fieldNode = new FieldNode(
            nameToken.value,
            dataTypeToken.value,
            constraints,
            nameToken.line,
            nameToken.column,
            dataTypeToken.column,
            validations,
            defaultValue
        );
        if (defaultValues && defaultValues.length > 0) {
            fieldNode.defaultValues = defaultValues;
        }

        Object.defineProperty(fieldNode, 'sourceLocations', { value: sourceLocations });
        return fieldNode;
    }

    // ════════════════════════════════════════════════════════
    // GRAMMAR RULE: FieldModifier* → (Constraint | Validation | Default)*
    //
    // Constraint  → 'PRIMARY' 'KEY' | 'REQUIRED' | 'UNIQUE'
    // Validation  → 'MIN' NUMBER | 'MAX' NUMBER
    //             | 'MIN_LENGTH' NUMBER | 'MAX_LENGTH' NUMBER
    // Default     → 'DEFAULT' Value
    // Value       → NUMBER | STRING_LITERAL | BOOLEAN_LITERAL
    // ════════════════════════════════════════════════════════
    
    /**
     * parseFieldModifiers()
     * 
     * Parses zero or more field modifiers after the data type.
     * Returns an object with constraints, validations, and defaultValue.
     * 
     * @returns {{ constraints: string[], validations: Array, defaultValue: Object|null }}
     */
    parseFieldModifiers() {
        const constraints = [];
        const validations = [];
        let defaultValue = null;
        const defaultValues = [];

        // Keep reading while the current token is a MODIFIER
        while (this.current().type === 'MODIFIER') {
            const token = this.current();

            switch (token.value) {
                case 'PRIMARY':
                    // PRIMARY must be followed by KEY
                    this.advance(); // consume PRIMARY

                    // Check that KEY follows immediately
                    if (this.current().type === 'MODIFIER' && this.current().value === 'KEY') {
                        this.advance(); // consume KEY
                        constraints.push('PRIMARY_KEY');
                    } else {
                        // PRIMARY without KEY — syntax error
                        const next = this.current();
                        const isEof = next.type === 'EOF';
                        const userMessage = isEof
                            ? `Missing KEY after PRIMARY.\nExpected: KEY.`
                            : `Expected "KEY" after "PRIMARY" but found ${next.type} "${next.value}".`;
                        const messageDesc = isEof
                            ? `Missing KEY after PRIMARY. Expected "KEY" after "PRIMARY" but found ${next.type} "${next.value}".`
                            : `Expected "KEY" after "PRIMARY" but found ${next.type} "${next.value}".`;

                        const err = new Error(
                            `Syntax Error at line ${next.line}, column ${next.column}: ${messageDesc}`
                        );
                        err.line = next.line;
                        err.column = next.column;
                        err.code = 'MISSING_KEY_AFTER_PRIMARY';
                        err.userMessage = userMessage;
                        throw attachDiagnostic(err, 'parser', this.current());
                    }
                    break;

                case 'KEY':
                    // KEY without a preceding PRIMARY — syntax error
                    const errKey = new Error(
                        `Syntax Error at line ${token.line}, column ${token.column}: ` +
                        `"KEY" must be preceded by "PRIMARY". Found standalone "KEY".`
                    );
                    errKey.line = token.line;
                    errKey.column = token.column;
                    errKey.code = 'STANDALONE_KEY';
                    errKey.userMessage = `"KEY" must be preceded by "PRIMARY". Found standalone "KEY".`;
                    throw attachDiagnostic(errKey, 'parser', this.current());

                case 'REQUIRED':
                    this.advance();
                    constraints.push('REQUIRED');
                    break;

                case 'UNIQUE':
                    this.advance();
                    constraints.push('UNIQUE');
                    break;

                case 'MIN': {
                    const minKeyword = this.advance(); // consume MIN
                    const valToken = this.current();

                    if (valToken.type === 'NUMBER') {
                        this.advance();
                        validations.push({ type: 'MIN', value: parseFloat(valToken.value) });
                    } else {
                        const isEof = valToken.type === 'EOF';
                        const userMessage = isEof
                            ? `Missing value after MIN.\nExpected a number.`
                            : `Missing value after MIN.\nExpected a number but found ${valToken.type} "${valToken.value}".`;
                        const messageDesc = `Expected NUMBER after MIN but found ${valToken.type} "${valToken.value}".`;

                        const err = new Error(
                            `Syntax Error at line ${valToken.line}, column ${valToken.column}: ${messageDesc}`
                        );
                        err.line = valToken.line;
                        err.column = valToken.column;
                        err.code = 'MISSING_MIN_VALUE';
                        err.userMessage = userMessage;
                        throw attachDiagnostic(err, 'parser', this.current());
                    }
                    break;
                }

                case 'MAX': {
                    const maxKeyword = this.advance(); // consume MAX
                    const valToken = this.current();

                    if (valToken.type === 'NUMBER') {
                        this.advance();
                        validations.push({ type: 'MAX', value: parseFloat(valToken.value) });
                    } else {
                        const isEof = valToken.type === 'EOF';
                        const userMessage = isEof
                            ? `Missing value after MAX.\nExpected a number.`
                            : `Missing value after MAX.\nExpected a number but found ${valToken.type} "${valToken.value}".`;
                        const messageDesc = `Expected NUMBER after MAX but found ${valToken.type} "${valToken.value}".`;

                        const err = new Error(
                            `Syntax Error at line ${valToken.line}, column ${valToken.column}: ${messageDesc}`
                        );
                        err.line = valToken.line;
                        err.column = valToken.column;
                        err.code = 'MISSING_MAX_VALUE';
                        err.userMessage = userMessage;
                        throw attachDiagnostic(err, 'parser', this.current());
                    }
                    break;
                }

                case 'MIN_LENGTH': {
                    this.advance(); // consume MIN_LENGTH
                    const valToken = this.current();

                    if (valToken.type === 'NUMBER') {
                        this.advance();
                        validations.push({ type: 'MIN_LENGTH', value: parseFloat(valToken.value) });
                    } else {
                        const isEof = valToken.type === 'EOF';
                        const userMessage = isEof
                            ? `Missing value after MIN_LENGTH.\nExpected a non-negative integer.`
                            : `Missing value after MIN_LENGTH.\nExpected a non-negative integer but found ${valToken.type} "${valToken.value}".`;
                        const messageDesc = `Expected NUMBER after MIN_LENGTH but found ${valToken.type} "${valToken.value}".`;

                        const err = new Error(
                            `Syntax Error at line ${valToken.line}, column ${valToken.column}: ${messageDesc}`
                        );
                        err.line = valToken.line;
                        err.column = valToken.column;
                        err.code = 'MISSING_MIN_LENGTH_VALUE';
                        err.userMessage = userMessage;
                        throw attachDiagnostic(err, 'parser', this.current());
                    }
                    break;
                }

                case 'MAX_LENGTH': {
                    this.advance(); // consume MAX_LENGTH
                    const valToken = this.current();

                    if (valToken.type === 'NUMBER') {
                        this.advance();
                        validations.push({ type: 'MAX_LENGTH', value: parseFloat(valToken.value) });
                    } else {
                        const isEof = valToken.type === 'EOF';
                        const userMessage = isEof
                            ? `Missing value after MAX_LENGTH.\nExpected a non-negative integer.`
                            : `Missing value after MAX_LENGTH.\nExpected a non-negative integer but found ${valToken.type} "${valToken.value}".`;
                        const messageDesc = `Expected NUMBER after MAX_LENGTH but found ${valToken.type} "${valToken.value}".`;

                        const err = new Error(
                            `Syntax Error at line ${valToken.line}, column ${valToken.column}: ${messageDesc}`
                        );
                        err.line = valToken.line;
                        err.column = valToken.column;
                        err.code = 'MISSING_MAX_LENGTH_VALUE';
                        err.userMessage = userMessage;
                        throw attachDiagnostic(err, 'parser', this.current());
                    }
                    break;
                }

                case 'DEFAULT': {
                    const defKeyword = this.advance(); // consume DEFAULT
                    const valToken = this.current();

                    if (valToken.type === 'NUMBER') {
                        this.advance();
                        defaultValue = { type: 'NUMBER', value: parseFloat(valToken.value) };
                        defaultValues.push(defaultValue);
                    } else if (valToken.type === 'STRING_LITERAL') {
                        this.advance();
                        defaultValue = { type: 'STRING', value: valToken.value };
                        defaultValues.push(defaultValue);
                    } else if (valToken.type === 'BOOLEAN_LITERAL') {
                        this.advance();
                        defaultValue = { type: 'BOOLEAN', value: valToken.value === 'TRUE' };
                        defaultValues.push(defaultValue);
                    } else {
                        const isEof = valToken.type === 'EOF';
                        const userMessage = isEof
                            ? `Missing default value.\nExpected a number, string, or boolean.`
                            : `Missing default value.\nExpected a number, string, or boolean but found ${valToken.type} "${valToken.value}".`;
                        const messageDesc = `Expected value after DEFAULT but found ${valToken.type} "${valToken.value}".`;

                        const err = new Error(
                            `Syntax Error at line ${valToken.line}, column ${valToken.column}: ${messageDesc}`
                        );
                        err.line = valToken.line;
                        err.column = valToken.column;
                        err.code = 'MISSING_DEFAULT_VALUE';
                        err.userMessage = userMessage;
                        throw attachDiagnostic(err, 'parser', this.current());
                    }
                    break;
                }

                default:
                    const errMod = new Error(
                        `Syntax Error at line ${token.line}, column ${token.column}: ` +
                        `Unknown modifier "${token.value}".`
                    );
                    errMod.line = token.line;
                    errMod.column = token.column;
                    errMod.code = 'UNKNOWN_MODIFIER';
                    errMod.userMessage = `Unknown modifier "${token.value}".`;
                    throw attachDiagnostic(errMod, 'parser', this.current());
            }
        }

        return { constraints, validations, defaultValue, defaultValues };
    }
}

// ════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════

/**
 * parse(tokens)
 * 
 * The public entry point. Creates a Parser instance and
 * runs the top-level parseProgram() rule.
 * 
 * @param {Array} tokens - Token array from the lexer
 * @returns {ProgramNode} - The root AST node
 */
function parse(tokens) {
    const parser = new Parser(tokens);
    return parser.parseProgram();
}

module.exports = {
    parse
};
