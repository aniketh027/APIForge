'use strict';
const APPLICATION_ID = 0x41504653;
const SCHEMA_VERSION = 1;
const FORMAT_VERSION = 1;
const uuidCheck = column => `length(${column})=36 AND ${column}=lower(${column}) AND ${column} NOT GLOB '*[^0-9a-f-]*' AND length(replace(${column},'-',''))=32 AND substr(${column},9,1)='-' AND substr(${column},14,1)='-' AND substr(${column},19,1)='-' AND substr(${column},24,1)='-' AND substr(${column},15,1)='4' AND substr(${column},20,1) IN ('8','9','a','b')`;
const fields = `name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128 AND length(CAST(name AS BLOB))<=512),
target TEXT NOT NULL CHECK(target IN ('mysql','postgres')),
source BLOB NOT NULL CHECK(length(source)<=1048576),
source_hash BLOB NOT NULL CHECK(length(source_hash)=32)`;
const definitions = Object.freeze({
    store_meta: `CREATE TABLE store_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
schema_version INTEGER NOT NULL CHECK(schema_version=1),format_version INTEGER NOT NULL CHECK(format_version=1),
store_id TEXT NOT NULL CHECK(${uuidCheck('store_id')}),created_at TEXT NOT NULL CHECK(length(created_at)=24)) STRICT`,
    projects: `CREATE TABLE projects(id TEXT PRIMARY KEY NOT NULL CHECK(${uuidCheck('id')}),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),${fields},
created_at TEXT NOT NULL CHECK(length(created_at)=24),updated_at TEXT NOT NULL CHECK(length(updated_at)=24),
FOREIGN KEY(id,revision) REFERENCES project_revisions(project_id,revision) DEFERRABLE INITIALLY DEFERRED) STRICT`,
    project_revisions: `CREATE TABLE project_revisions(project_id TEXT NOT NULL CHECK(${uuidCheck('project_id')}),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),${fields},
saved_at TEXT NOT NULL CHECK(length(saved_at)=24),PRIMARY KEY(project_id,revision),
FOREIGN KEY(project_id) REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED) STRICT`,
    revisions_no_update: `CREATE TRIGGER revisions_no_update BEFORE UPDATE ON project_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END`,
    revisions_no_delete: `CREATE TRIGGER revisions_no_delete BEFORE DELETE ON project_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END`,
    meta_no_update: `CREATE TRIGGER meta_no_update BEFORE UPDATE ON store_meta BEGIN SELECT RAISE(ABORT,'immutable store'); END`,
    meta_no_delete: `CREATE TRIGGER meta_no_delete BEFORE DELETE ON store_meta BEGIN SELECT RAISE(ABORT,'immutable store'); END`,
    projects_no_delete: `CREATE TRIGGER projects_no_delete BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT,'deletion unsupported'); END`,
    revisions_contiguous: `CREATE TRIGGER revisions_contiguous BEFORE INSERT ON project_revisions
WHEN NEW.revision<>coalesce((SELECT max(revision)+1 FROM project_revisions WHERE project_id=NEW.project_id),1)
OR NEW.saved_at<coalesce((SELECT max(saved_at) FROM project_revisions WHERE project_id=NEW.project_id),NEW.saved_at)
BEGIN SELECT RAISE(ABORT,'revision sequence'); END`,
    projects_initial: `CREATE TRIGGER projects_initial BEFORE INSERT ON projects WHEN NEW.revision<>1 OR NEW.created_at<>NEW.updated_at
BEGIN SELECT RAISE(ABORT,'initial revision'); END`,
    projects_advance: `CREATE TRIGGER projects_advance BEFORE UPDATE ON projects
WHEN NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at
BEGIN SELECT RAISE(ABORT,'revision advance'); END`,
    projects_snapshot_insert: `CREATE TRIGGER projects_snapshot_insert BEFORE INSERT ON projects
WHEN NOT EXISTS(SELECT 1 FROM project_revisions r WHERE r.project_id=NEW.id AND r.revision=NEW.revision AND r.name=NEW.name AND r.target=NEW.target AND r.source=NEW.source AND r.source_hash=NEW.source_hash AND r.saved_at=NEW.updated_at)
BEGIN SELECT RAISE(ABORT,'revision snapshot'); END`,
    projects_snapshot_update: `CREATE TRIGGER projects_snapshot_update BEFORE UPDATE ON projects
WHEN NOT EXISTS(SELECT 1 FROM project_revisions r WHERE r.project_id=NEW.id AND r.revision=NEW.revision AND r.name=NEW.name AND r.target=NEW.target AND r.source=NEW.source AND r.source_hash=NEW.source_hash AND r.saved_at=NEW.updated_at)
BEGIN SELECT RAISE(ABORT,'revision snapshot'); END`
});
module.exports = { APPLICATION_ID, SCHEMA_VERSION, FORMAT_VERSION, definitions };
