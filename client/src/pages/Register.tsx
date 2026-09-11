import { useNavigate } from 'react-router-dom';

export default function Register() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-md p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">注册</h1>
        <p className="text-gray-500 mb-2">暂未开放公开注册。</p>
        <p className="text-gray-500 mb-6">如需账号，请联系管理员创建。</p>
        <button
          onClick={() => navigate('/login')}
          className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 transition"
        >
          返回登录
        </button>
      </div>
    </div>
  );
}
