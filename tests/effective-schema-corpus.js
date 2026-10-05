'use strict';

// Corpus inputs are read from the reviewed tree, not from potentially changed
// fixtures or helper modules. Programs retain their source bytes; only the
// documentation's fence/table notation is decoded to executable DSL.
const vm = require('vm');

const CARDS = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];
const UUID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_UUID = '00000000-0000-0000-0000-000000000000';

function sourceCases(pinned) {
    const programs = new Map();
    const inventory = { samples: 0, frozenFixtureSources: 0, guideValid: 0, guideInvalid: 0, g16Boundaries: 0, g16Seeded: 0 };
    function add(name, source, category, expected = null) {
        if (typeof source !== 'string' || !/^(?:\s|\/\/[^\r\n]*(?:\r?\n|$))*ENTITY\b/.test(source)) return;
        if (programs.has(source)) {
            const existing = programs.get(source);
            existing.labels.push(name);
            if (!existing.categories.includes(category)) existing.categories.push(category);
            if (expected !== null) existing.expected = expected;
            return;
        }
        programs.set(source, { name, source, categories: [category], labels: [name], expected });
    }
    for (const filename of pinned.paths.filter(name => /^samples\/.*\.apiforge$/.test(name))) {
        add(filename, pinned.readFile(filename), 'samples');
        inventory.samples++;
    }
    for (const filename of pinned.paths.filter(name => /^tests\/fixtures\/.*\.json$/.test(name))) {
        function visit(value, pointer = '') {
            if (!value || typeof value !== 'object') return;
            if (typeof value.source === 'string') {
                add(filename + pointer, value.source, 'frozen-fixtures');
                inventory.frozenFixtureSources++;
            }
            if (value.sources && typeof value.sources === 'object') {
                for (const [name, source] of Object.entries(value.sources)) {
                    add(filename + pointer + '/sources/' + name, source, 'frozen-fixtures');
                    inventory.frozenFixtureSources++;
                }
            }
            for (const [key, child] of Object.entries(value)) visit(child, pointer + '/' + key);
        }
        visit(JSON.parse(pinned.readFile(filename)));
    }
    const guide = pinned.readFile('docs/APIForge-Language-Guide.md').replace(/\r\n/g, '\n');
    const validGuide = [...guide.matchAll(/<!-- example: valid ([\w-]+)(?: warnings=([\w,]+))? -->\n~~~apiforge\n([\s\S]*?)\n~~~/g)];
    inventory.guideValid = validGuide.length;
    for (const match of validGuide) add('guide:' + match[1], match[3], 'guide-valid', true);
    for (const match of guide.matchAll(/^\| ([\w-]+) \| `([^`]*)` \| `([A-Z0-9, ]+)` \|$/gm)) {
        add('guide-invalid:' + match[1], match[2].replace(/ *↵ */g, '\n'), 'guide-invalid', false);
        inventory.guideInvalid++;
    }

    // Capture static whole-program literals from the existing hardening,
    // runtime, diagnostics and naming tests without executing those suites.
    // Interpolated programs are expanded explicitly in the matrices below.
    const strings = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g;
    for (const filename of pinned.paths.filter(name => /^tests\/[^/]+(?:\.test|test)\.js$/.test(name) || name === 'tests/test.js')) {
        let occurrence = 0;
        for (const match of pinned.readFile(filename).matchAll(strings)) {
            occurrence++;
            if (match[0].includes('${') || !match[0].includes('ENTITY')) continue;
            let value;
            try { value = vm.runInNewContext(match[0], Object.create(null), { timeout: 100 }); }
            catch { continue; } // A regex/comment fragment is not a JS string.
            add(filename + ':literal-' + occurrence, value, 'existing-test-sources');
        }
    }

    const g16 = pinned.load('tests/mysql-target-capacity-cases.js');
    for (const [name, source, accepted] of g16.cases) {
        add('g16:' + name, source, 'g16-boundaries', accepted);
        inventory.g16Boundaries++;
    }
    for (const { name, source } of g16.seededCases(96, 0x16a84)) {
        add('g16:' + name, source, 'g16-seeded');
        inventory.g16Seeded++;
    }

    const keyDeclarations = {
        implicit: 'label STRING', integer: 'key INT PRIMARY KEY',
        integerDefault: 'key INT PRIMARY KEY DEFAULT 7', string: 'key STRING PRIMARY KEY',
        uuid: 'key UUID PRIMARY KEY', uuidDefault: 'key UUID PRIMARY KEY DEFAULT "' + UUID + '"'
    };
    for (const [name, declaration] of Object.entries(keyDeclarations)) {
        add('identity:' + name, 'ENTITY Record\n' + declaration + '\nvalue STRING', 'identity', true);
    }
    add('all-eight-types-and-falsy-defaults', [
        'ENTITY Scalar', 'key INT PRIMARY KEY', 'count INT DEFAULT 0',
        'label STRING DEFAULT ""', 'ratio FLOAT DEFAULT 0', 'active BOOLEAN DEFAULT FALSE',
        'state ENUM("draft","active","") DEFAULT "draft"',
        'day DATE DEFAULT "2026-10-05"', 'stamp TIMESTAMP DEFAULT "2026-10-05T12:30:00Z"',
        'token UUID DEFAULT "' + UUID + '"', 'requiredCount INT REQUIRED DEFAULT 0',
        'title STRING REQUIRED MIN_LENGTH 0 MAX_LENGTH 512', 'amount FLOAT MIN 0 MAX 100'
    ].join('\n'), 'all-types', true);
    add('reserved-collection-controls', 'ENTITY Record\npage INT\nlimit INT\nsort STRING\norder STRING\nlabel STRING', 'collection', true);
    add('temporal-runtime-profile', [
        'ENTITY Event', 'id INT PRIMARY KEY', 'eventDate DATE REQUIRED', 'createdAt TIMESTAMP REQUIRED',
        'optionalDate DATE', 'optionalStamp TIMESTAMP', 'defaultDate DATE DEFAULT "2026-01-01"',
        'defaultStamp TIMESTAMP DEFAULT "2026-10-05T12:30:00Z"', 'label STRING', 'active BOOLEAN'
    ].join('\n'), 'temporal', true);
    add('uuid-runtime-profile', [
        'ENTITY User', 'uid UUID PRIMARY KEY', 'email STRING REQUIRED UNIQUE', 'token UUID UNIQUE',
        'requiredUuid UUID REQUIRED', 'fixed UUID DEFAULT "' + UUID + '"', 'label STRING', 'active BOOLEAN',
        'ENTITY Profile', 'id UUID PRIMARY KEY', 'token UUID', 'ENTITY Post', 'id INT PRIMARY KEY', 'token UUID',
        'ENTITY Company', 'id UUID PRIMARY KEY', 'token UUID', 'ENTITY Group', 'code UUID PRIMARY KEY', 'token UUID',
        'ENTITY Member', 'id INT PRIMARY KEY', 'RELATION User HAS_PROFILE Profile ONE_TO_ONE',
        'RELATION User HAS_POST Post ONE_TO_MANY', 'RELATION User WORKS_FOR Company MANY_TO_ONE',
        'RELATION User JOINS Group MANY_TO_MANY', 'RELATION Member EMPLOYED_BY Company MANY_TO_ONE'
    ].join('\n'), 'uuid', true);

    const pairs = [
        ['INT PRIMARY KEY', 'UUID PRIMARY KEY'], ['UUID PRIMARY KEY', 'STRING PRIMARY KEY MAX_LENGTH 300'],
        ['STRING PRIMARY KEY MAX_LENGTH 300', 'INT PRIMARY KEY'], ['UUID PRIMARY KEY', 'UUID PRIMARY KEY'],
        ['INT PRIMARY KEY DEFAULT 7', 'UUID PRIMARY KEY DEFAULT "' + OTHER_UUID + '"']
    ];
    for (const kind of CARDS) {
        for (const [index, [sourceKey, targetKey]] of pairs.entries()) {
            add('mixed-key:' + kind + ':' + index,
                'ENTITY Parent\nsourceKey ' + sourceKey + '\nlabel STRING\nENTITY Child\ntargetKey ' + targetKey +
                '\nactive BOOLEAN\nRELATION Parent owns Child ' + kind, 'mixed-relations', true);
        }
        add('g06:' + kind, 'ENTITY Parent\nid INT PRIMARY KEY\nemail STRING UNIQUE\ncount INT\nactive BOOLEAN\n' +
            'ENTITY Child\nid INT PRIMARY KEY\nname STRING\nRELATION Parent HAS Child ' + kind, 'g06', true);
    }
    for (const name of ['__proto__', 'constructor', 'toString', 'entities', 'relations']) {
        add('prototype:' + name, 'ENTITY ' + name + '\nkey STRING PRIMARY KEY\n__proto__ STRING\nconstructor INT\n' +
            'toString BOOLEAN\nENTITY Target\nid INT PRIMARY KEY\nRELATION ' + name + ' __proto__ Target ONE_TO_MANY',
        'prototype-names', true);
    }
    for (const name of ['__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']) {
        add('prototype-field:' + name, 'ENTITY Item id INT PRIMARY KEY ' + name + ' STRING', 'prototype-names', true);
    }
    for (const name of ['Lateral', 'Intersect', 'Array', 'Member']) {
        add('mysql-keyword:' + name, 'ENTITY ' + name + ' id INT PRIMARY KEY ENTITY Parent ' + name +
            ' STRING RELATION Parent items ' + name + ' MANY_TO_ONE', 'target-names', true);
    }
    for (const name of ['CON', 'nul', 'COM1', 'lpt9']) add('windows-device:' + name,
        'ENTITY ' + name + ' id INT PRIMARY KEY', 'naming-invalid', false);
    add('plural-lower-first', 'ENTITY FooBar id INT PRIMARY KEY ENTITY Category code STRING PRIMARY KEY ' +
        'ENTITY Box id INT PRIMARY KEY RELATION FooBar belongs Category MANY_TO_ONE RELATION FooBar has Box ONE_TO_MANY',
    'target-names', true);
    return { cases: [...programs.values()], validGuideCount: validGuide.length, inventory };
}

const field = (entity, name, type, constraints = [], defaultValue = null, validations = []) => ({
    op: 'ADD_FIELD', entity, field: name, dataType: type, constraints, defaultValue, validations
});
const program = instructions => ({ type: 'PROGRAM', instructions });

function directIRCases(pinned) {
    return [
        ...pinned.load('tests/mysql-target-capacity-cases.js').forgedCheckCases()
            .filter(([, , accepted]) => accepted).map(([name, ir]) => ({ name, ir })),
        { name: 'empty-program', ir: program([]) },
        { name: 'add-field-introduces-entity', ir: program([field('Orphan', 'label', 'STRING')]) },
        { name: 'repeated-create-collapse', ir: program([{ op: 'CREATE_ENTITY', entity: 'Repeated' },
            field('Repeated', 'label', 'STRING'), { op: 'CREATE_ENTITY', entity: 'Repeated' },
            field('Repeated', 'active', 'BOOLEAN')]) },
        { name: 'representable-float-identity', ir: program([{ op: 'CREATE_ENTITY', entity: 'Direct' },
            field('Direct', 'key', 'FLOAT', ['PRIMARY_KEY']), field('Direct', 'label', 'STRING')]) },
        { name: 'representable-string-numeric-checks', ir: program([{ op: 'CREATE_ENTITY', entity: 'Direct' },
            field('Direct', 'label', 'STRING', [], null, [{ type: 'MIN', value: 0 }, { type: 'MAX', value: 10 }])]) }
    ];
}

// These witnesses intentionally leave the exact-compatibility corpus: the
// approved planner may reject the baseline's three incoherent accepted forms.
// Unresolved endpoints were already rejected and preserve their precedence.
function structuralIRCases() {
    return [
        { name: 'duplicate-declared-fields', acceptedBefore: true, ir: program([
            { op: 'CREATE_ENTITY', entity: 'Direct' }, field('Direct', 'label', 'STRING'), field('Direct', 'label', 'INT')]) },
        { name: 'implicit-identity-collision', acceptedBefore: true, ir: program([
            { op: 'CREATE_ENTITY', entity: 'Direct' }, field('Direct', 'id', 'STRING')]) },
        { name: 'competing-primary-keys', acceptedBefore: true, ir: program([
            { op: 'CREATE_ENTITY', entity: 'Direct' }, field('Direct', 'first', 'INT', ['PRIMARY_KEY']),
            field('Direct', 'second', 'UUID', ['PRIMARY_KEY'])]) },
        { name: 'unresolved-endpoint', acceptedBefore: false, ir: program([
            { op: 'CREATE_ENTITY', entity: 'Direct' }, field('Direct', 'label', 'STRING'),
            { op: 'CREATE_RELATION', sourceEntity: 'Direct', targetEntity: 'Missing', relationName: 'owns', relationType: 'ONE_TO_MANY' }]) }
    ];
}

module.exports = { CARDS, sourceCases, directIRCases, structuralIRCases };
