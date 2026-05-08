import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LocalNotification {
  id: string;
  title: string;
  body: string;
  icon?: string;
  receivedAt: string;
  read: boolean;
  type: 'renewal' | 'entry' | 'payment' | 'promotion' | 'system';
}

interface NotifState {
  notifications: LocalNotification[];
  unreadCount: number;
  addNotification: (n: Omit<LocalNotification, 'id' | 'receivedAt' | 'read'>) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  clear: () => void;
}

export const useNotifStore = create<NotifState>()(
  persist(
    (set, get) => ({
      notifications: [],
      unreadCount: 0,

      addNotification: (n) => {
        const item: LocalNotification = {
          ...n,
          id:         Math.random().toString(36).slice(2),
          receivedAt: new Date().toISOString(),
          read:       false,
        };
        set((s) => ({
          notifications: [item, ...s.notifications].slice(0, 50),
          unreadCount:   s.unreadCount + 1,
        }));
      },

      markRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) => n.id === id ? { ...n, read: true } : n),
          unreadCount: Math.max(0, s.unreadCount - (s.notifications.find(n => n.id === id)?.read ? 0 : 1)),
        })),

      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        })),

      clear: () => set({ notifications: [], unreadCount: 0 }),
    }),
    {
      name: 'edge-gym-notifications',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
