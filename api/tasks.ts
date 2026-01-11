import { createPool } from '@vercel/postgres';
import type { VercelRequest, VercelResponse } from '@vercel/node';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

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
    const { title, description, priority, tags, columnId } = req.body;

    if (!title || !columnId) {
      return res.status(400).json({ error: 'Title and columnId are required' });
    }

    const taskId = generateId();
    const now = new Date().toISOString();

    // Get the max position in the column
    const positionResult = await pool.sql`
      SELECT COALESCE(MAX(position), -1) + 1 as next_position
      FROM tasks
      WHERE column_id = ${columnId}
    `;
    const position = positionResult.rows[0].next_position;

    // Insert the task
    await pool.sql`
      INSERT INTO tasks (id, title, description, priority, column_id, position, created_at, updated_at)
      VALUES (${taskId}, ${title}, ${description || ''}, ${priority || 'medium'}, ${columnId}, ${position}, ${now}, ${now})
    `;

    // Handle tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        // Insert tag if it doesn't exist
        await pool.sql`
          INSERT INTO tags (name)
          VALUES (${tagName})
          ON CONFLICT (name) DO NOTHING
        `;

        // Get tag id
        const tagResult = await pool.sql`
          SELECT id FROM tags WHERE name = ${tagName}
        `;

        if (tagResult.rows[0]) {
          // Link tag to task
          await pool.sql`
            INSERT INTO task_tags (task_id, tag_id)
            VALUES (${taskId}, ${tagResult.rows[0].id})
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }

    return res.status(201).json({
      id: taskId,
      title,
      description: description || '',
      priority: priority || 'medium',
      columnId,
      tags: tags || [],
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    console.error('Error creating task:', error);
    return res.status(500).json({ error: 'Failed to create task' });
  }
}
