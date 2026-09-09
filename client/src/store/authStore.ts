import { create } from 'zustand';
import { initAuth, setAuthExpiredHandler, clearTokens, getMe, logout as apiLogout, type LoginUser } from '../api/client';

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
      const me = await getMe();
      set({
        user: {
          id: me.userId,
          phone: me.phone,
          email: null,
          isAdmin: me.isAdmin,
          nickName: '',
          avatar: '',
          status: 'normal',
          maxDevices: 3,
        },
        authEnabled: true,
        loading: false,
      });
    } catch {
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
