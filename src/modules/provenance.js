'use strict';

// Pure invocation-local ownership. Never serialize a module reference into DSL data.
const OWNER = Symbol('APIForge source owner');
const RELATED = Symbol('APIForge related locations');
function owner(value) { return value?.[OWNER]; }
function setOwner(value, sourceModule) {
    if (value && typeof value === 'object' && sourceModule) {
        Object.defineProperty(value, OWNER, { value: sourceModule, configurable: true });
    }
    return value;
}
function inheritOwner(value, original) { return setOwner(value, owner(original)); }
function bindTree(value, sourceModule) {
    const pending = [value], seen = new Set();
    while (pending.length) {
        const current = pending.pop();
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current); setOwner(current, sourceModule);
        pending.push(...Object.values(current), current.sourceLocations, current.numberLocation);
    }
    return value;
}
function setRelated(diagnostic, locations) {
    if (locations.length) Object.defineProperty(diagnostic, RELATED, { value: locations });
    return diagnostic;
}
function related(diagnostic) { return diagnostic?.[RELATED] || []; }
module.exports = { owner, setOwner, inheritOwner, bindTree, setRelated, related };
