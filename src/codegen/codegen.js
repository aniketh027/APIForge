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
 * 4. Project Metadata    → output/package.json
 * 5. Setup Guide         → output/README.md
 * 6. Express Models      → output/models/<Entity>.js (with mysql2 queries & relation helpers)
 * 7. Express Controllers → output/controllers/<entity>Controller.js (with input validation)
 * 8. Express Routes      → output/routes/<entity>Routes.js
 * 9. Express Server      → output/server.js
 * 10. OpenAPI / Swagger  → output/swagger.json (with range/length/default schema metadata)
 * 
 * ── Architectural Rule ──
 * This module ONLY consumes the validated IR. It does NOT parse
 * raw DSL, inspect lexer tokens, or rebuild AST nodes.
 * 
 * ── Primary Key + Default Policy (MySQL Compatibility) ──
 * In MySQL, AUTO_INCREMENT columns cannot declare a DEFAULT clause
 * (MySQL Error 1067: Invalid default value). Therefore:
 * - If PRIMARY KEY is specified without DEFAULT: generate PRIMARY KEY AUTO_INCREMENT (for INT)
 * - If PRIMARY KEY is specified with DEFAULT: generate PRIMARY KEY DEFAULT <val> (omitting AUTO_INCREMENT)
 * 
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const IRGenerator = require('../ir/generator');
const apiForgePackage = require('../../package.json');

const GENERATED_RUNTIME_DEPENDENCIES = ['dotenv', 'express', 'mysql2'];

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
 * Safely formats a literal value as a SQL literal string.
 * - STRING: escapes single quotes by doubling them (' -> '') and encloses in single quotes.
 * - NUMBER: converts to numeric string.
 * - BOOLEAN: TRUE or FALSE.
 * 
 * @param {Object} defaultValue - { type: 'NUMBER'|'STRING'|'BOOLEAN', value: any }
 * @returns {string} - SQL literal representation
 */
function formatSQLLiteral(defaultValue) {
    if (!defaultValue) return '';
    if (defaultValue.type === 'STRING') {
        const escaped = String(defaultValue.value).replace(/'/g, "''");
        return `'${escaped}'`;
    }
    if (defaultValue.type === 'NUMBER') {
        return String(defaultValue.value);
    }
    if (defaultValue.type === 'BOOLEAN') {
        return defaultValue.value ? 'TRUE' : 'FALSE';
    }
    return '';
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
 * MySQL reserved words that must be quoted with backticks when used as table or column identifiers.
 */
const MYSQL_RESERVED_WORDS = new Set([
    'ACCESSIBLE', 'ADD', 'ALL', 'ALTER', 'ANALYZE', 'AND', 'AS', 'ASC', 'ASENSITIVE',
    'BEFORE', 'BETWEEN', 'BIGINT', 'BINARY', 'BLOB', 'BOTH', 'BY', 'CALL', 'CASCADE',
    'CASE', 'CHANGE', 'CHAR', 'CHARACTER', 'CHECK', 'COLLATE', 'COLUMN', 'CONDITION',
    'CONSTRAINT', 'CONTINUE', 'CONVERT', 'CREATE', 'CROSS', 'CUBE', 'CUME_DIST',
    'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'CURSOR',
    'DATABASE', 'DATABASES', 'DAY_HOUR', 'DAY_MICROSECOND', 'DAY_MINUTE', 'DAY_SECOND',
    'DEC', 'DECIMAL', 'DECLARE', 'DEFAULT', 'DELAYED', 'DELETE', 'DENSE_RANK', 'DESC',
    'DESCRIBE', 'DETERMINISTIC', 'DISTINCT', 'DISTINCTROW', 'DIV', 'DOUBLE', 'DROP',
    'DUAL', 'EACH', 'ELSE', 'ELSEIF', 'EMPTY', 'ENCLOSED', 'ESCAPED', 'EXCEPT',
    'EXISTS', 'EXIT', 'EXPLAIN', 'FALSE', 'FETCH', 'FIRST_VALUE', 'FLOAT', 'FLOAT4',
    'FLOAT8', 'FOR', 'FORCE', 'FOREIGN', 'FROM', 'FULLTEXT', 'FUNCTION', 'GENERATED',
    'GET', 'GRANT', 'GROUP', 'GROUPING', 'GROUPS', 'HAVING', 'HIGH_PRIORITY',
    'HOUR_MICROSECOND', 'HOUR_MINUTE', 'HOUR_SECOND', 'IF', 'IGNORE', 'IN', 'INDEX',
    'INFILE', 'INNER', 'INOUT', 'INSENSITIVE', 'INSERT', 'INT', 'INT1', 'INT2', 'INT3',
    'INT4', 'INT8', 'INTEGER', 'INTERVAL', 'INTO', 'IO_AFTER_GTIDS', 'IO_BEFORE_GTIDS',
    'IS', 'ITERATE', 'JOIN', 'JSON_TABLE', 'KEY', 'KEYS', 'KILL', 'LAG', 'LAST_VALUE',
    'LEAD', 'LEADING', 'LEAVE', 'LEFT', 'LIKE', 'LIMIT', 'LINEAR', 'LINES', 'LOAD',
    'LOCALTIME', 'LOCALTIMESTAMP', 'LOCK', 'LONG', 'LONGBLOB', 'LONGTEXT', 'LOOP',
    'LOW_PRIORITY', 'MASTER_BIND', 'MASTER_SSL_VERIFY_SERVER_CERT', 'MATCH', 'MAXVALUE',
    'MEDIUMBLOB', 'MEDIUMINT', 'MEDIUMTEXT', 'MIDDLEINT', 'MINUTE_MICROSECOND',
    'MINUTE_SECOND', 'MOD', 'MODIFIES', 'NATURAL', 'NOT', 'NO_WRITE_TO_BINLOG', 'NTH_VALUE',
    'NTILE', 'NULL', 'NUMERIC', 'OF', 'ON', 'OPTIMIZE', 'OPTIMIZER_COSTS', 'OPTION',
    'OPTIONALLY', 'OR', 'ORDER', 'OUT', 'OUTER', 'OUTFILE', 'OVER', 'PARTITION',
    'PERCENT_RANK', 'PRECISION', 'PRIMARY', 'PROCEDURE', 'PURGE', 'RANGE', 'RANK',
    'READ', 'READS', 'READ_WRITE', 'REAL', 'RECURSIVE', 'REF_SYSTEM_ID', 'REFERENCES',
    'REGEXP', 'RELEASE', 'RENAME', 'REPEAT', 'REPLACE', 'REQUIRE', 'RESIGNAL', 'RESTRICT',
    'RETURN', 'REVOKE', 'RIGHT', 'RLIKE', 'ROW', 'ROWS', 'ROW_NUMBER', 'SCHEMA',
    'SCHEMAS', 'SECOND_MICROSECOND', 'SELECT', 'SENSITIVE', 'SEPARATOR', 'SET', 'SHOW',
    'SIGNAL', 'SMALLINT', 'SPATIAL', 'SPECIFIC', 'SQL', 'SQLEXCEPTION', 'SQLSTATE',
    'SQLWARNING', 'SQL_BIG_RESULT', 'SQL_CALC_FOUND_ROWS', 'SQL_SMALL_RESULT', 'SSL',
    'STARTING', 'STORED', 'STRAIGHT_JOIN', 'SYSTEM', 'TABLE', 'TERMINATED', 'THEN',
    'TINYBLOB', 'TINYINT', 'TINYTEXT', 'TO', 'TRAILING', 'TRIGGER', 'TRUE', 'UNDO',
    'UNION', 'UNIQUE', 'UNLOCK', 'UNSIGNED', 'UPDATE', 'USAGE', 'USE', 'USING',
    'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'VALUES', 'VARBINARY', 'VARCHAR',
    'VARCHARACTER', 'VARYING', 'VIRTUAL', 'WHEN', 'WHERE', 'WHILE', 'WINDOW', 'WITH',
    'WRITE', 'XOR', 'YEAR_MONTH', 'ZEROFILL'
]);

/**
 * Quotes an identifier with backticks if it is a MySQL reserved word or contains non-alphanumeric chars.
 */
function quoteIdentifier(name) {
    if (!name || typeof name !== 'string') return name;
    if (MYSQL_RESERVED_WORDS.has(name.toUpperCase()) || /^[^a-zA-Z_]/.test(name) || /[^a-zA-Z0-9_]/.test(name)) {
        return `\`${name}\``;
    }
    return name;
}

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
                validations: inst.validations || [],
                defaultValue: inst.defaultValue || null,
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
    return pk || { name: 'id', dataType: 'INT' };
}

/**
 * Gets the OpenAPI schema type for an entity identifier.
 * Entities without an explicit primary key use the generated INT id column.
 *
 * @param {Object} entity - Entity definition object
 * @returns {string} - OpenAPI schema type
 */
function getPrimaryKeySwaggerType(entity) {
    const primaryKey = getPrimaryKeyField(entity);
    return SWAGGER_TYPE_MAP[primaryKey.dataType] || 'string';
}

// ════════════════════════════════════════════════════════════
// TARGET ARTIFACT GENERATORS
// ════════════════════════════════════════════════════════════

/**
 * PART 1: MySQL Schema Generation
 * Generates CREATE TABLE statements for entities with column constraints,
 * defaults, and CHECK expressions, followed by relationship junction tables
 * and ALTER TABLE foreign key constraints.
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
        const hasPk = entity.fields.some(f => f.constraints && f.constraints.includes('PRIMARY_KEY'));
        const columnDefs = entity.fields.map(field => {
            const mysqlType = MYSQL_TYPE_MAP[field.dataType] || field.dataType;
            const isPk = field.constraints.includes('PRIMARY_KEY');
            const isRequired = field.constraints.includes('REQUIRED');
            const isUnique = field.constraints.includes('UNIQUE');
            const hasDefault = field.defaultValue !== null && field.defaultValue !== undefined;

            const parts = [];

            // Primary Key & Auto Increment handling:
            // If primary key has an explicit default value, omit AUTO_INCREMENT to prevent MySQL Error 1067.
            if (isPk) {
                if (hasDefault) {
                    parts.push('PRIMARY KEY');
                } else if (field.dataType === 'INT') {
                    parts.push('PRIMARY KEY AUTO_INCREMENT');
                } else {
                    parts.push('PRIMARY KEY');
                }
            }

            // REQUIRED constraint
            if (isRequired) {
                parts.push('NOT NULL');
            }

            // DEFAULT clause
            if (hasDefault) {
                const sqlVal = formatSQLLiteral(field.defaultValue);
                parts.push(`DEFAULT ${sqlVal}`);
            }

            // UNIQUE constraint
            if (isUnique) {
                parts.push('UNIQUE');
            }

            // CHECK constraints for numeric range and string-length validations
            if (Array.isArray(field.validations) && field.validations.length > 0) {
                const minV = field.validations.find(v => v.type === 'MIN');
                const maxV = field.validations.find(v => v.type === 'MAX');
                const minLengthV = field.validations.find(v => v.type === 'MIN_LENGTH');
                const maxLengthV = field.validations.find(v => v.type === 'MAX_LENGTH');

                if (minV && maxV) {
                    parts.push(`CHECK (${quoteIdentifier(field.name)} >= ${minV.value} AND ${quoteIdentifier(field.name)} <= ${maxV.value})`);
                } else if (minV) {
                    parts.push(`CHECK (${quoteIdentifier(field.name)} >= ${minV.value})`);
                } else if (maxV) {
                    parts.push(`CHECK (${quoteIdentifier(field.name)} <= ${maxV.value})`);
                }

                if (minLengthV && maxLengthV) {
                    parts.push(`CHECK (CHAR_LENGTH(${quoteIdentifier(field.name)}) >= ${minLengthV.value} AND CHAR_LENGTH(${quoteIdentifier(field.name)}) <= ${maxLengthV.value})`);
                } else if (minLengthV) {
                    parts.push(`CHECK (CHAR_LENGTH(${quoteIdentifier(field.name)}) >= ${minLengthV.value})`);
                } else if (maxLengthV) {
                    parts.push(`CHECK (CHAR_LENGTH(${quoteIdentifier(field.name)}) <= ${maxLengthV.value})`);
                }
            }

            const constraintsStr = parts.length > 0 ? ' ' + parts.join(' ') : '';
            return `    ${quoteIdentifier(field.name)} ${mysqlType}${constraintsStr}`;
        });

        if (!hasPk) {
            columnDefs.unshift('    id INT PRIMARY KEY AUTO_INCREMENT');
        }

        return `CREATE TABLE ${quoteIdentifier(entity.name)} (\n` + columnDefs.join(',\n') + `\n);`;
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

        const sourceTable = quoteIdentifier(sourceEntity.name);
        const targetTable = quoteIdentifier(targetEntity.name);
        const sourcePkName = quoteIdentifier(sourcePk.name);
        const targetPkName = quoteIdentifier(targetPk.name);
        const sourceFkColName = quoteIdentifier(sourceFkCol);
        const targetFkColName = quoteIdentifier(targetFkCol);

        if (rel.relationType === 'MANY_TO_MANY') {
            const junctionTableName = `${sourceEntity.name}_${targetEntity.name}`;
            const junctionTable = quoteIdentifier(junctionTableName);
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (MANY_TO_MANY)\n` +
                `CREATE TABLE ${junctionTable} (\n` +
                `    ${sourceFkColName} ${sourceFkType} NOT NULL,\n` +
                `    ${targetFkColName} ${targetFkType} NOT NULL,\n` +
                `    PRIMARY KEY (${sourceFkColName}, ${targetFkColName}),\n` +
                `    FOREIGN KEY (${sourceFkColName}) REFERENCES ${sourceTable}(${sourcePkName}) ON DELETE CASCADE,\n` +
                `    FOREIGN KEY (${targetFkColName}) REFERENCES ${targetTable}(${targetPkName}) ON DELETE CASCADE\n` +
                `);`
            );
        } else if (rel.relationType === 'ONE_TO_MANY') {
            const fkConstraintName = `fk_${targetEntity.name.toLowerCase()}_${sourceEntity.name.toLowerCase()}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (ONE_TO_MANY)\n` +
                `ALTER TABLE ${targetTable} ADD COLUMN ${sourceFkColName} ${sourceFkType};\n` +
                `ALTER TABLE ${targetTable} ADD CONSTRAINT ${fkConstraintName} FOREIGN KEY (${sourceFkColName}) REFERENCES ${sourceTable}(${sourcePkName}) ON DELETE SET NULL;`
            );
        } else if (rel.relationType === 'MANY_TO_ONE') {
            const fkConstraintName = `fk_${sourceEntity.name.toLowerCase()}_${targetEntity.name.toLowerCase()}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (MANY_TO_ONE)\n` +
                `ALTER TABLE ${sourceTable} ADD COLUMN ${targetFkColName} ${targetFkType};\n` +
                `ALTER TABLE ${sourceTable} ADD CONSTRAINT ${fkConstraintName} FOREIGN KEY (${targetFkColName}) REFERENCES ${targetTable}(${targetPkName}) ON DELETE SET NULL;`
            );
        } else if (rel.relationType === 'ONE_TO_ONE') {
            const fkConstraintName = `fk_${targetEntity.name.toLowerCase()}_${sourceEntity.name.toLowerCase()}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (ONE_TO_ONE)\n` +
                `ALTER TABLE ${targetTable} ADD COLUMN ${sourceFkColName} ${sourceFkType} UNIQUE;\n` +
                `ALTER TABLE ${targetTable} ADD CONSTRAINT ${fkConstraintName} FOREIGN KEY (${sourceFkColName}) REFERENCES ${sourceTable}(${sourcePkName}) ON DELETE CASCADE;`
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
 * Generates the dependency manifest for the generated backend.
 * Runtime versions intentionally follow APIForge's own compatible dependency versions.
 *
 * @returns {string} - package.json content
 */
function generatePackageJson() {
    const dependencies = {};

    GENERATED_RUNTIME_DEPENDENCIES.forEach(name => {
        const version = apiForgePackage.dependencies && apiForgePackage.dependencies[name];
        if (!version) {
            throw new Error(`Cannot generate package.json: Missing APIForge runtime dependency '${name}'.`);
        }
        dependencies[name] = version;
    });

    return JSON.stringify({
        name: 'apiforge-generated-backend',
        version: '1.0.0',
        private: true,
        description: 'REST API backend generated by APIForge',
        main: 'server.js',
        scripts: {
            start: 'node server.js'
        },
        dependencies
    }, null, 2) + '\n';
}

/**
 * Generates a concise setup guide matching the emitted server, schema, and routes.
 *
 * @param {Array<Object>} entities - List of entity objects
 * @returns {string} - README.md content
 */
function generateReadme(entities) {
    const routeList = entities.length > 0
        ? entities.map(entity => `- \`/${pluralize(entity.name)}\` (CRUD collection route; item operations use \`/${pluralize(entity.name)}/:id\`)`).join('\n')
        : '- No entity routes were generated.';

    return `# APIForge Generated Backend\n\n` +
           `This project is an Express REST API backed by MySQL.\n\n` +
           `## Setup\n\n` +
           `1. Install the runtime dependencies:\n\n` +
           `   \`\`\`sh\n` +
           `   npm install\n` +
           `   \`\`\`\n\n` +
           `2. Copy \`.env.example\` to \`.env\` and set the MySQL connection values. For example, use \`cp .env.example .env\` on macOS/Linux or \`Copy-Item .env.example .env\` in PowerShell.\n\n` +
           `3. Create the MySQL database named by \`DB_NAME\` and import the generated schema. With the example database name and root user:\n\n` +
           `   \`\`\`sh\n` +
           `   mysql -u root -p -e "CREATE DATABASE apiforge_db;"\n` +
           `   \`\`\`\n\n` +
           `   In Command Prompt, Git Bash, or a Unix shell:\n\n` +
           `   \`\`\`sh\n` +
           `   mysql -u root -p apiforge_db < database/schema.sql\n` +
           `   \`\`\`\n\n` +
           `   In PowerShell:\n\n` +
           `   \`\`\`powershell\n` +
           `   mysql.exe -u root -p apiforge_db -e "source database/schema.sql"\n` +
           `   \`\`\`\n\n` +
           `   If you change \`DB_NAME\` or \`DB_USER\` in \`.env\`, use the same values when creating and importing the database.\n\n` +
           `4. Start the backend:\n\n` +
           `   \`\`\`sh\n` +
           `   npm start\n` +
           `   \`\`\`\n\n` +
           `The server listens on \`PORT\` from \`.env\` (default \`3000\`).\n\n` +
           `## Routes and API specification\n\n` +
           `${routeList}\n` +
           `- \`/health\` reports server health.\n\n` +
           `The OpenAPI document is at \`swagger.json\` in the project root. The generated server does not serve Swagger UI or expose that file over HTTP.\n`;
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
           `        const [rows] = await pool.query('SELECT * FROM ${quoteIdentifier(entityName)}');\n` +
           `        return rows;\n` +
           `    }\n\n` +
           `    static async findById(id) {\n` +
           `        const [rows] = await pool.query('SELECT * FROM ${quoteIdentifier(entityName)} WHERE ${quoteIdentifier(pkField.name)} = ?', [id]);\n` +
           `        return rows.length > 0 ? rows[0] : null;\n` +
           `    }\n\n` +
           `    static async create(data) {\n` +
           `        const [result] = await pool.query('INSERT INTO ${quoteIdentifier(entityName)} SET ?', [data]);\n` +
           `        return { ${pkField.name}: result.insertId, ...data };\n` +
           `    }\n\n` +
           `    static async update(id, data) {\n` +
           `        if (!data || Object.keys(data).length === 0) {\n` +
           `            return await this.findById(id);\n` +
           `        }\n` +
           `        await pool.query('UPDATE ${quoteIdentifier(entityName)} SET ? WHERE ${quoteIdentifier(pkField.name)} = ?', [data, id]);\n` +
           `        return await this.findById(id);\n` +
           `    }\n\n` +
           `    static async delete(id) {\n` +
           `        const [result] = await pool.query('DELETE FROM ${quoteIdentifier(entityName)} WHERE ${quoteIdentifier(pkField.name)} = ?', [id]);\n` +
           `        return result.affectedRows > 0;\n` +
           `    }${relMethodsStr}\n` +
           `}\n\n` +
           `module.exports = ${entityName}Model;\n`;
}

/**
 * PART 5: Functional Controller Generation
 * Generates controller functions calling model methods with 400 validation, 404 & 500 error handling.
 * Includes relationship controller handlers if the entity participates in relationships.
 * 
 * @param {string} entityName - Entity name (e.g. "Student")
 * @param {Array} [fieldsOrRelations=[]] - List of field objects OR list of relationship objects
 * @param {Array} [maybeRelations=[]] - List of relationship objects (if 2nd arg was fields)
 * @returns {string} - JS controller module content
 */
function generateController(entityName, fieldsOrRelations = [], maybeRelations = []) {
    let fields = [];
    let relations = [];

    if (Array.isArray(fieldsOrRelations) && fieldsOrRelations.length > 0) {
        if (fieldsOrRelations[0].relationType || fieldsOrRelations[0].sourceEntity) {
            relations = fieldsOrRelations;
            fields = [];
        } else {
            fields = fieldsOrRelations;
            relations = Array.isArray(maybeRelations) ? maybeRelations : [];
        }
    } else {
        relations = Array.isArray(maybeRelations) ? maybeRelations : [];
    }
    const lowerName = lowerFirst(entityName);
    const pluralName = pluralize(entityName);
    const modelVar = `${entityName}Model`;
    const getPluralFn = `get${pluralName.charAt(0).toUpperCase() + pluralName.slice(1)}`;

    // Build validation checks for fields with numeric or string-length validations
    const validationCheckLines = [];
    (fields || []).forEach(f => {
        if (Array.isArray(f.validations) && f.validations.length > 0) {
            const minV = f.validations.find(v => v.type === 'MIN');
            const maxV = f.validations.find(v => v.type === 'MAX');
            const minLengthV = f.validations.find(v => v.type === 'MIN_LENGTH');
            const maxLengthV = f.validations.find(v => v.type === 'MAX_LENGTH');

            if (minV) {
                validationCheckLines.push(
                    `    if (data.${f.name} !== undefined && data.${f.name} !== null && data.${f.name} < ${minV.value}) {\n` +
                    `        return "Field '${f.name}' must be >= ${minV.value}.";\n` +
                    `    }`
                );
            }
            if (maxV) {
                validationCheckLines.push(
                    `    if (data.${f.name} !== undefined && data.${f.name} !== null && data.${f.name} > ${maxV.value}) {\n` +
                    `        return "Field '${f.name}' must be <= ${maxV.value}.";\n` +
                    `    }`
                );
            }
            if (minLengthV || maxLengthV) {
                validationCheckLines.push(
                    `    if (data.${f.name} !== undefined && data.${f.name} !== null) {\n` +
                    `        if (typeof data.${f.name} !== 'string') {\n` +
                    `            return "Field '${f.name}' must be a string.";\n` +
                    `        }\n` +
                    `        const ${f.name}Length = Array.from(data.${f.name}).length;\n` +
                    (minLengthV
                        ? `        if (${f.name}Length < ${minLengthV.value}) {\n            return "Field '${f.name}' length must be >= ${minLengthV.value}.";\n        }\n`
                        : '') +
                    (maxLengthV
                        ? `        if (${f.name}Length > ${maxLengthV.value}) {\n            return "Field '${f.name}' length must be <= ${maxLengthV.value}.";\n        }\n`
                        : '') +
                    `    }`
                );
            }
        }
    });

    const validationBody = validationCheckLines.length > 0
        ? '\n' + validationCheckLines.join('\n') + '\n    return null;'
        : '    return null;';

    const extraFunctions = [];
    const exportedFunctions = [
        `validate${entityName}`,
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
           `/**\n` +
           ` * Validates input data for ${entityName}\n` +
           ` * @param {Object} data - Input payload\n` +
           ` * @returns {string|null} - Error message if invalid, null if valid\n` +
           ` */\n` +
           `function validate${entityName}(data) {\n` +
           `    if (!data || typeof data !== 'object') return null;\n` +
           `${validationBody}\n` +
           `}\n\n` +
           `async function create${entityName}(req, res) {\n` +
           `    try {\n` +
           `        const validationError = validate${entityName}(req.body);\n` +
           `        if (validationError) {\n` +
           `            return res.status(400).json({ success: false, error: validationError });\n` +
           `        }\n` +
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
           `        const validationError = validate${entityName}(req.body);\n` +
           `        if (validationError) {\n` +
           `            return res.status(400).json({ success: false, error: validationError });\n` +
           `        }\n` +
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
 * Generates OpenAPI 3.0.0 JSON specification for all entities and relationships,
 * including numeric ranges, string lengths, and default property values.
 * 
 * @param {Array<Object>} entities - List of entity objects
 * @param {Array<Object>} [relations=[]] - List of relationship objects
 * @returns {string} - JSON string formatted with indent
 */
function generateSwagger(entities, relations = []) {
    const paths = {};
    const schemas = {};
    const entityMap = new Map(entities.map(entity => [entity.name, entity]));

    entities.forEach(entity => {
        const plural = pluralize(entity.name);
        const idParam = [
            {
                name: "id",
                in: "path",
                required: true,
                schema: { type: getPrimaryKeySwaggerType(entity) },
                description: `ID of the ${entity.name}`
            }
        ];

        paths[`/${plural}`] = {
            get: { summary: `Get all ${plural}`, responses: { "200": { description: "OK" } } },
            post: {
                summary: `Create ${entity.name}`,
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { "$ref": `#/components/schemas/${entity.name}` }
                        }
                    }
                },
                responses: { "201": { description: "Created" } }
            }
        };
        paths[`/${plural}/{id}`] = {
            parameters: idParam,
            get: { summary: `Get ${entity.name} by ID`, responses: { "200": { description: "OK" } } },
            put: {
                summary: `Update ${entity.name}`,
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { "$ref": `#/components/schemas/${entity.name}` }
                        }
                    }
                },
                responses: { "200": { description: "OK" } }
            },
            delete: { summary: `Delete ${entity.name}`, responses: { "200": { description: "OK" } } }
        };

        const properties = {};
        entity.fields.forEach(f => {
            const prop = { type: SWAGGER_TYPE_MAP[f.dataType] || 'string' };

            // Add numeric and string-length bounds if validations exist
            if (Array.isArray(f.validations)) {
                const minV = f.validations.find(v => v.type === 'MIN');
                const maxV = f.validations.find(v => v.type === 'MAX');
                const minLengthV = f.validations.find(v => v.type === 'MIN_LENGTH');
                const maxLengthV = f.validations.find(v => v.type === 'MAX_LENGTH');
                if (minV) prop.minimum = minV.value;
                if (maxV) prop.maximum = maxV.value;
                if (minLengthV) prop.minLength = minLengthV.value;
                if (maxLengthV) prop.maxLength = maxLengthV.value;
            }

            // Add default if defaultValue exists
            if (f.defaultValue !== null && f.defaultValue !== undefined) {
                prop.default = f.defaultValue.value;
            }

            properties[f.name] = prop;
        });

        const schemaObj = { type: "object", properties };
        const requiredFields = entity.fields
            .filter(f => f.constraints && f.constraints.includes('REQUIRED'))
            .map(f => f.name);
        if (requiredFields.length > 0) {
            schemaObj.required = requiredFields;
        }

        schemas[entity.name] = schemaObj;
    });

    relations.forEach(rel => {
        const sourcePlural = pluralize(rel.sourceEntity);
        const targetPlural = pluralize(rel.targetEntity);
        const targetParam = `${lowerFirst(rel.targetEntity)}Id`;
        const sourceEntity = entityMap.get(rel.sourceEntity);
        const targetEntity = entityMap.get(rel.targetEntity);
        const idParam = [
            {
                name: "id",
                in: "path",
                required: true,
                schema: { type: getPrimaryKeySwaggerType(sourceEntity) },
                description: `ID of the ${rel.sourceEntity}`
            }
        ];

        if (rel.relationType === 'MANY_TO_MANY') {
            paths[`/${sourcePlural}/{id}/${targetPlural}`] = {
                parameters: idParam,
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
                parameters: [
                    ...idParam,
                    {
                        name: targetParam,
                        in: "path",
                        required: true,
                        schema: { type: getPrimaryKeySwaggerType(targetEntity) },
                        description: `ID of the ${rel.targetEntity}`
                    }
                ],
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
                parameters: idParam,
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
                parameters: idParam,
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
        { path: '.env.example', content: generateEnvExample() },
        { path: 'package.json', content: generatePackageJson() },
        { path: 'README.md', content: generateReadme(entities) }
    ];

    entities.forEach(entity => {
        const lowerName = lowerFirst(entity.name);
        files.push({ path: `models/${entity.name}.js`, content: generateModel(entity.name, entity.fields, relations, entities) });
        files.push({ path: `controllers/${lowerName}Controller.js`, content: generateController(entity.name, entity.fields, relations) });
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
    generatePackageJson,
    generateReadme,
    generateModel,
    generateController,
    generateRoutes,
    generateServer,
    generateSwagger,
    formatSQLLiteral,
    pluralize,
    lowerFirst,
    extractEntitiesFromIR,
    extractRelationsFromIR
};
