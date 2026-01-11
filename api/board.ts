import { createPool } from '@vercel/postgres';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
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
    // Fetch all columns
    const columnsResult = await pool.sql`
      SELECT id, title, position FROM columns ORDER BY position
    `;

    // Fetch all tasks with their tags
    const tasksResult = await pool.sql`
      SELECT
        t.id,
        t.title,
        t.description,
        t.priority,
        t.column_id,
        t.position,
        t.created_at,
        t.updated_at,
        COALESCE(
          json_agg(tg.name) FILTER (WHERE tg.name IS NOT NULL),
          '[]'
        ) as tags
      FROM tasks t
      LEFT JOIN task_tags tt ON t.id = tt.task_id
      LEFT JOIN tags tg ON tt.tag_id = tg.id
      GROUP BY t.id, t.title, t.description, t.priority, t.column_id, t.position, t.created_at, t.updated_at
      ORDER BY t.position
    `;

    // Build the board state
    const tasks: Record<string, any> = {};
    const columns: Record<string, any> = {};
    const columnOrder: string[] = [];

    // Initialize columns
    for (const col of columnsResult.rows) {
      columns[col.id] = {
        id: col.id,
        title: col.title,
        taskIds: [],
      };
      columnOrder.push(col.id);
    }

    // Process tasks
    for (const task of tasksResult.rows) {
      tasks[task.id] = {
        id: task.id,
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        columnId: task.column_id,
        tags: task.tags,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
      };

      if (columns[task.column_id]) {
        columns[task.column_id].taskIds.push(task.id);
      }
    }

    return res.status(200).json({
      tasks,
      columns,
      columnOrder,
    });
  } catch (error) {
    console.error('Error fetching board:', error);
    return res.status(500).json({ error: 'Failed to fetch board data' });
  }
}
