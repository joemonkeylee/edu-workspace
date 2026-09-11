import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
        <p className="text-gray-500 mb-6">页面不存在</p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 transition"
        >
          返回首页
        </button>
      </div>
    </div>
  );
}
