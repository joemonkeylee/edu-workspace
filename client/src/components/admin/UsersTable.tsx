import { useState, useEffect, useCallback } from 'react';
import { adminGetUsers, adminCreateUser, adminUpdateUser, adminResetPassword, adminDeleteUser, adminGetUserDevices, adminKickDevice } from '../../api/client';
import { toast } from 'sonner';

interface UserRow {
  id: number;
  phone: string;
  email: string | null;
  isAdmin: boolean;
  nickName: string;
  avatar: string;
  status: string;
  maxDevices: number;
  deviceCount: number;
  createdAt: string;
  updatedAt: string;
}

interface DeviceRow {
  id: number;
  deviceInfo: string;
  createdAt: string;
  expiresAt: string;
}

export default function UsersTable() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showDevices, setShowDevices] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetUsers({ page, pageSize, search });
      setUsers(res.users);
      setTotal(res.total);
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, pageSize, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const fetchDevices = useCallback(async (userId: number) => {
    try {
      const res = await adminGetUserDevices(userId);
      setDevices(res.devices);
      setShowDevices(userId);
    } catch { /* ignore */ }
  }, []);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="搜索手机号/邮箱/昵称"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:border-primary"
          />
          <button onClick={fetchUsers} className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">搜索</button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:opacity-90">添加用户</button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-left">手机号</th>
              <th className="px-4 py-3 text-left">邮箱</th>
              <th className="px-4 py-3 text-left">昵称</th>
              <th className="px-4 py-3 text-left">角色</th>
              <th className="px-4 py-3 text-left">状态</th>
              <th className="px-4 py-3 text-left">设备数</th>
              <th className="px-4 py-3 text-left">最大设备</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{u.id}</td>
                <td className="px-4 py-3">{u.phone}</td>
                <td className="px-4 py-3">{u.email || '-'}</td>
                <td className="px-4 py-3">{u.nickName || '-'}</td>
                <td className="px-4 py-3">
                  <span className={u.isAdmin ? 'text-primary font-medium' : 'text-gray-500'}>{u.isAdmin ? '管理员' : '用户'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={u.status === 'disabled' ? 'text-red-600' : 'text-green-600'}>{u.status === 'disabled' ? '禁用' : '正常'}</span>
                </td>
                <td className="px-4 py-3">{u.deviceCount}</td>
                <td className="px-4 py-3">{u.maxDevices}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => fetchDevices(u.id)} className="text-blue-600 hover:underline">设备</button>
                    <EditButton user={u} onUpdated={fetchUsers} />
                    <ResetPasswordButton userId={u.id} />
                    <button onClick={() => { if (confirm('确认删除该用户？')) { adminDeleteUser(u.id).then(() => { toast.success('用户已删除'); fetchUsers(); }).catch((e: any) => toast.error('删除失败: ' + (e?.message || ''))); } }} className="text-red-600 hover:underline">删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">暂无数据</td></tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-sm text-gray-500">共 {total} 条</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border rounded text-sm disabled:opacity-50">上一页</button>
              <span className="px-3 py-1 text-sm">{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border rounded text-sm disabled:opacity-50">下一页</button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={fetchUsers} />}
      {showDevices !== null && (
        <DevicesModal
          userId={showDevices}
          devices={devices}
          onClose={() => setShowDevices(null)}
          onKick={(tokenId) => adminKickDevice(showDevices, tokenId).then(() => fetchDevices(showDevices))}
        />
      )}
    </div>
  );
}

function EditButton({ user, onUpdated }: { user: UserRow; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    phone: user.phone,
    email: user.email || '',
    nickName: user.nickName,
    isAdmin: user.isAdmin,
    status: user.status,
    maxDevices: user.maxDevices,
  });

  if (!editing) {
    return <button onClick={() => setEditing(true)} className="text-blue-600 hover:underline">编辑</button>;
  }

  return (
    <>
      <button onClick={() => setEditing(false)} className="text-gray-500 hover:underline">取消</button>
      <button
        onClick={async () => {
          await adminUpdateUser(user.id, form);
          setEditing(false);
          onUpdated();
        }}
        className="text-green-600 hover:underline"
      >保存</button>
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setEditing(false)}>
        <div className="bg-white rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold mb-4">编辑用户 #{user.id}</h3>
          <div className="space-y-3">
            <Field label="手机号" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label="邮箱" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label="昵称" value={form.nickName} onChange={(v) => setForm({ ...form, nickName: v })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />
              管理员
            </label>
            <div>
              <label className="text-sm text-gray-500">状态</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 border rounded text-sm">
                <option value="normal">正常</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-500">最大设备数</label>
              <input type="number" min={1} max={10} value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: parseInt(e.target.value) || 3 })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <button
              onClick={async () => { await adminUpdateUser(user.id, form); setEditing(false); onUpdated(); }}
              className="w-full py-2 bg-primary text-white rounded text-sm"
            >保存</button>
          </div>
        </div>
      </div>
    </>
  );
}

function ResetPasswordButton({ userId }: { userId: number }) {
  const [show, setShow] = useState(false);
  const [password, setPassword] = useState('');

  return (
    <>
      <button onClick={() => setShow(true)} className="text-orange-600 hover:underline">重置密码</button>
      {show && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShow(false)}>
          <div className="bg-white rounded-lg p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">重置密码</h3>
            <input type="password" placeholder="新密码" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border rounded text-sm mb-3" />
            <button
              onClick={async () => {
                if (!password || password.length < 4) { toast.warning('密码至少4位'); return; }
                try {
                  await adminResetPassword(userId, password);
                  setShow(false);
                  setPassword('');
                  toast.success('密码已重置');
                } catch (e: any) {
                  toast.error('重置失败: ' + (e?.message || ''));
                }
              }}
              className="w-full py-2 bg-primary text-white rounded text-sm"
            >确认重置</button>
          </div>
        </div>
      )}
    </>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ phone: '', password: '', email: '', nickName: '', isAdmin: false, maxDevices: 3 });
  const [error, setError] = useState('');

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">添加用户</h3>
        <div className="space-y-3">
          <Field label="手机号 *" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="密码 *" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" />
          <Field label="邮箱" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="昵称" value={form.nickName} onChange={(v) => setForm({ ...form, nickName: v })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />
            管理员
          </label>
          <div>
            <label className="text-sm text-gray-500">最大设备数</label>
            <input type="number" min={1} max={10} value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: parseInt(e.target.value) || 3 })} className="w-full px-3 py-2 border rounded text-sm" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={async () => {
              try {
                await adminCreateUser(form);
                onCreated();
                onClose();
              } catch (err: any) {
                setError(err.response?.data?.error || 'failed');
              }
            }}
            className="w-full py-2 bg-primary text-white rounded text-sm"
          >创建</button>
        </div>
      </div>
    </div>
  );
}

function DevicesModal({ userId, devices, onClose, onKick }: { userId: number; devices: DeviceRow[]; onClose: () => void; onKick: (tokenId: number) => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">用户 #{userId} 的设备 ({devices.length})</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-medium truncate" style={{ maxWidth: 200 }}>{d.deviceInfo}</p>
                <p className="text-xs text-gray-400">{new Date(d.createdAt).toLocaleString()} - {new Date(d.expiresAt).toLocaleString()}</p>
              </div>
              <button onClick={() => onKick(d.id)} className="text-xs text-red-600 hover:underline">踢下线</button>
            </div>
          ))}
          {devices.length === 0 && <p className="text-center text-gray-400 py-4">暂无在线设备</p>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-sm text-gray-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
    </div>
  );
}
