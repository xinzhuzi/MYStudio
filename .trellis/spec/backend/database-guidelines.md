# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

<!--
Document your project's database conventions here.

Questions to answer:
- What ORM/query library do you use?
- How are migrations managed?
- What are the naming conventions for tables/columns?
- How do you handle transactions?
-->

The Python sidecar uses the standard-library `sqlite3` module through
`RuntimeStore`. There is no ORM. The runtime-local database is
`{data_dir}/tts.sqlite` and stores voice profiles and generations.

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

- Open short-lived connections through `RuntimeStore._connect()` and use a
  context manager for deterministic commit and close behavior.
- Use `?` placeholders or named parameters for values; never interpolate user
  values into SQL.
- Convert `sqlite3.Row` to dictionaries at the storage boundary.

```python
with self._connect() as conn:
    row = conn.execute(
        "SELECT * FROM profiles WHERE id = ?", (profile_id,)
    ).fetchone()
```

---

## Migrations

<!-- How to create and run migrations -->

Schema creation is idempotent in `RuntimeStore._init_db()`. Additive migrations
inspect `PRAGMA table_info(...)` and use `ALTER TABLE ... ADD COLUMN` only when
the column is absent. Destructive or data-rewriting changes require a separate
task, backup, and migration test.

---

## Naming Conventions

<!-- Table names, column names, index names -->

- Tables and columns use `snake_case`.
- IDs are text UUIDs; timestamps are integer milliseconds named `created_at`
  and `updated_at`.
- Compatibility aliases such as `profileId` are normalized before SQL access.

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

- Do not write runtime databases into the repository or packaged resources.
- Do not build SQL field names from external input.
- Do not remove or rename columns without backup and compatibility planning.
