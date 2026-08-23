/**
 * ============================================================
 * AST Node Definitions
 * ============================================================
 * 
 * This file defines the "shapes" of our Abstract Syntax Tree
 * nodes. Each node type is a simple class that holds the data
 * the parser extracts from the token stream.
 * 
 * Think of AST nodes like building blocks:
 * - A Program node contains lists of Entity nodes and Relation nodes.
 * - An Entity node contains its name and a list of Field nodes.
 * - A Field node contains its name, data type, and constraints.
 * - A Relation node contains source entity, relation name, target entity, and cardinality.
 * 
 * ── Node Hierarchy ──
 * 
 * ProgramNode
 *  ├── EntityNode
 *  │    └── FieldNode
 *  └── RelationNode
 * 
 * ============================================================
 */

/**
 * ProgramNode - The root of every AST.
 * Represents the entire .apiforge source file.
 * Contains arrays of EntityNode and RelationNode children.
 */
class ProgramNode {
    constructor() {
        this.type = 'Program';
        this.entities = [];   // Array of EntityNode
        this.relations = [];  // Array of RelationNode
    }
}

/**
 * EntityNode - Represents a single ENTITY declaration.
 * e.g., ENTITY Student
 * 
 * @param {string} name - The entity name (e.g., "Student")
 * @param {number} line - Source line where the ENTITY keyword appeared
 */
class EntityNode {
    constructor(name, line) {
        this.type = 'Entity';
        this.name = name;      // e.g., "Student"
        this.fields = [];      // Array of FieldNode
        this.line = line;      // Source line number for error reporting
    }
}

/**
 * FieldNode - Represents a single field inside an entity.
 * e.g., name STRING REQUIRED
 * 
 * After parsing, constraints are combined forms:
 *   "PRIMARY_KEY", "REQUIRED", "UNIQUE"
 * 
 * @param {string} name        - Field name (e.g., "name")
 * @param {string} dataType    - Data type (e.g., "STRING")
 * @param {Array}  constraints - Parsed constraints (e.g., ["REQUIRED"])
 * @param {number} line        - Source line number
 */
class FieldNode {
    constructor(name, dataType, constraints, line) {
        this.type = 'Field';
        this.name = name;                    // e.g., "name"
        this.dataType = dataType;            // e.g., "STRING"
        this.constraints = constraints || []; // e.g., ["REQUIRED"]
        this.line = line;                    // Source line number
    }
}

/**
 * RelationNode - Represents a single RELATION declaration between entities.
 * e.g., RELATION Student ENROLLS_IN Course MANY_TO_MANY
 * 
 * @param {string} sourceEntity - Name of the source entity (e.g., "Student")
 * @param {string} name         - Name of the relationship (e.g., "ENROLLS_IN")
 * @param {string} targetEntity - Name of the target entity (e.g., "Course")
 * @param {string} relationType - Cardinality ("ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE", "MANY_TO_MANY")
 * @param {number} line         - Source line number where the RELATION keyword appeared
 */
class RelationNode {
    constructor(sourceEntity, name, targetEntity, relationType, line) {
        this.type = 'Relation';
        this.sourceEntity = sourceEntity;    // e.g., "Student"
        this.name = name;                    // e.g., "ENROLLS_IN"
        this.targetEntity = targetEntity;    // e.g., "Course"
        this.relationType = relationType;    // e.g., "MANY_TO_MANY"
        this.line = line;                    // Source line number
    }
}

module.exports = {
    ProgramNode,
    EntityNode,
    FieldNode,
    RelationNode
};
