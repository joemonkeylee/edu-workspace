import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCaptcha, login } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function Login() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [captchaKey, setCaptchaKey] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refreshCaptcha = useCallback(async () => {
    try {
      const { key, svg } = await getCaptcha();
      setCaptchaKey(key);
      setCaptchaSvg(svg);
      setCaptchaText('');
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshCaptcha(); }, [refreshCaptcha]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!/^\d{11}$/.test(phone)) {
      setError('请输入 11 位手机号');
      return;
    }
    if (!password || password.length < 4) {
      setError('密码至少 4 位');
      return;
    }
    if (!captchaText.trim()) {
      setError('请输入验证码');
      return;
    }

    setLoading(true);
    try {
      const { user } = await login(phone, password, captchaKey, captchaText);
      setUser(user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || '登录失败，请重试');
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">登录</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="tel"
            placeholder="手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-primary"
            autoComplete="tel"
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-primary"
            autoComplete="current-password"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="验证码"
              value={captchaText}
              onChange={(e) => setCaptchaText(e.target.value)}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-primary"
              autoComplete="off"
            />
            <div
              className="h-11 w-28 border border-gray-300 rounded-lg cursor-pointer flex items-center justify-center bg-gray-50"
              onClick={refreshCaptcha}
              dangerouslySetInnerHTML={{ __html: captchaSvg }}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        <div className="flex justify-between mt-4 text-sm text-gray-500">
          <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/register')}>注册</span>
          <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/forgot-password')}>忘记密码</span>
        </div>
      </div>
    </div>
  );
}
