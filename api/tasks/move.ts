import { createPool } from '@vercel/postgres';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') {
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
    const { taskId, sourceColumnId, destinationColumnId, destinationIndex } = req.body;

    if (!taskId || !sourceColumnId || !destinationColumnId || destinationIndex === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const now = new Date().toISOString();

    // Get current task position
    const taskResult = await pool.sql`
      SELECT position FROM tasks WHERE id = ${taskId}
    `;

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const currentPosition = taskResult.rows[0].position;

    if (sourceColumnId === destinationColumnId) {
      // Moving within the same column
      if (destinationIndex > currentPosition) {
        // Moving down
        await pool.sql`
          UPDATE tasks
          SET position = position - 1
          WHERE column_id = ${sourceColumnId}
            AND position > ${currentPosition}
            AND position <= ${destinationIndex}
        `;
      } else if (destinationIndex < currentPosition) {
        // Moving up
        await pool.sql`
          UPDATE tasks
          SET position = position + 1
          WHERE column_id = ${sourceColumnId}
            AND position >= ${destinationIndex}
            AND position < ${currentPosition}
        `;
      }

      // Update task position
      await pool.sql`
        UPDATE tasks
        SET position = ${destinationIndex}, updated_at = ${now}
        WHERE id = ${taskId}
      `;
    } else {
      // Moving to a different column
      // Decrease positions in source column
      await pool.sql`
        UPDATE tasks
        SET position = position - 1
        WHERE column_id = ${sourceColumnId}
          AND position > ${currentPosition}
      `;

      // Increase positions in destination column
      await pool.sql`
        UPDATE tasks
        SET position = position + 1
        WHERE column_id = ${destinationColumnId}
          AND position >= ${destinationIndex}
      `;

      // Move task to new column
      await pool.sql`
        UPDATE tasks
        SET column_id = ${destinationColumnId}, position = ${destinationIndex}, updated_at = ${now}
        WHERE id = ${taskId}
      `;
    }

    return res.status(200).json({ message: 'Task moved successfully' });
  } catch (error) {
    console.error('Error moving task:', error);
    return res.status(500).json({ error: 'Failed to move task' });
  }
}
