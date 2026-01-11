import { createPool } from '@vercel/postgres';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    return res.status(500).json({
      error: 'Database connection string not found',
      hint: 'Set POSTGRES_URL environment variable in Vercel'
    });
  }

  const pool = createPool({ connectionString });

  try {
    // Create columns table
    await pool.sql`
      CREATE TABLE IF NOT EXISTS columns (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        position INTEGER NOT NULL
      )
    `;

    // Create tasks table
    await pool.sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        column_id VARCHAR(50) REFERENCES columns(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create tags table
    await pool.sql`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL
      )
    `;

    // Create task_tags junction table
    await pool.sql`
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id VARCHAR(50) REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      )
    `;

    // Insert default columns if they don't exist
    await pool.sql`
      INSERT INTO columns (id, title, position)
      VALUES
        ('column-1', 'To Do', 0),
        ('column-2', 'In Progress', 1),
        ('column-3', 'Completed', 2)
      ON CONFLICT (id) DO NOTHING
    `;

    return res.status(200).json({ message: 'Database initialized successfully' });
  } catch (error) {
    console.error('Database initialization error:', error);
    return res.status(500).json({ error: 'Failed to initialize database' });
  }
}
