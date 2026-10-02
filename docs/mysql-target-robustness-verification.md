# MySQL target robustness verification

Milestone 4, 2026-10-02 (Asia/Calcutta), starts at
`16cbac71a83ec2ff9603e2ef95f5547dda41f37a`, pushed with ahead/behind 0/0;
protected integrity PASS. Main/base remains a016868 unchanged.

## Supported assumptions and official evidence

Target MySQL >=8.0.16 (enforced CHECK baseline), utf8mb4, InnoDB DYNAMIC row
format, 16 KiB pages, strict SQL mode with NO_BACKSLASH_ESCAPES disabled for
schema import and runtime connections. The caller configures database/server
defaults; DDL does not silently change existing engine/collation settings.
Ordinary STRING equality follows configured collation; ENUM explicitly uses
utf8mb4_bin. The existing live harness creates utf8mb4/utf8mb4_unicode_ci DBs;
mysql2's default connection charset is UTF8MB4_UNICODE_CI. No running DB settings
are claimed verified during this run.

Verified official rules: [identifiers](https://dev.mysql.com/doc/refman/8.0/en/identifier-length.html)
are limited to 64 characters, including derived automatic constraint names;
[InnoDB full-column keys](https://dev.mysql.com/doc/refman/8.0/en/innodb-limits.html)
have a 3072-byte limit under DYNAMIC/16 KiB; [row/VARCHAR storage](https://dev.mysql.com/doc/refman/8.0/en/column-count-limit.html)
has a 65,535-byte logical row limit including length bytes;
[backslash literals](https://dev.mysql.com/doc/refman/8.0/en/string-literals.html)
depend on NO_BACKSLASH_ESCAPES; [native ENUM](https://dev.mysql.com/doc/refman/8.0/en/enum.html)
removes trailing declaration spaces. These links support target assumptions,
not a live integration claim.

## Implemented subset

| Gap | Result |
|---|---|
| G15 | FIXED: STRING and ENUM share apostrophe/backslash escaping; Unicode/empty values retained under supported SQL mode |
| G16 | PARTIALLY FIXED: source/composed table/column/FK/junction/constraint limits; single VARCHAR capacity; individual indexed STRING and junction composite key capacities; over-capacity STRING defaults |
| G17 | FIXED for authorized literal precision/finite scope: finite FLOAT; finite safe INT/length operands; raw fractional digits cannot silently round to accepted integers |
| G18 | FIXED: trailing ASCII-space members fail SEM036; leading/empty values remain legal, defaults are not trimmed |
| G21 | FIXED: repository README and generated README/package specify Node >=18, matching declared Express dependency; no lockfile or dependency added |
| G19 | INTENTIONALLY DEFERRED: ordinary filesystem failure can still leave mixed old/new managed output; robust cross-platform replacement/rollback is a separate transaction design |

SEM035 / UNSAFE_NUMERIC_LITERAL, SEM036 / ENUM_TRAILING_SPACE and SEM037 /
MYSQL_TARGET_LIMIT are appended after SEM034, giving 66 public errors. The old
62 mappings and all five warnings remain unchanged. Numeric token text/location
is stored non-enumerably on parsed values; valid serialized AST/symbol/IR/optimized
IR bytes remain source-faithful. No numeric grammar, type or default syntax added.

Preflight checks source names plus composed FK/junction/explicit constraints and
automatic table_chk_n / junction_ibfk_n names. STRING width remains
max(255, declared length bounds). Deterministic single-column capacity is
floor((65535-2)/4)=16383 under utf8mb4; individual indexed capacity accounts for
four bytes per character and 3072-byte full-key limit. Junction composite primary
keys sum both key widths. No truncation, collation rewrite, arbitrary INT32 check
or row-layout simulator is added. Production semantic errors precede IR; direct
IR generation repeats target preflight before any output write.

Remaining DB-authoritative limits include complete row/page layout, column/index
counts, scalar INT/FLOAT storage ranges, server configuration and direct DB writes.
Passing preflight does not guarantee that every schema fits every server.

## Corrective tests and compatibility

tests/mysql-target.test.js loads a016868 semantic/codegen baselines. Old STRING
backslash defaults fail a literal-preservation assertion under a separate decoder
of the supported MySQL escapes. Current literals round-trip apostrophes,
backslashes, ordinary Unicode and empty strings for STRING/ENUM.

Old source analysis accepts unsafe INTs, FLOAT Infinity and rounded nonzero
fractions; corrective rejection passes now at exact token ranges. Non-enumerable
raw metadata is absent from serialized AST and IR. Old trailing ENUM values,
65-character source names, oversized VARCHAR/indexes and composed names/keys are
accepted; current semantic and direct-IR preflight reject. Boundary names at 64,
indexed STRING at 768 and junction keys at exactly 3072 bytes remain legal.
Preflight failure in a disposable existing output tree leaves its old schema
unchanged. This is compiler-preflight protection, not G19 filesystem atomicity.

Historical compatibility fixture files remain frozen. Only generated Node engines,
supported-target README text, approved earlier role/normalization changes and
affected literal escaping may differ. All unaffected compiler phase hashes and
output sections remain checked against pinned baselines. No dependency lock or
repository output edits; no protected artifact staged.

## Verification

- npm test, including five MySQL target groups and all earlier/existing suites: PASS.
- node tests/mysql-target.test.js: PASS.
- node docs/verify-language-guide.js: PASS (counts recorded in final audit after
  added diagnostic examples).
- npm run test:generated-integration: PASS; install/start/health and temporary
  process/project/port cleanup with repository output preserved.
- Changed/generated JS node --check and git diff --check: PASS.
- Protected comparison: 36 paths, sizes, hashes and creation/modification times
  unchanged.
- LIVE MYSQL UNAVAILABLE: no APIFORGE_TEST_DB_* credentials; no DB created.

Self-review found no blocker in the authorized deterministic subset. G19 was
inspected after G15–G18; complete atomic replacement/rollback across Windows
managed directories and user-owned root files would require a larger design,
so it remains explicitly open rather than claiming preflight solves disk failure.

Commit range: 16cbac7..the milestone-4 commit containing this report. Concrete
SHAs and remote boundary evidence are in the final audit.
