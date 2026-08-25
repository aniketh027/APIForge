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
 * - A Field node contains its name, data type, constraints,
 *   validations (MIN/MAX), and an optional default value.
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
 * @param {number} [nameColumn] - Source column of the entity name token
 */
class EntityNode {
    constructor(name, line, nameColumn) {
        this.type = 'Entity';
        this.name = name;          // e.g., "Student"
        this.fields = [];          // Array of FieldNode
        this.line = line;          // Source line number for error reporting
        this.nameColumn = nameColumn; // Column of the name token (for carets)
    }
}

/**
 * FieldNode - Represents a single field inside an entity.
 * e.g., name STRING REQUIRED
 *       age INT MIN 17 MAX 60
 *       status STRING DEFAULT "active"
 * 
 * After parsing, constraints are combined forms:
 *   "PRIMARY_KEY", "REQUIRED", "UNIQUE"
 * 
 * Validations hold MIN/MAX rules:
 *   [{ type: "MIN", value: 17 }, { type: "MAX", value: 60 }]
 * 
 * Default value holds a typed literal or null:
 *   { type: "STRING", value: "active" }
 *   { type: "NUMBER", value: 42 }
 *   { type: "BOOLEAN", value: true }
 *   null (if no default)
 * 
 * @param {string} name          - Field name (e.g., "name")
 * @param {string} dataType      - Data type (e.g., "STRING")
 * @param {Array}  constraints   - Parsed constraints (e.g., ["REQUIRED"])
 * @param {number} line          - Source line number
 * @param {number} [nameColumn]  - Source column of the field name token
 * @param {number} [typeColumn]  - Source column of the data type token
 * @param {Array}  [validations] - Validation rules (e.g., [{ type: "MIN", value: 17 }])
 * @param {Object|null} [defaultValue] - Default value literal or null
 */
class FieldNode {
    constructor(name, dataType, constraints, line, nameColumn, typeColumn, validations, defaultValue) {
        this.type = 'Field';
        this.name = name;                        // e.g., "name"
        this.dataType = dataType;                // e.g., "STRING"
        this.constraints = constraints || [];     // e.g., ["REQUIRED"]
        this.line = line;                        // Source line number
        this.nameColumn = nameColumn;            // Column of the field name token
        this.typeColumn = typeColumn;            // Column of the data type token
        this.validations = validations || [];     // e.g., [{ type: "MIN", value: 17 }]
        this.defaultValue = defaultValue || null; // e.g., { type: "STRING", value: "active" }
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
 * @param {number} [sourceColumn] - Column of the source entity token
 * @param {number} [nameColumn]   - Column of the relationship name token
 * @param {number} [targetColumn] - Column of the target entity token
 * @param {number} [typeColumn]   - Column of the relation type token
 */
class RelationNode {
    constructor(sourceEntity, name, targetEntity, relationType, line, sourceColumn, nameColumn, targetColumn, typeColumn) {
        this.type = 'Relation';
        this.sourceEntity = sourceEntity;    // e.g., "Student"
        this.name = name;                    // e.g., "ENROLLS_IN"
        this.targetEntity = targetEntity;    // e.g., "Course"
        this.relationType = relationType;    // e.g., "MANY_TO_MANY"
        this.line = line;                    // Source line number
        this.sourceColumn = sourceColumn;    // Column of the source entity token
        this.nameColumn = nameColumn;        // Column of the relationship name token
        this.targetColumn = targetColumn;    // Column of the target entity token
        this.typeColumn = typeColumn;        // Column of the relation type token
    }
}

module.exports = {
    ProgramNode,
    EntityNode,
    FieldNode,
    RelationNode
};
