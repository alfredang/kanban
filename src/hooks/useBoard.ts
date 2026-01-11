import { useCallback } from 'react';
import type { BoardState, Task } from '../types';
import { useLocalStorage } from './useLocalStorage';
import { getInitialBoardState, generateId } from '../utils/storage';

export function useBoard() {
  const [boardState, setBoardState] = useLocalStorage<BoardState>(
    'kanban-board-state',
    getInitialBoardState()
  );

  const addTask = useCallback((
    columnId: string,
    taskData: Omit<Task, 'id' | 'columnId' | 'createdAt' | 'updatedAt'>
  ) => {
    const taskId = generateId();
    const now = new Date().toISOString();
    const newTask: Task = {
      ...taskData,
      id: taskId,
      columnId,
      createdAt: now,
      updatedAt: now,
    };

    setBoardState((prev) => ({
      ...prev,
      tasks: { ...prev.tasks, [taskId]: newTask },
      columns: {
        ...prev.columns,
        [columnId]: {
          ...prev.columns[columnId],
          taskIds: [...prev.columns[columnId].taskIds, taskId],
        },
      },
    }));

    return taskId;
  }, [setBoardState]);

  const updateTask = useCallback((taskId: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>) => {
    setBoardState((prev) => {
      const task = prev.tasks[taskId];
      if (!task) return prev;

      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: {
            ...task,
            ...updates,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  }, [setBoardState]);

  const deleteTask = useCallback((taskId: string) => {
    setBoardState((prev) => {
      const task = prev.tasks[taskId];
      if (!task) return prev;

      const { [taskId]: deletedTask, ...remainingTasks } = prev.tasks;
      const column = prev.columns[task.columnId];

      return {
        ...prev,
        tasks: remainingTasks,
        columns: {
          ...prev.columns,
          [task.columnId]: {
            ...column,
            taskIds: column.taskIds.filter((id) => id !== taskId),
          },
        },
      };
    });
  }, [setBoardState]);

  const moveTask = useCallback((
    taskId: string,
    sourceColumnId: string,
    destinationColumnId: string,
    destinationIndex: number
  ) => {
    setBoardState((prev) => {
      const sourceColumn = prev.columns[sourceColumnId];
      const destColumn = prev.columns[destinationColumnId];

      const sourceTaskIds = [...sourceColumn.taskIds];
      const destTaskIds = sourceColumnId === destinationColumnId
        ? sourceTaskIds
        : [...destColumn.taskIds];

      const sourceIndex = sourceTaskIds.indexOf(taskId);
      if (sourceIndex === -1) return prev;

      sourceTaskIds.splice(sourceIndex, 1);

      if (sourceColumnId === destinationColumnId) {
        sourceTaskIds.splice(destinationIndex, 0, taskId);
      } else {
        destTaskIds.splice(destinationIndex, 0, taskId);
      }

      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: {
            ...prev.tasks[taskId],
            columnId: destinationColumnId,
            updatedAt: new Date().toISOString(),
          },
        },
        columns: {
          ...prev.columns,
          [sourceColumnId]: { ...sourceColumn, taskIds: sourceTaskIds },
          ...(sourceColumnId !== destinationColumnId && {
            [destinationColumnId]: { ...destColumn, taskIds: destTaskIds },
          }),
        },
      };
    });
  }, [setBoardState]);

  return {
    boardState,
    addTask,
    updateTask,
    deleteTask,
    moveTask,
  };
}
