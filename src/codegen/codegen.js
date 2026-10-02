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
const MANAGED_OUTPUT_DIRECTORIES = ['models', 'controllers', 'routes', 'config', 'database'];

function isPathWithin(basePath, targetPath) {
    const relative = path.relative(basePath, targetPath);
    return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function assertDirectoryIsSafe(directoryPath, outputBase) {
    if (!fs.existsSync(directoryPath)) return;

    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        const relative = path.relative(outputBase, directoryPath) || 'output';
        throw new Error(`Cannot write generated output: '${relative}' must be a real directory.`);
    }
}

function resolveOutputPath(outputBase, relativePath) {
    const fullPath = path.resolve(outputBase, relativePath);
    if (!isPathWithin(outputBase, fullPath)) {
        throw new Error(`Cannot write generated output outside '${outputBase}': ${relativePath}`);
    }
    return fullPath;
}

function ensureOutputDirectory(outputBase, directoryPath) {
    assertDirectoryIsSafe(outputBase, outputBase);

    const relative = path.relative(outputBase, directoryPath);
    let current = outputBase;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        assertDirectoryIsSafe(current, outputBase);
    }

    fs.mkdirSync(directoryPath, { recursive: true });
}

function pruneManagedDirectory(directoryPath, expectedPaths, outputBase) {
    if (!fs.existsSync(directoryPath)) return;
    assertDirectoryIsSafe(directoryPath, outputBase);

    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            pruneManagedDirectory(entryPath, expectedPaths, outputBase);
            if (fs.readdirSync(entryPath).length === 0) fs.rmdirSync(entryPath);
        } else if (!expectedPaths.has(entryPath)) {
            fs.unlinkSync(entryPath);
        }
    }
}

function writeGeneratedFiles(files) {
    const outputBase = path.resolve(process.cwd(), 'output');
    ensureOutputDirectory(outputBase, outputBase);

    const expectedPaths = new Set();
    for (const file of files) {
        const fullPath = resolveOutputPath(outputBase, file.path);
        expectedPaths.add(fullPath);
        const directoryPath = path.dirname(fullPath);
        ensureOutputDirectory(outputBase, directoryPath);
        fs.writeFileSync(fullPath, file.content, 'utf-8');
    }

    for (const directoryName of MANAGED_OUTPUT_DIRECTORIES) {
        const directoryPath = resolveOutputPath(outputBase, directoryName);
        pruneManagedDirectory(directoryPath, expectedPaths, outputBase);
    }
}

// ── Helper Utilities ────────────────────────────────────────

/**
 * Pluralizes a noun for REST API routes.
 * e.g., Student -> students, Course -> courses, Category -> categories
 */
function pluralize(word) { return require('../utils/target-names').pluralize(word); }

/**
 * Converts a string to camelCase with lowercase first letter.
 * e.g., Student -> student, Course -> course
 */
function lowerFirst(str) { return require('../utils/target-names').lowerFirst(str); }

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
function formatSQLLiteral(defaultValue, enumLiteral = false) {
    if (!defaultValue) return '';
    if (defaultValue.type === 'STRING') {
        const value = String(defaultValue.value);
        // DSL backslashes are literal. Preserve them for STRING and ENUM under
        // the supported MySQL mode (NO_BACKSLASH_ESCAPES disabled).
        const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
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
 * Resolves a field's MySQL column type. STRING keeps the legacy VARCHAR(255)
 * capacity unless a declared length bound requires a wider column.
 *
 * @param {Object} field - Field definition extracted from IR
 * @returns {string} - MySQL column type
 */
function getMySQLColumnType(field) {
    if (field?.dataType === 'ENUM') {
        return `ENUM(${field.enumValues.map(value => formatSQLLiteral({ type: 'STRING', value }, true)).join(', ')}) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`;
    }
    if (!field || field.dataType !== 'STRING') {
        return MYSQL_TYPE_MAP[field && field.dataType] || (field && field.dataType);
    }

    const declaredLengths = Array.isArray(field.validations)
        ? field.validations
            .filter(v => (v.type === 'MIN_LENGTH' || v.type === 'MAX_LENGTH') && Number.isInteger(v.value) && v.value >= 0)
            .map(v => v.value)
        : [];
    const capacity = Math.max(255, ...declaredLengths);
    return `VARCHAR(${capacity})`;
}

/**
 * Maps APIForge DSL data types to OpenAPI / Swagger JSON Schema types.
 */
const SWAGGER_TYPE_MAP = {
    'INT': 'integer',
    'STRING': 'string',
    'FLOAT': 'number',
    'BOOLEAN': 'boolean',
    'ENUM': 'string'
};

/**
 * MySQL reserved words that must be quoted with backticks when used as table or column identifiers.
 */
const MYSQL_RESERVED_WORDS = new Set([
    'LATERAL', 'INTERSECT', 'ARRAY', 'MEMBER',
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
                ...(inst.dataType === 'ENUM' ? { enumValues: [...inst.enumValues] } : {}),
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
 * Canonical target identity. Declared fields remain source-faithful; the
 * implicit key exists only in code-generation metadata.
 * 
 * @param {Object} entity - Entity definition object
 * @returns {Object} - Key name/type, origin, autoGenerated and declared metadata
 */
function getEffectiveKey(entity) {
    const pk = entity?.fields?.find(f => f.constraints?.includes('PRIMARY_KEY'));
    return pk
        ? { ...pk, origin: 'explicit', autoGenerated: pk.dataType === 'INT' && pk.defaultValue == null }
        : { name: 'id', dataType: 'INT', origin: 'implicit', autoGenerated: true };
}

/**
 * Gets the OpenAPI schema type for an entity identifier.
 * Entities without an explicit primary key use the generated INT id column.
 *
 * @param {Object} entity - Entity definition object
 * @returns {string} - OpenAPI schema type
 */
function getPrimaryKeySwaggerType(entity) {
    const primaryKey = getEffectiveKey(entity);
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
        const effectiveKey = getEffectiveKey(entity);
        const columnDefs = entity.fields.map(field => {
            const mysqlType = getMySQLColumnType(field);
            const isPk = effectiveKey.origin === 'explicit' && field.name === effectiveKey.name;
            const isRequired = field.constraints.includes('REQUIRED');
            const isUnique = field.constraints.includes('UNIQUE');
            const hasDefault = field.defaultValue !== null && field.defaultValue !== undefined;

            const parts = [];

            // Primary Key & Auto Increment handling:
            // If primary key has an explicit default value, omit AUTO_INCREMENT to prevent MySQL Error 1067.
            if (isPk) {
                if (hasDefault) {
                    parts.push('PRIMARY KEY');
                } else if (effectiveKey.autoGenerated) {
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
                const sqlVal = formatSQLLiteral(field.defaultValue, field.dataType === 'ENUM');
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

        if (effectiveKey.origin === 'implicit') {
            columnDefs.unshift(`    ${quoteIdentifier(effectiveKey.name)} ${getMySQLColumnType(effectiveKey)} PRIMARY KEY AUTO_INCREMENT`);
        }

        return `CREATE TABLE ${quoteIdentifier(entity.name)} (\n` + columnDefs.join(',\n') + `\n);`;
    });

    // 2. Relationship statements (Junction tables or ALTER TABLE statements)
    const relationStatements = [];

    relations.forEach(rel => {
        const sourceEntity = entityMap.get(rel.sourceEntity);
        const targetEntity = entityMap.get(rel.targetEntity);

        if (!sourceEntity || !targetEntity) return;

        const sourcePk = getEffectiveKey(sourceEntity);
        const targetPk = getEffectiveKey(targetEntity);
        const sourceFkCol = `${lowerFirst(sourceEntity.name)}_${sourcePk.name}`;
        const targetFkCol = `${lowerFirst(targetEntity.name)}_${targetPk.name}`;
        const sourceFkType = getMySQLColumnType(sourcePk) || 'INT';
        const targetFkType = getMySQLColumnType(targetPk) || 'INT';

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
                `ALTER TABLE ${targetTable} ADD CONSTRAINT ${quoteIdentifier(fkConstraintName)} FOREIGN KEY (${sourceFkColName}) REFERENCES ${sourceTable}(${sourcePkName}) ON DELETE SET NULL;`
            );
        } else if (rel.relationType === 'MANY_TO_ONE') {
            const fkConstraintName = `fk_${sourceEntity.name.toLowerCase()}_${targetEntity.name.toLowerCase()}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (MANY_TO_ONE)\n` +
                `ALTER TABLE ${sourceTable} ADD COLUMN ${targetFkColName} ${targetFkType};\n` +
                `ALTER TABLE ${sourceTable} ADD CONSTRAINT ${quoteIdentifier(fkConstraintName)} FOREIGN KEY (${targetFkColName}) REFERENCES ${targetTable}(${targetPkName}) ON DELETE SET NULL;`
            );
        } else if (rel.relationType === 'ONE_TO_ONE') {
            const fkConstraintName = `fk_${targetEntity.name.toLowerCase()}_${sourceEntity.name.toLowerCase()}`;
            relationStatements.push(
                `-- Relationship: ${sourceEntity.name} ${rel.relationName} ${targetEntity.name} (ONE_TO_ONE)\n` +
                `ALTER TABLE ${targetTable} ADD COLUMN ${sourceFkColName} ${sourceFkType} UNIQUE;\n` +
                `ALTER TABLE ${targetTable} ADD CONSTRAINT ${quoteIdentifier(fkConstraintName)} FOREIGN KEY (${sourceFkColName}) REFERENCES ${sourceTable}(${sourcePkName}) ON DELETE CASCADE;`
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
function generateDBConfig(entities = [], relations = []) {
    const privateColumns = new Set(['__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
    const hasPrototypeColumn = entities.some(e => e.fields.some(f => privateColumns.has(f.name))) || relations.some(rel => {
        return entities.some(entity => [rel.sourceEntity, rel.targetEntity].includes(entity.name) &&
            privateColumns.has(`${lowerFirst(entity.name)}_${getEffectiveKey(entity).name}`));
    });
    const safeRows = hasPrototypeColumn ? `// Preserve own prototype-sensitive columns before mysql2 object assignment.
const rawQuery = pool.query.bind(pool);
pool.query = async (sql, values) => {
    const options = typeof sql === 'string' ? { sql } : sql;
    const [result, fields] = await rawQuery({ ...options, rowsAsArray: true, disableEval: true }, values);
    if (!Array.isArray(result) || !fields) return [result, fields];
    return [result.map(row => Object.fromEntries(fields.map((field, index) => [field.name, row[index]]))), fields];
};

` : '';
    return `/**\n` +
           ` * Database Connection Pool\n` +
           ` * Generated automatically by APIForge Compiler\n` +
           ` */\n\n` +
           `const mysql = require('mysql2/promise');\n\n` +
           `const pool = mysql.createPool({\n` +
           `    host: process.env.DB_HOST || 'localhost',\n` +
           `    port: Number(process.env.DB_PORT) || 3306,\n` +
           `    user: process.env.DB_USER || 'root',\n` +
           `    password: process.env.DB_PASSWORD || '',\n` +
           `    database: process.env.DB_NAME || 'apiforge_db',\n` +
           `    waitForConnections: true,\n` +
           `    connectionLimit: 10,\n` +
           `    queueLimit: 0\n` +
           `});\n\n` +
           safeRows + `module.exports = pool;\n`;
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
           `DB_PORT=3306\n` +
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
        engines: { node: '>=18' },
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
           `## Supported target\n\n` +
           `Use Node.js >=18 and MySQL >=8.0.16 with utf8mb4, InnoDB DYNAMIC row format and 16 KiB pages (3072-byte keys). Configure the database/table defaults accordingly; the generator does not override server settings. Use strict SQL mode with NO_BACKSLASH_ESCAPES disabled for schema import and runtime connections. Ordinary STRING equality follows the configured collation; ENUM uses utf8mb4_bin.\n\n` +
           `Preflight checks identifier lengths, individual VARCHAR/index capacities and junction composite keys. Whole-row layout, scalar storage limits and server configuration remain database-authoritative.\n\n` +
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
           `The OpenAPI document is at \`swagger.json\` in the project root. The generated server does not serve Swagger UI or expose that file over HTTP.\n\n` +
           `## Write requests\n\n` +
           `POST and PUT require a JSON object. Unknown properties, implicit generated \`id\`, and SQL-added relationship fields are rejected with HTTP 400 before model access. Only declared supplied fields are forwarded.\n\n` +
           `INT values must be finite safe integers; FLOAT values finite numbers; BOOLEAN values booleans; STRING values strings; ENUM values exact member strings. Bounds and Unicode code-point lengths apply to non-null values.\n\n` +
           `POST requires REQUIRED fields unless a declared DEFAULT or generated auto-increment key supplies omission. REQUIRED null is rejected; optional null is allowed. Defaults remain database-applied.\n\n` +
           `Create identity uses a supplied explicit primary key first (including a caller-supplied INT auto-increment key), otherwise the generated insertId, otherwise the explicit key's declared DEFAULT. Explicit STRING keys are supported. A non-generated key without DEFAULT is left to the database; PRIMARY KEY alone does not make it required by request validation. The create response resolves only the key and submitted fields, without rereading arbitrary database defaults.\n\n` +
           `PUT is partial, including an empty object that rereads the existing row. The URL \`:id\` identifies the resource even when its primary key has another name or STRING type. Primary keys are immutable: any supplied explicit primary-key field returns HTTP 400 before model access, even the same value or null. Direct model updates also reject key properties before SQL.\n\n` +
           `OpenAPI uses Entity.Create/Update/Read roles and response envelopes. Update omits immutable keys; optional inputs are nullable; synthetic FK columns are readOnly. Declared BOOLEAN rows return booleans on source and target reads.\n\n` +
           `Malformed JSON returns sanitized HTTP 400. POST/PUT database failures return sanitized HTTP 500; UNIQUE remains database-enforced without prechecks or duplicate-key status mapping.\n\n` +
           `## Collection query options\n\n` +
           `Collection GET preserves \`{ success: true, data: [...] }\`. Without \`page\` or \`limit\`, results remain unbounded and no count query runs.\n\n` +
           `- Exact-match filters use field names, including implicit \`id\`. INT requires a safe integer; FLOAT a finite decimal/exponent number; BOOLEAN accepts only \`true\` or \`false\`; STRING uses raw text; ENUM requires an exact declared member.\n` +
           `- \`sort=<field>\` accepts known fields; \`order=asc|desc\` defaults to asc and requires sort.\n` +
           `- \`page\` or \`limit\` enables pagination: defaults page=1, limit=20; maximum limit=100. Both must be positive decimal integers with a safe offset.\n` +
           `- Pagination returns \`X-Total-Count\`, \`X-Page\`, \`X-Limit\`, \`X-Total-Pages\` headers; counts use the same filters. Pages beyond the last return an empty data array. Pagination uses primary-key ordering/tie-breaking for stable pages.\n` +
           `- Reserved parameters are \`page\`, \`limit\`, \`sort\`, \`order\`; fields with those names cannot be filtered, but can be sorted. Unknown parameters, repeated/non-scalar parameters and invalid values return HTTP 400. No special null-filter syntax is supported.\n` +
           `- Item GET, POST/PUT/DELETE and relationship routes do not gain query options. Filter values are bound SQL parameters; column names and ordering come from trusted whitelists.\n\n` +
           `Examples (use fields declared in your entity):\n\n` +
           `\`GET /${entities.length ? pluralize(entities[0].name) : 'students'}?age=21\`\n\n` +
           `\`GET /${entities.length ? pluralize(entities[0].name) : 'students'}?sort=name&order=desc\`\n\n` +
           `\`GET /${entities.length ? pluralize(entities[0].name) : 'students'}?status=active&sort=name&page=2&limit=20\`\n`;
}

// Collection metadata is target-specific: implicit SQL ids never enter the IR.
const COLLECTION_RESERVED_PARAMS = ['page', 'limit', 'sort', 'order'];
function collectionFields(entity) {
    const fields = entity.fields || [];
    const key = getEffectiveKey(entity);
    return key.origin === 'explicit' ? fields
        : [{ name: key.name, dataType: key.dataType, constraints: [] }, ...fields];
}

// Write policy uses declared fields only; collection read metadata also has implicit id.
function postRequiresField(field, key) {
    return field.constraints?.includes('REQUIRED') && field.defaultValue == null &&
        !(key.autoGenerated && field.name === key.name);
}

// The same emitted key metadata and immutable-key rule serve controllers and
// direct model callers. Implicit request keys still fail the unknown-field check.
function generatePrimaryKeyPolicy(entity, includeCreate = false) {
    const key = getEffectiveKey(entity);
    const metadata = { name: key.name, origin: key.origin, autoGenerated: key.autoGenerated,
        defaultValue: key.defaultValue ?? null };
    return `// Primary-key policy (source-declared defaults retain their typed values).
const PRIMARY_KEY = ${JSON.stringify(metadata, null, 4)};

function primaryKeyUpdateError(data) {
    return data && Object.prototype.hasOwnProperty.call(data, PRIMARY_KEY.name)
        ? "Field '" + PRIMARY_KEY.name + "' is immutable." : null;
}

` + (includeCreate ? `function resolveCreateIdentity(data, result) {
    if (PRIMARY_KEY.origin === 'explicit' && Object.prototype.hasOwnProperty.call(data, PRIMARY_KEY.name)) {
        return { resolved: true, value: data[PRIMARY_KEY.name] };
    }
    if (PRIMARY_KEY.autoGenerated) return { resolved: true, value: result.insertId };
    if (PRIMARY_KEY.defaultValue !== null) return { resolved: true, value: PRIMARY_KEY.defaultValue.value };
    // A missing, non-generated, non-defaulted key remains database-authoritative.
    return { resolved: false };
}

` : '') + `// End primary-key policy\n\n`;
}

function generateWriteValidation(entity) {
    const key = getEffectiveKey(entity);
    const metadata = entity.fields.map(field => ({
        name: field.name, dataType: field.dataType,
        required: !!field.constraints?.includes('REQUIRED'),
        requiredOnCreate: !!postRequiresField(field, key),
        validations: field.validations || [],
        ...(field.dataType === 'ENUM' ? { enumValues: field.enumValues } : {})
    }));
    return generatePrimaryKeyPolicy(entity) + `const WRITE_FIELDS = ${JSON.stringify(metadata, null, 4)};

// First error: shape, unknown own keys, immutable key, then declaration order (presence/null/type/bounds).
function validate${entity.name}(data, operation = 'update') {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return 'Request body must be a JSON object.';
    }
    for (const name of Object.keys(data)) {
        if (!WRITE_FIELDS.some(field => field.name === name)) return "Unknown field '" + name + "'.";
    }
    const keyError = operation === 'update' ? primaryKeyUpdateError(data) : null;
    if (keyError) return keyError;
    for (const field of WRITE_FIELDS) {
        const label = "Field '" + field.name + "'";
        if (!Object.prototype.hasOwnProperty.call(data, field.name)) {
            if (operation === 'create' && field.requiredOnCreate) return label + ' is required.';
            continue;
        }
        const value = data[field.name];
        if (value === null) {
            if (field.required) return label + ' cannot be null.';
            continue;
        }
        switch (field.dataType) {
            case 'INT':
                if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)) return label + ' must be an integer.';
                break;
            case 'FLOAT':
                if (typeof value !== 'number' || !Number.isFinite(value)) return label + ' must be a finite number.';
                break;
            case 'BOOLEAN':
                if (typeof value !== 'boolean') return label + ' must be a boolean.';
                break;
            case 'STRING':
                if (typeof value !== 'string') return label + ' must be a string.';
                break;
            case 'ENUM':
                if (typeof value !== 'string' || !field.enumValues.includes(value)) return label + ' must be one of: ' + field.enumValues.join(', ') + '.';
                break;
        }
        // Normalize bound order independently of modifier order in the source.
        for (const type of ['MIN', 'MAX', 'MIN_LENGTH', 'MAX_LENGTH']) {
            const bound = field.validations.find(validation => validation.type === type);
            if (!bound) continue;
            const measured = type.endsWith('_LENGTH') ? Array.from(value).length : value;
            const minimum = type.startsWith('MIN');
            if (minimum ? measured < bound.value : measured > bound.value) {
                return label + (type.endsWith('_LENGTH') ? ' length' : '') + ' must be ' + (minimum ? '>=' : '<=') + ' ' + bound.value + '.';
            }
        }
    }
    return null;
}

function select${entity.name}WriteData(body) {
    const data = {};
    for (const field of WRITE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, field.name)) {
            // Define an own property even for a prototype-sensitive declared name.
            Object.defineProperty(data, field.name, { value: body[field.name], enumerable: true, writable: true, configurable: true });
        }
    }
    return data;
}

`;
}

function generateReadNormalization() {
    return `// Read normalization: declared BOOLEAN columns only.
function normalizeRow(row, booleanFields) {
    if (row == null) return row;
    const result = { ...row };
    for (const name of booleanFields) {
        if (Object.prototype.hasOwnProperty.call(result, name) && result[name] != null) {
            if (typeof result[name] === 'number') result[name] = result[name] !== 0;
        }
    }
    return result;
}
// End read normalization

`;
}

function generateCollectionMethods(entity) {
    const primaryKey = getEffectiveKey(entity).name;
    const table = JSON.stringify(quoteIdentifier(entity.name));
    return `    // Parse HTTP strings once, before any database access.
    static parseQuery(query = {}) {
        const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
        const reserved = ${JSON.stringify(COLLECTION_RESERVED_PARAMS)};
        for (const key of Object.keys(query)) {
            if (!reserved.includes(key) && !QUERY_FIELDS.some(field => field.name === key)) {
                fail("Unknown query parameter '" + key + "'.");
            }
            if (typeof query[key] !== 'string') fail("Query parameter '" + key + "' must have one string value.");
        }
        const positiveInteger = (key, fallback) => {
            if (!Object.prototype.hasOwnProperty.call(query, key)) return fallback;
            if (!/^[1-9]\\d*$/.test(query[key])) fail('Invalid ' + key + ' parameter.');
            const value = Number(query[key]);
            if (!Number.isSafeInteger(value)) fail('Invalid ' + key + ' parameter.');
            return value;
        };
        const paginated = Object.prototype.hasOwnProperty.call(query, 'page') || Object.prototype.hasOwnProperty.call(query, 'limit');
        const page = positiveInteger('page', 1);
        const limit = positiveInteger('limit', 20);
        if (limit > 100) fail('Invalid limit parameter: maximum is 100.');
        const offset = (page - 1) * limit;
        if (!Number.isSafeInteger(offset)) fail('Invalid page parameter: offset exceeds safe integer range.');
        const sort = query.sort;
        if (sort !== undefined && !QUERY_FIELDS.some(field => field.name === sort)) fail("Invalid sort field '" + sort + "'.");
        if (query.order !== undefined && sort === undefined) fail('The order parameter requires sort.');
        const order = query.order === undefined ? 'asc' : query.order;
        if (order !== 'asc' && order !== 'desc') fail("Invalid sort order '" + order + "'.");
        const filters = Object.create(null);
        for (const field of QUERY_FIELDS) {
            if (reserved.includes(field.name) || !Object.prototype.hasOwnProperty.call(query, field.name)) continue;
            const raw = query[field.name];
            let value = raw;
            if (field.dataType === 'INT') {
                if (!/^-?\\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail("Invalid value for filter '" + field.name + "'.");
                value = Number(raw);
            } else if (field.dataType === 'FLOAT') {
                if (!/^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) fail("Invalid value for filter '" + field.name + "'.");
                value = Number(raw);
            } else if (field.dataType === 'BOOLEAN') {
                if (raw !== 'true' && raw !== 'false') fail("Invalid value for filter '" + field.name + "'.");
                value = raw === 'true';
            } else if (field.dataType === 'ENUM' && !field.enumValues.includes(raw)) {
                fail("Invalid value for ENUM filter '" + field.name + "'.");
            }
            filters[field.name] = value;
        }
        return { filters, sort, order, paginated, page, limit, offset };
    }

    static filterQuery(options) {
        const clauses = [];
        const values = [];
        for (const field of QUERY_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(options.filters || {}, field.name)) {
                clauses.push(field.column + ' = ?');
                values.push(options.filters[field.name]);
            }
        }
        return { where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', values };
    }

    static async findAll(options = {}) {
        const { where, values } = this.filterQuery(options);
        let sql = 'SELECT * FROM ' + ${table} + where;
        const sort = QUERY_FIELDS.find(field => field.name === (options.sort || (options.paginated ? ${JSON.stringify(primaryKey)} : undefined)));
        if (sort) {
            sql += ' ORDER BY ' + sort.column + (options.order === 'desc' ? ' DESC' : ' ASC');
            if (options.paginated && sort.name !== ${JSON.stringify(primaryKey)}) {
                sql += ', ' + QUERY_FIELDS.find(field => field.name === ${JSON.stringify(primaryKey)}).column + ' ASC';
            }
        }
        if (options.paginated) {
            sql += ' LIMIT ? OFFSET ?';
            values.push(options.limit, options.offset);
        }
        const [rows] = await pool.query(sql, values);
        return rows.map(row => normalizeRow(row, ${JSON.stringify(entity.fields.filter(f => f.dataType === 'BOOLEAN').map(f => f.name))}));
    }

    static async countFiltered(options) {
        const { where, values } = this.filterQuery(options);
        const [rows] = await pool.query('SELECT COUNT(*) AS total FROM ' + ${table} + where, values);
        const total = Number(rows[0].total);
        if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid collection count.');
        return total;
    }\n\n`;
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
    const queryFieldsJson = JSON.stringify(collectionFields({ name: entityName, fields }).map(field => ({
        name: field.name, column: quoteIdentifier(field.name), dataType: field.dataType,
        ...(field.dataType === 'ENUM' ? { enumValues: [...field.enumValues] } : {})
    })), null, 4);
    const pkField = getEffectiveKey({ name: entityName, fields });
    const entityMap = new Map(entities.map(e => [e.name, e]));

    // Generate relationship helper methods for this entity
    const relMethods = [];

    relations.forEach(rel => {
        if (rel.sourceEntity === entityName) {
            const targetEntity = entityMap.get(rel.targetEntity) || { name: rel.targetEntity, fields: [] };
            const targetPk = getEffectiveKey(targetEntity);
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
                    `            'SELECT t.* FROM ${quoteIdentifier(rel.targetEntity)} t JOIN ${quoteIdentifier(junctionTable)} j ON t.${quoteIdentifier(targetPk.name)} = j.${quoteIdentifier(targetFkCol)} WHERE j.${quoteIdentifier(sourceFkCol)} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id]\n` +
                    `        );\n` +
                    `        return rows.map(row => normalizeRow(row, ${JSON.stringify(targetEntity.fields.filter(f => f.dataType === 'BOOLEAN').map(f => f.name))}));\n` +
                    `    }\n\n` +
                    `    static async add${upperFirst(rel.targetEntity)}(${lowerFirst(entityName)}Id, ${targetParam}) {\n` +
                    `        await pool.query(\n` +
                    `            'INSERT INTO ${quoteIdentifier(junctionTable)} (${quoteIdentifier(sourceFkCol)}, ${quoteIdentifier(targetFkCol)}) VALUES (?, ?)',\n` +
                    `            [${lowerFirst(entityName)}Id, ${targetParam}]\n` +
                    `        );\n` +
                    `        return { ${sourceFkCol === '__proto__' ? '["__proto__"]' : sourceFkCol}: ${lowerFirst(entityName)}Id, ${targetFkCol === '__proto__' ? '["__proto__"]' : targetFkCol}: ${targetParam} };\n` +
                    `    }\n\n` +
                    `    static async remove${upperFirst(rel.targetEntity)}(${lowerFirst(entityName)}Id, ${targetParam}) {\n` +
                    `        const [result] = await pool.query(\n` +
                    `            'DELETE FROM ${quoteIdentifier(junctionTable)} WHERE ${quoteIdentifier(sourceFkCol)} = ? AND ${quoteIdentifier(targetFkCol)} = ?',\n` +
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
                    `            'SELECT * FROM ${quoteIdentifier(rel.targetEntity)} WHERE ${quoteIdentifier(sourceFkCol)} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id]\n` +
                    `        );\n` +
                    `        return rows.map(row => normalizeRow(row, ${JSON.stringify(targetEntity.fields.filter(f => f.dataType === 'BOOLEAN').map(f => f.name))}));\n` +
                    `    }`
                );
            } else if (rel.relationType === 'MANY_TO_ONE') {
                const targetFkCol = `${lowerFirst(rel.targetEntity)}_${targetPk.name}`;
                relMethods.push(
                    `    // Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (MANY_TO_ONE)\n` +
                    `    static async get${upperFirst(rel.targetEntity)}(${lowerFirst(entityName)}Id) {\n` +
                    `        const [rows] = await pool.query(\n` +
                    `            'SELECT t.* FROM ${quoteIdentifier(rel.targetEntity)} t JOIN ${quoteIdentifier(entityName)} s ON t.${quoteIdentifier(targetPk.name)} = s.${quoteIdentifier(targetFkCol)} WHERE s.${quoteIdentifier(sourcePk.name)} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id]\n` +
                    `        );\n` +
                    `        return rows.length > 0 ? normalizeRow(rows[0], ${JSON.stringify(targetEntity.fields.filter(f => f.dataType === 'BOOLEAN').map(f => f.name))}) : null;\n` +
                    `    }`
                );
            } else if (rel.relationType === 'ONE_TO_ONE') {
                const sourceFkCol = `${lowerFirst(entityName)}_${sourcePk.name}`;
                relMethods.push(
                    `    // Relationship: ${entityName} ${rel.relationName} ${rel.targetEntity} (ONE_TO_ONE)\n` +
                    `    static async get${upperFirst(rel.targetEntity)}(${lowerFirst(entityName)}Id) {\n` +
                    `        const [rows] = await pool.query(\n` +
                    `            'SELECT * FROM ${quoteIdentifier(rel.targetEntity)} WHERE ${quoteIdentifier(sourceFkCol)} = ?',\n` +
                    `            [${lowerFirst(entityName)}Id]\n` +
                    `        );\n` +
                    `        return rows.length > 0 ? normalizeRow(rows[0], ${JSON.stringify(targetEntity.fields.filter(f => f.dataType === 'BOOLEAN').map(f => f.name))}) : null;\n` +
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
           `const QUERY_FIELDS = ${queryFieldsJson};\n\n` +
           generatePrimaryKeyPolicy({ name: entityName, fields }, true) +
           generateReadNormalization() +
           `class ${entityName}Model {\n` +
           `    static get tableName() {\n` +
           `        return '${entityName}';\n` +
           `    }\n\n` +
           `    static get fields() {\n` +
           `        return ${fieldsJson};\n` +
           `    }\n\n` +
           generateCollectionMethods({ name: entityName, fields }) +
           `    static async findById(id) {\n` +
           `        const [rows] = await pool.query('SELECT * FROM ${quoteIdentifier(entityName)} WHERE ${quoteIdentifier(pkField.name)} = ?', [id]);\n` +
           `        return rows.length > 0 ? normalizeRow(rows[0], ${JSON.stringify(fields.filter(f => f.dataType === 'BOOLEAN').map(f => f.name))}) : null;\n` +
           `    }\n\n` +
           `    static async create(data) {\n` +
           `        const [result] = Object.keys(data).length === 0\n` +
           `            ? await pool.query('INSERT INTO ${quoteIdentifier(entityName)} () VALUES ()')\n` +
           `            : await pool.query('INSERT INTO ${quoteIdentifier(entityName)} SET ?', [data]);\n` +
           `        const identity = resolveCreateIdentity(data, result);\n` +
           `        const response = { ...data };\n` +
           `        if (identity.resolved) {\n` +
           `            Object.defineProperty(response, PRIMARY_KEY.name, { value: identity.value, enumerable: true, writable: true, configurable: true });\n` +
           `        }\n` +
           `        return normalizeRow(response, ${JSON.stringify(fields.filter(f => f.dataType === 'BOOLEAN').map(f => f.name))});\n` +
           `    }\n\n` +
           `    static async update(id, data) {\n` +
           `        const keyError = primaryKeyUpdateError(data);\n` +
           `        if (keyError) throw new Error(keyError);\n` +
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
                    `        res.status(500).json({ success: false, error: 'Unable to complete request.' });\n` +
                    `    }\n` +
                    `}\n\n` +
                    `async function ${addRelFn}(req, res) {\n` +
                    `    try {\n` +
                    `        const result = await ${modelVar}.${addRelFn}(req.params.id, req.params.${targetParam});\n` +
                    `        res.status(201).json({ success: true, data: result });\n` +
                    `    } catch (error) {\n` +
                    `        res.status(500).json({ success: false, error: 'Unable to complete request.' });\n` +
                    `    }\n` +
                    `}\n\n` +
                    `async function ${removeRelFn}(req, res) {\n` +
                    `    try {\n` +
                    `        const success = await ${modelVar}.${removeRelFn}(req.params.id, req.params.${targetParam});\n` +
                    `        res.status(200).json({ success: true, message: 'Association removed successfully' });\n` +
                    `    } catch (error) {\n` +
                    `        res.status(500).json({ success: false, error: 'Unable to complete request.' });\n` +
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
                    `        res.status(500).json({ success: false, error: 'Unable to complete request.' });\n` +
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
                    `        res.status(500).json({ success: false, error: 'Unable to complete request.' });\n` +
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
           generateWriteValidation({ name: entityName, fields }) +
           `async function create${entityName}(req, res) {\n` +
           `    try {\n` +
           `        const validationError = validate${entityName}(req.body, 'create');\n` +
           `        if (validationError) {\n` +
           `            return res.status(400).json({ success: false, error: validationError });\n` +
           `        }\n` +
           `        const data = select${entityName}WriteData(req.body);\n` +
           `        const result = await ${modelVar}.create(data);\n` +
           `        res.status(201).json({ success: true, data: result });\n` +
           `    } catch (error) {\n` +
           `        res.status(500).json({ success: false, error: 'Unable to create item.' });\n` +
           `    }\n` +
           `}\n\n` +
           `async function ${getPluralFn}(req, res) {\n` +
           `    try {\n` +
           `        const options = ${modelVar}.parseQuery(req.query || {});\n` +
           `        const items = await ${modelVar}.findAll(options);\n` +
           `        if (options.paginated) {\n` +
           `            const total = await ${modelVar}.countFiltered(options);\n` +
           `            res.set({ 'X-Total-Count': String(total), 'X-Page': String(options.page),\n` +
           `                'X-Limit': String(options.limit), 'X-Total-Pages': String(Math.ceil(total / options.limit)) });\n` +
           `        }\n` +
           `        res.status(200).json({ success: true, data: items });\n` +
           `    } catch (error) {\n` +
           `        const status = error.statusCode === 400 ? 400 : 500;\n` +
           `        res.status(status).json({ success: false, error: status === 400 ? error.message : 'Unable to retrieve collection.' });\n` +
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
           `        res.status(500).json({ success: false, error: 'Unable to complete request.' });\n` +
           `    }\n` +
           `}\n\n` +
           `async function update${entityName}(req, res) {\n` +
           `    try {\n` +
           `        const validationError = validate${entityName}(req.body);\n` +
           `        if (validationError) {\n` +
           `            return res.status(400).json({ success: false, error: validationError });\n` +
           `        }\n` +
           `        const data = select${entityName}WriteData(req.body);\n` +
           `        const updated = await ${modelVar}.update(req.params.id, data);\n` +
           `        if (!updated) {\n` +
           `            return res.status(404).json({ success: false, error: '${entityName} not found' });\n` +
           `        }\n` +
           `        res.status(200).json({ success: true, data: updated });\n` +
           `    } catch (error) {\n` +
           `        res.status(500).json({ success: false, error: 'Unable to update item.' });\n` +
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
           `        res.status(500).json({ success: false, error: 'Unable to complete request.' });\n` +
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
           `    if (err.type === 'entity.parse.failed') {\n` +
           `        return res.status(400).json({ success: false, error: 'Request body must contain valid JSON.' });\n` +
           `    }\n` +
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
    const schemas = Object.create(null);
    const entityMap = new Map(entities.map(entity => [entity.name, entity]));

    entities.forEach(entity => {
        const plural = pluralize(entity.name);
        const queryFields = collectionFields(entity);
        const queryParameters = [
            { name: 'page', in: 'query', required: false, description: 'Enables pagination; defaults to 1 when limit alone is supplied. Offset must be a safe integer.', schema: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 1 } },
            { name: 'limit', in: 'query', required: false, description: 'Enables pagination; defaults to 20 when page alone is supplied.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'sort', in: 'query', required: false, description: 'Known field name. Pagination uses primary-key ordering/tie-breaking.', schema: { type: 'string', enum: queryFields.map(field => field.name) } },
            { name: 'order', in: 'query', required: false, description: 'Requires sort; lowercase asc or desc only.', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
            ...queryFields.filter(field => !COLLECTION_RESERVED_PARAMS.includes(field.name)).map(field => ({
                name: field.name, in: 'query', required: false, description: 'Exact-match filter. One value only; no special null syntax.',
                ...(field.dataType === 'STRING' || (field.dataType === 'ENUM' && field.enumValues.includes('')) ? { allowEmptyValue: true } : {}),
                schema: { type: SWAGGER_TYPE_MAP[field.dataType] || 'string',
                    ...(field.dataType === 'INT' ? { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER } : {}),
                    ...(field.dataType === 'ENUM' ? { enum: [...field.enumValues] } : {}) }
            }))
        ];
        const paginationHeaders = Object.fromEntries([
            ['X-Total-Count', 'Total rows matching the same filters.', 0],
            ['X-Page', 'Requested page.', 1], ['X-Limit', 'Page size (maximum 100).', 1],
            ['X-Total-Pages', 'Ceiling of total matching rows divided by limit; zero for no matches.', 0]
        ].map(([name, description, minimum]) => [name, {
            description: `${description} Present only when page or limit is supplied.`, schema: { type: 'integer', minimum }
        }]));
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
            get: { summary: `Get all ${plural}`, description: 'Exact equality filters; unknown/repeated parameters and invalid values return 400. Preserves { success: true, data: [...] }; unpaginated unless page or limit is supplied.',
                parameters: queryParameters,
                responses: { "200": { description: "OK", headers: paginationHeaders }, "400": { description: "Invalid collection query options" } } },
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

        const properties = Object.create(null);
        const effectiveKey = getEffectiveKey(entity);
        if (effectiveKey.origin === 'implicit') {
            properties[effectiveKey.name] = { type: SWAGGER_TYPE_MAP[effectiveKey.dataType], readOnly: true };
        }
        entity.fields.forEach(f => {
            const prop = { type: SWAGGER_TYPE_MAP[f.dataType] || 'string' };
            if (f.dataType === 'ENUM') prop.enum = [...f.enumValues];

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

        const schemaObj = { type: "object", properties, additionalProperties: false };
        const requiredFields = entity.fields
            .filter(f => postRequiresField(f, effectiveKey))
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

    return JSON.stringify(require('./openapi-fidelity').enrich({
        openapi: "3.0.0",
        info: { title: "APIForge Generated REST API", version: "1.0.0" },
        paths,
        components: { schemas }
    }, entities, relations, { key: getEffectiveKey, lowerFirst, pluralize }), null, 2);
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
    const targetIssues = require('../utils/mysql-target').targetIssues(entities, relations);
    const numericIssues = entities.flatMap(e => e.fields.flatMap(require('../utils/mysql-target').numericIssues));
    const invalidEnum = entities.some(e => e.fields.some(f => f.dataType === 'ENUM' && f.enumValues.some(value => value.endsWith(' '))));
    if (targetIssues.length || numericIssues.length || invalidEnum) throw new Error('Cannot generate target code: MySQL target preflight failed. ' + [...targetIssues, ...numericIssues].map(i => i.message).join(' '));
    const conflicts = require('../utils/target-names').namingConflicts(entities, relations);
    if (conflicts.length) throw new Error('Cannot generate target code: ' + conflicts.map(c => `${c.namespace} '${c.name}' collision`).join(', '));
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
        { path: 'config/db.js', content: generateDBConfig(entities, relations) },
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
        writeGeneratedFiles(files);
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
