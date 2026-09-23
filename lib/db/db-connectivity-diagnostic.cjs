const { performance } = require("node:perf_hooks");
const pg = require("pg");

function redactUrlShape(value) {
  const url = new URL(value);
  return {
    scheme: url.protocol.replace(":", ""),
    host: url.hostname,
    port: url.port || "(default)",
    database: url.pathname.replace(/^\//, ""),
    hasUser: Boolean(url.username),
    queryKeys: [...url.searchParams.keys()],
    sslmode: url.searchParams.get("sslmode"),
  };
}

async function timed(label, fn) {
  const started = performance.now();
  try {
    const value = await fn();
    console.log({
      label,
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      ...value,
    });
  } catch (error) {
    console.error({
      label,
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      name: error.name,
      code: error.code,
      message: error.message,
    });
  }
}

async function runPool(label, config) {
  const pool = new pg.Pool(config);
  pool.on("error", (error) => {
    console.error({
      label,
      event: "pool-error",
      name: error.name,
      code: error.code,
      message: error.message,
    });
  });

  await timed(`${label}: select 1`, async () => {
    const result = await pool.query("select 1 as ok");
    return { rows: result.rowCount };
  });

  await timed(`${label}: keys shape`, async () => {
    const user = await pool.query("select clerk_id from public.users limit 1");
    if (user.rowCount === 0) return { skipped: "no-user-row" };
    const result = await pool.query(
      "select id, public_key from public.user_device_keys where user_id = $1 and revoked_at is null limit 1",
      [user.rows[0].clerk_id],
    );
    return { rows: result.rowCount };
  });

  await timed(`${label}: files shape`, async () => {
    const user = await pool.query("select clerk_id from public.users limit 1");
    if (user.rowCount === 0) return { skipped: "no-user-row" };
    const result = await pool.query(
      "select id from public.files where owner_clerk_id = $1 order by created_at desc limit 25",
      [user.rows[0].clerk_id],
    );
    return { rows: result.rowCount };
  });

  await timed(`${label}: connection capacity`, async () => {
    const [activity, limits] = await Promise.all([
      pool.query(
        "select state, count(*)::int as connections from pg_stat_activity where datname = current_database() group by state order by state",
      ),
      pool.query(
        "select current_setting('max_connections')::int as max_connections, current_setting('superuser_reserved_connections')::int as reserved_connections",
      ),
    ]);
    return { activity: activity.rows, limits: limits.rows[0] };
  });

  await timed(`${label}: upload schema`, async () => {
    const result = await pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('files', 'file_search_tokens', 'user_device_keys') order by table_name",
    );
    return { tables: result.rows.map((row) => row.table_name) };
  });

  await pool.end();
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  console.log({ url: redactUrlShape(process.env.DATABASE_URL) });

  await runPool("current", {
    connectionString: process.env.DATABASE_URL,
  });

  await runPool("ssl-explicit", {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    max: 2,
  });
}

main().catch((error) => {
  console.error({
    name: error.name,
    code: error.code,
    message: error.message,
  });
  process.exit(1);
});
