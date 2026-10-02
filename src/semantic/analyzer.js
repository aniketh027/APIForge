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
 * 1. A program must contain at least one entity.
 * 2. Entity names must be unique.
 * 3. Field names must be unique within an entity.
 * 4. Data types must be valid (INT, STRING, FLOAT, BOOLEAN, ENUM).
 * 5. Every entity must have at least one field.
 * 6. At most one PRIMARY_KEY per entity.
 * 7. PRIMARY_KEY is only allowed on INT or STRING fields.
 * 8. Entity/field/relation names must not be reserved keywords or types.
 * 9. Source and target entities in relationships must exist.
 * 10. Relationship names must be unique across the program.
 * 11. Relationship types must be valid (ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY).
 * 12. Self-referential relationships are rejected.
 * 13. MIN / MAX validations are only allowed on numeric types (INT, FLOAT).
 * 14. MIN_LENGTH / MAX_LENGTH validations are only allowed on STRING.
 * 15. Length values must be non-negative integers and ranges must be ordered.
 * 16. Default value type must be compatible with field data type.
 * 17. Defaults must satisfy applicable numeric or string-length validations.
 * 18. Duplicate validation or DEFAULT declarations on the same field are rejected.
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

const { createDiagnostic, createWarningDiagnostic, sortDiagnostics, locate } = require('../utils/diagnostics');
const { didYouMeanSuffix } = require('../utils/errors');

const RESERVED_WORDS = new Set([
    // Keywords
    'ENTITY', 'RELATION',
    // Data types
    'INT', 'STRING', 'FLOAT', 'BOOLEAN', 'ENUM',
    // Modifiers
    'PRIMARY', 'KEY', 'REQUIRED', 'UNIQUE', 'MIN', 'MAX', 'MIN_LENGTH', 'MAX_LENGTH', 'DEFAULT',
    // Boolean literals
    'TRUE', 'FALSE',
    // Relation types
    'ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'
]);

// ── Valid Data Types ────────────────────────────────────────

const VALID_DATA_TYPES = new Set([
    'INT', 'STRING', 'FLOAT', 'BOOLEAN', 'ENUM'
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
        this.symbolTable = Object.create(null);

        /**
         * relationsTable - Records every relationship.
         */
        this.relationsTable = Object.create(null);
    }

    // ── Error Helper ────────────────────────────────────────

    /**
     * addError(message, location, symbol, hint)
     * Records a semantic error. We don't throw — we collect.
     * Locations come from parser metadata when available, otherwise declarations.
     * Legacy error entries retain their message and expose the shared diagnostic.
     */
    addError(message, location, symbol, hint) {
        const diagnostic = createDiagnostic('semantic', symbol, message, location, hint);
        const error = { message, line: diagnostic.line, column: diagnostic.column,
            code: symbol, diagnostic };
        if (symbol === 'MISSING_ENTITY_DECLARATION') error.userMessage = message;
        this.errors.push(error);
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
        // A declaration-free token stream is syntactically well-formed, but it
        // cannot describe a backend. Keep this language-level rule here so all
        // compiler entry points reject the same empty ProgramNode.
        if (!ast.entities || !Array.isArray(ast.entities) || ast.entities.length === 0) {
            this.addError(
                'APIForge programs must contain at least one ENTITY.',
                { line: 1, column: 1 },
                'MISSING_ENTITY_DECLARATION'
            );
        }

        // Step 1: Check each entity
        if (ast.entities && Array.isArray(ast.entities)) {
            for (const entity of ast.entities) {
                this.checkEntity(entity);
            }

            // Step 2: Check for duplicate entity names
            this.checkDuplicateEntities(ast.entities);
            for (const issue of require('../utils/mysql-target').targetIssues(ast.entities, ast.relations || [])) {
                this.addError(issue.message, locate(issue.node, issue.locationKey, issue.node.nameColumn),
                    'MYSQL_TARGET_LIMIT', issue.hint || 'Shorten the identifier or lower the declared STRING capacity for the supported MySQL target.');
            }
            for (const conflict of require('../utils/target-names').namingConflicts(ast.entities, ast.relations || [])) {
                this.addError(`${conflict.owner} conflicts with ${conflict.previous} in generated ${conflict.namespace} '${conflict.name}'.`,
                    locate(conflict.node, 'name', conflict.node.nameColumn), 'GENERATED_NAME_COLLISION',
                    'Rename one of the conflicting source constructs; generated names are not silently changed.');
            }
        }

        // Step 3: Check relationships (if present)
        if (ast.relations && Array.isArray(ast.relations)) {
            this.checkRelations(ast.relations, ast.entities || []);
        }

        // Attach non-enumerable properties on symbolTable for compatibility
        if (!Object.hasOwn(this.symbolTable, 'relations')) Object.defineProperty(this.symbolTable, 'relations', {
            value: this.relationsTable,
            enumerable: false,
            writable: true,
            configurable: true
        });

        if (!Object.hasOwn(this.symbolTable, 'entities')) Object.defineProperty(this.symbolTable, 'entities', {
            value: this.symbolTable,
            enumerable: false,
            writable: true,
            configurable: true
        });

        // Only valid programs reach codegen's existing implicit INT id behavior.
        // Keep warning metadata out of the AST, symbol table, and generated IR.
        const warnings = this.errors.length === 0 ? ast.entities
            .filter(entity => !entity.fields.some(field => (field.constraints || []).includes('PRIMARY_KEY')))
            .map(entity => createWarningDiagnostic('semantic', 'IMPLICIT_PRIMARY_KEY',
                `Entity '${entity.name}' has no explicit primary key. APIForge will generate an implicit integer id field.`,
                locate(entity, 'name', entity.nameColumn),
                'Declare an explicit PRIMARY KEY to control the identifier.')) : [];

        return {
            valid: this.errors.length === 0,
            errors: this.errors,
            diagnostics: this.errors.map(error => error.diagnostic),
            warnings: sortDiagnostics(warnings),
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
                    locate(entity, 'name', entity.nameColumn),
                    'DUPLICATE_ENTITY'
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
                locate(entity, 'name', entity.nameColumn),
                'RESERVED_ENTITY_NAME'
            );
        }

        // ── Rule: At least one field ────────────────────────
        if (entity.fields.length === 0) {
            this.addError(
                `Entity '${entity.name}' must contain at least one field.`,
                locate(entity, 'name', entity.nameColumn),
                'EMPTY_ENTITY'
            );
        }

        // MySQL column identifiers are case-insensitive. An explicit key avoids
        // synthetic allocation; never promote or rename an ordinary id field.
        if (!entity.fields.some(field => field.constraints?.includes('PRIMARY_KEY'))) {
            for (const field of entity.fields.filter(field => field.name.toLowerCase() === 'id')) {
                this.addError(
                    `Entity '${entity.name}' has no explicit primary key, so APIForge would generate implicit field 'id', which conflicts with declared field '${field.name}'.`,
                    locate(field, 'name', field.nameColumn),
                    'IMPLICIT_PRIMARY_KEY_COLLISION',
                    'Declare an explicit PRIMARY KEY or rename the conflicting field.'
                );
            }
        }

        // ── Build the field symbol table for this entity ────
        const fieldTable = Object.create(null);
        const seenFieldNames = new Set();
        let primaryKeyCount = 0;

        for (const field of entity.fields) {
            for (const issue of require('../utils/mysql-target').numericIssues(field)) {
                this.addError(issue.message, issue.value.numberLocation || locate(field, issue.value.type === 'NUMBER' ? 'DEFAULT' : issue.value.type, field.nameColumn),
                    'UNSAFE_NUMERIC_LITERAL', 'Use a finite literal; INT and length operands must remain exact safe integers.');
            }

            // ── Rule: Duplicate field names ─────────────────
            if (seenFieldNames.has(field.name)) {
                this.addError(
                    `Duplicate field '${field.name}' in entity '${entity.name}'.`,
                    locate(field, 'name', field.nameColumn),
                    'DUPLICATE_FIELD'
                );
            } else {
                seenFieldNames.add(field.name);
                // Register the field in the field table (only first declaration)
                fieldTable[field.name] = {
                    dataType: field.dataType,
                    ...(field.dataType === 'ENUM' ? { enumValues: Array.isArray(field.enumValues) ? [...field.enumValues] : [] } : {}),
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
                    locate(field, 'name', field.nameColumn),
                    'RESERVED_FIELD_NAME'
                );
            }

            // ── Rule: Valid data type ───────────────────────
            if (!VALID_DATA_TYPES.has(field.dataType)) {
                this.addError(
                    `Invalid data type '${field.dataType}' for field '${field.name}' in entity '${entity.name}'. Allowed types: INT, STRING, FLOAT, BOOLEAN, ENUM.` +
                        didYouMeanSuffix(field.dataType, Array.from(VALID_DATA_TYPES)),
                    locate(field, 'type', field.typeColumn),
                    'INVALID_DATATYPE'
                );
            }

            if (field.dataType === 'ENUM') {
                if (!Array.isArray(field.enumValues) || field.enumValues.length === 0 ||
                    Array.from(field.enumValues).some(value => typeof value !== 'string')) {
                    this.addError(`ENUM field '${field.name}' requires at least one string value.`,
                        locate(field, 'type', field.typeColumn), 'INVALID_ENUM_VALUES');
                } else {
                    const seenValues = new Set();
                    field.enumValues.forEach((value, index) => {
                        if (value.endsWith(' ')) {
                            this.addError(`ENUM member ${JSON.stringify(value)} in field '${field.name}' has trailing spaces that MySQL would remove.`,
                                locate(field, 'enumValues', field.typeColumn, index), 'ENUM_TRAILING_SPACE',
                                'Remove trailing spaces from the source member and any matching DEFAULT; values are never trimmed automatically.');
                        }
                        if (seenValues.has(value)) {
                            this.addError(`Duplicate ENUM value ${JSON.stringify(value)} for field '${field.name}'.`,
                                locate(field, 'enumValues', field.typeColumn, index), 'DUPLICATE_ENUM_VALUE');
                        }
                        seenValues.add(value);
                    });
                }
            }

            // ── Rule: Constraint validity & duplicates ───────
            const constraints = field.constraints || [];
            const seenConstraints = new Set();
            for (const [constraintIndex, c] of constraints.entries()) {
                if (!VALID_CONSTRAINTS.has(c)) {
                    this.addError(
                        `Invalid constraint '${c}' on field '${field.name}' in entity '${entity.name}'. Allowed constraints: PRIMARY KEY, REQUIRED, UNIQUE.`,
                        locate(field, c, field.nameColumn),
                        'INVALID_CONSTRAINT'
                    );
                } else if (seenConstraints.has(c)) {
                    this.addError(
                        `Duplicate constraint '${c}' on field '${field.name}' in entity '${entity.name}'.`,
                        locate(field, c, field.nameColumn, constraints.slice(0, constraintIndex).filter(value => value === c).length),
                        'DUPLICATE_CONSTRAINT'
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
                        locate(field, 'PRIMARY_KEY', field.nameColumn),
                        'MULTIPLE_PRIMARY_KEYS'
                    );
                }

                // PK type restriction (INT or STRING only)
                if (!PRIMARY_KEY_ALLOWED_TYPES.has(field.dataType)) {
                    this.addError(
                        `PRIMARY KEY on field '${field.name}' in entity '${entity.name}' requires INT or STRING, but found '${field.dataType}'.`,
                        locate(field, 'type', field.typeColumn),
                        'INVALID_PRIMARY_KEY_TYPE'
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
                    locate(field, 'MIN', field.nameColumn, 1),
                    'DUPLICATE_VALIDATION'
                );
            }

            // 2. Duplicate MAX validations
            if (maxList.length > 1) {
                this.addError(
                    `Duplicate MAX validation for field '${field.name}'.`,
                    locate(field, 'MAX', field.nameColumn, 1),
                    'DUPLICATE_VALIDATION'
                );
            }

            if (minLengthList.length > 1) {
                this.addError(
                    `Duplicate MIN_LENGTH validation for field '${field.name}'.`,
                    locate(field, 'MIN_LENGTH', field.nameColumn, 1),
                    'DUPLICATE_VALIDATION'
                );
            }

            if (maxLengthList.length > 1) {
                this.addError(
                    `Duplicate MAX_LENGTH validation for field '${field.name}'.`,
                    locate(field, 'MAX_LENGTH', field.nameColumn, 1),
                    'DUPLICATE_VALIDATION'
                );
            }

            // 3. Validation value sanity (numeric check)
            for (const val of validations) {
                if (val.type === 'MIN' || val.type === 'MAX') {
                    if (typeof val.value !== 'number' || Number.isNaN(val.value)) {
                        this.addError(
                            `Validation '${val.type}' value on field '${field.name}' must be a number.`,
                            locate(field, val.type, field.nameColumn, validations.filter(v => v.type === val.type).indexOf(val)),
                            'INVALID_NUMERIC_BOUND'
                        );
                    }
                }
                if (val.type === 'MIN_LENGTH' || val.type === 'MAX_LENGTH') {
                    if (typeof val.value !== 'number' || !Number.isInteger(val.value) || val.value < 0) {
                        this.addError(
                            `Validation '${val.type}' value on field '${field.name}' must be a non-negative integer.`,
                            locate(field, val.type, field.nameColumn, validations.filter(v => v.type === val.type).indexOf(val)),
                            'INVALID_LENGTH_BOUND'
                        );
                    }
                }
            }

            // 4. MIN / MAX only allowed for INT or FLOAT fields
            if (minList.length > 0) {
                if (field.dataType !== 'INT' && field.dataType !== 'FLOAT') {
                    this.addError(
                        `Validation 'MIN' is only allowed for INT or FLOAT fields.`,
                        locate(field, 'MIN', field.typeColumn || field.nameColumn),
                        'NUMERIC_MODIFIER_TYPE_MISMATCH', field.dataType === 'STRING' ? 'Use MIN_LENGTH/MAX_LENGTH for STRING length bounds.' : undefined
                    );
                }
            }

            if (maxList.length > 0) {
                if (field.dataType !== 'INT' && field.dataType !== 'FLOAT') {
                    this.addError(
                        `Validation 'MAX' is only allowed for INT or FLOAT fields.`,
                        locate(field, 'MAX', field.typeColumn || field.nameColumn),
                        'NUMERIC_MODIFIER_TYPE_MISMATCH', field.dataType === 'STRING' ? 'Use MIN_LENGTH/MAX_LENGTH for STRING length bounds.' : undefined
                    );
                }
            }

            if (minLengthList.length > 0 && field.dataType !== 'STRING') {
                this.addError(
                    `Validation 'MIN_LENGTH' is only allowed for STRING fields.`,
                    locate(field, 'MIN_LENGTH', field.typeColumn || field.nameColumn),
                    'LENGTH_MODIFIER_TYPE_MISMATCH',
                    ['INT', 'FLOAT'].includes(field.dataType) ? 'Use MIN/MAX for numeric bounds.' : undefined
                );
            }

            if (maxLengthList.length > 0 && field.dataType !== 'STRING') {
                this.addError(
                    `Validation 'MAX_LENGTH' is only allowed for STRING fields.`,
                    locate(field, 'MAX_LENGTH', field.typeColumn || field.nameColumn),
                    'LENGTH_MODIFIER_TYPE_MISMATCH',
                    ['INT', 'FLOAT'].includes(field.dataType) ? 'Use MIN/MAX for numeric bounds.' : undefined
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
                            locate(field, 'MIN', field.nameColumn),
                            'MIN_EXCEEDS_MAX', 'MIN must not exceed MAX.'
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
                        locate(field, 'MIN_LENGTH', field.nameColumn),
                        'MIN_LENGTH_EXCEEDS_MAX_LENGTH', 'MIN_LENGTH must not exceed MAX_LENGTH.'
                    );
                }
            }

            // 6. Integer check for INT fields with MIN / MAX
            if (field.dataType === 'INT') {
                for (const val of minList) {
                    if (typeof val.value === 'number' && !Number.isInteger(val.value)) {
                        this.addError(
                            `Validation 'MIN' value for INT field '${field.name}' must be an integer, but found ${val.value}.`,
                            locate(field, 'MIN', field.nameColumn, minList.indexOf(val)),
                            'NON_INTEGER_BOUND'
                        );
                    }
                }
                for (const val of maxList) {
                    if (typeof val.value === 'number' && !Number.isInteger(val.value)) {
                        this.addError(
                            `Validation 'MAX' value for INT field '${field.name}' must be an integer, but found ${val.value}.`,
                            locate(field, 'MAX', field.nameColumn, maxList.indexOf(val)),
                            'NON_INTEGER_BOUND'
                        );
                    }
                }
            }

            // ── Rule: Default Value Compatibility & Range ───
            if (Array.isArray(field.defaultValue) && field.defaultValue.length > 1) {
                this.addError(
                    `Duplicate DEFAULT value for field '${field.name}'.`,
                    locate(field, 'DEFAULT', field.nameColumn, 1),
                    'DUPLICATE_DEFAULT'
                );
            }
            if (field.defaultValues && field.defaultValues.length > 1) {
                this.addError(
                    `Duplicate DEFAULT value for field '${field.name}'.`,
                    locate(field, 'DEFAULT', field.nameColumn, 1),
                    'DUPLICATE_DEFAULT'
                );
            }

            const def = Array.isArray(field.defaultValue) ? field.defaultValue[0] : field.defaultValue;

            if (def !== null && def !== undefined) {
                // Type compatibility checks
                if (field.dataType === 'INT') {
                    if (def.type !== 'NUMBER') {
                        this.addError(
                            `Default value for INT field '${field.name}' must be an integer.`,
                            locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                            'INVALID_DEFAULT_TYPE'
                        );
                    } else if (!Number.isInteger(def.value)) {
                        this.addError(
                            `Default value for INT field '${field.name}' must be an integer, but found ${def.value}.`,
                            locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                            'INVALID_DEFAULT_TYPE'
                        );
                    }
                } else if (field.dataType === 'FLOAT') {
                    if (def.type !== 'NUMBER' || typeof def.value !== 'number' || Number.isNaN(def.value)) {
                        this.addError(
                            `Default value for FLOAT field '${field.name}' must be a number.`,
                            locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                            'INVALID_DEFAULT_TYPE'
                        );
                    }
                } else if (field.dataType === 'STRING') {
                    if (def.type !== 'STRING') {
                        this.addError(
                            `Default value for STRING field '${field.name}' must be a string.`,
                            locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                            'INVALID_DEFAULT_TYPE'
                        );
                    }
                } else if (field.dataType === 'ENUM') {
                    const location = locate(field, 'DEFAULT', field.nameColumn,
                        Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1));
                    if (def.type !== 'STRING' || typeof def.value !== 'string') {
                        this.addError(`Default value for ENUM field '${field.name}' must be a string.`,
                            location, 'INVALID_DEFAULT_TYPE');
                    } else if (Array.isArray(field.enumValues) && !field.enumValues.includes(def.value)) {
                        const preview = field.enumValues.slice(0, 5).map(value => JSON.stringify(value)).join(', ');
                        this.addError(`DEFAULT ${JSON.stringify(def.value)} is not one of the declared ENUM values.`,
                            location, 'INVALID_ENUM_DEFAULT',
                            `Use one of: ${preview.slice(0, 200)}${field.enumValues.length > 5 || preview.length > 200 ? ', ...' : ''}.`);
                    }
                } else if (field.dataType === 'BOOLEAN') {
                    if (def.type !== 'BOOLEAN') {
                        this.addError(
                            `Default value for BOOLEAN field '${field.name}' must be a boolean (TRUE or FALSE).`,
                            locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                            'INVALID_DEFAULT_TYPE'
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
                                locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                                'DEFAULT_OUT_OF_RANGE'
                            );
                        } else if (hasMin) {
                            this.addError(
                                `Default value ${def.value} is less than MIN value ${minVal}.`,
                                locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                                'DEFAULT_OUT_OF_RANGE'
                            );
                        } else if (hasMax) {
                            this.addError(
                                `Default value ${def.value} is greater than MAX value ${maxVal}.`,
                                locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                                'DEFAULT_OUT_OF_RANGE'
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
                                locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                                'DEFAULT_LENGTH_OUT_OF_RANGE'
                            );
                        } else if (hasMinLength) {
                            this.addError(
                                `Default value for field '${field.name}' has length ${defaultLength}, less than MIN_LENGTH value ${minLength}.`,
                                locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                                'DEFAULT_LENGTH_OUT_OF_RANGE'
                            );
                        } else if (hasMaxLength) {
                            this.addError(
                                `Default value for field '${field.name}' has length ${defaultLength}, greater than MAX_LENGTH value ${maxLength}.`,
                                locate(field, 'DEFAULT', field.nameColumn, Math.max(0, (field.sourceLocations?.DEFAULT?.length || 1) - 1)),
                                'DEFAULT_LENGTH_OUT_OF_RANGE'
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
                    locate(rel, 'name', rel.nameColumn),
                    'DUPLICATE_RELATION'
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
                    locate(rel, 'name', rel.nameColumn),
                    'RESERVED_RELATION_NAME'
                );
            }

            // ── Check: Valid relationship type ──────────────
            if (!VALID_RELATION_TYPES.has(rel.relationType)) {
                this.addError(
                    `Invalid relationship type '${rel.relationType}' in relationship '${rel.name}'. Allowed types: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY.`,
                    locate(rel, 'type', rel.typeColumn),
                    'INVALID_RELATION_TYPE'
                );
            }

            // ── Check: Self-referential relationship ────────
            if (rel.sourceEntity === rel.targetEntity) {
                this.addError(
                    `Self-referential relationships are not supported: '${rel.sourceEntity}' cannot relate to itself in relationship '${rel.name}'.`,
                    locate(rel, 'source', rel.sourceColumn),
                    'SELF_RELATION'
                );
            }

            // ── Check: Source entity existence ──────────────
            if (!declaredEntityNames.has(rel.sourceEntity)) {
                this.addError(
                    `Source entity '${rel.sourceEntity}' in relationship '${rel.name}' does not exist.` +
                        didYouMeanSuffix(rel.sourceEntity, entityNameList),
                    locate(rel, 'source', rel.sourceColumn),
                    'UNKNOWN_SOURCE_ENTITY'
                );
            }

            // ── Check: Target entity existence ──────────────
            if (!declaredEntityNames.has(rel.targetEntity)) {
                this.addError(
                    `Target entity '${rel.targetEntity}' in relationship '${rel.name}' does not exist.` +
                        didYouMeanSuffix(rel.targetEntity, entityNameList),
                    locate(rel, 'target', rel.targetColumn),
                    'UNKNOWN_TARGET_ENTITY'
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
