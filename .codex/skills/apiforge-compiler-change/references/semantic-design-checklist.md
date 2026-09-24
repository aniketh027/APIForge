# Semantic design checklist

Answer only the questions relevant to the proposed feature. Record material decisions before implementation; do not manufacture requirements where a category does not apply.

## Surface syntax

- What source form introduces the feature?
- Where may it appear, and what terminates or separates it?
- Is new lexical vocabulary or a new literal form required?
- What are representative valid, malformed, and boundary examples?
- Does order matter? Can the construct appear more than once, and what does duplication mean?

## Meaning and interactions

- Which datatypes or declarations support it?
- Which values are invalid, including boundary and empty cases?
- Can it coexist with `REQUIRED`, `DEFAULT`, `PRIMARY KEY`, and `UNIQUE`?
- How does it interact with existing validations, constraints, relationships, or implicit defaults?
- Is backward compatibility affected?
- Which error belongs to parsing, and which belongs to semantic analysis?
- What diagnostic location and message should the user receive?

## Representation and preservation

- What exact data should the AST contain?
- Must the symbol table expose it for later analysis?
- What target-independent meaning should the IR contain?
- Does IR validation need a schema rule?
- Must the optimizer preserve, normalize, order, or deduplicate it?
- How will tests prove it survives AST -> semantic analysis -> IR -> optimized IR -> codegen?

## Generated behavior

- What SQL behavior, if any, represents the feature?
- What Express runtime validation or endpoint behavior is required?
- What OpenAPI schema or path representation is required?
- Do all applicable targets accept and reject the same values?
- What should happen when a target cannot express the language meaning directly?

## User-facing surfaces

- Does the compiler API response shape change?
- Does the playground render an affected token, AST node, symbol-table entry, IR instruction, diagnostic, or artifact?
- Are a sample and Language Guide update useful after implementation is verified?

If an unanswered question would materially change language behavior or compatibility, pause and report the ambiguity. Use established APIForge conventions for local implementation choices that do not change the contract.
