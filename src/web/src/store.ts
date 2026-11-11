import { create } from 'zustand';
interface ShellState {
  assistantOpen: boolean;
  sidebarOpen: boolean;
  toggleAssistant: () => void;
  toggleSidebar: () => void;
}
export const useShell = create<ShellState>((set) => ({
  assistantOpen: true,
  sidebarOpen: false,
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
