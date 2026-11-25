# Harmony P1 Fixtures

These JSON files are deterministic inputs for the P1 pure-logic tests.

- `normal-state.json`: one semester, school rules only, no remap, holiday, custom course, or evening study.
- `edge-state.json`: closed date, remap, local map, holiday range/day skip, evening study, weekly/once custom courses, approved leave.

Rules:
- All dates use `YYYY-MM-DD`; all times use `HH:mm`.
- The `version` is the state schema version (`1`).
- Fixtures contain only synthetic demo data; no account, password, cookie, URL, or real student data.
- Keep fixtures stable; a behavior change must be reflected in the spec and tests together.
