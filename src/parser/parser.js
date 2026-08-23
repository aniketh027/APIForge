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
 *   Constraints           →  parseConstraints()
 * 
 * ── Grammar (EBNF) ──
 * 
 * Program     → EntityDecl*
 * EntityDecl  → 'ENTITY' IDENTIFIER FieldDecl+
 * FieldDecl   → IDENTIFIER DataType Constraint*
 * DataType    → 'INT' | 'STRING' | 'FLOAT' | 'BOOLEAN'
 * Constraint  → 'PRIMARY' 'KEY' | 'REQUIRED' | 'UNIQUE'
 * 
 * ── How the cursor works ──
 * 
 * The parser maintains a cursor (this.pos) that points to the
 * current token in the token array. Helper methods:
 * 
 *   current()  → returns the token at this.pos
 *   peek()     → returns the NEXT token (this.pos + 1)
 *   advance()  → returns current token and moves cursor forward
 *   expect()   → like advance(), but throws if the token doesn't
 *                 match the expected type/value
 * 
 * ── Example ──
 * 
 * Tokens:  ENTITY  Student  id  INT  PRIMARY  KEY  name  STRING  REQUIRED  EOF
 *          ^
 *          cursor starts here
 * 
 * parseProgram() sees KEYWORD "ENTITY" → calls parseEntity()
 * parseEntity()  consumes ENTITY, Student → calls parseField() in a loop
 * parseField()   consumes id, INT → calls parseConstraints()
 * parseConstraints() consumes PRIMARY, KEY → returns ["PRIMARY_KEY"]
 * ...and so on until we reach EOF.
 * 
 * ============================================================
 */

const { ProgramNode, EntityNode, FieldNode, RelationNode } = require('../ast/ast');
const { didYouMeanSuffix } = require('../utils/errors');

// ── Candidate lists for "did you mean?" suggestions ─────────
const DATA_TYPES = ['INT', 'STRING', 'FLOAT', 'BOOLEAN'];
const RELATION_TYPES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];

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
        // Safety: return the last token (should be EOF)
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
     * 
     * Think of it like reading: you read the current word,
     * then your eye moves to the next word.
     */
    advance() {
        const token = this.current();
        this.pos++;
        return token;
    }

    /**
     * expect(type, value) - Asserts that the current token
     * matches the expected type (and optionally value).
     * If it matches, advances and returns the token.
     * If not, throws a syntax error with a helpful message.
     * 
     * @param {string} type  - Expected token type (e.g., 'IDENTIFIER')
     * @param {string} [value] - Expected token value (optional)
     * @returns {Object} - The matched token
     * @throws {Error}  - Syntax error if expectation fails
     */
    expect(type, value) {
        const token = this.current();

        // Check type match
        if (token.type !== type) {
            const expected = value ? `${type} "${value}"` : type;
            throw new Error(
                `Syntax Error at line ${token.line}, column ${token.column}: ` +
                `Expected ${expected} but found ${token.type} "${token.value}".`
            );
        }

        // Check value match (if a specific value was required)
        if (value !== undefined && token.value !== value) {
            throw new Error(
                `Syntax Error at line ${token.line}, column ${token.column}: ` +
                `Expected ${type} "${value}" but found ${type} "${token.value}".`
            );
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
     * An empty program (just EOF) is valid — it simply has
     * no entities or relations.
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
                throw new Error(
                    `Syntax Error at line ${token.line}, column ${token.column}: ` +
                    `Expected ENTITY declaration but found ${token.type} "${token.value}".`
                );
            }
        }

        return program;
    }

    // ════════════════════════════════════════════════════════
    // GRAMMAR RULE: EntityDecl → 'ENTITY' IDENTIFIER FieldDecl+
    // ════════════════════════════════════════════════════════
    
    /**
     * parseEntity()
     * 
     * Parses a single entity declaration:
     *   ENTITY Student
     *       id INT PRIMARY KEY
     *       name STRING REQUIRED
     *       ...
     * 
     * An entity MUST have:
     *   1. The ENTITY keyword
     *   2. An IDENTIFIER (the entity name)
     *   3. At least one field declaration
     * 
     * Fields continue until we see another ENTITY or RELATION keyword or EOF.
     * 
     * @returns {EntityNode}
     */
    parseEntity() {
        // Step 1: Consume the ENTITY keyword
        const entityKeyword = this.expect('KEYWORD', 'ENTITY');

        // Step 2: Expect an entity name (IDENTIFIER)
        const nameToken = this.expect('IDENTIFIER');

        // Create the entity AST node
        const entity = new EntityNode(nameToken.value, entityKeyword.line, nameToken.column);

        // Step 3: Parse fields until we hit another ENTITY, RELATION, or EOF.
        // A field always starts with an IDENTIFIER (the field name).
        while (
            this.current().type !== 'EOF' &&
            !(this.current().type === 'KEYWORD' && (this.current().value === 'ENTITY' || this.current().value === 'RELATION'))
        ) {
            // A field must start with an IDENTIFIER (field name).
            // If we see something else, it's a syntax error.
            if (this.current().type === 'IDENTIFIER') {
                entity.fields.push(this.parseField());
            } else {
                const token = this.current();
                throw new Error(
                    `Syntax Error at line ${token.line}, column ${token.column}: ` +
                    `Expected field name (IDENTIFIER) but found ${token.type} "${token.value}".`
                );
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
     * Grammar:
     *   RELATION IDENTIFIER IDENTIFIER IDENTIFIER RELATION_TYPE
     * 
     * - The 1st IDENTIFIER is the source entity name.
     * - The 2nd IDENTIFIER is the relationship name.
     * - The 3rd IDENTIFIER is the target entity name.
     * - The RELATION_TYPE is ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, or MANY_TO_MANY.
     * 
     * @returns {RelationNode}
     */
    parseRelation() {
        // Step 1: Consume the RELATION keyword
        const relationKeyword = this.expect('KEYWORD', 'RELATION');

        // Step 2: Expect source entity name (IDENTIFIER)
        const sourceEntityToken = this.expect('IDENTIFIER');

        // Step 3: Expect relationship name (IDENTIFIER)
        const nameToken = this.expect('IDENTIFIER');

        // Step 4: Expect target entity name (IDENTIFIER)
        const targetEntityToken = this.expect('IDENTIFIER');

        // Step 5: Expect relationship type (RELATION_TYPE)
        // As with data types, keep the canonical "Expected RELATION_TYPE"
        // phrasing and append a suggestion on a near-miss.
        const relationTypeTok = this.current();
        if (relationTypeTok.type !== 'RELATION_TYPE') {
            const suffix = didYouMeanSuffix(relationTypeTok.value, RELATION_TYPES);
            throw new Error(
                `Syntax Error at line ${relationTypeTok.line}, column ${relationTypeTok.column}: ` +
                `Expected RELATION_TYPE but found ${relationTypeTok.type} "${relationTypeTok.value}".` + suffix
            );
        }
        const relationTypeToken = this.advance();

        return new RelationNode(
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
    }

    // ════════════════════════════════════════════════════════
    // GRAMMAR RULE: FieldDecl → IDENTIFIER DataType Constraint*
    // ════════════════════════════════════════════════════════
    
    /**
     * parseField()
     * 
     * Parses a single field declaration:
     *   name STRING REQUIRED
     *   id   INT    PRIMARY KEY
     *   age  INT
     * 
     * A field MUST have:
     *   1. An IDENTIFIER (field name)
     *   2. A DATATYPE (INT, STRING, FLOAT, BOOLEAN)
     *   3. Zero or more constraints (optional)
     * 
     * @returns {FieldNode}
     */
    parseField() {
        // Step 1: Consume the field name (IDENTIFIER)
        const nameToken = this.advance(); // We already checked it's IDENTIFIER

        // Step 2: Expect a data type (DATATYPE token)
        // If the next token is not a DATATYPE, it's an error. We keep the
        // canonical "Expected DATATYPE" phrasing but append a "did you mean?"
        // hint when the offending word is a near-miss of a real type.
        const typeToken = this.current();
        if (typeToken.type !== 'DATATYPE') {
            const suffix = didYouMeanSuffix(typeToken.value, DATA_TYPES);
            throw new Error(
                `Syntax Error at line ${typeToken.line}, column ${typeToken.column}: ` +
                `Expected DATATYPE but found ${typeToken.type} "${typeToken.value}".` + suffix
            );
        }
        const dataTypeToken = this.advance();

        // Step 3: Parse zero or more constraints
        const constraints = this.parseConstraints();

        return new FieldNode(
            nameToken.value,
            dataTypeToken.value,
            constraints,
            nameToken.line,
            nameToken.column,
            dataTypeToken.column
        );
    }

    // ════════════════════════════════════════════════════════
    // GRAMMAR RULE: Constraint → 'PRIMARY' 'KEY' | 'REQUIRED' | 'UNIQUE'
    // ════════════════════════════════════════════════════════
    
    /**
     * parseConstraints()
     * 
     * Parses zero or more field constraints. Called after the
     * data type in a field declaration.
     * 
     * Important logic:
     *   - PRIMARY must be immediately followed by KEY.
     *     Together they form the single constraint "PRIMARY_KEY".
     *   - KEY appearing without a preceding PRIMARY is an error.
     *   - REQUIRED and UNIQUE are standalone constraints.
     * 
     * We keep consuming MODIFIER tokens until we see something
     * that isn't a MODIFIER (which means the field is done).
     * 
     * @returns {Array<string>} - e.g., ["PRIMARY_KEY"], ["REQUIRED"], []
     */
    parseConstraints() {
        const constraints = [];

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
                        throw new Error(
                            `Syntax Error at line ${next.line}, column ${next.column}: ` +
                            `Expected "KEY" after "PRIMARY" but found ${next.type} "${next.value}".`
                        );
                    }
                    break;

                case 'KEY':
                    // KEY without a preceding PRIMARY — syntax error
                    throw new Error(
                        `Syntax Error at line ${token.line}, column ${token.column}: ` +
                        `"KEY" must be preceded by "PRIMARY". Found standalone "KEY".`
                    );

                case 'REQUIRED':
                    this.advance();
                    constraints.push('REQUIRED');
                    break;

                case 'UNIQUE':
                    this.advance();
                    constraints.push('UNIQUE');
                    break;

                default:
                    // Unknown modifier — shouldn't happen if the lexer
                    // is correct, but we handle it defensively.
                    throw new Error(
                        `Syntax Error at line ${token.line}, column ${token.column}: ` +
                        `Unknown modifier "${token.value}".`
                    );
            }
        }

        return constraints;
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
