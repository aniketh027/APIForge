/**
 * ============================================================
 * SEMANTIC ANALYZER - Phase 3 of the Compiler Pipeline
 * ============================================================
 * 
 * The semantic analyzer is the THIRD phase. It walks through
 * the AST produced by the parser and checks for MEANING-LEVEL
 * errors that the parser's grammar rules cannot catch.
 * 
 * The parser only checks STRUCTURE (syntax). The semantic
 * analyzer checks LOGIC (semantics).
 * 
 * ── Analogy ──
 * 
 * Parser   = "Is this sentence grammatically correct?"
 * Semantic = "Does this sentence make logical sense?"
 * 
 * "Colorless green ideas sleep furiously."
 *   → Grammatically correct  (parser passes)
 *   → Semantically nonsensical (semantic analyzer catches it)
 * 
 * ── Semantic Rules Enforced ──
 * 
 * 1. Entity names must be unique.
 * 2. Field names must be unique within an entity.
 * 3. Data types must be valid (INT, STRING, FLOAT, BOOLEAN).
 * 4. Every entity must have at least one field.
 * 5. At most one PRIMARY_KEY per entity.
 * 6. PRIMARY_KEY is only allowed on INT or STRING fields.
 * 7. Entity/field/relation names must not be reserved keywords or types.
 * 8. Source and target entities in relationships must exist.
 * 9. Relationship names must be unique across the program.
 * 10. Relationship types must be valid (ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY).
 * 11. Self-referential relationships are rejected.
 * 
 * ── Symbol Table ──
 * 
 * During analysis, we build a "symbol table" — a lookup
 * structure that records every entity, its fields, and relations.
 * 
 * Structure:
 *   {
 *     EntityName: {
 *       fields: {
 *         fieldName: { dataType, constraints, line }
 *       },
 *       line: <source line>
 *     },
 *     relations: {
 *       RelationName: {
 *         sourceEntity: <source>,
 *         targetEntity: <target>,
 *         relationType: <cardinality>,
 *         line: <source line>
 *       }
 *     }
 *   }
 * 
 * ── Error Collection Strategy ──
 * 
 * Unlike the lexer and parser (which stop at the first error),
 * the semantic analyzer COLLECTS ALL errors and reports them
 * together. This is more helpful for the programmer — they
 * can fix multiple issues in one pass instead of playing
 * whack-a-mole one error at a time.
 * 
 * ============================================================
 */

// ── Reserved Words ──────────────────────────────────────────
// Entity names, field names, and relation names must NOT use any of these.

const RESERVED_WORDS = new Set([
    // Keywords
    'ENTITY', 'RELATION',
    // Data types
    'INT', 'STRING', 'FLOAT', 'BOOLEAN',
    // Modifiers
    'PRIMARY', 'KEY', 'REQUIRED', 'UNIQUE',
    // Relation types
    'ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'
]);

// ── Valid Data Types ────────────────────────────────────────

const VALID_DATA_TYPES = new Set([
    'INT', 'STRING', 'FLOAT', 'BOOLEAN'
]);

// ── Types Allowed for PRIMARY KEY ───────────────────────────

const PRIMARY_KEY_ALLOWED_TYPES = new Set([
    'INT', 'STRING'
]);

// ── Valid Relationship Types ────────────────────────────────

const VALID_RELATION_TYPES = new Set([
    'ONE_TO_ONE',
    'ONE_TO_MANY',
    'MANY_TO_ONE',
    'MANY_TO_MANY'
]);


// ── Semantic Analyzer Class ─────────────────────────────────

class SemanticAnalyzer {
    constructor() {
        /**
         * errors - Collects all semantic errors found during
         * analysis. Each error is an object:
         *   { message: string, line: number }
         */
        this.errors = [];

        /**
         * symbolTable - Records every entity and its fields.
         */
        this.symbolTable = {};

        /**
         * relationsTable - Records every relationship.
         */
        this.relationsTable = {};
    }

    // ── Error Helper ────────────────────────────────────────

    /**
     * addError(message, line)
     * Records a semantic error. We don't throw — we collect.
     */
    addError(message, line) {
        this.errors.push({ message, line });
    }

    // ════════════════════════════════════════════════════════
    // MAIN ANALYSIS ENTRY POINT
    // ════════════════════════════════════════════════════════

    /**
     * analyze(ast)
     * 
     * Walks the entire AST and performs all semantic checks.
     * Returns a result object:
     *   {
     *     valid: boolean,
     *     errors: Array<{ message, line }>,
     *     symbolTable: Object,
     *     entities: Object,
     *     relations: Object
     *   }
     * 
     * @param {Object} ast - The ProgramNode from the parser
     * @returns {Object}   - Analysis result
     */
    analyze(ast) {
        // Step 1: Check each entity
        if (ast.entities && Array.isArray(ast.entities)) {
            for (const entity of ast.entities) {
                this.checkEntity(entity);
            }

            // Step 2: Check for duplicate entity names
            this.checkDuplicateEntities(ast.entities);
        }

        // Step 3: Check relationships (if present)
        if (ast.relations && Array.isArray(ast.relations)) {
            this.checkRelations(ast.relations, ast.entities || []);
        }

        // Attach non-enumerable properties on symbolTable for compatibility
        Object.defineProperty(this.symbolTable, 'relations', {
            value: this.relationsTable,
            enumerable: false,
            writable: true,
            configurable: true
        });

        Object.defineProperty(this.symbolTable, 'entities', {
            value: this.symbolTable,
            enumerable: false,
            writable: true,
            configurable: true
        });

        return {
            valid: this.errors.length === 0,
            errors: this.errors,
            symbolTable: this.symbolTable,
            entities: this.symbolTable,
            relations: this.relationsTable
        };
    }

    // ════════════════════════════════════════════════════════
    // RULE: ENTITY NAMES MUST BE UNIQUE
    // ════════════════════════════════════════════════════════

    /**
     * checkDuplicateEntities(entities)
     * 
     * Scans the entity list for duplicate names.
     * We use a Set to track names we've already seen.
     */
    checkDuplicateEntities(entities) {
        const seen = new Set();

        for (const entity of entities) {
            if (seen.has(entity.name)) {
                this.addError(
                    `Duplicate entity '${entity.name}'. Entity names must be unique.`,
                    entity.line
                );
            } else {
                seen.add(entity.name);
            }
        }
    }

    // ════════════════════════════════════════════════════════
    // PER-ENTITY CHECKS
    // ════════════════════════════════════════════════════════

    /**
     * checkEntity(entity)
     * 
     * Runs all semantic checks for a single entity:
     *   - Reserved name check
     *   - At least one field
     *   - Duplicate field names
     *   - Primary key count
     *   - Per-field checks (type, reserved name, PK type)
     * 
     * Also registers the entity in the symbol table.
     */
    checkEntity(entity) {

        // ── Rule: Reserved entity name ──────────────────────
        if (RESERVED_WORDS.has(entity.name)) {
            this.addError(
                `Entity name '${entity.name}' is a reserved word and cannot be used as an identifier.`,
                entity.line
            );
        }

        // ── Rule: At least one field ────────────────────────
        if (entity.fields.length === 0) {
            this.addError(
                `Entity '${entity.name}' must contain at least one field.`,
                entity.line
            );
        }

        // ── Build the field symbol table for this entity ────
        const fieldTable = {};
        const seenFieldNames = new Set();
        let primaryKeyCount = 0;

        for (const field of entity.fields) {

            // ── Rule: Duplicate field names ─────────────────
            if (seenFieldNames.has(field.name)) {
                this.addError(
                    `Duplicate field '${field.name}' in entity '${entity.name}'.`,
                    field.line
                );
            } else {
                seenFieldNames.add(field.name);
            }

            // ── Rule: Reserved field name ───────────────────
            if (RESERVED_WORDS.has(field.name)) {
                this.addError(
                    `Field name '${field.name}' in entity '${entity.name}' is a reserved word and cannot be used as an identifier.`,
                    field.line
                );
            }

            // ── Rule: Valid data type ───────────────────────
            if (!VALID_DATA_TYPES.has(field.dataType)) {
                this.addError(
                    `Invalid data type '${field.dataType}' for field '${field.name}' in entity '${entity.name}'. Allowed types: INT, STRING, FLOAT, BOOLEAN.`,
                    field.line
                );
            }

            // ── Rule: Primary key checks ───────────────────
            if (field.constraints.includes('PRIMARY_KEY')) {
                primaryKeyCount++;

                // At most one primary key
                if (primaryKeyCount > 1) {
                    this.addError(
                        `Entity '${entity.name}' cannot have multiple primary keys. Field '${field.name}' is an extra primary key.`,
                        field.line
                    );
                }

                // PK type restriction (INT or STRING only)
                if (!PRIMARY_KEY_ALLOWED_TYPES.has(field.dataType)) {
                    this.addError(
                        `PRIMARY KEY on field '${field.name}' in entity '${entity.name}' requires INT or STRING, but found '${field.dataType}'.`,
                        field.line
                    );
                }
            }

            // Register the field in the field table
            fieldTable[field.name] = {
                dataType: field.dataType,
                constraints: field.constraints,
                line: field.line
            };
        }

        // Register the entity in the global symbol table
        this.symbolTable[entity.name] = {
            fields: fieldTable,
            line: entity.line
        };
    }

    // ════════════════════════════════════════════════════════
    // RELATIONSHIP CHECKS
    // ════════════════════════════════════════════════════════

    /**
     * checkRelations(relations, entities)
     * 
     * Validates all relationship declarations:
     *   1. Source entity must exist.
     *   2. Target entity must exist.
     *   3. Relationship names must be unique.
     *   4. Relationship type must be valid.
     *   5. Self-referential relationships are rejected.
     *   6. Relationship name must not be a reserved word.
     * 
     * @param {Array} relations - Array of RelationNode
     * @param {Array} entities  - Array of EntityNode
     */
    checkRelations(relations, entities) {
        const declaredEntityNames = new Set(entities.map(e => e.name));
        const seenRelNames = new Set();

        for (const rel of relations) {

            // ── Check: Duplicate relationship name ──────────
            if (seenRelNames.has(rel.name)) {
                this.addError(
                    `Duplicate relationship '${rel.name}'. Relationship names must be unique.`,
                    rel.line
                );
            } else {
                seenRelNames.add(rel.name);
            }

            // ── Check: Reserved word for relation name ──────
            if (RESERVED_WORDS.has(rel.name)) {
                this.addError(
                    `Relationship name '${rel.name}' is a reserved word and cannot be used as an identifier.`,
                    rel.line
                );
            }

            // ── Check: Valid relationship type ──────────────
            if (!VALID_RELATION_TYPES.has(rel.relationType)) {
                this.addError(
                    `Invalid relationship type '${rel.relationType}' in relationship '${rel.name}'. Allowed types: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY.`,
                    rel.line
                );
            }

            // ── Check: Self-referential relationship ────────
            if (rel.sourceEntity === rel.targetEntity) {
                this.addError(
                    `Self-referential relationships are not supported: '${rel.sourceEntity}' cannot relate to itself in relationship '${rel.name}'.`,
                    rel.line
                );
            }

            // ── Check: Source entity existence ──────────────
            if (!declaredEntityNames.has(rel.sourceEntity)) {
                this.addError(
                    `Source entity '${rel.sourceEntity}' in relationship '${rel.name}' does not exist.`,
                    rel.line
                );
            }

            // ── Check: Target entity existence ──────────────
            if (!declaredEntityNames.has(rel.targetEntity)) {
                this.addError(
                    `Target entity '${rel.targetEntity}' in relationship '${rel.name}' does not exist.`,
                    rel.line
                );
            }

            // Register in the relations table
            this.relationsTable[rel.name] = {
                sourceEntity: rel.sourceEntity,
                targetEntity: rel.targetEntity,
                relationType: rel.relationType,
                line: rel.line
            };
        }
    }
}


// ════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════

/**
 * analyze(ast)
 * 
 * The public entry point. Creates a SemanticAnalyzer instance,
 * runs all checks, and returns the result.
 * 
 * @param {Object} ast - The ProgramNode from the parser
 * @returns {Object}   - { valid, errors, symbolTable, entities, relations }
 */
function analyze(ast) {
    const analyzer = new SemanticAnalyzer();
    return analyzer.analyze(ast);
}

module.exports = {
    analyze
};
