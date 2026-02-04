export interface Todo {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done';
  createdAt: Date;
}

export type TodoStatus = Todo['status'];

export interface Column {
  id: TodoStatus;
  title: string;
}
