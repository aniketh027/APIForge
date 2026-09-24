# Review report template

Omit sections that add no information. Do not print empty placeholders or a numeric score.

## Findings

Use one entry per issue, ordered by severity:

```text
1. [SEVERITY] Short title
   File: path/to/file.js:line
   Problem: What is incorrect or missing.
   Why it matters: User-visible, compiler, runtime, or maintenance impact.
   Evidence: Code path, test, generated output, or reproduction result.
   Recommended fix: Focused correction without unrelated redesign.
```

If there are no findings:

```text
No blocking or correctness issues found in the reviewed scope.
```

## Verification

```text
- Targeted tests: command and result
- Full suite: command and result, or why not run
- CLI/API/integration: command and result
- Generated artifacts: what was inspected
```

Include only checks actually performed.

## Scope reviewed

Briefly name the comparison, requirements, files, and behavior reviewed. State if the original implementation request was unavailable.

## Remaining risks

List material unverified areas or environmental limits. Omit when none remain.

## Conclusion

Use one:

- `Ready`
- `Not ready`
- `Ready after listed fixes`

Tie the conclusion to the requested implementation and findings.
