import type { BoardState } from '../types';

const STORAGE_KEY = 'kanban-board-state';

export const getInitialBoardState = (): BoardState => ({
  tasks: {},
  columns: {
    'column-1': { id: 'column-1', title: 'To Do', taskIds: [] },
    'column-2': { id: 'column-2', title: 'In Progress', taskIds: [] },
    'column-3': { id: 'column-3', title: 'Completed', taskIds: [] },
  },
  columnOrder: ['column-1', 'column-2', 'column-3'],
});

export const loadBoardState = (): BoardState => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Failed to load board state:', error);
  }
  return getInitialBoardState();
};

export const saveBoardState = (state: BoardState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save board state:', error);
  }
};

export const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
