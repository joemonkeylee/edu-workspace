import { useNavigate } from 'react-router-dom';

export default function ForgotPassword() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm bg-card border border-border rounded-lg shadow-md p-8 text-center">
        <h1 className="text-2xl font-bold text-foreground mb-4">找回密码</h1>
        <p className="text-muted-foreground mb-2">暂未开放自助找回密码。</p>
        <p className="text-muted-foreground mb-6">如需重置密码，请联系管理员。</p>
        <button
          onClick={() => navigate('/login')}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition"
        >
          返回登录
        </button>
      </div>
    </div>
  );
}
