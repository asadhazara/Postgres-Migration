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
  return (await transaction(`SELECT * FROM "Migration";`)).rows.map(row => row.name);
}

/**
 * Run all of the available migrations.
 */
async function migrate() {
  await transaction('CREATE TABLE IF NOT EXISTS "Migration"(name VARCHAR(255) NOT NULL);');

  const directories = getDirectories(join(__dirname, 'migration'));
  const migrations = await fetchMigrations();

  for (const directory of directories) {
    const name = directory.split('/').pop();

    if (migrations.includes(name)) continue;

    const query = readFileSync(join(directory, 'up.sql')).toString();

    if (!query) continue;

    await transaction(`INSERT INTO "Migration" VALUES ('${name}');${query}`);

    console.log(chalk.blue(query));
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

    const name = directory.split('/').pop();

    if (!migrations.includes(name)) continue;

    const query = readFileSync(join(directory, 'down.sql')).toString();

    if (!query) continue;

    await transaction(`DELETE FROM "Migration" WHERE name = '${name}';${query}`);

    console.log(chalk.blue(query));
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