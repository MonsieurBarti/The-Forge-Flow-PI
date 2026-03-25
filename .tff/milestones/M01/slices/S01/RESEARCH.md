# M01-S01 Research: Biome Import Boundary Enforcement

## Question

How to configure Biome to prevent cross-hexagon deep imports?

## Findings

### noRestrictedImports (style group, Biome 2.x)

The `noRestrictedImports` rule in the `style` category supports two mechanisms:

**1. Path-based restrictions** — ban specific module names:
```json
{
  "paths": {
    "lodash": "Using lodash is not encouraged"
  }
}
```

**2. Gitignore-style glob patterns** — ban groups of imports with exceptions:
```json
{
  "patterns": [
    {
      "group": ["import-foo/*", "!import-foo/bar"],
      "message": "import-foo is deprecated, except import-foo/bar."
    }
  ]
}
```

### Application to Hexagon Boundaries

Since we use path aliases (`@hexagons/*`), we can create patterns that block deep imports into hexagons while allowing barrel imports:

```json
{
  "noRestrictedImports": {
    "level": "error",
    "options": {
      "patterns": [
        {
          "group": [
            "@hexagons/project/*",
            "@hexagons/milestone/*",
            "@hexagons/slice/*",
            "@hexagons/task/*",
            "@hexagons/execution/*",
            "@hexagons/review/*",
            "@hexagons/intelligence/*",
            "@hexagons/settings/*",
            "@hexagons/workflow/*"
          ],
          "message": "Import from the hexagon barrel (@hexagons/<name>) instead of its internals."
        }
      ]
    }
  }
}
```

This blocks `@hexagons/project/domain/project.entity` but allows `@hexagons/project` (the barrel).

### useImportRestrictions (v1 only, removed in v2)

The v1 `useImportRestrictions` rule in `nursery` enforced directory-based package privacy automatically. It was **not promoted** to Biome 2.x — 404 on the docs site. Not viable.

### Alternative: Biome overrides

We could also use `overrides` to apply different rules per directory (e.g., files in `src/hexagons/project/` can only import from `@kernel/` and their own relative paths). This is more complex but provides tighter control. Not needed for M01 — the pattern-based approach is sufficient.

## Decision

Use `noRestrictedImports` with glob patterns. Enumerate each hexagon explicitly in the `group` array. This is maintainable (new hexagons are added infrequently) and catches the exact violation we care about.

## Resolved Unknown

Biome uses **gitignore-style glob patterns** in the `patterns` option. `*` matches path segments, `!` negates. No regex needed.
