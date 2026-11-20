# database/

The local SQLite file lives here during development. It is created by
`cd backend && npm run migrate`, and it is git-ignored.

In production this directory is not used at all: the database sits on a Railway volume
mounted at `/data`, addressed by `DATABASE_PATH=/data/unfold.sqlite`.

The schema is `backend/src/db/schema.sql` — 24 tables covering all six phases, so later
work never migrates rows that participants have already filled. Applying it is idempotent
and runs automatically on backend boot.

To start over locally, delete the `.sqlite` file (and its `-wal` / `-shm` siblings) and
re-run the migration.
