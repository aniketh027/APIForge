'use strict';
const ddl=require('./ddl'),names=require('./names'),policy=require('../../planning/effective-policy');
const temporal=require('../../utils/temporal'),uuid=require('../../utils/uuid');
const {generateCollectionParser}=require('../../codegen/runtime-policy');
const pkg=require('../../../package.json');
const q=names.quoteIdentifier,table=names.table;
const j=JSON.stringify;
function temporalSource(){return [temporal.isCalendarDate,temporal.isDate,temporal.isTimestamp].map(f=>f.toString()).join('\n\n')+'\n';}
function uuidSource(){return 'const UUID_PATTERN = '+j(uuid.UUID_PATTERN)+';\n'+uuid.isUuid.toString()+'\n';}
// Deterministic numeric-offset conversion: no host parsing or host timezone.
function parseTimestamp(value,withoutZone=false) {
    const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)?$/.exec(value);
    if(!match||(!withoutZone&&!match[7])||(withoutZone&&match[7]))throw new Error('Invalid PostgreSQL timestamp representation.');
    const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number);
    const oh=Number(match[8]||0),om=Number(match[9]||0),os=Number(match[10]||0);
    if(!isCalendarDate(year,month,day)||hour>23||minute>59||second>59||oh>23||om>59||os>59)throw new Error('Invalid PostgreSQL timestamp representation.');
    const offset=(oh*3600+om*60+os)*(match[7]==='-'?-1:1);
    const result=new Date(Date.UTC(year,month-1,day,hour,minute,second)-offset*1000).toISOString().replace('.000Z','Z');
    if(!isTimestamp(result))throw new Error('PostgreSQL timestamp outside APIForge logical range.');
    return result;
}
function generateDBConfig(entities,relations,context){return `// APIForge postgresql-18-v1. Every query awaits a certified session lease.
const pg = require('pg');
require('dotenv').config();
const expectedTables = ${j(context.physical.tables.map(t=>t.name))};
${temporalSource()}
${parseTimestamp.toString()}
const types = {getTypeParser(oid,format) {
    if(!format || format==='text') {
        if(oid===1082)return value=>{if(!isDate(value))throw new Error('Invalid PostgreSQL DATE representation.');return value;};
        if(oid===1184)return value=>parseTimestamp(value);
        if(oid===1114)return value=>parseTimestamp(value,true);
    }
    return pg.types.getTypeParser(oid,format);
}};
const pool = new pg.Pool({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||5432),
    user:process.env.DB_USER||'postgres',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'apiforge_db',types});
pool.on('error',()=>console.error('Database idle connection failure.'));
async function query(text,values=[]) {
    const client=await pool.connect();let failed;
    try {
        await client.query("SET TIME ZONE 'UTC'; SET DateStyle = 'ISO, YMD'; SET standard_conforming_strings = on; SET search_path = pg_catalog, public; SET application_name = 'apiforge-postgresql-18-v1';");
        const profile=await client.query("SELECT current_setting('server_version_num')::integer BETWEEN 180000 AND 189999 AND current_setting('server_encoding')='UTF8' AND current_setting('block_size')='8192' AND has_schema_privilege('public','USAGE') AND has_schema_privilege('public','CREATE') AND NOT EXISTS (SELECT 1 FROM unnest($1::text[]) AS expected(table_name) LEFT JOIN pg_namespace n ON n.nspname='public' LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname::text COLLATE \\\"C\\\"=expected.table_name COLLATE \\\"C\\\" AND c.relkind='r' WHERE c.oid IS NULL OR NOT (has_table_privilege(c.oid,'SELECT') AND has_table_privilege(c.oid,'INSERT') AND has_table_privilege(c.oid,'UPDATE') AND has_table_privilege(c.oid,'DELETE'))) AS certified",[expectedTables]);
        if(!profile.rows[0]?.certified)throw new Error('Unsupported PostgreSQL deployment profile.');
        const result=await client.query({text,values,rowMode:'array',types});
        return {rowCount:result.rowCount,rows:result.rows.map(row=>Object.fromEntries(result.fields.map((field,i)=>[field.name,row[i]])))};
    } catch(error){failed=error;throw error;}finally{client.release(failed);}
}
module.exports={query,end:()=>pool.end()};
`;}
function statement() {
    const values=[];
    return {values,bind(value){values.push(value);return '$'+values.length;}};
}
function normalizeRow(row,fields) {
    if(!row)return row;
    for(const field of fields) {
        if(!Object.prototype.hasOwnProperty.call(row,field.name)||row[field.name]===null)continue;
        const value=row[field.name];
        if(field.dataType==='DATE'&&!isDate(value)||field.dataType==='TIMESTAMP'&&!isTimestamp(value)||field.dataType==='UUID'&&!isUuid(value)||field.dataType==='FLOAT'&&(typeof value!=='number'||!Number.isFinite(value))||field.dataType==='BOOLEAN'&&typeof value!=='boolean'||field.dataType==='ENUM'&&(!field.enumValues.includes(value)))throw new Error('Invalid database value representation.');
    }
    return row;
}
function databaseWriteData(data,operation) {
    if(data===null||typeof data!=='object'||Array.isArray(data))throw new Error('Request body must be a JSON object.');
    const result=Object.fromEntries(Object.entries(data));
    for(const field of WRITE_CHECKS) {
        if(!Object.prototype.hasOwnProperty.call(result,field.name)) {
            if(operation==='create'&&field.dataType==='UUID'&&field.requiredOnCreate)throw new Error("Field '"+field.name+"' is required.");
            continue;
        }
        const value=result[field.name];if(value===null&&!field.required)continue;
        if(field.dataType==='UUID'?!isUuid(value):field.dataType==='DATE'?!isDate(value):!isTimestamp(value))throw new Error('Invalid declared UUID/temporal write value.');
    }
    if(operation==='create') {
        if(PRIMARY_KEY.generation==='database_integer'&&result[PRIMARY_KEY.name]===null)delete result[PRIMARY_KEY.name];
        if(PRIMARY_KEY.generation==='runtime_uuid'&&(!Object.prototype.hasOwnProperty.call(result,PRIMARY_KEY.name)||result[PRIMARY_KEY.name]===null))Object.defineProperty(result,PRIMARY_KEY.name,{value:crypto.randomUUID(),enumerable:true,writable:true,configurable:true});
    }
    return result;
}
function generateModel(entityName,fields,relations,entities,context) {
    const entity=context.byName.get(entityName),key=policy.identity(entity),keyField=key.field;
    const readFields=e=>e.fields.map(f=>({name:f.name,dataType:f.dataType,...(f.dataType==='ENUM'?{enumValues:f.enumValues}:{})}));
    const queryFields=policy.fieldViews(entity,'query').map(f=>({name:f.name,column:q(f.name),dataType:f.dataType,...(f.dataType==='ENUM'?{enumValues:f.enumValues}:{})}));
    const writeChecks=policy.fieldViews(entity).filter(f=>['DATE','TIMESTAMP','UUID'].includes(f.dataType)).map(f=>({name:f.name,dataType:f.dataType,required:f.constraints.includes('REQUIRED'),requiredOnCreate:f.roles.http.create.required}));
    const related=[];
    for(const relation of context.plan.relations.filter(r=>r.sourceEntityId===entity.id)) {
        const target=context.byId.get(relation.targetEntityId),targetKey=policy.identity(target),r=relation.storage;
        const targetFields=j(readFields(target));let query;
        if(r.kind==='junction') {
            const [a,b]=r.table.columns;
            query='SELECT t.* FROM '+table(target.names.table)+' t JOIN '+table(r.table.name)+' j ON t.'+q(targetKey.name)+' = j.'+q(b.name)+' WHERE j.'+q(a.name)+' = ';
            related.push(`static async ${relation.names.add}(sourceId,targetId) {const s=statement();await db.query(${j('INSERT INTO '+table(r.table.name)+' ('+q(a.name)+', '+q(b.name)+') VALUES (')}+s.bind(sourceId)+', '+s.bind(targetId)+')',s.values);return Object.fromEntries([[${j(a.name)},sourceId],[${j(b.name)},targetId]]);}
static async ${relation.names.remove}(sourceId,targetId) {const s=statement();const result=await db.query(${j('DELETE FROM '+table(r.table.name)+' WHERE '+q(a.name)+' = ')}+s.bind(sourceId)+${j(' AND '+q(b.name)+' = ')}+s.bind(targetId),s.values);return result.rowCount>0;}`);
        } else if(relation.cardinality==='MANY_TO_ONE') {
            const f=entity.fields.find(f=>f.id===r.fieldId);
            query='SELECT t.* FROM '+table(target.names.table)+' t JOIN '+table(entity.names.table)+' s ON t.'+q(targetKey.name)+' = s.'+q(f.name)+' WHERE s.'+q(key.name)+' = ';
        } else {
            const f=target.fields.find(f=>f.id===r.fieldId);
            query='SELECT * FROM '+table(target.names.table)+' WHERE '+q(f.name)+' = ';
        }
        related.push(`static async ${relation.names.getter}(sourceId) {const s=statement();const {rows}=await db.query(${j(query)}+s.bind(sourceId),s.values);return ${relation.http.many?'rows.map(row=>normalizeRow(row,'+targetFields+'))':'rows.length?normalizeRow(rows[0],'+targetFields+'):null'};}`);
    }
    const source=`// ${entityName} PostgreSQL model, generated by APIForge.
const db=require('../config/db');
const crypto=require('crypto');
const QUERY_FIELDS=${j(queryFields,null,4)};
const READ_FIELDS=${j(readFields(entity))};
const WRITE_CHECKS=${j(writeChecks)};
const PRIMARY_KEY=${j({name:key.name,origin:key.origin,generation:key.generation,defaultValue:keyField.defaultValue})};
const queryValidationErrors=new WeakMap();
${temporalSource()}
${uuidSource()}
${names.validUnicode.toString()}
${names.identifierIssue.toString()}
const SYSTEM_COLUMNS=${j(names.SYSTEM_COLUMNS)};
${names.quoteIdentifier.toString()}
${statement.toString()}
${normalizeRow.toString()}
${databaseWriteData.toString()}
class ${entity.names.modelClass} {
    static queryValidationMessage(error){return queryValidationErrors.get(error);}
    static get tableName(){return ${j(entity.names.table)};}
    static get fields(){return ${j(fields,null,4)};}
${generateCollectionParser(entity)}
    static filterQuery(options,s) {
        const clauses=[];
        for(const field of QUERY_FIELDS)if(Object.prototype.hasOwnProperty.call(options.filters||{},field.name)) {
            const value=options.filters[field.name];
            if(field.dataType==='UUID'&&!isUuid(value)||field.dataType==='DATE'&&!isDate(value)||field.dataType==='TIMESTAMP'&&!isTimestamp(value))throw new Error('Invalid declared filter value.');
            clauses.push(field.column+' = '+s.bind(value));
        }
        return clauses.length?' WHERE '+clauses.join(' AND '):'';
    }
    static async findAll(options={}) {
        const s=statement();let sql=${j('SELECT * FROM '+table(entity.names.table))}+this.filterQuery(options,s);
        const sort=QUERY_FIELDS.find(field=>field.name===(options.sort||(options.paginated?PRIMARY_KEY.name:undefined)));
        if(sort) {
            const direction=options.order==='desc'?' DESC NULLS LAST':' ASC NULLS FIRST';
            let expression=sort.column;
            if(sort.dataType==='ENUM')expression='CASE '+sort.column+' '+sort.enumValues.map((value,i)=>'WHEN '+s.bind(value)+' THEN '+i).join(' ')+' END';
            sql+=' ORDER BY '+expression+direction;
            if(options.paginated&&sort.name!==PRIMARY_KEY.name)sql+=', '+QUERY_FIELDS.find(f=>f.name===PRIMARY_KEY.name).column+' ASC NULLS FIRST';
        }
        if(options.paginated)sql+=' LIMIT '+s.bind(options.limit)+' OFFSET '+s.bind(options.offset);
        const {rows}=await db.query(sql,s.values);return rows.map(row=>normalizeRow(row,READ_FIELDS));
    }
    static async countFiltered(options) {
        const s=statement();const {rows}=await db.query(${j('SELECT COUNT(*) AS "total" FROM '+table(entity.names.table))}+this.filterQuery(options,s),s.values);
        const raw=rows[0]?.total;
        if(typeof raw!=='string'||!/^\\d+$/.test(raw)||BigInt(raw)>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Invalid collection count.');
        return Number(raw);
    }
    static async findById(id) {
        const s=statement();const {rows}=await db.query(${j('SELECT * FROM '+table(entity.names.table)+' WHERE '+q(key.name)+' = ')}+s.bind(id),s.values);
        return rows.length?normalizeRow(rows[0],READ_FIELDS):null;
    }
    static async create(data) {
        const payload=databaseWriteData(data,'create');const columns=Object.keys(payload);const s=statement();
        const prefix=${j('INSERT INTO '+table(entity.names.table))};
        const sql=columns.length?prefix+' ('+columns.map(quoteIdentifier).join(', ')+') VALUES ('+columns.map(column=>s.bind(payload[column])).join(', ')+')':prefix+' DEFAULT VALUES';
        const {rows}=await db.query(sql+${j(' RETURNING '+q(key.name))},s.values);
        const response=Object.fromEntries(Object.entries(data));
        let resolved=false,value;
        if(PRIMARY_KEY.generation==='database_integer'){resolved=true;value=rows[0][PRIMARY_KEY.name];}
        else if(Object.prototype.hasOwnProperty.call(payload,PRIMARY_KEY.name)){resolved=true;value=payload[PRIMARY_KEY.name];}
        else if(PRIMARY_KEY.defaultValue!==null){resolved=true;value=rows[0][PRIMARY_KEY.name];}
        if(resolved)Object.defineProperty(response,PRIMARY_KEY.name,{value,enumerable:true,writable:true,configurable:true});
        return normalizeRow(response,${j(readFields(entity).filter(f=>policy.fieldViews(entity).some(d=>d.name===f.name)))});
    }
    static async update(id,data) {
        if(data&&Object.prototype.hasOwnProperty.call(data,PRIMARY_KEY.name))throw new Error("Field '"+PRIMARY_KEY.name+"' is immutable.");
        if(!data||Object.keys(data).length===0)return this.findById(id);
        const payload=databaseWriteData(data,'update'),s=statement();
        const assignments=Object.keys(payload).map(column=>quoteIdentifier(column)+' = '+s.bind(payload[column]));
        await db.query(${j('UPDATE '+table(entity.names.table)+' SET ')}+assignments.join(', ')+${j(' WHERE '+q(key.name)+' = ')}+s.bind(id),s.values);
        return this.findById(id);
    }
    static async delete(id) {const s=statement();const result=await db.query(${j('DELETE FROM '+table(entity.names.table)+' WHERE '+q(key.name)+' = ')}+s.bind(id),s.values);return result.rowCount>0;}
    ${related.join('\n    ')}
}
module.exports=${entity.names.modelClass};
`;
    return source;
}
function generatePackageJson(){return j({name:'apiforge-generated-backend',version:'1.0.0',private:true,description:'Generated by APIForge for postgresql-18-v1',main:'server.js',scripts:{start:'node server.js'},engines:{node:'>=18'},dependencies:Object.fromEntries(['dotenv','express','pg'].map(name=>[name,pkg.dependencies[name]]))},null,2)+'\n';}
function generateEnvExample(){return 'PORT=3000\nDB_HOST=localhost\nDB_PORT=5432\nDB_USER=postgres\nDB_PASSWORD=\nDB_NAME=apiforge_db\n';}
function generateReadme(entities,context){return `# APIForge PostgreSQL backend

Target: postgresql-18-v1 (PostgreSQL 18, UTF8, stock 8192-byte block size, public schema, Node >=18).

Run npm install. Copy .env.example to .env and set PORT, DB_HOST, DB_PORT (5432), DB_USER (postgres), DB_PASSWORD and DB_NAME (apiforge_db).
Create a UTF8 database and grant the application user CONNECT, public schema USAGE/CREATE and SELECT/INSERT/UPDATE/DELETE on every generated entity and junction table. Certification requires those exact tables to exist with those privileges; unrelated public tables need no grants. No sequence grants are required for generated identity INSERTs.
Import database/schema.sql with psql (for example: psql -h localhost -p 5432 -U postgres -d apiforge_db -v ON_ERROR_STOP=1 -f database/schema.sql), then npm start.
GET /health checks server availability. OpenAPI is in swagger.json.

Routes:
${entities.map(e=>'- '+context.byName.get(e.name).names.resourcePath).join('\n')}

Generated integer identities use GENERATED BY DEFAULT AS IDENTITY: omission or optional null generates; zero is stored as zero; supplied positive keys are stored. REQUIRED null fails HTTP validation. Negative generated keys fail HTTP validation. Direct generated-identity null requests generation. Identity updates are forbidden.
**Supplied keys do not advance the identity sequence. A later generated key can collide and return 409. There is no sequence reconciliation or retry.** Declared identity bounds also constrain future sequence values; sequence start/range is unchanged.
STRING and CHECK-based ENUM use C collation, with exact case/Unicode/trailing-space comparison. ENUM collection sorting uses declaration order; ASC NULLS FIRST and DESC NULLS LAST preserve collection behavior. MySQL STRING collation differs.
STRING uses VARCHAR(n). PostgreSQL rejects over-length non-space data (22001 / sanitized HTTP 400), but discards excess characters when they are all spaces. For default VARCHAR(255), 255 non-space characters plus one or more spaces stores only the 255 characters. Create echoes the submitted string, so its echo can differ from the stored value returned on a later read. HTTP applies declared MIN_LENGTH/MAX_LENGTH first: MAX_LENGTH 255 rejects a 256-character string even when its excess is spaces. Without a declared bound, HTTP permits the native truncation. Trusted direct models do not enforce scalar length bounds and retain this database assignment behavior.
UUID values require canonical lowercase text. Runtime UUID identities use crypto.randomUUID(); ordinary UUID fields and static defaults do not generate. No extensions are required.
DATE accepts 1000-01-01 through 9999-12-31. TIMESTAMPTZ(0) preserves canonical UTC seconds from 1970-01-01T00:00:01Z through 2038-01-19T03:14:07Z. Each query awaits UTC, ISO/YMD and standard string settings. Returned temporal values never depend on the host timezone.
HTTP writes accept declared fields only; direct models trust arbitrary own keys, safely quote identifiers, validate declared UUID/temporal fields, and reject identity updates. Create responses echo submitted fields plus the resolved key; arbitrary database defaults appear on subsequent reads.
G27 has no PostgreSQL migrations, alternate schemas, JSONB/arrays, native ENUMs, database UUID generation, custom TLS setup, automatic sequence reconciliation or retries. B-tree admission is conservative; data-dependent storage failures remain database-authoritative. G26 migrations remain MySQL-only. The compiler browser defaults to MySQL.
`;}
function renderers(legacy,context) {
    context.generateDatabaseErrorHandler=require('./errors').generateDatabaseErrorHandler;
    context.generatedIntegerMinimum=minimum=>Math.max(0,minimum);
    return {generateSQL:()=>ddl.renderSchema(context.physical),generateDBConfig,generateEnvExample,generatePackageJson,generateReadme,generateModel};
}
module.exports={parseTimestamp,generateDBConfig,generateModel,generatePackageJson,generateEnvExample,generateReadme,renderers};
