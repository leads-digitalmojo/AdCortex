import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgres://localhost:5432/ad-pilot' });

// We try to insert a client with createdAt as string
pool.query(`INSERT INTO clients (id, name, short_name, project, location, target_locations, platforms, targets, created_at) VALUES ('test-1', 'Name', 'N', 'P', 'Loc', '[]', '{}', '{}', '2026-04-09T05:00:00.000Z') RETURNING *`)
  .then(res => console.log('Success:', res.rows[0]))
  .catch(err => console.error('Error insert string createdAt:', err.message))
  .finally(() => pool.end());
