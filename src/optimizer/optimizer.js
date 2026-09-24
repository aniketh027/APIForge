/**
 * ============================================================
 * OPTIMIZER - Phase 5 of the Compiler Pipeline
 * ============================================================
 * 
 * The optimizer is the FIFTH phase. It takes the Intermediate
 * Representation (IR) generated in Phase 4 and applies target-
 * independent optimizations to produce cleaner, more efficient IR.
 * 
 * ── Optimization Passes ──
 * 
 * 1. Constraint Normalization
 *    Deduplicates and sorts field constraints deterministically:
 *    [PRIMARY_KEY, REQUIRED, UNIQUE, ...]
 * 
 * 2. Duplicate Validation Elimination
 *    Removes exact duplicate validation objects on each field.
 * 
 * 3. Validation Order Normalization
 *    Sorts validations deterministically (MIN, MAX, MIN_LENGTH, MAX_LENGTH).
 * 
 * 4. Duplicate Entity Elimination
 *    Removes redundant CREATE_ENTITY instructions for the same entity.
 * 
 * 5. Duplicate Field Elimination
 *    Removes identical ADD_FIELD instructions for the same entity.field.
 *    If field declarations conflict (different type/constraints/validations/defaults),
 *    both are preserved and an optimization warning is emitted.
 * 
 * 6. Duplicate Relationship Elimination
 *    Removes identical CREATE_RELATION instructions (matching source,
 *    name, target, and type). If relation declarations conflict,
 *    both are preserved and an optimization warning is emitted.
 * 
 * ============================================================
 */

/**
 * Priority order for constraint normalization.
 */
const CONSTRAINT_PRIORITY = {
    'PRIMARY_KEY': 1,
    'REQUIRED': 2,
    'UNIQUE': 3
};

/**
 * Priority order for validation normalization.
 */
const VALIDATION_PRIORITY = {
    'MIN': 1,
    'MAX': 2,
    'MIN_LENGTH': 3,
    'MAX_LENGTH': 4
};

/**
 * Normalizes a list of constraint strings:
 * - Removes duplicates
 * - Sorts deterministically (PRIMARY_KEY -> REQUIRED -> UNIQUE -> alphabetical)
 * 
 * @param {Array<string>} constraints
 * @returns {Array<string>}
 */
function normalizeConstraintList(constraints) {
    if (!Array.isArray(constraints) || constraints.length === 0) {
        return [];
    }

    // Deduplicate
    const unique = Array.from(new Set(constraints));

    // Sort deterministically
    unique.sort((a, b) => {
        const pA = CONSTRAINT_PRIORITY[a] || 100;
        const pB = CONSTRAINT_PRIORITY[b] || 100;
        if (pA !== pB) return pA - pB;
        return a.localeCompare(b);
    });

    return unique;
}

/**
 * Pass 1: Constraint Normalization
 * Normalizes constraints for all ADD_FIELD instructions in the IR.
 * 
 * @param {Array} instructions - Array of IR instructions
 * @returns {Object} - { instructions: Array, modifiedCount: number }
 */
function normalizeConstraints(instructions) {
    let modifiedCount = 0;

    const newInstructions = instructions.map(inst => {
        if (!inst || inst.op !== 'ADD_FIELD' || !Array.isArray(inst.constraints)) {
            return inst;
        }

        const normalized = normalizeConstraintList(inst.constraints);
        const changed = JSON.stringify(inst.constraints) !== JSON.stringify(normalized);

        if (changed) {
            modifiedCount++;
            return {
                ...inst,
                constraints: normalized
            };
        }

        return inst;
    });

    return {
        instructions: newInstructions,
        modifiedCount
    };
}

/**
 * Pass 2: Duplicate Validation Elimination
 * Removes exact duplicate validation objects on each ADD_FIELD instruction.
 * 
 * @param {Array} instructions - Array of IR instructions
 * @returns {Object} - { instructions: Array, removedCount: number }
 */
function eliminateDuplicateValidations(instructions) {
    let removedCount = 0;

    const newInstructions = instructions.map(inst => {
        if (!inst || inst.op !== 'ADD_FIELD' || !Array.isArray(inst.validations) || inst.validations.length <= 1) {
            return inst;
        }

        const seen = new Set();
        const uniqueValidations = [];

        for (const v of inst.validations) {
            if (!v || typeof v !== 'object') {
                uniqueValidations.push(v);
                continue;
            }
            const key = `${v.type}:${v.value}`;
            if (seen.has(key)) {
                removedCount++;
            } else {
                seen.add(key);
                uniqueValidations.push(v);
            }
        }

        if (uniqueValidations.length !== inst.validations.length) {
            return {
                ...inst,
                validations: uniqueValidations
            };
        }

        return inst;
    });

    return {
        instructions: newInstructions,
        removedCount
    };
}

/**
 * Pass 3: Validation Order Normalization
 * Normalizes validation order to MIN, MAX, MIN_LENGTH, then MAX_LENGTH.
 * 
 * @param {Array} instructions - Array of IR instructions
 * @returns {Object} - { instructions: Array, modifiedCount: number }
 */
function normalizeValidations(instructions) {
    let modifiedCount = 0;

    const newInstructions = instructions.map(inst => {
        if (!inst || inst.op !== 'ADD_FIELD' || !Array.isArray(inst.validations) || inst.validations.length <= 1) {
            return inst;
        }

        const sorted = [...inst.validations].sort((a, b) => {
            const pA = VALIDATION_PRIORITY[a.type] || 100;
            const pB = VALIDATION_PRIORITY[b.type] || 100;
            if (pA !== pB) return pA - pB;
            if (typeof a.value === 'number' && typeof b.value === 'number') {
                return a.value - b.value;
            }
            return 0;
        });

        const changed = JSON.stringify(inst.validations) !== JSON.stringify(sorted);

        if (changed) {
            modifiedCount++;
            return {
                ...inst,
                validations: sorted
            };
        }

        return inst;
    });

    return {
        instructions: newInstructions,
        modifiedCount
    };
}

/**
 * Pass 4: Duplicate Entity Elimination
 * Removes duplicate CREATE_ENTITY instructions for the same entity name.
 * Preserves entity declaration order and line numbers.
 * 
 * @param {Array} instructions - Array of IR instructions
 * @returns {Object} - { instructions: Array, removedCount: number }
 */
function removeDuplicateEntities(instructions) {
    const seenEntities = new Set();
    let removedCount = 0;

    const filtered = instructions.filter(inst => {
        if (!inst || inst.op !== 'CREATE_ENTITY') {
            return true;
        }

        if (seenEntities.has(inst.entity)) {
            removedCount++;
            return false;
        }

        seenEntities.add(inst.entity);
        return true;
    });

    return {
        instructions: filtered,
        removedCount
    };
}

/**
 * Pass 5: Duplicate Field Elimination
 * Removes duplicate ADD_FIELD instructions for the same entity and field name.
 * If data types, constraints, validations, or default values conflict, both are preserved and a warning is logged.
 * 
 * @param {Array} instructions - Array of IR instructions
 * @returns {Object} - { instructions: Array, removedCount: number, warnings: Array<string> }
 */
function removeDuplicateFields(instructions) {
    const seenFields = new Map(); // key: "Entity.field", value: instruction
    const warnings = [];
    let removedCount = 0;

    const filtered = [];

    for (const inst of instructions) {
        if (!inst || inst.op !== 'ADD_FIELD') {
            filtered.push(inst);
            continue;
        }

        const key = `${inst.entity}.${inst.field}`;

        if (!seenFields.has(key)) {
            seenFields.set(key, inst);
            filtered.push(inst);
        } else {
            const prevInst = seenFields.get(key);
            const sameType = prevInst.dataType === inst.dataType;
            const sameConstraints = JSON.stringify(prevInst.constraints) === JSON.stringify(inst.constraints);
            const sameValidations = JSON.stringify(prevInst.validations || []) === JSON.stringify(inst.validations || []);
            const sameDefault = JSON.stringify(prevInst.defaultValue || null) === JSON.stringify(inst.defaultValue || null);

            if (sameType && sameConstraints && sameValidations && sameDefault) {
                // Exact duplicate — eliminate
                removedCount++;
            } else {
                // Conflicting duplicate — preserve both and emit warning
                warnings.push(
                    `Optimization Conflict: Duplicate field '${key}' has conflicting declarations: ` +
                    `'${prevInst.dataType} [${prevInst.constraints.join(', ')}]' vs ` +
                    `'${inst.dataType} [${inst.constraints.join(', ')}]'.`
                );
                filtered.push(inst);
            }
        }
    }

    return {
        instructions: filtered,
        removedCount,
        warnings
    };
}

/**
 * Pass 6: Duplicate Relationship Elimination
 * Removes duplicate CREATE_RELATION instructions with identical properties.
 * If relationship declarations conflict (different type or endpoints),
 * both are preserved and an optimization conflict warning is logged.
 * 
 * @param {Array} instructions - Array of IR instructions
 * @returns {Object} - { instructions: Array, removedCount: number, warnings: Array<string> }
 */
function removeDuplicateRelations(instructions) {
    const seenRelations = new Map(); // key: relationName, value: instruction
    const warnings = [];
    let removedCount = 0;

    const filtered = [];

    for (const inst of instructions) {
        if (!inst || inst.op !== 'CREATE_RELATION') {
            filtered.push(inst);
            continue;
        }

        const key = inst.relationName;

        if (!seenRelations.has(key)) {
            seenRelations.set(key, inst);
            filtered.push(inst);
        } else {
            const prevInst = seenRelations.get(key);
            const sameSource = prevInst.sourceEntity === inst.sourceEntity;
            const sameTarget = prevInst.targetEntity === inst.targetEntity;
            const sameType = prevInst.relationType === inst.relationType;

            if (sameSource && sameTarget && sameType) {
                // Exact duplicate — eliminate
                removedCount++;
            } else if (sameSource && sameTarget && !sameType) {
                // Conflicting relation type — preserve both and emit warning
                warnings.push(
                    `Optimization Conflict: Relationship '${inst.relationName}' between '${inst.sourceEntity}' and '${inst.targetEntity}' has conflicting relation types: ${prevInst.relationType} vs ${inst.relationType}.`
                );
                filtered.push(inst);
            } else {
                // Conflicting endpoints — preserve both and emit warning
                warnings.push(
                    `Optimization Conflict: Relationship '${inst.relationName}' has conflicting endpoint definitions: '${prevInst.sourceEntity} -> ${prevInst.targetEntity}' vs '${inst.sourceEntity} -> ${inst.targetEntity}'.`
                );
                filtered.push(inst);
            }
        }
    }

    return {
        instructions: filtered,
        removedCount,
        warnings
    };
}

/**
 * Main Optimizer Function
 * 
 * Takes an IR object and returns an optimization result containing:
 *   - ir: The optimized IR object
 *   - optimizations: List of optimization passes applied with counts
 *   - warnings: List of optimization warnings/conflicts
 * 
 * @param {Object} ir - The input IR object
 * @returns {Object} - { ir, optimizations, warnings }
 */
function optimize(ir) {
    if (!ir || typeof ir !== 'object' || !Array.isArray(ir.instructions)) {
        return {
            ir: ir,
            optimizations: [],
            warnings: ['Invalid IR passed to optimizer.']
        };
    }

    let currentInstructions = ir.instructions;
    const optimizations = [];
    const warnings = [];

    // Pass 1: Normalize constraints
    const pass1 = normalizeConstraints(currentInstructions);
    currentInstructions = pass1.instructions;
    if (pass1.modifiedCount > 0) {
        optimizations.push({
            pass: 'Constraint Normalization',
            description: `Normalized constraint order/duplicates across ${pass1.modifiedCount} field(s).`,
            count: pass1.modifiedCount
        });
    }

    // Pass 2: Eliminate duplicate validations
    const pass2 = eliminateDuplicateValidations(currentInstructions);
    currentInstructions = pass2.instructions;
    if (pass2.removedCount > 0) {
        optimizations.push({
            pass: 'Duplicate Validation Elimination',
            description: pass2.removedCount === 1
                ? 'Removed 1 duplicate validation.'
                : `Removed ${pass2.removedCount} duplicate validations.`,
            count: pass2.removedCount
        });
    }

    // Pass 3: Normalize validation order (MIN before MAX)
    const pass3 = normalizeValidations(currentInstructions);
    currentInstructions = pass3.instructions;
    if (pass3.modifiedCount > 0) {
        optimizations.push({
            pass: 'Validation Normalization',
            description: pass3.modifiedCount === 1
                ? 'Normalized validation order.'
                : `Normalized validation order across ${pass3.modifiedCount} field(s).`,
            count: pass3.modifiedCount
        });
    }

    // Pass 4: Remove duplicate CREATE_ENTITY instructions
    const pass4 = removeDuplicateEntities(currentInstructions);
    currentInstructions = pass4.instructions;
    if (pass4.removedCount > 0) {
        optimizations.push({
            pass: 'Duplicate Entity Elimination',
            description: `Removed ${pass4.removedCount} duplicate CREATE_ENTITY instruction(s).`,
            count: pass4.removedCount
        });
    }

    // Pass 5: Remove duplicate ADD_FIELD instructions
    const pass5 = removeDuplicateFields(currentInstructions);
    currentInstructions = pass5.instructions;
    if (pass5.removedCount > 0) {
        optimizations.push({
            pass: 'Duplicate Field Elimination',
            description: `Removed ${pass5.removedCount} duplicate ADD_FIELD instruction(s).`,
            count: pass5.removedCount
        });
    }
    if (pass5.warnings.length > 0) {
        warnings.push(...pass5.warnings);
    }

    // Pass 6: Remove duplicate CREATE_RELATION instructions
    const pass6 = removeDuplicateRelations(currentInstructions);
    currentInstructions = pass6.instructions;
    if (pass6.removedCount > 0) {
        optimizations.push({
            pass: 'Duplicate Relationship Elimination',
            description: `Removed ${pass6.removedCount} duplicate CREATE_RELATION instruction(s).`,
            count: pass6.removedCount
        });
    }
    if (pass6.warnings.length > 0) {
        warnings.push(...pass6.warnings);
    }

    const optimizedIR = {
        type: ir.type || 'PROGRAM',
        instructions: currentInstructions
    };

    return {
        ir: optimizedIR,
        optimizations,
        warnings
    };
}

module.exports = {
    optimize,
    normalizeConstraints,
    eliminateDuplicateValidations,
    normalizeValidations,
    removeDuplicateEntities,
    removeDuplicateFields,
    removeDuplicateRelations,
    normalizeConstraintList
};
