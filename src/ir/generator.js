/**
 * ============================================================
 * INTERMEDIATE REPRESENTATION (IR) GENERATOR - Phase 4
 * ============================================================
 * 
 * The IR generator is the FOURTH phase of the compiler. It takes
 * the semantically validated Abstract Syntax Tree (AST) and
 * converts it into a uniform, target-independent Intermediate
 * Representation (IR).
 * 
 * ── Why do we need an IR? ──
 * 
 * 1. Decoupling: The AST represents DSL source syntax. Target
 *    code generation produces SQL, Express.js, etc. The IR sits
 *    in between, freeing front-end parsing from back-end code gen.
 * 2. Multi-Target Flexibility: We can generate MySQL, PostgreSQL,
 *    or REST API endpoints from the SAME IR without re-parsing.
 * 3. Optimization Sandbox: The IR provides a simple instruction
 *    list where optimizations (dead code elimination, index
 *    suggestions) can be applied before target code generation.
 * 
 * ── IR Instruction Format ──
 * 
 * Program IR:
 * {
 *   type: "PROGRAM",
 *   instructions: [
 *     { op: "CREATE_ENTITY", entity: "Student", line: 11 },
 *     { op: "ADD_FIELD", entity: "Student", field: "id", dataType: "INT", constraints: ["PRIMARY_KEY"], line: 13 },
 *     { op: "CREATE_RELATION", sourceEntity: "Student", relationName: "ENROLLS_IN", targetEntity: "Course", relationType: "MANY_TO_MANY", line: 15 },
 *     ...
 *   ]
 * }
 * 
 * ============================================================
 */

const VALID_RELATION_TYPES = new Set([
    'ONE_TO_ONE',
    'ONE_TO_MANY',
    'MANY_TO_ONE',
    'MANY_TO_MANY'
]);

/**
 * Validates an IR object to ensure it conforms to the IR schema.
 * 
 * @param {Object} ir - The IR object to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validate(ir) {
    const errors = [];

    if (!ir || typeof ir !== 'object') {
        return { valid: false, errors: ['IR must be a non-null object.'] };
    }

    if (ir.type !== 'PROGRAM') {
        errors.push(`Invalid IR type '${ir.type}'. Expected 'PROGRAM'.`);
    }

    if (!Array.isArray(ir.instructions)) {
        errors.push("IR must contain an 'instructions' array.");
        return { valid: false, errors };
    }

    ir.instructions.forEach((inst, index) => {
        if (!inst || typeof inst !== 'object') {
            errors.push(`Instruction at index ${index} must be an object.`);
            return;
        }

        if (!inst.op) {
            errors.push(`Instruction at index ${index} is missing 'op'.`);
            return;
        }

        switch (inst.op) {
            case 'CREATE_ENTITY':
                if (!inst.entity || typeof inst.entity !== 'string') {
                    errors.push(`CREATE_ENTITY instruction at index ${index} must have a valid 'entity' name.`);
                }
                break;

            case 'ADD_FIELD':
                if (!inst.entity || typeof inst.entity !== 'string') {
                    errors.push(`ADD_FIELD instruction at index ${index} must have an 'entity' name.`);
                }
                if (!inst.field || typeof inst.field !== 'string') {
                    errors.push(`ADD_FIELD instruction at index ${index} must have a 'field' name.`);
                }
                if (!inst.dataType || typeof inst.dataType !== 'string') {
                    errors.push(`ADD_FIELD instruction at index ${index} must have a 'dataType'.`);
                }
                if (!Array.isArray(inst.constraints)) {
                    errors.push(`ADD_FIELD instruction at index ${index} must have a 'constraints' array.`);
                }
                break;

            case 'CREATE_RELATION':
                if (!inst.sourceEntity || typeof inst.sourceEntity !== 'string') {
                    errors.push(`CREATE_RELATION instruction at index ${index} must have a valid 'sourceEntity' name.`);
                }
                if (!inst.relationName || typeof inst.relationName !== 'string') {
                    errors.push(`CREATE_RELATION instruction at index ${index} must have a valid 'relationName'.`);
                }
                if (!inst.targetEntity || typeof inst.targetEntity !== 'string') {
                    errors.push(`CREATE_RELATION instruction at index ${index} must have a valid 'targetEntity' name.`);
                }
                if (!inst.relationType || typeof inst.relationType !== 'string' || !VALID_RELATION_TYPES.has(inst.relationType)) {
                    errors.push(`CREATE_RELATION instruction at index ${index} must have a valid 'relationType' (ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY).`);
                }
                break;

            default:
                errors.push(`Unknown instruction op '${inst.op}' at index ${index}.`);
        }
    });

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * generate(ast, semanticResult)
 * 
 * Takes the validated AST (and optional semantic analysis result)
 * and generates a PROGRAM-level Intermediate Representation.
 * 
 * @param {Object} ast - The AST root (ProgramNode)
 * @param {Object} [semanticResult] - Optional semantic analysis result object
 * @returns {Object} - The IR object { type: "PROGRAM", instructions: [...] }
 * @throws {Error} - If semantic analysis failed or AST is invalid
 */
function generate(ast, semanticResult = null) {
    // Rule 2: Do not run if semantic analysis failed
    if (semanticResult && semanticResult.valid === false) {
        throw new Error('Cannot generate IR: Semantic analysis failed.');
    }

    if (!ast || !ast.entities || !Array.isArray(ast.entities)) {
        throw new Error('Cannot generate IR: Invalid or missing AST.');
    }

    const instructions = [];

    // Traverse AST entities
    for (const entity of ast.entities) {
        // Instruction: CREATE_ENTITY
        instructions.push({
            op: 'CREATE_ENTITY',
            entity: entity.name,
            line: entity.line
        });

        // Traverse entity fields
        for (const field of entity.fields) {
            // Instruction: ADD_FIELD
            instructions.push({
                op: 'ADD_FIELD',
                entity: entity.name,
                field: field.name,
                dataType: field.dataType,
                constraints: [...(field.constraints || [])],
                line: field.line
            });
        }
    }

    // Traverse AST relations if present
    const relationsList = (ast.relations && Array.isArray(ast.relations))
        ? ast.relations
        : (semanticResult && semanticResult.relations
            ? Object.entries(semanticResult.relations).map(([name, r]) => ({
                sourceEntity: r.sourceEntity,
                name: name,
                targetEntity: r.targetEntity,
                relationType: r.relationType,
                line: r.line
            }))
            : []);

    for (const rel of relationsList) {
        instructions.push({
            op: 'CREATE_RELATION',
            sourceEntity: rel.sourceEntity,
            relationName: rel.name,
            targetEntity: rel.targetEntity,
            relationType: rel.relationType,
            line: rel.line
        });
    }

    const ir = {
        type: 'PROGRAM',
        instructions
    };

    // Self-validate generated IR
    const validation = validate(ir);
    if (!validation.valid) {
        throw new Error(`Generated IR is invalid: ${validation.errors.join(', ')}`);
    }

    return ir;
}

module.exports = {
    generate,
    validate
};
