import { create } from 'zustand';
import { initAuth, setAuthExpiredHandler, clearTokens, getAuthStatus, getMe, logout as apiLogout, type LoginUser } from '../api/client';

interface AuthState {
  user: LoginUser | null;
  authEnabled: boolean | null; // null = unknown (not yet checked)
  loading: boolean;
  init: () => Promise<void>;
  setUser: (user: LoginUser) => void;
  logout: () => Promise<void>;
  setAuthExpired: () => void;
}

let initialized = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  authEnabled: null,
  loading: false,

  init: async () => {
    if (initialized) return;
    initialized = true;
    initAuth();
    setAuthExpiredHandler(() => get().setAuthExpired());
    set({ loading: true });
    try {
      const { authEnabled } = await getAuthStatus();
      if (!authEnabled) {
        set({ user: null, authEnabled: false, loading: false });
        return;
      }
      // Auth is enabled — check if we have a valid token
      try {
        const me = await getMe();
        set({
          user: {
            id: me.userId,
            phone: me.phone,
            email: me.email ?? null,
            isAdmin: me.isAdmin,
            role: me.role,
            nickName: me.nickName ?? '',
            avatar: me.avatar ?? '',
            status: me.status ?? 'normal',
            maxDevices: me.maxDevices ?? 3,
          },
          authEnabled: true,
          loading: false,
        });
      } catch {
        // Token missing or invalid — auth is on but not logged in
        set({ user: null, authEnabled: true, loading: false });
      }
    } catch {
      // Status endpoint failed — assume auth disabled
      set({ user: null, authEnabled: false, loading: false });
    }
  },

  setUser: (user: LoginUser) => set({ user }),

  logout: async () => {
    await apiLogout();
    set({ user: null });
  },

  setAuthExpired: () => {
    set({ user: null });
  },
}));
