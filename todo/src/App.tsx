import { useState } from 'react';
import type { Todo, TodoStatus, Column } from './types';
import './App.css';

const COLUMNS: Column[] = [
  { id: 'todo', title: '📋 할 일' },
  { id: 'in-progress', title: '🚀 진행 중' },
  { id: 'done', title: '✅ 완료' },
];

const initialTodos: Todo[] = [
  { id: '1', title: '프로젝트 기획', description: '요구사항 분석 및 기획서 작성', status: 'done', createdAt: new Date() },
  { id: '2', title: 'UI 디자인', description: '와이어프레임 및 목업 제작', status: 'in-progress', createdAt: new Date() },
  { id: '3', title: 'API 개발', description: 'REST API 엔드포인트 구현', status: 'todo', createdAt: new Date() },
  { id: '4', title: '테스트 작성', description: '유닛 테스트 및 통합 테스트', status: 'todo', createdAt: new Date() },
];

function App() {
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [draggedTodo, setDraggedTodo] = useState<Todo | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const addTodo = () => {
    if (!newTodoTitle.trim()) return;

    const newTodo: Todo = {
      id: Date.now().toString(),
      title: newTodoTitle.trim(),
      status: 'todo',
      createdAt: new Date(),
    };

    setTodos([...todos, newTodo]);
    setNewTodoTitle('');
  };

  const deleteTodo = (id: string) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

  const handleDragStart = (todo: Todo) => {
    setDraggedTodo(todo);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (status: TodoStatus) => {
    if (!draggedTodo) return;

    setTodos(todos.map(todo =>
      todo.id === draggedTodo.id
        ? { ...todo, status }
        : todo
    ));
    setDraggedTodo(null);
  };

  const getTodosByStatus = (status: TodoStatus) => {
    return todos.filter(todo => todo.status === status);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🗂️ Todo 칸반 보드</h1>
        <div className="add-todo">
          <input
            type="text"
            placeholder="새 할 일 입력..."
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTodo()}
          />
          <button onClick={addTodo}>추가</button>
        </div>
        <button onClick={() => setIsSettingsOpen(true)}>⚙️ 설정</button>
      </header>

      {isSettingsOpen && (
        <div role="dialog">
          <h2>⚙️ 설정</h2>
          <button onClick={() => setIsSettingsOpen(false)}>닫기</button>
        </div>
      )}

      <main className="board">
        {COLUMNS.map(column => (
          <div
            key={column.id}
            className="column"
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(column.id)}
          >
            <h2 className="column-title">
              {column.title}
              <span className="count">{getTodosByStatus(column.id).length}</span>
            </h2>
            <div className="todo-list">
              {getTodosByStatus(column.id).map(todo => (
                <div
                  key={todo.id}
                  className={`todo-card ${draggedTodo?.id === todo.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(todo)}
                >
                  <div className="todo-content">
                    <h3>{todo.title}</h3>
                    {todo.description && <p>{todo.description}</p>}
                  </div>
                  <button
                    className="delete-btn"
                    onClick={() => deleteTodo(todo.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}

export default App;
