# APIForge V1 Live MySQL Verification

**Overall state: LIVE MYSQL V1 VERIFIED.** Verification date: 2026-10-02 (Asia/Calcutta).

## Frozen baseline and scope

- Verified branch: `main`.
- Compiler/runtime SHA: `9de0e8faa11371454170930328c25482485212ba`. Local HEAD, fetched `origin/main`, and live remote main matched; ahead/behind was 0/0.
- Tracked worktree/index were clean before testing and before this report. Only the four approved protected roots were untracked. No implementation, frontend, DSL, generated runtime source, tests, dependencies, or repository `output/` were changed.
- This report is the sole repository change and is authorized for one local documentation-only commit. No push was performed.

## Live server and supported assumptions

The user supplied disposable Docker container `apiforge-mysql-v1` from `mysql:8.4`, published on host port 3307. After Codex restarted, all four `APIFORGE_TEST_DB_HOST/PORT/USER/PASSWORD` variables were present in the process environment. Final execution used these configured credentials. An earlier connection probe read the same container settings in memory while environment propagation was being resolved.

| Measurement | Observed live value |
|---|---|
| SELECT VERSION() | `8.4.11` |
| @@sql_mode on the mysql2 session | `IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` |
| @@global.sql_mode | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` |
| @@character_set_server | `utf8mb4` |
| @@collation_server | `utf8mb4_unicode_ci` |
| Default storage engine | `InnoDB` |
| InnoDB default row format | `dynamic` |
| InnoDB page size | 16384 bytes |
| lower_case_table_names | 0 |
| Matrix driver | mysql2 3.23.4 |
| Node runtime | v24.14.0 |

MySQL >=8.0.16, utf8mb4 availability, strict mode, InnoDB DYNAMIC, and 16 KiB pages were confirmed. `NO_BACKSLASH_ESCAPES` was disabled. `NO_AUTO_VALUE_ON_ZERO` was absent in the normal session. mysql2 negotiates its default `IGNORE_SPACE` client flag, explaining the session/global difference. Final sessions reproduced the initial mode. The second zero test changed only the dedicated backend connection sessions; no global SQL mode was altered.

## Verification method and existing live harness

The existing documented command `npm run test:generated-mysql` ran first and passed, then passed again after the offline regressions. It materialized the generated project outside the repository, installed its declared dependencies, imported real MySQL DDL, started through npm, and executed all its CRUD/default/validation/collection/MANY_TO_MANY assertions. This imperative harness is one end-to-end workflow, rather than a numbered test runner.

| Existing harness run | Temporary database | Result | Cleanup |
|---|---|---|---|
| Before additional matrix | `apiforge_e2e_muqurt549619458fdaf62542` | PASS | DB/project/process/port/output verified |
| After regressions | `apiforge_e2e_muqv61vbb32e3503bbde1bfb` | PASS | DB/project/process/port/output verified |

To honor the password restriction, a temporary external Node preload omitted the password entry from the harness-created temporary `.env`. The generated server received the credential only through its inherited environment. The harness assertions and generated source were unchanged. Password values were neither printed nor written to repository or temporary files.

The supplemental live matrix compiled the fixture below through the frozen six phases, materialized 130 generated files, imported 44 InnoDB DYNAMIC tables, and used unmodified generated HTTP routes/models with installed mysql2 3.23.4. Its 211 generated HTTP requests included 34 invalid requests for which an external pool-call observer proved zero DB query calls. Direct MySQL queries independently verified persistence, constraints, FK topology, and key widths. The observer retained actual mysql2 ResultSetHeader identities and did not substitute any DB response. Generated files were hash-checked against their original compile results: all 130 remained identical.

## Complete required scenario matrix

| Scenario | Concrete live evidence | Result |
|---|---|---|
| A. Basic generated backend | 130 generated files, 44 imported InnoDB DYNAMIC tables, health 200, actual database-backed HTTP CRUD; standalone dependency installation/startup covered by the existing harness. | PASS |
| B. Implicit key | Student POST `{"name":"Alice"}` returned integer id; GET/PUT/collection/DELETE used that identity and direct DB checks verified updates/removal. | PASS |
| C. Explicit auto INT | Omitted/null/zero/positive identities matched persisted IDs and actual headers; negative id returned 400 with no query or row mutation. | PASS |
| D. Defaulted keys | Empty ItemDefault create returned/persisted key 7; supplied 9 took precedence. Empty Config create returned/persisted `main`; supplied `caller` took precedence. | PASS |
| E. STRING key | User username `alice` survived POST/GET/non-key PUT/DELETE with independently checked DB state. | PASS |
| F. Key immutability | Both same and different INT/STRING PK fields on PUT returned 400, called no query, and left the original full rows unchanged. | PASS |
| G. Required/null/default | REQUIRED omission/null rejected with no DB call; optional STRING/BOOLEAN null persisted; omitted count/state received 4/draft; empty valid creates, partial PUT and empty PUT behaved correctly. | PASS |
| H. Scalars/booleans | INT 3, FLOAT 1.25, Unicode STRING and ENUM round-tripped. BOOLEAN reads were JSON true/false; nullable BOOLEAN stayed null. | PASS |
| I. ENUM | Exact members including empty/apostrophe/backslash/Unicode persisted/read; database ordinals matched declaration order; omitted default was Alpha; wrong case and invalid members returned 400 before DB access. | PASS |
| J. STRING/default escaping | `O'Reilly`, `C:\new` (one U+005C followed by n), `😀漢字`, and empty string imported as defaults and survived runtime writes/reads exactly. | PASS |
| K. Bounds/CHECK | INT -3/9, FLOAT 0/10 and STRING length 1/12 accepted. Six direct constraint violations returned ER_CHECK_CONSTRAINT_VIOLATED; matching HTTP inputs returned 400 without queries. SEM037 rejected auto-key MIN/MAX. | PASS |
| L. Collections | All five typed equality filters, asc/desc, pages/counts/headers, stable PK ties, empty/beyond-last pages and literal injection-like string values worked; 15 malformed queries returned 400 before DB work. | PASS |
| M. Relationships | All four cardinalities across 12 implicit/explicit INT/STRING source-target combinations; imported FK/junctions, source routes, reads, key types/widths and deletion actions verified. | PASS |
| N. Reserved identifiers | Lateral, Intersect, Array, Member and select/group columns executed DDL/CRUD/source-side relationships without identifier SQL errors. | PASS |
| O. Private properties | Actual mysql2 read all five private column names as own properties; HTTP serialized them; prototype remained intact; object-valued __proto__ input rejected before DB access. | PASS |
| P. Preflight rejection | Eight real compiler HTTP cases returned 422 with exact SEM034/036/037, skipped IR/optimizer/codegen, emitted no files and made no generated DB calls. | PASS |

## AUTO_INCREMENT identity and zero modes

| Input/mode | HTTP response identity | Persisted identity | Actual mysql2 insertId |
|---|---:|---:|---:|
| omitted / normal | 1 | 1 | 1 |
| null / normal | 2 | 2 | 2 |
| zero / normal | 3 | 3 | 3 |
| positive / normal | 100 | 100 | 100 |
| id:0 / NO_AUTO_VALUE_ON_ZERO | 0 | 0 | 0 |

The isolated zero backend observed session mode `IGNORE_SPACE,ONLY_FULL_GROUP_BY,NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`. GET `/items/0` returned the stored zero row. In that mode, subsequent omission/null still generated IDs 1/2 and both rows were directly confirmed. Normal-mode negative input performed zero DB work and did not alter the row count.

## Relationship evidence

| Cardinality | Source entity / key | Target entity / key | FK/junction and deletion result |
|---|---|---|---|
| ONE_TO_ONE | Parent0 / implicit | Child0 / STRING | Unique target FK; duplicate relationship failed ER_DUP_ENTRY; deleting source cascaded target. |
| ONE_TO_ONE | Parent1 / INT | Child1 / implicit | Unique target FK; duplicate relationship failed ER_DUP_ENTRY; deleting source cascaded target. |
| ONE_TO_ONE | Parent2 / STRING | Child2 / INT | Unique target FK; duplicate relationship failed ER_DUP_ENTRY; deleting source cascaded target. |
| ONE_TO_MANY | Parent3 / implicit | Child3 / STRING | Target FK; deleting source kept target with null FK. |
| ONE_TO_MANY | Parent4 / INT | Child4 / implicit | Target FK; deleting source kept target with null FK. |
| ONE_TO_MANY | Parent5 / STRING | Child5 / INT | Target FK; deleting source kept target with null FK. |
| MANY_TO_ONE | Parent6 / implicit | Child6 / STRING | Source FK; deleting target kept source with null FK; lookup became 404. |
| MANY_TO_ONE | Parent7 / INT | Child7 / implicit | Source FK; deleting target kept source with null FK; lookup became 404. |
| MANY_TO_ONE | Parent8 / STRING | Child8 / INT | Source FK; deleting target kept source with null FK; lookup became 404. |
| MANY_TO_MANY | Parent9 / implicit | Child9 / STRING | Two FKs and composite-key junction; HTTP add/remove; parent deletion cleared junction while target survived. |
| MANY_TO_MANY | Parent10 / INT | Child10 / implicit | Two FKs and composite-key junction; HTTP add/remove; parent deletion cleared junction while target survived. |
| MANY_TO_MANY | Parent11 / STRING | Child11 / INT | Two FKs and composite-key junction; HTTP add/remove; parent deletion cleared junction while target survived. |

All relationship GETs returned the expected target identity/label and JSON boolean true. Every INT/implicit FK had MySQL type INT. Every STRING FK retained VARCHAR(300), including STRING junction endpoints. Singular/list route shapes and MANY_TO_MANY source add/remove routes came directly from generated code.

## Collection, ENUM and private-property observations

- Collection fixture IDs: 11, 12, 13, 14. Sorting integer ascending with limit 2 produced page 1 `[11,12]` and page 2 `[14,13]`, proving ascending PK ties. Descending field sort also retained ascending PK ties.
- Page 2/limit 2 metadata: `x-total-count=4`, `x-page=2`, `x-limit=2`, `x-total-pages=2`. Filtered count/pages were 3/2; zero matches returned total-pages 0; beyond-last page returned an empty array.
- ENUM members in source/native ordinal order: `["zeta","Alpha","","O'Reilly","C:\\new","😀漢字"]`. Native column metadata was captured and each persisted member ordinal equaled its source position plus one.
- Private columns: `__proto__`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`. Both raw real-driver array values and generated object/HTTP values matched; `constructor` and `toString` also retained declared values. A non-key PUT updated `__proto__` without prototype corruption.

## Compiler preflight evidence

| Invalid program category | Diagnostic | HTTP | Generated DB calls |
|---|---|---:|---:|
| transformed entity collision | SEM034 | 422 | 0 |
| case-distinct column collision | SEM034 | 422 | 0 |
| relationship allocation collision | SEM034 | 422 | 0 |
| overlong MySQL identifier | SEM037 | 422 | 0 |
| oversized indexed STRING | SEM037 | 422 | 0 |
| AUTO_INCREMENT MIN | SEM037 | 422 | 0 |
| AUTO_INCREMENT MAX | SEM037 | 422 | 0 |
| ENUM trailing-space member | SEM036 | 422 | 0 |

## Full regressions after the live matrix

| Command/suite | Current result |
|---|---|
| npm test | Exit 0; main suite 1,060 passed / 0 failed. All extension suites below passed. |
| STRING length / diagnostics / warnings / ENUM | 25 / 53 / 26 / 16 tests passed. |
| Collection / implicit key / request validation / key contract | 9 / 9 / 9 / 11 groups passed. |
| Naming / relationship safety / OpenAPI / MySQL target / final audit | 5 / 3 / 3 / 6 / 6 groups passed. |
| Disk generation and MySQL harness safety | Both suites passed. |
| node docs/verify-language-guide.js | Exit 0; 18 valid, 67 invalid examples; 120 generated JS files parsed; real CLI cases verified. |
| npm run test:generated-integration | Exit 0; declared dependency installation and npm startup/health passed; ephemeral port 57067 and project/process/output cleanup verified. |
| npm run test:generated-mysql | Exit 0; all existing live assertions passed again; full harness cleanup verified. |
| git diff --check; cached check | Both passed. |

Some historical wording printed by offline tests still says live MySQL was unverified/unavailable. Those lines describe each offline simulation/static-parser test; the real persistence evidence in this report is from the separate live executions.

## Cleanup and protected artifacts

- Successful matrix databases: `apiforge_e2e_muqv2hgba0d84c6eabde6432`, `apiforge_e2e_muqv2jdy43a064b4280b5969`. Both were dropped and absence independently checked. Both existing-harness databases above were also dropped. A final live query returned zero `apiforge_e2e_*` databases.
- Matrix backend/compiler ports 53675, 53682, 53685 were all independently rebound after shutdown; both backend process trees terminated. The existing harnesses independently verified their process/port/project cleanup. Additional generated projects and all external temporary verifier files were removed before committing this report.
- The task-specific disposable Docker container `apiforge-mysql-v1` and its sole anonymous volume `cac729f8c47aadf5c2c618eb0ccaff9fea0ef6dab40398177c30f9e5f02ccdd7` were removed with `docker rm --force --volumes apiforge-mysql-v1`. Before removal, the volume was confirmed attached only to that container. Exact-name container/volume inventories confirmed absence; host port 3307 was released. No other user container/database was removed.
- All 36 protected files matched the pre-test snapshot at each checked boundary: exact paths/counts, sizes, SHA-256, creation timestamps and modification timestamps. The established `tests/verify-protected-artifacts.ps1` workflow passed. Protected paths were never staged.
- Pre-test manifest SHA-256: `e2fc5717827e3af5115fe1f896289ddfb08d49a8bc1f21c3c2b24f9ce6f9786e`. The full manifest below records the matching final values.

Two preliminary verifier issues were corrected only in external temporary code: quoting the reserved Sensitive table in a direct probe, and comparing session SQL mode with session SQL mode rather than global mode. Neither was a generated-backend defect. The corrected complete matrix and final audit passed; no production fix or test change was made.

## Limits of this result

This gate verifies the specified V1 matrix on measured MySQL 8.4.11 settings. It does not establish support for MariaDB, NO_BACKSLASH_ESCAPES, another page/row format, arbitrary scalar storage extremes, concurrency/load behavior, or transaction semantics beyond the frozen documented contract. Supplemental matrix projects used repository-installed runtime dependencies; independent standalone installation/startup was separately proven by the existing harnesses. Database-applied non-key defaults were verified by DB/GET reads; create responses continue to follow the documented echoed-field/key behavior.

## Reproduction fixture

At the frozen SHA, configure the four test environment variables without writing a password file, then run the documented live harness. The additional fixture below generates the exact primary matrix schema. Follow the scenario table through generated root routes. Synthetic FK setup for non-MANY_TO_MANY cases uses direct test SQL because generated write APIs intentionally reject synthetic FK input. The isolated zero check uses a second generated Item database/backend and SET SESSION sql_mode on that backend's connections; it does not alter global mode.

```apiforge
ENTITY Student
name STRING REQUIRED
ENTITY Item
id INT PRIMARY KEY
name STRING
ENTITY ItemDefault
key INT PRIMARY KEY DEFAULT 7
name STRING
ENTITY Config
key STRING PRIMARY KEY DEFAULT "main"
value STRING
ENTITY User
username STRING PRIMARY KEY
name STRING
ENTITY RequiredRow
label STRING REQUIRED
optional STRING
enabled BOOLEAN
count INT DEFAULT 4
state ENUM("draft", "ready", "") DEFAULT "draft"
ENTITY Scalar
id INT PRIMARY KEY
integer INT MIN -3 MAX 9
ratio FLOAT MIN 0 MAX 10
flag BOOLEAN
nullableFlag BOOLEAN
text STRING MIN_LENGTH 1 MAX_LENGTH 12
state ENUM("zeta", "Alpha", "", "O'Reilly", "C:\new", "😀漢字") DEFAULT "Alpha"
ENTITY Escaping
id INT PRIMARY KEY
apostrophe STRING DEFAULT "O'Reilly"
backslash STRING DEFAULT "C:\new"
unicode STRING DEFAULT "😀漢字"
empty STRING DEFAULT ""
ENTITY Sensitive
id INT PRIMARY KEY
__proto__ STRING
__defineGetter__ STRING
__defineSetter__ STRING
__lookupGetter__ STRING
__lookupSetter__ STRING
constructor INT
toString BOOLEAN
ENTITY Parent0
label STRING
ENTITY Child0
code STRING PRIMARY KEY MAX_LENGTH 300
label STRING
flag BOOLEAN
RELATION Parent0 links0 Child0 ONE_TO_ONE
ENTITY Parent1
id INT PRIMARY KEY
label STRING
ENTITY Child1
label STRING
flag BOOLEAN
RELATION Parent1 links1 Child1 ONE_TO_ONE
ENTITY Parent2
code STRING PRIMARY KEY MAX_LENGTH 300
label STRING
ENTITY Child2
id INT PRIMARY KEY
label STRING
flag BOOLEAN
RELATION Parent2 links2 Child2 ONE_TO_ONE
ENTITY Parent3
label STRING
ENTITY Child3
code STRING PRIMARY KEY MAX_LENGTH 300
label STRING
flag BOOLEAN
RELATION Parent3 links3 Child3 ONE_TO_MANY
ENTITY Parent4
id INT PRIMARY KEY
label STRING
ENTITY Child4
label STRING
flag BOOLEAN
RELATION Parent4 links4 Child4 ONE_TO_MANY
ENTITY Parent5
code STRING PRIMARY KEY MAX_LENGTH 300
label STRING
ENTITY Child5
id INT PRIMARY KEY
label STRING
flag BOOLEAN
RELATION Parent5 links5 Child5 ONE_TO_MANY
ENTITY Parent6
label STRING
ENTITY Child6
code STRING PRIMARY KEY MAX_LENGTH 300
label STRING
flag BOOLEAN
RELATION Parent6 links6 Child6 MANY_TO_ONE
ENTITY Parent7
id INT PRIMARY KEY
label STRING
ENTITY Child7
label STRING
flag BOOLEAN
RELATION Parent7 links7 Child7 MANY_TO_ONE
ENTITY Parent8
code STRING PRIMARY KEY MAX_LENGTH 300
label STRING
ENTITY Child8
id INT PRIMARY KEY
label STRING
flag BOOLEAN
RELATION Parent8 links8 Child8 MANY_TO_ONE
ENTITY Parent9
label STRING
ENTITY Child9
code STRING PRIMARY KEY MAX_LENGTH 300
label STRING
flag BOOLEAN
RELATION Parent9 links9 Child9 MANY_TO_MANY
ENTITY Parent10
id INT PRIMARY KEY
label STRING
ENTITY Child10
label STRING
flag BOOLEAN
RELATION Parent10 links10 Child10 MANY_TO_MANY
ENTITY Parent11
code STRING PRIMARY KEY MAX_LENGTH 300
label STRING
ENTITY Child11
id INT PRIMARY KEY
label STRING
flag BOOLEAN
RELATION Parent11 links11 Child11 MANY_TO_MANY
ENTITY Lateral
id INT PRIMARY KEY
select STRING
ENTITY ReservedHost0
id INT PRIMARY KEY
group STRING
RELATION ReservedHost0 linksReserved0 Lateral MANY_TO_ONE
ENTITY Intersect
id INT PRIMARY KEY
select STRING
ENTITY ReservedHost1
id INT PRIMARY KEY
group STRING
RELATION ReservedHost1 linksReserved1 Intersect MANY_TO_ONE
ENTITY Array
id INT PRIMARY KEY
select STRING
ENTITY ReservedHost2
id INT PRIMARY KEY
group STRING
RELATION ReservedHost2 linksReserved2 Array MANY_TO_ONE
ENTITY Member
id INT PRIMARY KEY
select STRING
ENTITY ReservedHost3
id INT PRIMARY KEY
group STRING
RELATION ReservedHost3 linksReserved3 Member MANY_TO_ONE
```

## Matching protected-file manifest

| Path | Bytes | SHA-256 | Created UTC | Modified UTC |
|---|---:|---|---|---|
| `APIForge_Drive_Resources.zip` | 4267514 | `c7a6a95db84ce16d4a2381dffaf484ed35c6805225a9b767fd867bbae7c2016f` | 2026-09-25T10:44:59.5972535Z | 2026-09-25T11:26:58.2276552Z |
| `APIForge_Drive_Resources/APIForge_Compiler_Architecture.pdf` | 1114941 | `17f60546e50638a7b46b8e08b0577a965a5fccdb062285622b49e86e1d8438a5` | 2026-09-25T06:33:20.8266865Z | 2026-09-25T10:56:47.5638583Z |
| `APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report-2_1.png` | 313128 | `97e086c18b3a3276f82ea3309da1279af1043f2775c59130b6ae900b11c6bc26` | 2026-09-25T12:32:53.8394282Z | 2026-09-25T12:33:06.2808084Z |
| `APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report-3_1.png` | 144469 | `b89f4ebda12496c5dc0c872911db75f2e8b457ce68c010030a66114ad444972a` | 2026-09-25T12:32:54.9628426Z | 2026-09-25T12:33:07.0916984Z |
| `APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report-3_2.png` | 159916 | `29fcdf42bcdff5db9a2c02aef3a183096604579f14f80d147e77f10f8b109b48` | 2026-09-25T12:32:55.7212546Z | 2026-09-25T12:33:07.5953826Z |
| `APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report-3_3.png` | 143478 | `471e9e8364baee8cf3b5bc4c0c07d53188ab6638a9fc0d5b4b37558eb15498e4` | 2026-09-25T12:32:56.2661293Z | 2026-09-25T12:33:08.3688595Z |
| `APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report.pdf` | 1102750 | `5e90f1bf49cfaca997f8b89458c16a43f9de0f2b9efac3613cb041adf7ee5778` | 2026-09-25T06:33:20.7862670Z | 2026-09-25T11:23:16.1917813Z |
| `APIForge_Drive_Resources/APIForge_Language_Guide.pdf` | 520798 | `a03c46877004956decde5b60df7a03f1c5493eee7ddefc03040d17d8ce9bd750` | 2026-09-25T06:33:20.7983689Z | 2026-09-25T10:56:43.4376308Z |
| `APIForge_Drive_Resources/APIForge_Quick_Start.pdf` | 843174 | `1aa4154898768280c1addd5bae066aca4d3d99ccd7358395e36161191ae069ec` | 2026-09-25T06:33:20.8096770Z | 2026-09-25T10:56:45.3825646Z |
| `APIForge_Drive_Resources/DSL_Examples/basic_entity.apiforge` | 152 | `0a26aa126aa93a45c80ace44108519b4642addd31a417ea96eb489c841816567` | 2026-09-25T06:22:15.7532357Z | 2026-09-25T06:22:15.7532357Z |
| `APIForge_Drive_Resources/DSL_Examples/complete_example.apiforge` | 443 | `24c539de30b1e4a9d94369476e605249016726fd857b59457b6d8122fdcf2722` | 2026-09-25T06:22:15.7571486Z | 2026-09-25T06:22:15.7571486Z |
| `APIForge_Drive_Resources/DSL_Examples/relationships.apiforge` | 201 | `08d07d450bdbbd3f9d54213a5d38ab5b014116e100defe6254799bf1626f9d65` | 2026-09-25T06:22:15.7561358Z | 2026-09-25T06:22:15.7561358Z |
| `APIForge_Drive_Resources/DSL_Examples/validations.apiforge` | 277 | `4c521f48f43f8bc37de38e54918c84cbb2c12e0b145999591d180f38757556da` | 2026-09-25T06:22:15.7542404Z | 2026-09-25T06:22:15.7542404Z |
| `APIForge_Drive_Resources/Screenshots/generated_api.png` | 160133 | `d8c7f2f375e761f8cdcbde2100527662edecda70f0a7cbf9a6b83069f8521fe8` | 2026-09-25T06:22:02.7742888Z | 2026-09-25T06:55:37.5494659Z |
| `APIForge_Drive_Resources/Screenshots/generated_sql.png` | 235548 | `4d00d409d12315e16271ed404aee5219be7fbc79a0a180175a431f01925c342d` | 2026-09-25T06:22:02.7812638Z | 2026-09-25T06:55:37.8432717Z |
| `APIForge_Drive_Resources/Screenshots/lexer_error.png` | 143635 | `de3f5acf352dc8084aaf4104548e919127bc46fd50782a63be8a8c73445986e9` | 2026-09-25T06:22:02.7832610Z | 2026-09-25T06:55:38.2243888Z |
| `APIForge_Drive_Resources/Screenshots/openapi.png` | 142443 | `b7c8b853f2fe8fd8e62e947ff597a757eda48bf4fa7b0c6bce5a1f219aad6230` | 2026-09-25T06:22:02.7887804Z | 2026-09-25T06:55:37.9953657Z |
| `APIForge_Drive_Resources/Screenshots/semantic_error.png` | 152739 | `82099209e727011ca806a568a80edf0be4d09e5f07d68c035fbb3bbf4f13b082` | 2026-09-25T06:22:02.7979179Z | 2026-09-25T06:55:38.4439090Z |
| `APIForge_Drive_Resources/Screenshots/successful_compilation.png` | 311042 | `eb5eb0f35155110c0976d9e0dd7d06889dd3d8aad8b583b2c10a743b35f0cd02` | 2026-09-25T06:22:02.8039222Z | 2026-09-25T06:55:37.3579774Z |
| `APIForge_Overleaf_Source__FINAL.zip` | 1029692 | `e6baf4a2b503a7bf174f59c92be3a92ea0338933de87208424497dbf733121ec` | 2026-09-25T11:22:57.3946991Z | 2026-09-25T11:22:58.4073441Z |
| `APIForge_Overleaf_Source/apiforge-style.tex` | 3846 | `7563fc6a9269c83f4fc4d4f89bd7305df58d9f71eb2b3687d58659868f5fc386` | 2026-09-25T10:16:53.9695234Z | 2026-09-25T10:55:59.2799679Z |
| `APIForge_Overleaf_Source/architecture.tex` | 12452 | `c4d71e8c823e1d6290fa3817e3a3a5f979dcb6e6bf20ca5c7d88f1de07ec06f9` | 2026-09-25T10:20:00.6462880Z | 2026-09-25T10:47:25.1333404Z |
| `APIForge_Overleaf_Source/assets/generated_api.png` | 160133 | `d8c7f2f375e761f8cdcbde2100527662edecda70f0a7cbf9a6b83069f8521fe8` | 2026-09-25T10:15:33.0000746Z | 2026-09-25T06:55:37.5494659Z |
| `APIForge_Overleaf_Source/assets/generated_sql.png` | 235548 | `4d00d409d12315e16271ed404aee5219be7fbc79a0a180175a431f01925c342d` | 2026-09-25T10:15:33.0060718Z | 2026-09-25T06:55:37.8432717Z |
| `APIForge_Overleaf_Source/assets/lexer_error.png` | 143635 | `de3f5acf352dc8084aaf4104548e919127bc46fd50782a63be8a8c73445986e9` | 2026-09-25T10:15:32.9740723Z | 2026-09-25T06:55:38.2243888Z |
| `APIForge_Overleaf_Source/assets/openapi.png` | 142443 | `b7c8b853f2fe8fd8e62e947ff597a757eda48bf4fa7b0c6bce5a1f219aad6230` | 2026-09-25T10:15:33.0100738Z | 2026-09-25T06:55:37.9953657Z |
| `APIForge_Overleaf_Source/assets/semantic_error.png` | 152739 | `82099209e727011ca806a568a80edf0be4d09e5f07d68c035fbb3bbf4f13b082` | 2026-09-25T10:15:32.9790817Z | 2026-09-25T06:55:38.4439090Z |
| `APIForge_Overleaf_Source/assets/successful_compilation.png` | 311042 | `eb5eb0f35155110c0976d9e0dd7d06889dd3d8aad8b583b2c10a743b35f0cd02` | 2026-09-25T10:15:32.9670703Z | 2026-09-25T06:55:37.3579774Z |
| `APIForge_Overleaf_Source/examples/basic_entity.apiforge` | 152 | `0a26aa126aa93a45c80ace44108519b4642addd31a417ea96eb489c841816567` | 2026-09-25T10:15:33.0340831Z | 2026-09-25T06:22:15.7532357Z |
| `APIForge_Overleaf_Source/examples/complete_example.apiforge` | 443 | `24c539de30b1e4a9d94369476e605249016726fd857b59457b6d8122fdcf2722` | 2026-09-25T10:15:33.0390846Z | 2026-09-25T06:22:15.7571486Z |
| `APIForge_Overleaf_Source/examples/relationships.apiforge` | 201 | `08d07d450bdbbd3f9d54213a5d38ab5b014116e100defe6254799bf1626f9d65` | 2026-09-25T10:15:33.0430880Z | 2026-09-25T06:22:15.7561358Z |
| `APIForge_Overleaf_Source/examples/validations.apiforge` | 277 | `4c521f48f43f8bc37de38e54918c84cbb2c12e0b145999591d180f38757556da` | 2026-09-25T10:15:33.0480835Z | 2026-09-25T06:22:15.7542404Z |
| `APIForge_Overleaf_Source/language-guide.tex` | 12692 | `1caf325ef6862b9d0a28bf65b0db8df27ac425bc1d8f15930f054ff06e17a084` | 2026-09-25T10:18:47.7684611Z | 2026-09-25T10:30:54.1288611Z |
| `APIForge_Overleaf_Source/quick-start.tex` | 6425 | `253a4c3b261d5b02d61d4f85f33a3663296f2778748a25126ccc61ac3c282dee` | 2026-09-25T10:18:47.7721170Z | 2026-09-25T10:42:43.7969713Z |
| `APIForge_Overleaf_Source/README.md` | 1388 | `294dc75314cfb74d63de6c2c536a17dbf65a1253852883d776c541317f1e564a` | 2026-09-25T10:20:00.6496860Z | 2026-09-25T10:55:59.2814116Z |
| `APIForge_Overleaf_Source/report.tex` | 8345 | `61cca730433aa7dd25c717b640b24b65b93baeedb7d81b894cd40e1ef25265eb` | 2026-09-25T10:16:53.9707069Z | 2026-09-25T11:27:49.7218612Z |

**LIVE MYSQL V1 VERIFIED — READY FOR EXTERNAL REVIEW**
