import { Layout } from 'lucide-react';
import { Board } from './components/Board';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3">
            <Layout className="text-blue-600" size={28} />
            <h1 className="text-xl font-bold text-gray-900">Kanban Board</h1>
          </div>
        </div>
      </header>

      <main>
        <Board />
      </main>
    </div>
  );
}

export default App;
