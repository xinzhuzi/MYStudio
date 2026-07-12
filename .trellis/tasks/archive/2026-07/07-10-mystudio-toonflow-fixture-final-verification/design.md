# MYStudio Toonflow fixture and final parity verification design

## Scope

This child task adds a deterministic read-only structure comparison between Toonflow storyboard fixture rows and MYStudio storyboard projections. It does not depend on the user's live Toonflow SQLite database.

## Fixture comparison

The comparison covers:

- storyboard count and index mapping;
- prompt text;
- video description;
- ordered reference asset ids;
- ordered reference image paths.

## Golden image comparison

Image pixel comparison is explicitly deferred in this slice because portable fixture ownership and local Toonflow OSS paths are not stable in unit tests. The report must expose this as `goldenImageComparisonStatus: "deferred"` with a blocker reason.

## Verification layers

The final report must distinguish:

1. unit tests;
2. typecheck/lint;
3. full tests;
4. packaged smoke;
5. visible smoke;
6. real Daojie runner;
7. real media generation.

Only freshly executed layers can be reported as run.
