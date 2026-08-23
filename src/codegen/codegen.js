/**
 * ============================================================
 * CODE GENERATOR - Phase 6 of the Compiler Pipeline
 * ============================================================
 * 
 * The code generator is the FINAL phase of the compiler. It takes
 * the optimized Intermediate Representation (IR) from Phase 5
 * and produces functional target code artifacts:
 * 
 * 1. MySQL DDL Schema    → output/database/schema.sql
 * 2. Database Connection → output/config/db.js
 * 3. Env Config Template → output/.env.example
 * 4. Express Models      → output/models/<Entity>.js (with mysql2 queries & relation helpers)
 * 5. Express Controllers → output/controllers/<entity>Controller.js
 * 6. Express Routes      → output/routes/<entity>Routes.js
 * 7. Express Server      → output/server.js
 * 8. OpenAPI / Swagger   → output/swagger.json
 * 
 * ── Architectural Rule ──
 * This module ONLY consumes the validated IR. It does NOT parse
 * raw DSL, inspect lexer tokens, or rebuild AST nodes.
 * 
 * ── Relational Database Mapping Guide (Academic Reference) ──
 * 
 * 1. ONE_TO_ONE (1:1)
 *    - Conceptual Meaning: One record in Entity A relates to at most one record in Entity B.
 *    - Relational Mapping: A foreign key column is placed on Entity B referencing Entity A,
 *      with a UNIQUE constraint (e.g., Profile.user_id UNIQUE REFERENCES User(id)).
 *      This guarantees that no two profiles can reference the same user.
 * 
 * 2. ONE_TO_MANY (1:N)
 *    - Conceptual Meaning: One record in Entity A owns/contains multiple records in Entity B.
 *    - Relational Mapping: The foreign key MUST reside on the "Many" side (Entity B),
 *      pointing back to Entity A (e.g., Employee.department_id REFERENCES Department(id)).
 * 
 * 3. MANY_TO_ONE (N:1)
 *    - Conceptual Meaning: Multiple records in Entity A belong to one record in Entity B.
 *    - Relational Mapping: Symmetrical to 1:N — the foreign key is placed on Entity A
 *      referencing Entity B (e.g., Employee.department_id REFERENCES Department(id)).
 * 
 * 4. MANY_TO_MANY (M:N)
 *    - Conceptual Meaning: Multiple records in Entity A relate to multiple records in Entity B.
 *    - Why a Junction Table is Required: Relational databases cannot store multi-valued arrays
 *      in a single atomic column (First Normal Form - 1NF). Therefore, an intermediate
 *      "junction" or "associative" table (e.g., Student_Course) is created containing two
 *      foreign keys (student_id, course_id) that together form a composite primary key.
 * 
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const IRGenerator = require('../ir/generator');

// ── Helper Utilities ────────────────────────────────────────

/**
 * Pluralizes a noun for REST API routes.
 * e.g., Student -> students, Course -> courses, Category -> categories
 */
function pluralize(word) {
    if (!word) return '';
    const lower = word.toLowerCase();
    if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) {
        return lower.slice(0, -1) + 'ies';
    }
    if (lower.endsWith('s') || lower.endsWith('ch') || lower.endsWith('sh') || lower.endsWith('x')) {
        return lower + 'es';
    }
    return lower + 's';
}

/**
 * Converts a string to camelCase with lowercase first letter.
 * e.g., Student -> student, Course -> course
 */
function lowerFirst(str) {
    if (!str) return '';
    return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Capitalizes the first letter of a string.
 */
function upperFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Maps APIForge DSL data types to MySQL column data types.
 */
const MYSQL_TYPE_MAP = {
    'INT': 'INT',
    'STRING': 'VARCHAR(255)',
    'FLOAT': 'FLOAT',
    'BOOLEAN': 'BOOLEAN'
};

/**
 * Maps APIForge DSL data types to OpenAPI / Swagger JSON Schema types.
 */
const SWAGGER_TYPE_MAP = {
    'INT': 'integer',
    'STRING': 'string',
    'FLOAT': 'number',
    'BOOLEAN': 'boolean'
};

/**
 * Helper to extract entity definitions from IR instructions.
 * 
 * @param {Object} ir - The PROGRAM IR
 * @returns {Array<Object>} - List of entity objects { name, fields }
 */
function extractEntitiesFromIR(ir) {
    const entitiesMap = new Map();

    if (!ir || !Array.isArray(ir.instructions)) {
        return [];
    }

    for (const inst of ir.instructions) {
        if (inst.op === 'CREATE_ENTITY') {
            if (!entitiesMap.has(inst.entity)) {
                entitiesMap.set(inst.entity, { name: inst.entity, fields: [] });
            }
        } else if (inst.op === 'ADD_FIELD') {
            let entity = entitiesMap.get(inst.entity);
            if (!entity) {
                entity = { name: inst.entity, fields: [] };
                entitiesMap.set(inst.entity, entity);
            }
            entity.fields.push({
                name: inst.field,
                dataType: inst.dataType,
                constraints: inst.constraints || [],
                line: inst.line
            });
        }
    }

    return Array.from(entitiesMap.values());
}

/**
 * Helper to extract relationship definitions from IR instructions.
 * 
 * @param {Object} ir - The PROGRAM IR
 * @returns {Array<Object>} - List of relationship objects
 */
function extractRelationsFromIR(ir) {
    if (!ir || !Array.isArray(ir.instructions)) {
        return [];
    }

    const relations = [];
    for (const inst of ir.instructions) {
        if (inst && inst.op === 'CREATE_RELATION') {
            relations.push({
                sourceEntity: inst.sourceEntity,
                relationName: inst.relationName,
                targetEntity: inst.targetEntity,
                relationType: inst.relationType,
                line: inst.line
            });
        }
    }

    return relations;
}

/**
 * Gets the primary key field of an entity.
 * Defaults to { name: 'id', dataType: 'INT' } if none declared.
 * 
 * @param {Object} entity - Entity definition object
 * @returns {Object} - Field definition object
 */
function getPrimaryKeyField(entity) {
    if (!entity || !entity.fields || entity.fields.length === 0) {
        return { name: 'id', dataType: 'INT' };
    }
    const pk = entity.fields.find(f => f.constraints && f.constraints.includes('PRIMARY_KEY'));
    return pk || entity.fields[0] || { name: 'id', dataType: 'INT' };
}

// ════════════════════════════════════════════════════════════
// TARGET ARTIFACT GENERATORS
// ════════════════════════════════════════════════════════════

/**
 * PART 1: MySQL Schema Generation
 * Generates CREATE TABLE statements for entities, followed by relationship
 * junction tables and ALTER TABLE foreign key constraints.
 * 
 * @param {Object} ir - The IR object
 * @returns {string} - Complete SQL DDL file content
 */
function generateSQL(ir) {
    const entities = extractEntitiesFromIR(ir);
    const relations = extractRelationsFromIR(ir);
    const entityMap = new Map(entities.map(e => [e.name, e]));

    // 1. Entity table statements
    const tableStatements = entities.map(entity => {
        const columnDefs = entity.fields.map(field => {
            const mysqlType = MYSQL_TYPE_MAP[field.dataType] || field.dataType;
            const constraintParts = [];

            if (field.constraints.includes('PRIMARY_KEY')) {
                constraintParts.push('PRIMARY KEY AUTO_INCREMENT');
            }
            if (field.constraints.includes('REQUIRED')) {
                constraintParts.push('NOT NULL');
            }
            if (field.constraints.includes('UNIQUE')) {
                constraintParts.push('UNIQUE');
            }

            const constraintsStr = constraintParts.length > 0 ? ' ' + constraintParts.join(' ') : '';
            return `    ${field.name} ${mysqlType}${constraintsStr}`;
        });

        return `CREATE TABLE ${entity.name} (\n` + columnDefs.join(',\n') + `\n);`;
    });

    // 2. Relationship statements (Junction tables or ALTER TABLE statements)
    const relationStatements = [];

    relations.forEach(rel => {
        const sourceEntity = entityMap.get(rel.sourceEntity);
        const targetEntity = entityMap.get(rel.targetEntity);

        if (!sourceEntity || !targetEntity) return;

        const sourcePk = getPrimaryKeyField(sourceEntity);
        const targetPk = getPrimaryKeyField(targetEntity);
        const sourceFkCol = `${lowerFirst(sourceEntity.name)}_${sourcePk.name}`;
        const targetFkCol = `${lowerFirst(targetEntity.name)}_${targetPk.name}`;
        const sourceFkType = MYSQL_TYPE_MAP[sourcePk.dataType] || 'INT';
        const targetFkType = MYSQL_TYPE_MAP[targetPk.dataType] || 'INT';

        if (rel.relationType === 'MANY_TO_MANY') {
            const junctionTableName = `${sourceEntity.name}_${targetEntity.name}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (MANY_TO_MANY)\n` +
                `CREATE TABLE ${junctionTableName} (\n` +
                `    ${sourceFkCol} ${sourceFkType} NOT NULL,\n` +
                `    ${targetFkCol} ${targetFkType} NOT NULL,\n` +
                `    PRIMARY KEY (${sourceFkCol}, ${targetFkCol}),\n` +
                `    FOREIGN KEY (${sourceFkCol}) REFERENCES ${sourceEntity.name}(${sourcePk.name}) ON DELETE CASCADE,\n` +
                `    FOREIGN KEY (${targetFkCol}) REFERENCES ${targetEntity.name}(${targetPk.name}) ON DELETE CASCADE\n` +
                `);`
            );
        } else if (rel.relationType === 'ONE_TO_MANY') {
            const fkConstraintName = `fk_${targetEntity.name.toLowerCase()}_${sourceEntity.name.toLowerCase()}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (ONE_TO_MANY)\n` +
                `ALTER TABLE ${targetEntity.name} ADD COLUMN ${sourceFkCol} ${sourceFkType};\n` +
                `ALTER TABLE ${targetEntity.name} ADD CONSTRAINT ${fkConstraintName} FOREIGN KEY (${sourceFkCol}) REFERENCES ${sourceEntity.name}(${sourcePk.name}) ON DELETE SET NULL;`
            );
        } else if (rel.relationType === 'MANY_TO_ONE') {
            const fkConstraintName = `fk_${sourceEntity.name.toLowerCase()}_${targetEntity.name.toLowerCase()}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (MANY_TO_ONE)\n` +
                `ALTER TABLE ${sourceEntity.name} ADD COLUMN ${targetFkCol} ${targetFkType};\n` +
                `ALTER TABLE ${sourceEntity.name} ADD CONSTRAINT ${fkConstraintName} FOREIGN KEY (${targetFkCol}) REFERENCES ${targetEntity.name}(${targetPk.name}) ON DELETE SET NULL;`
            );
        } else if (rel.relationType === 'ONE_TO_ONE') {
            const fkConstraintName = `fk_${targetEntity.name.toLowerCase()}_${sourceEntity.name.toLowerCase()}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (ONE_TO_ONE)\n` +
                `ALTER TABLE ${targetEntity.name} ADD COLUMN ${sourceFkCol} ${sourceFkType} UNIQUE;\n` +
                `ALTER TABLE ${targetEntity.name} ADD CONSTRAINT ${fkConstraintName} FOREIGN KEY (${sourceFkCol}) REFERENCES ${sourceEntity.name}(${sourcePk.name}) ON DELETE CASCADE;`
            );
        }
    });

    let sql = `-- ============================================================\n` +
              `-- MySQL Database Schema\n` +
              `-- Generated automatically by APIForge Compiler\n` +
              `-- ============================================================\n\n` +
              tableStatements.join('\n\n') + '\n';

    if (relationStatements.length > 0) {
        sql += `\n-- ============================================================\n` +
               `-- Relationship Tables & Foreign Key Constraints\n` +
               `-- ============================================================\n\n` +
               relationStatements.join('\n\n') + '\n';
    }

    return sql;
}

/**
 * PART 2: Database Connection Config Generation
 * Generates config/db.js creating a mysql2/promise connection pool.
 * 
 * @returns {string} - DB connection file content
 */
function generateDBConfig() {
    return `/**\n` +
           ` * Database Connection Pool\n` +
           ` * Generated automatically by APIForge Compiler\n` +
           ` */\n\n` +
           `const mysql = require('mysql2/promise');\n\n` +
           `const pool = mysql.createPool({\n` +
           `    host: process.env.DB_HOST || 'localhost',\n` +
           `    user: process.env.DB_USER || 'root',\n` +
           `    password: process.env.DB_PASSWORD || '',\n` +
           `    database: process.env.DB_NAME || 'apiforge_db',\n` +
           `    waitForConnections: true,\n` +
           `    connectionLimit: 10,\n` +
           `    queueLimit: 0\n` +
           `});\n\n` +
           `module.exports = pool;\n`;
}

/**
 * PART 3: Environment Configuration Template Generation
 * Generates .env.example with environment variable keys.
 * 
 * @returns {string} - .env.example content
 */
function generateEnvExample() {
    return `# APIForge Generated Environment Variables\n` +
           `PORT=3000\n` +
           `DB_HOST=localhost\n` +
           `DB_USER=root\n` +
           `DB_PASSWORD=your_mysql_password\n` +
           `DB_NAME=apiforge_db\n`;
}

/**
 * PART 4: Functional Model Generation
 * Generates MySQL model using mysql2 parameterized queries.
 * Includes relationship helper methods if the entity participates in relationships.
 * 
 * @param {string} entityName - Entity name (e.g. "Student")
 * @param {Array} fields - List of field objects
 * @param {Array} [relations=[]] - List of relationship objects
 * @param {Array} [entities=[]] - List of entity objects
 * @returns {string} - JS model module content
 */
function generateModel(entityName, fields, relations = [], entities = []) {
    const fieldsJson = JSON.stringify(fields, null, 12);
    const pkField = (fields || []).find(f => f.constraints && f.constraints.includes('PRIMARY_KEY')) || (fields || [])[0] || { name: 'id' };
    const entityMap = new Map(entities.map(e => [e.name, e]));

    // Generate relationship helper methods for this entity
    const relMethods = [];

    relations.forEach(rel => {
        if (rel.sourceEntity === entityName) {
            const targetEntity = entityMap.get(rel.targetEntity) || { name: rel.targetEntity, fields: [] };
            const targetPk = getPrimaryKeyField(targetEntity);
            const sourcePk = pkField;
            const targetPlural = pluralize(rel.targetEntity);
            const targetParam = `${lowerFirst(rel.targetEntity)}Id`;

            if (rel.relationType === 'MANY_TO_MANY') {
                const junctionTable = `${entityName}_${rel.targetEntity}`;
                const sourceFkCol = `${lowerFirst(entityName)}_${sourcePk.name}`;
                const targetFkCol = `${lowerFirst(rel.targetEntity)}_${targetPk.name}`;

                relMethods.push(
                    `    // Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (MANY_TO_MANY)\n` +
                    `    static async get${upperFirst(targetPlural)}(${lowerFirst(entityName)}Id) {\n` +
                    `        const [rows] = await pool.query(\n` +
                    `            'SELECT t.* FROM ${rel.targetEntity} t JOIN ${junctionTable} j ON t.${targetPk.name} = j.${targetFkCol} WHERE j.${sourceFkCol} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id]\n` +
                    `        );\n` +
                    `        return rows;\n` +
                    `    }\n\n` +
                    `    static async add${upperFirst(rel.targetEntity)}(${lowerFirst(entityName)}Id, ${targetParam}) {\n` +
                    `        await pool.query(\n` +
                    `            'INSERT INTO ${junctionTable} (${sourceFkCol}, ${targetFkCol}) VALUES (?, ?)',\n` +
                    `            [${lowerFirst(entityName)}Id, ${targetParam}]\n` +
                    `        );\n` +
                    `        return { ${sourceFkCol}: ${lowerFirst(entityName)}Id, ${targetFkCol}: ${targetParam} };\n` +
                    `    }\n\n` +
                    `    static async remove${upperFirst(rel.targetEntity)}(${lowerFirst(entityName)}Id, ${targetParam}) {\n` +
                    `        const [result] = await pool.query(\n` +
                    `            'DELETE FROM ${junctionTable} WHERE ${sourceFkCol} = ? AND ${targetFkCol} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id, ${targetParam}]\n` +
                    `        );\n` +
                    `        return result.affectedRows > 0;\n` +
                    `    }`
                );
            } else if (rel.relationType === 'ONE_TO_MANY') {
                const sourceFkCol = `${lowerFirst(entityName)}_${sourcePk.name}`;
                relMethods.push(
                    `    // Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (ONE_TO_MANY)\n` +
                    `    static async get${upperFirst(targetPlural)}(${lowerFirst(entityName)}Id) {\n` +
                    `        const [rows] = await pool.query(\n` +
                    `            'SELECT * FROM ${rel.targetEntity} WHERE ${sourceFkCol} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id]\n` +
                    `        );\n` +
                    `        return rows;\n` +
                    `    }`
                );
            } else if (rel.relationType === 'MANY_TO_ONE') {
                const targetFkCol = `${lowerFirst(rel.targetEntity)}_${targetPk.name}`;
                relMethods.push(
                    `    // Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (MANY_TO_ONE)\n` +
                    `    static async get${upperFirst(rel.targetEntity)}(${lowerFirst(entityName)}Id) {\n` +
                    `        const [rows] = await pool.query(\n` +
                    `            'SELECT t.* FROM ${rel.targetEntity} t JOIN ${entityName} s ON t.${targetPk.name} = s.${targetFkCol} WHERE s.${sourcePk.name} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id]\n` +
                    `        );\n` +
                    `        return rows.length > 0 ? rows[0] : null;\n` +
                    `    }`
                );
            } else if (rel.relationType === 'ONE_TO_ONE') {
                const sourceFkCol = `${lowerFirst(entityName)}_${sourcePk.name}`;
                relMethods.push(
                    `    // Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (ONE_TO_ONE)\n` +
                    `    static async get${upperFirst(rel.targetEntity)}(${lowerFirst(entityName)}Id) {\n` +
                    `        const [rows] = await pool.query(\n` +
                    `            'SELECT * FROM ${rel.targetEntity} WHERE ${sourceFkCol} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id]\n` +
                    `        );\n` +
                    `        return rows.length > 0 ? rows[0] : null;\n` +
                    `    }`
                );
            }
        }
    });

    const relMethodsStr = relMethods.length > 0 ? '\n\n' + relMethods.join('\n\n') : '';

    return `/**\n` +
           ` * ${entityName} Model\n` +
           ` * Generated automatically by APIForge Compiler\n` +
           ` */\n\n` +
           `const pool = require('../config/db');\n\n` +
           `class ${entityName}Model {\n` +
           `    static get tableName() {\n` +
           `        return '${entityName}';\n` +
           `    }\n\n` +
           `    static get fields() {\n` +
           `        return ${fieldsJson};\n` +
           `    }\n\n` +
           `    static async findAll() {\n` +
           `        const [rows] = await pool.query('SELECT * FROM ${entityName}');\n` +
           `        return rows;\n` +
           `    }\n\n` +
           `    static async findById(id) {\n` +
           `        const [rows] = await pool.query('SELECT * FROM ${entityName} WHERE ${pkField.name} = ?', [id]);\n` +
           `        return rows.length > 0 ? rows[0] : null;\n` +
           `    }\n\n` +
           `    static async create(data) {\n` +
           `        const [result] = await pool.query('INSERT INTO ${entityName} SET ?', [data]);\n` +
           `        return { ${pkField.name}: result.insertId, ...data };\n` +
           `    }\n\n` +
           `    static async update(id, data) {\n` +
           `        await pool.query('UPDATE ${entityName} SET ? WHERE ${pkField.name} = ?', [data, id]);\n` +
           `        return await this.findById(id);\n` +
           `    }\n\n` +
           `    static async delete(id) {\n` +
           `        const [result] = await pool.query('DELETE FROM ${entityName} WHERE ${pkField.name} = ?', [id]);\n` +
           `        return result.affectedRows > 0;\n` +
           `    }${relMethodsStr}\n` +
           `}\n\n` +
           `module.exports = ${entityName}Model;\n`;
}

/**
 * PART 5: Functional Controller Generation
 * Generates controller functions calling model methods with 404 & 500 error handling.
 * Includes relationship controller handlers if the entity participates in relationships.
 * 
 * @param {string} entityName - Entity name (e.g. "Student")
 * @param {Array} [relations=[]] - List of relationship objects
 * @returns {string} - JS controller module content
 */
function generateController(entityName, relations = []) {
    const lowerName = lowerFirst(entityName);
    const pluralName = pluralize(entityName);
    const modelVar = `${entityName}Model`;
    const getPluralFn = `get${pluralName.charAt(0).toUpperCase() + pluralName.slice(1)}`;

    const extraFunctions = [];
    const exportedFunctions = [
        `create${entityName}`,
        getPluralFn,
        `get${entityName}ById`,
        `update${entityName}`,
        `delete${entityName}`
    ];

    relations.forEach(rel => {
        if (rel.sourceEntity === entityName) {
            const targetPlural = pluralize(rel.targetEntity);
            const targetParam = `${lowerFirst(rel.targetEntity)}Id`;

            if (rel.relationType === 'MANY_TO_MANY') {
                const getRelFn = `get${upperFirst(targetPlural)}`;
                const addRelFn = `add${upperFirst(rel.targetEntity)}`;
                const removeRelFn = `remove${upperFirst(rel.targetEntity)}`;

                extraFunctions.push(
                    `async function ${getRelFn}(req, res) {\n` +
                    `    try {\n` +
                    `        const items = await ${modelVar}.${getRelFn}(req.params.id);\n` +
                    `        res.status(200).json({ success: true, data: items });\n` +
                    `    } catch (error) {\n` +
                    `        res.status(500).json({ success: false, error: error.message });\n` +
                    `    }\n` +
                    `}\n\n` +
                    `async function ${addRelFn}(req, res) {\n` +
                    `    try {\n` +
                    `        const result = await ${modelVar}.${addRelFn}(req.params.id, req.params.${targetParam});\n` +
                    `        res.status(201).json({ success: true, data: result });\n` +
                    `    } catch (error) {\n` +
                    `        res.status(500).json({ success: false, error: error.message });\n` +
                    `    }\n` +
                    `}\n\n` +
                    `async function ${removeRelFn}(req, res) {\n` +
                    `    try {\n` +
                    `        const success = await ${modelVar}.${removeRelFn}(req.params.id, req.params.${targetParam});\n` +
                    `        res.status(200).json({ success: true, message: 'Association removed successfully' });\n` +
                    `    } catch (error) {\n` +
                    `        res.status(500).json({ success: false, error: error.message });\n` +
                    `    }\n` +
                    `}`
                );

                exportedFunctions.push(getRelFn, addRelFn, removeRelFn);
            } else if (rel.relationType === 'ONE_TO_MANY') {
                const getRelFn = `get${upperFirst(targetPlural)}`;
                extraFunctions.push(
                    `async function ${getRelFn}(req, res) {\n` +
                    `    try {\n` +
                    `        const items = await ${modelVar}.${getRelFn}(req.params.id);\n` +
                    `        res.status(200).json({ success: true, data: items });\n` +
                    `    } catch (error) {\n` +
                    `        res.status(500).json({ success: false, error: error.message });\n` +
                    `    }\n` +
                    `}`
                );
                exportedFunctions.push(getRelFn);
            } else if (rel.relationType === 'MANY_TO_ONE' || rel.relationType === 'ONE_TO_ONE') {
                const getRelFn = `get${upperFirst(rel.targetEntity)}`;
                extraFunctions.push(
                    `async function ${getRelFn}(req, res) {\n` +
                    `    try {\n` +
                    `        const item = await ${modelVar}.${getRelFn}(req.params.id);\n` +
                    `        if (!item) {\n` +
                    `            return res.status(404).json({ success: false, error: '${rel.targetEntity} not found' });\n` +
                    `        }\n` +
                    `        res.status(200).json({ success: true, data: item });\n` +
                    `    } catch (error) {\n` +
                    `        res.status(500).json({ success: false, error: error.message });\n` +
                    `    }\n` +
                    `}`
                );
                exportedFunctions.push(getRelFn);
            }
        }
    });

    const extraFunctionsStr = extraFunctions.length > 0 ? '\n\n' + extraFunctions.join('\n\n') : '';
    const exportsStr = exportedFunctions.map(f => `    ${f}`).join(',\n');

    return `/**\n` +
           ` * ${entityName} Controller\n` +
           ` * Generated automatically by APIForge Compiler\n` +
           ` */\n\n` +
           `const ${modelVar} = require('../models/${entityName}');\n\n` +
           `async function create${entityName}(req, res) {\n` +
           `    try {\n` +
           `        const result = await ${modelVar}.create(req.body);\n` +
           `        res.status(201).json({ success: true, data: result });\n` +
           `    } catch (error) {\n` +
           `        res.status(500).json({ success: false, error: error.message });\n` +
           `    }\n` +
           `}\n\n` +
           `async function ${getPluralFn}(req, res) {\n` +
           `    try {\n` +
           `        const items = await ${modelVar}.findAll();\n` +
           `        res.status(200).json({ success: true, data: items });\n` +
           `    } catch (error) {\n` +
           `        res.status(500).json({ success: false, error: error.message });\n` +
           `    }\n` +
           `}\n\n` +
           `async function get${entityName}ById(req, res) {\n` +
           `    try {\n` +
           `        const item = await ${modelVar}.findById(req.params.id);\n` +
           `        if (!item) {\n` +
           `            return res.status(404).json({ success: false, error: '${entityName} not found' });\n` +
           `        }\n` +
           `        res.status(200).json({ success: true, data: item });\n` +
           `    } catch (error) {\n` +
           `        res.status(500).json({ success: false, error: error.message });\n` +
           `    }\n` +
           `}\n\n` +
           `async function update${entityName}(req, res) {\n` +
           `    try {\n` +
           `        const updated = await ${modelVar}.update(req.params.id, req.body);\n` +
           `        if (!updated) {\n` +
           `            return res.status(404).json({ success: false, error: '${entityName} not found' });\n` +
           `        }\n` +
           `        res.status(200).json({ success: true, data: updated });\n` +
           `    } catch (error) {\n` +
           `        res.status(500).json({ success: false, error: error.message });\n` +
           `    }\n` +
           `}\n\n` +
           `async function delete${entityName}(req, res) {\n` +
           `    try {\n` +
           `        const deleted = await ${modelVar}.delete(req.params.id);\n` +
           `        if (!deleted) {\n` +
           `            return res.status(404).json({ success: false, error: '${entityName} not found' });\n` +
           `        }\n` +
           `        res.status(200).json({ success: true, message: '${entityName} deleted successfully' });\n` +
           `    } catch (error) {\n` +
           `        res.status(500).json({ success: false, error: error.message });\n` +
           `    }\n` +
           `}${extraFunctionsStr}\n\n` +
           `module.exports = {\n` +
           `${exportsStr}\n` +
           `};\n`;
}

/**
 * PART 6: Express Routes Generation
 * Generates Express router for an entity with REST and relationship routes.
 * 
 * @param {string} entityName - Entity name (e.g. "Student")
 * @param {Array} [relations=[]] - List of relationship objects
 * @returns {string} - JS router module content
 */
function generateRoutes(entityName, relations = []) {
    const lowerName = lowerFirst(entityName);
    const controllerName = `${lowerName}Controller`;
    const getPluralFn = `get${pluralize(entityName).charAt(0).toUpperCase() + pluralize(entityName).slice(1)}`;

    const relRouteLines = [];

    relations.forEach(rel => {
        if (rel.sourceEntity === entityName) {
            const targetPlural = pluralize(rel.targetEntity);
            const targetParam = `${lowerFirst(rel.targetEntity)}Id`;

            if (rel.relationType === 'MANY_TO_MANY') {
                const getRelFn = `get${upperFirst(targetPlural)}`;
                const addRelFn = `add${upperFirst(rel.targetEntity)}`;
                const removeRelFn = `remove${upperFirst(rel.targetEntity)}`;

                relRouteLines.push(`// Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (MANY_TO_MANY)`);
                relRouteLines.push(`router.get('/:id/${targetPlural}', ${controllerName}.${getRelFn});`);
                relRouteLines.push(`router.post('/:id/${targetPlural}/:${targetParam}', ${controllerName}.${addRelFn});`);
                relRouteLines.push(`router.delete('/:id/${targetPlural}/:${targetParam}', ${controllerName}.${removeRelFn});`);
            } else if (rel.relationType === 'ONE_TO_MANY') {
                const getRelFn = `get${upperFirst(targetPlural)}`;
                relRouteLines.push(`// Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (ONE_TO_MANY)`);
                relRouteLines.push(`router.get('/:id/${targetPlural}', ${controllerName}.${getRelFn});`);
            } else if (rel.relationType === 'MANY_TO_ONE' || rel.relationType === 'ONE_TO_ONE') {
                const getRelFn = `get${upperFirst(rel.targetEntity)}`;
                const routeSegment = lowerFirst(rel.targetEntity);
                relRouteLines.push(`// Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (${rel.relationType})`);
                relRouteLines.push(`router.get('/:id/${routeSegment}', ${controllerName}.${getRelFn});`);
            }
        }
    });

    const relRouteSection = relRouteLines.length > 0
        ? '\n// Relationship endpoints\n' + relRouteLines.join('\n') + '\n'
        : '';

    return `/**\n` +
           ` * ${entityName} REST API Routes\n` +
           ` * Generated automatically by APIForge Compiler\n` +
           ` */\n\n` +
           `const express = require('express');\n` +
           `const router = express.Router();\n` +
           `const ${controllerName} = require('../controllers/${lowerName}Controller');\n\n` +
           `// REST API CRUD endpoints\n` +
           `router.get('/', ${controllerName}.${getPluralFn});\n` +
           `router.get('/:id', ${controllerName}.get${entityName}ById);\n` +
           `router.post('/', ${controllerName}.create${entityName});\n` +
           `router.put('/:id', ${controllerName}.update${entityName});\n` +
           `router.delete('/:id', ${controllerName}.delete${entityName});\n` +
           `${relRouteSection}\n` +
           `module.exports = router;\n`;
}

/**
 * PART 7: Express Server Generation
 * Generates server.js initializing dotenv, Express app, middleware, routes, and error handlers.
 * 
 * @param {Array<Object>} entities - List of entity objects
 * @returns {string} - server.js file content
 */
function generateServer(entities) {
    const routeImports = entities.map(e => {
        const lowerName = lowerFirst(e.name);
        return `const ${lowerName}Routes = require('./routes/${lowerName}Routes');`;
    }).join('\n');

    const routeUses = entities.map(e => {
        const lowerName = lowerFirst(e.name);
        const plural = pluralize(e.name);
        return `app.use('/${plural}', ${lowerName}Routes);`;
    }).join('\n');

    return `/**\n` +
           ` * APIForge Express Server\n` +
           ` * Generated automatically by APIForge Compiler\n` +
           ` */\n\n` +
           `require('dotenv').config();\n` +
           `const express = require('express');\n` +
           `const app = express();\n` +
           `const PORT = process.env.PORT || 3000;\n\n` +
           `// Middleware\n` +
           `app.use(express.json());\n\n` +
           `// Registered Entity Routes\n` +
           `${routeImports}\n\n` +
           `${routeUses}\n\n` +
           `// Health Check Endpoint\n` +
           `app.get('/health', (req, res) => {\n` +
           `    res.json({ status: 'UP', message: 'APIForge server running smoothly' });\n` +
           `});\n\n` +
           `// Global Error Handler\n` +
           `app.use((err, req, res, next) => {\n` +
           `    console.error(err.stack);\n` +
           `    res.status(500).json({ success: false, error: 'Internal Server Error' });\n` +
           `});\n\n` +
           `if (require.main === module) {\n` +
           `    app.listen(PORT, () => {\n` +
           `        console.log(\`APIForge server listening on port \${PORT}\`);\n` +
           `    });\n` +
           `}\n\n` +
           `module.exports = app;\n`;
}

/**
 * PART 8: Swagger / OpenAPI Spec Generation
 * Generates OpenAPI 3.0.0 JSON specification for all entities and relationships.
 * 
 * @param {Array<Object>} entities - List of entity objects
 * @param {Array<Object>} [relations=[]] - List of relationship objects
 * @returns {string} - JSON string formatted with indent
 */
function generateSwagger(entities, relations = []) {
    const paths = {};
    const schemas = {};

    entities.forEach(entity => {
        const plural = pluralize(entity.name);
        paths[`/${plural}`] = {
            get: { summary: `Get all ${plural}`, responses: { "200": { description: "OK" } } },
            post: { summary: `Create ${entity.name}`, responses: { "201": { description: "Created" } } }
        };
        paths[`/${plural}/{id}`] = {
            get: { summary: `Get ${entity.name} by ID`, responses: { "200": { description: "OK" } } },
            put: { summary: `Update ${entity.name}`, responses: { "200": { description: "OK" } } },
            delete: { summary: `Delete ${entity.name}`, responses: { "200": { description: "OK" } } }
        };

        const properties = {};
        entity.fields.forEach(f => {
            properties[f.name] = { type: SWAGGER_TYPE_MAP[f.dataType] || 'string' };
        });
        schemas[entity.name] = { type: "object", properties };
    });

    relations.forEach(rel => {
        const sourcePlural = pluralize(rel.sourceEntity);
        const targetPlural = pluralize(rel.targetEntity);
        const targetParam = `${lowerFirst(rel.targetEntity)}Id`;

        if (rel.relationType === 'MANY_TO_MANY') {
            paths[`/${sourcePlural}/{id}/${targetPlural}`] = {
                get: {
                    summary: `Get all ${targetPlural} associated with ${rel.sourceEntity} (${rel.relationName})`,
                    responses: {
                        "200": {
                            description: "OK",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "array",
                                        items: { "$ref": `#/components/schemas/${rel.targetEntity}` }
                                    }
                                }
                            }
                        }
                    }
                }
            };
            paths[`/${sourcePlural}/{id}/${targetPlural}/{${targetParam}}`] = {
                post: {
                    summary: `Associate ${rel.targetEntity} with ${rel.sourceEntity} (${rel.relationName})`,
                    responses: { "201": { description: "Associated successfully" } }
                },
                delete: {
                    summary: `Disassociate ${rel.targetEntity} from ${rel.sourceEntity} (${rel.relationName})`,
                    responses: { "200": { description: "Disassociated successfully" } }
                }
            };
        } else if (rel.relationType === 'ONE_TO_MANY') {
            paths[`/${sourcePlural}/{id}/${targetPlural}`] = {
                get: {
                    summary: `Get all ${targetPlural} in ${rel.sourceEntity} (${rel.relationName})`,
                    responses: {
                        "200": {
                            description: "OK",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "array",
                                        items: { "$ref": `#/components/schemas/${rel.targetEntity}` }
                                    }
                                }
                            }
                        }
                    }
                }
            };
        } else if (rel.relationType === 'MANY_TO_ONE' || rel.relationType === 'ONE_TO_ONE') {
            const segment = lowerFirst(rel.targetEntity);
            paths[`/${sourcePlural}/{id}/${segment}`] = {
                get: {
                    summary: `Get ${rel.targetEntity} for ${rel.sourceEntity} (${rel.relationName})`,
                    responses: {
                        "200": {
                            description: "OK",
                            content: {
                                "application/json": {
                                    schema: { "$ref": `#/components/schemas/${rel.targetEntity}` }
                                }
                            }
                        }
                    }
                }
            };
        }
    });

    return JSON.stringify({
        openapi: "3.0.0",
        info: { title: "APIForge Generated REST API", version: "1.0.0" },
        paths,
        components: { schemas }
    }, null, 2);
}

// ════════════════════════════════════════════════════════════
// MAIN CODE GENERATOR ENTRY POINT
// ════════════════════════════════════════════════════════════

/**
 * generate(optimizedIR, writeToDisk)
 * 
 * Takes the optimized IR and produces target artifacts.
 * Optionally writes files to the output/ directory.
 * 
 * @param {Object} optimizedIR - The optimized PROGRAM IR
 * @param {boolean} [writeToDisk=true] - Whether to write output files to disk
 * @returns {Object} - { success: true, files: [{ path, content }] }
 */
function generate(optimizedIR, writeToDisk = true) {
    const validation = IRGenerator.validate(optimizedIR);
    if (!validation.valid) {
        throw new Error(`Cannot generate target code: Invalid IR - ${validation.errors.join(', ')}`);
    }

    const entities = extractEntitiesFromIR(optimizedIR);
    const relations = extractRelationsFromIR(optimizedIR);
    const entityMap = new Map(entities.map(e => [e.name, e]));

    // Validate that referenced relationship entities exist
    for (const rel of relations) {
        if (!entityMap.has(rel.sourceEntity)) {
            throw new Error(`Cannot generate relationship: Source entity '${rel.sourceEntity}' not found in IR.`);
        }
        if (!entityMap.has(rel.targetEntity)) {
            throw new Error(`Cannot generate relationship: Target entity '${rel.targetEntity}' not found in IR.`);
        }
    }

    const files = [
        { path: 'database/schema.sql', content: generateSQL(optimizedIR) },
        { path: 'config/db.js', content: generateDBConfig() },
        { path: '.env.example', content: generateEnvExample() }
    ];

    entities.forEach(entity => {
        const lowerName = lowerFirst(entity.name);
        files.push({ path: `models/${entity.name}.js`, content: generateModel(entity.name, entity.fields, relations, entities) });
        files.push({ path: `controllers/${lowerName}Controller.js`, content: generateController(entity.name, relations) });
        files.push({ path: `routes/${lowerName}Routes.js`, content: generateRoutes(entity.name, relations) });
    });

    files.push({ path: 'server.js', content: generateServer(entities) });
    files.push({ path: 'swagger.json', content: generateSwagger(entities, relations) });

    if (writeToDisk) {
        const outputBase = path.join(process.cwd(), 'output');
        files.forEach(file => {
            const fullPath = path.join(outputBase, file.path);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, file.content, 'utf-8');
        });
    }

    return { success: true, files };
}

module.exports = {
    generate,
    generateSQL,
    generateDBConfig,
    generateEnvExample,
    generateModel,
    generateController,
    generateRoutes,
    generateServer,
    generateSwagger,
    pluralize,
    lowerFirst,
    extractEntitiesFromIR,
    extractRelationsFromIR
};
