import { createPool } from '@vercel/postgres';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;

  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid task ID' });
  }

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    return res.status(500).json({
      error: 'Database connection string not found',
      hint: 'Set POSTGRES_URL environment variable in Vercel'
    });
  }

  const pool = createPool({ connectionString });

  if (req.method === 'PUT') {
    return updateTask(id, req, res, pool);
  } else if (req.method === 'DELETE') {
    return deleteTask(id, res, pool);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function updateTask(id: string, req: VercelRequest, res: VercelResponse, pool: any) {
  try {
    const { title, description, priority, tags } = req.body;
    const now = new Date().toISOString();

    // Update the task
    await pool.sql`
      UPDATE tasks
      SET
        title = COALESCE(${title}, title),
        description = COALESCE(${description}, description),
        priority = COALESCE(${priority}, priority),
        updated_at = ${now}
      WHERE id = ${id}
    `;

    // Update tags if provided
    if (tags !== undefined) {
      // Remove existing tags
      await pool.sql`
        DELETE FROM task_tags WHERE task_id = ${id}
      `;

      // Add new tags
      for (const tagName of tags) {
        await pool.sql`
          INSERT INTO tags (name)
          VALUES (${tagName})
          ON CONFLICT (name) DO NOTHING
        `;

        const tagResult = await pool.sql`
          SELECT id FROM tags WHERE name = ${tagName}
        `;

        if (tagResult.rows[0]) {
          await pool.sql`
            INSERT INTO task_tags (task_id, tag_id)
            VALUES (${id}, ${tagResult.rows[0].id})
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }

    // Fetch updated task
    const taskResult = await pool.sql`
      SELECT
        t.id,
        t.title,
        t.description,
        t.priority,
        t.column_id,
        t.created_at,
        t.updated_at,
        COALESCE(
          json_agg(tg.name) FILTER (WHERE tg.name IS NOT NULL),
          '[]'
        ) as tags
      FROM tasks t
      LEFT JOIN task_tags tt ON t.id = tt.task_id
      LEFT JOIN tags tg ON tt.tag_id = tg.id
      WHERE t.id = ${id}
      GROUP BY t.id
    `;

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskResult.rows[0];
    return res.status(200).json({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      columnId: task.column_id,
      tags: task.tags,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    });
  } catch (error) {
    console.error('Error updating task:', error);
    return res.status(500).json({ error: 'Failed to update task' });
  }
}

async function deleteTask(id: string, res: VercelResponse, pool: any) {
  try {
    const result = await pool.sql`
      DELETE FROM tasks WHERE id = ${id} RETURNING id
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.status(200).json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
}
