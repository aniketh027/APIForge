(function (root) {
    // Columns count UTF-16 code units, as in the lexer. End positions are exclusive.
    function sourceFrame(source, location) {
        if (typeof source !== 'string' || !Number.isInteger(location.line) || location.line < 1) return [];
        const lines = source.replace(/^\uFEFF/, '').split('\n').map(line => line.replace(/\r$/, ''));
        if (location.line > lines.length) return [];
        const hasColumn = Number.isInteger(location.column) && location.column > 0;
        const hasRange = hasColumn && Number.isInteger(location.endLine) && Number.isInteger(location.endColumn) &&
            location.endLine <= lines.length && location.endColumn > 0 &&
            (location.endLine > location.line || (location.endLine === location.line && location.endColumn > location.column));
        const end = hasRange && location.endLine > location.line && location.endColumn === 1
            ? location.endLine - 1 : hasRange ? location.endLine : location.line;
        const frames = [];
        for (let line = location.line; line <= end; line++) {
            const text = lines[line - 1];
            const start = line === location.line ? Math.min(location.column - 1, text.length) : 0;
            const finish = hasRange ? (line === location.endLine ? Math.min(location.endColumn - 1, text.length) : text.length) : start + 1;
            // Preserve tabs in the prefix so caret alignment matches the source.
            const pointer = hasColumn ? text.slice(0, start).replace(/[^\t]/g, ' ') + '^'.repeat(Math.max(1, finish - start)) : '';
            frames.push({ line, text, pointer });
        }
        return frames;
    }
    function formatDiagnostic(source, diagnostic) {
        const output = [`${diagnostic.code}: ${diagnostic.message}`];
        if (diagnostic.line) output.push(`  --> line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ''}`);
        for (const frame of sourceFrame(source, diagnostic)) {
            output.push(`${frame.line} | ${frame.text}`);
            if (frame.pointer) output.push(`${' '.repeat(String(frame.line).length)} | ${frame.pointer}`);
        }
        if (diagnostic.hint) output.push(`Hint: ${diagnostic.hint}`);
        return output.join('\n');
    }
    const api = { sourceFrame, formatDiagnostic };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.APIForgeSourceFrame = api;
})(typeof globalThis === 'object' ? globalThis : this);
