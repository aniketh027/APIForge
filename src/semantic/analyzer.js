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
 * 12. MIN / MAX validations are only allowed on numeric types (INT, FLOAT).
 * 13. MIN_LENGTH / MAX_LENGTH validations are only allowed on STRING.
 * 14. Length values must be non-negative integers and ranges must be ordered.
 * 15. Default value type must be compatible with field data type.
 * 16. Defaults must satisfy applicable numeric or string-length validations.
 * 17. Duplicate validation or DEFAULT declarations on the same field are rejected.
 * 
 * ── Symbol Table ──
 * 
 * During analysis, we build a "symbol table" — a lookup
 * structure that records every entity, its fields, validations,
 * default values, and relations.
 * 
 * Structure:
 *   {
 *     EntityName: {
 *       fields: {
 *         fieldName: { dataType, constraints, validations, defaultValue, line }
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

const { didYouMeanSuffix } = require('../utils/errors');

const RESERVED_WORDS = new Set([
    // Keywords
    'ENTITY', 'RELATION',
    // Data types
    'INT', 'STRING', 'FLOAT', 'BOOLEAN',
    // Modifiers
    'PRIMARY', 'KEY', 'REQUIRED', 'UNIQUE', 'MIN', 'MAX', 'MIN_LENGTH', 'MAX_LENGTH', 'DEFAULT',
    // Boolean literals
    'TRUE', 'FALSE',
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

// ── Valid Constraints ───────────────────────────────────────

const VALID_CONSTRAINTS = new Set([
    'PRIMARY_KEY', 'REQUIRED', 'UNIQUE'
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
         *   { message: string, line: number, column?: number }
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
     * addError(message, line, column)
     * Records a semantic error. We don't throw — we collect.
     * `column` is optional; when present it lets the CLI and the
     * web UI render a caret under the offending token.
     */
    addError(message, line, column) {
        this.errors.push({ message, line, column });
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
     *     errors: Array<{ message, line, column }>,
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
                    entity.line,
                    entity.nameColumn
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
     *   - Primary key count & type restriction
     *   - Per-field checks (type, reserved name, validations, default values)
     * 
     * Also registers the entity in the symbol table.
     */
    checkEntity(entity) {

        // ── Rule: Reserved entity name ──────────────────────
        if (RESERVED_WORDS.has(entity.name)) {
            this.addError(
                `Entity name '${entity.name}' is a reserved word and cannot be used as an identifier.`,
                entity.line,
                entity.nameColumn
            );
        }

        // ── Rule: At least one field ────────────────────────
        if (entity.fields.length === 0) {
            this.addError(
                `Entity '${entity.name}' must contain at least one field.`,
                entity.line,
                entity.nameColumn
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
                    field.line,
                    field.nameColumn
                );
            } else {
                seenFieldNames.add(field.name);
                // Register the field in the field table (only first declaration)
                fieldTable[field.name] = {
                    dataType: field.dataType,
                    constraints: field.constraints || [],
                    validations: field.validations || [],
                    defaultValue: field.defaultValue || null,
                    line: field.line
                };
            }

            // ── Rule: Reserved field name ───────────────────
            if (RESERVED_WORDS.has(field.name)) {
                this.addError(
                    `Field name '${field.name}' in entity '${entity.name}' is a reserved word and cannot be used as an identifier.`,
                    field.line,
                    field.nameColumn
                );
            }

            // ── Rule: Valid data type ───────────────────────
            if (!VALID_DATA_TYPES.has(field.dataType)) {
                this.addError(
                    `Invalid data type '${field.dataType}' for field '${field.name}' in entity '${entity.name}'. Allowed types: INT, STRING, FLOAT, BOOLEAN.` +
                        didYouMeanSuffix(field.dataType, Array.from(VALID_DATA_TYPES)),
                    field.line,
                    field.typeColumn
                );
            }

            // ── Rule: Constraint validity & duplicates ───────
            const constraints = field.constraints || [];
            const seenConstraints = new Set();
            for (const c of constraints) {
                if (!VALID_CONSTRAINTS.has(c)) {
                    this.addError(
                        `Invalid constraint '${c}' on field '${field.name}' in entity '${entity.name}'. Allowed constraints: PRIMARY KEY, REQUIRED, UNIQUE.`,
                        field.line,
                        field.nameColumn
                    );
                } else if (seenConstraints.has(c)) {
                    this.addError(
                        `Duplicate constraint '${c}' on field '${field.name}' in entity '${entity.name}'.`,
                        field.line,
                        field.nameColumn
                    );
                } else {
                    seenConstraints.add(c);
                }
            }

            // ── Rule: Primary key checks ───────────────────
            if (constraints.includes('PRIMARY_KEY')) {
                primaryKeyCount++;

                // At most one primary key
                if (primaryKeyCount > 1) {
                    this.addError(
                        `Entity '${entity.name}' cannot have multiple primary keys. Field '${field.name}' is an extra primary key.`,
                        field.line,
                        field.nameColumn
                    );
                }

                // PK type restriction (INT or STRING only)
                if (!PRIMARY_KEY_ALLOWED_TYPES.has(field.dataType)) {
                    this.addError(
                        `PRIMARY KEY on field '${field.name}' in entity '${entity.name}' requires INT or STRING, but found '${field.dataType}'.`,
                        field.line,
                        field.typeColumn
                    );
                }
            }

            // ── Rule: Validations (MIN / MAX) ───────────────
            const validations = field.validations || [];
            const minList = validations.filter(v => v.type === 'MIN');
            const maxList = validations.filter(v => v.type === 'MAX');
            const minLengthList = validations.filter(v => v.type === 'MIN_LENGTH');
            const maxLengthList = validations.filter(v => v.type === 'MAX_LENGTH');

            // 1. Duplicate MIN validations
            if (minList.length > 1) {
                this.addError(
                    `Duplicate MIN validation for field '${field.name}'.`,
                    field.line,
                    field.nameColumn
                );
            }

            // 2. Duplicate MAX validations
            if (maxList.length > 1) {
                this.addError(
                    `Duplicate MAX validation for field '${field.name}'.`,
                    field.line,
                    field.nameColumn
                );
            }

            if (minLengthList.length > 1) {
                this.addError(
                    `Duplicate MIN_LENGTH validation for field '${field.name}'.`,
                    field.line,
                    field.nameColumn
                );
            }

            if (maxLengthList.length > 1) {
                this.addError(
                    `Duplicate MAX_LENGTH validation for field '${field.name}'.`,
                    field.line,
                    field.nameColumn
                );
            }

            // 3. Validation value sanity (numeric check)
            for (const val of validations) {
                if (val.type === 'MIN' || val.type === 'MAX') {
                    if (typeof val.value !== 'number' || Number.isNaN(val.value)) {
                        this.addError(
                            `Validation '${val.type}' value on field '${field.name}' must be a number.`,
                            field.line,
                            field.nameColumn
                        );
                    }
                }
                if (val.type === 'MIN_LENGTH' || val.type === 'MAX_LENGTH') {
                    if (typeof val.value !== 'number' || !Number.isInteger(val.value) || val.value < 0) {
                        this.addError(
                            `Validation '${val.type}' value on field '${field.name}' must be a non-negative integer.`,
                            field.line,
                            field.nameColumn
                        );
                    }
                }
            }

            // 4. MIN / MAX only allowed for INT or FLOAT fields
            if (minList.length > 0) {
                if (field.dataType !== 'INT' && field.dataType !== 'FLOAT') {
                    this.addError(
                        `Validation 'MIN' is only allowed for INT or FLOAT fields.`,
                        field.line,
                        field.typeColumn || field.nameColumn
                    );
                }
            }

            if (maxList.length > 0) {
                if (field.dataType !== 'INT' && field.dataType !== 'FLOAT') {
                    this.addError(
                        `Validation 'MAX' is only allowed for INT or FLOAT fields.`,
                        field.line,
                        field.typeColumn || field.nameColumn
                    );
                }
            }

            if (minLengthList.length > 0 && field.dataType !== 'STRING') {
                this.addError(
                    `Validation 'MIN_LENGTH' is only allowed for STRING fields.`,
                    field.line,
                    field.typeColumn || field.nameColumn
                );
            }

            if (maxLengthList.length > 0 && field.dataType !== 'STRING') {
                this.addError(
                    `Validation 'MAX_LENGTH' is only allowed for STRING fields.`,
                    field.line,
                    field.typeColumn || field.nameColumn
                );
            }

            // 5. Range consistency (MIN <= MAX)
            if (minList.length >= 1 && maxList.length >= 1) {
                const minVal = minList[0].value;
                const maxVal = maxList[0].value;
                if (typeof minVal === 'number' && typeof maxVal === 'number' && !Number.isNaN(minVal) && !Number.isNaN(maxVal)) {
                    if (minVal > maxVal) {
                        this.addError(
                            `MIN value ${minVal} cannot be greater than MAX value ${maxVal}.`,
                            field.line,
                            field.nameColumn
                        );
                    }
                }
            }

            if (minLengthList.length >= 1 && maxLengthList.length >= 1) {
                const minLength = minLengthList[0].value;
                const maxLength = maxLengthList[0].value;
                if (Number.isInteger(minLength) && Number.isInteger(maxLength) && minLength >= 0 && maxLength >= 0 && minLength > maxLength) {
                    this.addError(
                        `MIN_LENGTH value ${minLength} cannot be greater than MAX_LENGTH value ${maxLength}.`,
                        field.line,
                        field.nameColumn
                    );
                }
            }

            // 6. Integer check for INT fields with MIN / MAX
            if (field.dataType === 'INT') {
                for (const val of minList) {
                    if (typeof val.value === 'number' && !Number.isInteger(val.value)) {
                        this.addError(
                            `Validation 'MIN' value for INT field '${field.name}' must be an integer, but found ${val.value}.`,
                            field.line,
                            field.nameColumn
                        );
                    }
                }
                for (const val of maxList) {
                    if (typeof val.value === 'number' && !Number.isInteger(val.value)) {
                        this.addError(
                            `Validation 'MAX' value for INT field '${field.name}' must be an integer, but found ${val.value}.`,
                            field.line,
                            field.nameColumn
                        );
                    }
                }
            }

            // ── Rule: Default Value Compatibility & Range ───
            if (Array.isArray(field.defaultValue) && field.defaultValue.length > 1) {
                this.addError(
                    `Duplicate DEFAULT value for field '${field.name}'.`,
                    field.line,
                    field.nameColumn
                );
            }
            if (field.defaultValues && field.defaultValues.length > 1) {
                this.addError(
                    `Duplicate DEFAULT value for field '${field.name}'.`,
                    field.line,
                    field.nameColumn
                );
            }

            const def = Array.isArray(field.defaultValue) ? field.defaultValue[0] : field.defaultValue;

            if (def !== null && def !== undefined) {
                // Type compatibility checks
                if (field.dataType === 'INT') {
                    if (def.type !== 'NUMBER') {
                        this.addError(
                            `Default value for INT field '${field.name}' must be an integer.`,
                            field.line,
                            field.nameColumn
                        );
                    } else if (!Number.isInteger(def.value)) {
                        this.addError(
                            `Default value for INT field '${field.name}' must be an integer, but found ${def.value}.`,
                            field.line,
                            field.nameColumn
                        );
                    }
                } else if (field.dataType === 'FLOAT') {
                    if (def.type !== 'NUMBER' || typeof def.value !== 'number' || Number.isNaN(def.value)) {
                        this.addError(
                            `Default value for FLOAT field '${field.name}' must be a number.`,
                            field.line,
                            field.nameColumn
                        );
                    }
                } else if (field.dataType === 'STRING') {
                    if (def.type !== 'STRING') {
                        this.addError(
                            `Default value for STRING field '${field.name}' must be a string.`,
                            field.line,
                            field.nameColumn
                        );
                    }
                } else if (field.dataType === 'BOOLEAN') {
                    if (def.type !== 'BOOLEAN') {
                        this.addError(
                            `Default value for BOOLEAN field '${field.name}' must be a boolean (TRUE or FALSE).`,
                            field.line,
                            field.nameColumn
                        );
                    }
                }

                // Range validation check for numeric default values
                if (def.type === 'NUMBER' && typeof def.value === 'number' && !Number.isNaN(def.value)) {
                    const hasMin = minList.length === 1 && typeof minList[0].value === 'number';
                    const hasMax = maxList.length === 1 && typeof maxList[0].value === 'number';
                    const minVal = hasMin ? minList[0].value : null;
                    const maxVal = hasMax ? maxList[0].value : null;

                    if ((hasMin && def.value < minVal) || (hasMax && def.value > maxVal)) {
                        if (hasMin && hasMax) {
                            this.addError(
                                `Default value ${def.value} is outside the allowed range [${minVal}, ${maxVal}].`,
                                field.line,
                                field.nameColumn
                            );
                        } else if (hasMin) {
                            this.addError(
                                `Default value ${def.value} is less than MIN value ${minVal}.`,
                                field.line,
                                field.nameColumn
                            );
                        } else if (hasMax) {
                            this.addError(
                                `Default value ${def.value} is greater than MAX value ${maxVal}.`,
                                field.line,
                                field.nameColumn
                            );
                        }
                    }
                }

                if (def.type === 'STRING' && typeof def.value === 'string') {
                    const defaultLength = Array.from(def.value).length;
                    const hasMinLength = minLengthList.length === 1 && Number.isInteger(minLengthList[0].value) && minLengthList[0].value >= 0;
                    const hasMaxLength = maxLengthList.length === 1 && Number.isInteger(maxLengthList[0].value) && maxLengthList[0].value >= 0;
                    const minLength = hasMinLength ? minLengthList[0].value : null;
                    const maxLength = hasMaxLength ? maxLengthList[0].value : null;

                    if ((hasMinLength && defaultLength < minLength) || (hasMaxLength && defaultLength > maxLength)) {
                        if (hasMinLength && hasMaxLength) {
                            this.addError(
                                `Default value for field '${field.name}' has length ${defaultLength}, outside the allowed range [${minLength}, ${maxLength}].`,
                                field.line,
                                field.nameColumn
                            );
                        } else if (hasMinLength) {
                            this.addError(
                                `Default value for field '${field.name}' has length ${defaultLength}, less than MIN_LENGTH value ${minLength}.`,
                                field.line,
                                field.nameColumn
                            );
                        } else if (hasMaxLength) {
                            this.addError(
                                `Default value for field '${field.name}' has length ${defaultLength}, greater than MAX_LENGTH value ${maxLength}.`,
                                field.line,
                                field.nameColumn
                            );
                        }
                    }
                }
            }
        }

        // Register the entity in the global symbol table (first declaration only)
        if (!this.symbolTable[entity.name]) {
            this.symbolTable[entity.name] = {
                fields: fieldTable,
                line: entity.line
            };
        }
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
        const entityNameList = Array.from(declaredEntityNames); // for "did you mean?" suggestions
        const seenRelNames = new Set();

        for (const rel of relations) {

            // ── Check: Duplicate relationship name ──────────
            if (seenRelNames.has(rel.name)) {
                this.addError(
                    `Duplicate relationship '${rel.name}'. Relationship names must be unique.`,
                    rel.line,
                    rel.nameColumn
                );
            } else {
                seenRelNames.add(rel.name);
                // Register in the relations table (first declaration only)
                this.relationsTable[rel.name] = {
                    sourceEntity: rel.sourceEntity,
                    targetEntity: rel.targetEntity,
                    relationType: rel.relationType,
                    line: rel.line
                };
            }

            // ── Check: Reserved word for relation name ──────
            if (RESERVED_WORDS.has(rel.name)) {
                this.addError(
                    `Relationship name '${rel.name}' is a reserved word and cannot be used as an identifier.`,
                    rel.line,
                    rel.nameColumn
                );
            }

            // ── Check: Valid relationship type ──────────────
            if (!VALID_RELATION_TYPES.has(rel.relationType)) {
                this.addError(
                    `Invalid relationship type '${rel.relationType}' in relationship '${rel.name}'. Allowed types: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY.`,
                    rel.line,
                    rel.typeColumn
                );
            }

            // ── Check: Self-referential relationship ────────
            if (rel.sourceEntity === rel.targetEntity) {
                this.addError(
                    `Self-referential relationships are not supported: '${rel.sourceEntity}' cannot relate to itself in relationship '${rel.name}'.`,
                    rel.line,
                    rel.sourceColumn
                );
            }

            // ── Check: Source entity existence ──────────────
            if (!declaredEntityNames.has(rel.sourceEntity)) {
                this.addError(
                    `Source entity '${rel.sourceEntity}' in relationship '${rel.name}' does not exist.` +
                        didYouMeanSuffix(rel.sourceEntity, entityNameList),
                    rel.line,
                    rel.sourceColumn
                );
            }

            // ── Check: Target entity existence ──────────────
            if (!declaredEntityNames.has(rel.targetEntity)) {
                this.addError(
                    `Target entity '${rel.targetEntity}' in relationship '${rel.name}' does not exist.` +
                        didYouMeanSuffix(rel.targetEntity, entityNameList),
                    rel.line,
                    rel.targetColumn
                );
            }
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
