'use strict';
const effectivePolicy = require('../planning/effective-policy');
const { COLLECTION_RESERVED_PARAMS } = effectivePolicy;
const isTemporalField = field => field.dataType === 'DATE' || field.dataType === 'TIMESTAMP';
const isUuidField = field => field.dataType === 'UUID';
function generateCollectionParser(entity) {
    const fields = effectivePolicy.fieldViews(entity);
    return `    // Parse HTTP strings once, before any database access.
    static parseQuery(query = {}) {
        const fail = message => {
            const error = Object.assign(new Error(message), { statusCode: 400 });
            queryValidationErrors.set(error, message);
            throw error;
        };
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
${fields.some(isUuidField) ? `            } else if (field.dataType === 'UUID' && !isUuid(raw)) {
                fail("Invalid value for UUID filter '" + field.name + "'.");
` : ''}${fields.some(isTemporalField) ? `            } else if ((field.dataType === 'DATE' && !isDate(raw)) || (field.dataType === 'TIMESTAMP' && !isTimestamp(raw))) {
                fail("Invalid value for temporal filter '" + field.name + "'.");
` : ''}            }
            filters[field.name] = value;
        }
        return { filters, sort, order, paginated, page, limit, offset };
    }

`;
}
module.exports = { generateCollectionParser };
