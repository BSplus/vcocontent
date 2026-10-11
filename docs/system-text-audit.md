# English system-text audit

## Scope and checks

Audited `client/index.html`, all pages, components and client libraries, and
app-owned strings in `server` and `shared`. This covers public, Creator and Admin
views, dialogs, toast descriptions, placeholders, help and accessibility labels,
schema validation, API responses and newly recorded import/analysis status.

Used searches for German characters **and words without umlauts**, then traced
messages to their consumers: Nextcloud status/file warnings in the event modal,
entry-preview issues/API errors in the entry editor, image-analysis/edit errors
in the media editor, and API errors passed through fetch/query helpers to toasts.
No change was needed to the query helper: it forwards errors rather than owning
German copy. Existing English validation/analysis modules remain unchanged.

The audit guard parses string/template literals and JSX text across app sources
without treating comments as UI. Its targeted patterns catch known regressions;
it does not claim to detect every possible non-English sentence.

## Terminology and behavior

- Use **event gallery**, not **album**, for the Nextcloud import destination.
- Use **entry list**, **media item**, **image**, and **video** in app-owned errors.
- Use **Try again** for the changed query-refetch buttons and **Reload page**
  for the changed full-page reload buttons.
- Entry-validation text-prefix checks were updated alongside their messages;
  both official and Creator creation paths are tested.
- Status codes, file/data/time limits, safety restrictions, retry/resume actions,
  ownership checks and unchanged-data promises were preserved.

## Intentional exceptions

- Imprint/privacy names and addresses: `Lindwurmstraße 88`, `München`,
  `Amtsgericht München`, `Bayerisches Landesamt für Datenschutzaufsicht`.
  Legal wording was not rewritten.
- `Digital Nürburgring Langstrecken Serie` is a series name in demo data.
- German developer comments are not user-visible system copy.
- Uploaded filenames, user names, captions, descriptions and other authored
  content remain as supplied. Previously stored import errors are not migrated.
- External technical errors retain their source text. Translating raw third-party
  failures would misleadingly turn them into app-controlled messages.

## Focused verification

- `tests/system-text-audit.test.mjs`: source audit with the named exceptions.
- `tests/system-text-ui.test.mjs`: genuine empty gallery; startup, sign-in,
  Admin dashboard/media/users/storage and Creator failure views plus retry actions,
  with intercepted synthetic API data and no database writes.
- `tests/recognition-reference-api.test.mjs`: representative entry/media
  validation, denied access, missing source file, both event-creation validation
  branches, and unchanged saved entries/caption.
- `tests/nextcloud.test.mjs`: English access/security/limit errors, failed file
  statuses, real bounded imports and deduplicated retry using synthetic providers.
- Existing entry parsing, Nextcloud form and event-thumbnail UI checks.
