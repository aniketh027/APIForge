'use strict';
function numericIssues(field) {
    const issues = [];
    for (const value of [...(field.validations || []), ...(field.defaultValues || (field.defaultValue ? [field.defaultValue] : []))]) {
        if (typeof value.value !== 'number') continue;
        const integerRole = field.dataType === 'INT' || ['MIN_LENGTH', 'MAX_LENGTH'].includes(value.type);
        const raw = value.rawNumber;
        const lostFraction = integerRole && raw && raw.includes('.') && /[1-9]/.test(raw.split('.')[1]) && Number.isInteger(value.value);
        if (!Number.isFinite(value.value) || (integerRole && Number.isInteger(value.value) && !Number.isSafeInteger(value.value)) || lostFraction) {
            issues.push({ value, message: `Numeric literal ${raw || String(value.value)} for field '${field.name}' must be finite${integerRole ? ' and an exactly representable safe integer' : ''}.` });
        }
    }
    return issues;
}
module.exports = { numericIssues };
