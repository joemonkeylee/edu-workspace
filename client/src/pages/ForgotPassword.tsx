import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCaptcha } from '../api/client';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [captchaKey, setCaptchaKey] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [error, setError] = useState('');

  const refreshCaptcha = useCallback(async () => {
    try {
      const { key, svg } = await getCaptcha();
      setCaptchaKey(key);
      setCaptchaSvg(svg);
      setCaptchaText('');
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshCaptcha(); }, [refreshCaptcha]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!phone || !newPassword || !captchaText) { setError('all fields required'); return; }
    setError('短信功能未开放，请联系管理员重置密码');
    refreshCaptcha();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">找回密码</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="tel" placeholder="手机号" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-primary" autoComplete="tel" />
          <input type="password" placeholder="新密码" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-primary" autoComplete="new-password" />
          <div className="flex gap-2">
            <input type="text" placeholder="图形验证码" value={captchaText} onChange={(e) => setCaptchaText(e.target.value)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-primary" autoComplete="off" />
            <div className="h-11 w-28 border border-gray-300 rounded-lg cursor-pointer flex items-center justify-center bg-gray-50" onClick={refreshCaptcha} dangerouslySetInnerHTML={{ __html: captchaSvg }} />
          </div>
          <div className="flex gap-2">
            <input type="text" placeholder="短信验证码" disabled className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg bg-gray-100 text-gray-400" />
            <button type="button" disabled className="px-4 py-2.5 bg-gray-200 text-gray-500 rounded-lg cursor-not-allowed">发送</button>
          </div>
          <p className="text-xs text-gray-400">短信功能暂未开放，重置密码请联系管理员</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 transition">重置密码</button>
        </form>
        <div className="flex justify-between mt-4 text-sm text-gray-500">
          <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/login')}>返回登录</span>
        </div>
      </div>
    </div>
  );
}
