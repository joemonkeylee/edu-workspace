import { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button"
import { adminGetUsers, adminCreateUser, adminUpdateUser, adminResetPassword, adminDeleteUser, adminGetUserDevices, adminKickDevice } from '../../api/client';
import { toast } from 'sonner';
import { useConfirm } from '../ConfirmDialog';

interface UserRow {
  id: number;
  phone: string;
  email: string | null;
  isAdmin: boolean;
  role: string;
  roles: string[];
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
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showDevices, setShowDevices] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetUsers({ page, pageSize, search, role: roleFilter });
      setUsers(res.data);
      setTotal(res.total);
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, pageSize, search, roleFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const fetchDevices = useCallback(async (userId: number) => {
    try {
      const devices = await adminGetUserDevices(userId);
      setDevices(devices);
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
            className="px-3 py-2 border border-input rounded-lg text-sm w-64 focus:outline-none focus:border-primary"
          />
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:border-primary bg-background"
          >
            <option value="all">全部角色</option>
            <option value="student">学生</option>
            <option value="teacher">教师</option>
            <option value="admin">管理员</option>
          </select>
          <Button onClick={fetchUsers}  variant="secondary" size="sm">搜索</Button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90">添加用户</button>
        </div>
      </div>

      <div className="bg-background rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-foreground/70">
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
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-muted/50">
                <td className="px-4 py-3">{u.id}</td>
                <td className="px-4 py-3">{u.phone}</td>
                <td className="px-4 py-3">{u.email || '-'}</td>
                <td className="px-4 py-3">{u.nickName || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role]).map((r) => (
                      <span key={r} className={
                        r === 'admin' ? 'px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium' :
                        r === 'teacher' ? 'px-1.5 py-0.5 text-xs rounded bg-teal-50 dark:bg-teal-950/50 dark:border dark:border-teal-800 text-teal-600 dark:text-teal-400 font-medium' :
                        'px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground'
                      }>
                        {r === 'admin' ? '管理员' : r === 'teacher' ? '教师' : '学生'}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={u.status === 'disabled' ? 'text-destructive' : 'text-green-600 dark:text-green-400 dark:text-green-400'}>{u.status === 'disabled' ? '禁用' : '正常'}</span>
                </td>
                <td className="px-4 py-3">{u.deviceCount}</td>
                <td className="px-4 py-3">{u.maxDevices}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => fetchDevices(u.id)} className="text-primary hover:underline">设备</button>
                    <EditButton user={u} onUpdated={fetchUsers} />
                    <ResetPasswordButton userId={u.id} />
                    <button onClick={async () => {
                      const confirmed = await confirm({
                        title: '确认删除',
                        message: '确认删除该用户？',
                        confirmText: '确认删除',
                        confirmClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                      });
                      if (confirmed) {
                        adminDeleteUser(u.id).then(() => { toast.success('用户已删除'); fetchUsers(); }).catch((e: any) => toast.error('删除失败: ' + (e?.message || '')));
                      }
                    }} className="text-destructive hover:underline">删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">暂无数据</td></tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-sm text-muted-foreground">共 {total} 条</span>
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
    roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role || (user.isAdmin ? 'admin' : 'student')],
    status: user.status,
    maxDevices: user.maxDevices,
  });
  const toggleRole = (r: string) => {
    setForm((f) => {
      const has = f.roles.includes(r);
      const next = has ? f.roles.filter((x) => x !== r) : [...f.roles, r];
      return { ...f, roles: next.length > 0 ? next : ['student'] };
    });
  };

  if (!editing) {
    return <button onClick={() => setEditing(true)} className="text-primary hover:underline">编辑</button>;
  }

  return (
    <>
      <button onClick={() => setEditing(false)} className="text-muted-foreground hover:underline">取消</button>
      <button
        onClick={async () => {
          try {
            await adminUpdateUser(user.id, { ...form, isAdmin: form.roles.includes('admin') });
            toast.success('用户已更新');
            setEditing(false);
            onUpdated();
          } catch (e: any) {
            toast.error('更新失败: ' + (e?.message || ''));
          }
        }}
        className="text-green-600 dark:text-green-400 dark:text-green-400 hover:underline"
      >保存</button>
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setEditing(false)}>
        <div className="bg-background rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold mb-4">编辑用户 #{user.id}</h3>
          <div className="space-y-3">
            <Field label="手机号" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label="邮箱" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label="昵称" value={form.nickName} onChange={(v) => setForm({ ...form, nickName: v })} />
            <div>
              <label className="text-sm text-muted-foreground">角色（可多选）</label>
              <div className="flex gap-3 mt-1">
                {(['admin', 'teacher', 'student'] as const).map((r) => (
                  <label key={r} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.roles.includes(r)}
                      onChange={() => toggleRole(r)}
                      className="rounded"
                    />
                    {r === 'admin' ? '管理员' : r === 'teacher' ? '教师' : '学生'}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">状态</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <option value="normal">正常</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">最大设备数</label>
              <input type="number" min={1} max={10} value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: parseInt(e.target.value) || 3 })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <button
              onClick={async () => {
                try {
                  await adminUpdateUser(user.id, { ...form, isAdmin: form.roles.includes('admin') });
                  toast.success('用户已更新');
                  setEditing(false);
                  onUpdated();
                } catch (e: any) {
                  toast.error('更新失败: ' + (e?.message || ''));
                }
              }}
              className="w-full py-2 bg-primary text-primary-foreground rounded text-sm"
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
      <button onClick={() => setShow(true)} className="text-orange-600 dark:text-orange-400 hover:underline">重置密码</button>
      {show && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShow(false)}>
          <div className="bg-background rounded-lg p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">重置密码</h3>
            <input type="password" placeholder="新密码" value={password} onChange={(e) => setPassword(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mb-3" />
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
              className="w-full py-2 bg-primary text-primary-foreground rounded text-sm"
            >确认重置</button>
          </div>
        </div>
      )}
    </>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ phone: '', password: '', email: '', nickName: '', roles: ['student'] as string[], maxDevices: 3 });
  const [error, setError] = useState('');
  const toggleRole = (r: string) => {
    setForm((f) => {
      const has = f.roles.includes(r);
      const next = has ? f.roles.filter((x) => x !== r) : [...f.roles, r];
      return { ...f, roles: next.length > 0 ? next : ['student'] };
    });
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">添加用户</h3>
        <div className="space-y-3">
          <Field label="手机号 *" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="密码 *" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" />
          <Field label="邮箱" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="昵称" value={form.nickName} onChange={(v) => setForm({ ...form, nickName: v })} />
          <div>
            <label className="text-sm text-muted-foreground">角色（可多选）</label>
            <div className="flex gap-3 mt-1">
              {(['admin', 'teacher', 'student'] as const).map((r) => (
                <label key={r} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(r)}
                    onChange={() => toggleRole(r)}
                    className="rounded"
                  />
                  {r === 'admin' ? '管理员' : r === 'teacher' ? '教师' : '学生'}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">最大设备数</label>
            <input type="number" min={1} max={10} value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: parseInt(e.target.value) || 3 })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={async () => {
              try {
                await adminCreateUser({ ...form, isAdmin: form.roles.includes('admin') } as any);
                toast.success('用户已创建');
                onCreated();
                onClose();
              } catch (err: any) {
                setError(err.response?.data?.error || '创建失败');
              }
            }}
            className="w-full py-2 bg-primary text-primary-foreground rounded text-sm"
          >创建</button>
        </div>
      </div>
    </div>
  );
}

function DevicesModal({ userId, devices, onClose, onKick }: { userId: number; devices: DeviceRow[]; onClose: () => void; onKick: (tokenId: number) => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">用户 #{userId} 的设备 ({devices.length})</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-medium truncate" style={{ maxWidth: 200 }}>{d.deviceInfo}</p>
                <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleString()} - {new Date(d.expiresAt).toLocaleString()}</p>
              </div>
              <button onClick={() => onKick(d.id)} className="text-xs text-destructive hover:underline">踢下线</button>
            </div>
          ))}
          {devices.length === 0 && <p className="text-center text-muted-foreground py-4">暂无在线设备</p>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-sm text-muted-foreground">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
    </div>
  );
}
