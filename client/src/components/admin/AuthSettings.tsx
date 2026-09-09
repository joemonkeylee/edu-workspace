import { useState, useEffect } from 'react';
import { adminGetAuthSettings, adminUpdateAuthSettings } from '../../api/client';

const FIELDS = [
  { key: 'auth.access_token_expiry', label: 'Access Token 过期时间', hint: '0 = 永不过期，或 1h / 30m / 7d', placeholder: '0' },
  { key: 'auth.refresh_token_expiry', label: 'Refresh Token 过期时间', hint: '如 7d / 30d', placeholder: '7d' },
  { key: 'auth.token_rotation', label: 'Token 轮换 (rotation)', hint: 'true = 换 token 时旧 refresh 作废，false = 共享', placeholder: 'false' },
  { key: 'auth.login_max_attempts', label: '登录失败次数限制', hint: '超过后锁定', placeholder: '5' },
  { key: 'auth.lock_duration', label: '锁定时长', hint: '如 5m / 10m', placeholder: '5m' },
];

export default function AuthSettings() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminGetAuthSettings();
      setForm(data);
    } catch {
      setMessage('加载失败');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      await adminUpdateAuthSettings(form);
      setMessage('保存成功，运行时生效');
    } catch (err: any) {
      setMessage(err.response?.data?.error || '保存失败');
    }
    setSaving(false);
  };

  if (loading) return <div className="p-6 text-gray-400">Loading...</div>;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-base font-semibold text-gray-800">认证设置</h2>
        <p className="mt-1 text-sm text-gray-500">所有配置运行时生效，无需重启服务。总开关 AUTH_ENABLED 在服务端 .env 中配置。</p>

        <div className="mt-5 space-y-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-sm font-medium text-gray-700">{f.label}</label>
              <input
                type="text"
                value={form[f.key] ?? ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-primary"
                placeholder={f.placeholder}
              />
              <p className="mt-0.5 text-xs text-gray-400">{f.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={load}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:border-primary hover:text-primary"
          >
            重置
          </button>
          {message && <span className="text-sm text-primary">{message}</span>}
        </div>
      </div>
    </div>
  );
}
