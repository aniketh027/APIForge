const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

// Pure and serializable: the emitter includes this pattern and function verbatim.
// The length check prevents JavaScript's $ anchor accepting a final newline.
function isUuid(value) {
    return typeof value === 'string' && value.length === 36 && new RegExp(UUID_PATTERN).test(value);
}

module.exports = { UUID_PATTERN, isUuid };
