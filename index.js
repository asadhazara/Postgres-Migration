// @ts-check
const { program } = require('commander');
const { lstatSync, readdirSync, closeSync, openSync, readFileSync, mkdirSync } = require('fs');
const { Pool } = require('pg');
const { join } = require('path');
const { upperFirst, camelCase } = require('lodash');
const chalk = require('chalk');
const { config } = require('dotenv');

// configure dotenv
config();

const pool = new Pool({ connectionString: process.env.DB_URL });

/**
 * 
 * @param {string} source 
 */
const isDirectory = source => lstatSync(source).isDirectory();

/**
 * 
 * @param {string} source 
 */
const getDirectories = source => readdirSync(source).map(name => join(source, name)).filter(isDirectory);

/**
 * 
 * @param {string} query 
 */
async function transaction(query) {
  const client = await pool.connect();

  let result;

  try {
    await client.query('BEGIN;');
    result = await client.query(`${query}`);
    await client.query('COMMIT;');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return result;
}

/**
 * Create a new migration.
 * @param {string} title 
 */
function create(title) {
  const pascalCasedTitle = upperFirst(camelCase(title));
  const path = join(__dirname, `migration/${Date.now()}-${pascalCasedTitle}`);

  mkdirSync(path, { recursive: true });
  closeSync(openSync(join(path, 'up.sql'), 'w'));
  closeSync(openSync(join(path, 'down.sql'), 'w'));
}
/**
 * fetch all migrations in database
 */
async function fetchMigrations() {
  return (await transaction('SELECT * FROM "Migration";')).rows.map(row => row.version);
}

/**
 * Run all of the available migrations.
 */
async function migrate() {
  await transaction(`
    CREATE TABLE IF NOT EXISTS "Migration"(
      version BIGINT PRIMARY KEY NOT NULL,
      name VARCHAR(255) NOT NULL
    );
  `);

  const directories = getDirectories(join(__dirname, 'migration'));
  const migrations = await fetchMigrations();

  for (const directory of directories) {
    const [version, name] = directory.split('/').pop().split('-');

    if (migrations.includes(version)) continue;

    const query = readFileSync(join(directory, 'up.sql')).toString();

    if (!query) continue;

    await transaction(`INSERT INTO "Migration" VALUES (${version}, '${name}');${query}`);

    console.log(chalk.green('MIGRATED', version), chalk.blue(name));
  }

  process.exit();
}

/**
 * Undo previous migrations executed.
 * @param {object} options
 * @param {boolean} options.all
 */
async function rollback(options) {
  const directories = getDirectories(join(__dirname, 'migration'));
  const migrations = await fetchMigrations();

  let removedCount = 0;

  for (const directory of directories.reverse()) {
    if (!options.all && removedCount > 0) break;

    const [version, name] = directory.split('/').pop().split('-');

    if (!migrations.includes(version)) continue;

    const query = readFileSync(join(directory, 'down.sql')).toString();

    if (!query) continue;

    await transaction(`DELETE FROM "Migration" WHERE version = ${version};${query}`);

    console.log(chalk.green('REVERTED', version), chalk.blue(name));
    removedCount++;
  }

  process.exit();
}

program
  .command('create')
  .arguments('<name>')
  .description('Create a new migration.', { title: 'The name of the migration.' })
  .action(create);

program
  .command('migrate')
  .description('Run all of the available migrations.')
  .action(migrate);

program
  .command('rollback')
  .description('Undo previous migrations executed.')
  .option('-a, --all', 'Revert all migrations.')
  .action(rollback);

program.parse(process.argv);