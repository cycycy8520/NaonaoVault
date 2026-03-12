import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CustomField {
  id: string;
  recordId: string;
  fieldName: string;
  fieldValue?: string;
  fieldType: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedByDeviceId: string;
}

export interface Record {
  id: string;
  categoryId: string;
  name: string;
  address?: string;
  account?: string;
  password?: string;
  key?: string;
  icon?: string;
  color?: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  updatedByDeviceId: string;
  customFields: CustomField[];
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
}

export type ViewMode = 'bento' | 'list' | 'detail' | 'table';

interface AppState {
  isUnlocked: boolean;
  isInitialized: boolean;

  records: Record[];
  categories: Category[];
  selectedCategoryId: string | null;
  selectedRecord: Record | null;
  searchQuery: string;
  searchResults: Record[];

  isLoading: boolean;
  isSidebarCollapsed: boolean;
  isDarkMode: boolean;
  isRecordModalOpen: boolean;
  isDeleteConfirmOpen: boolean;
  isSettingsModalOpen: boolean;
  isSmartCaptureOpen: boolean;
  isAssistantOpen: boolean;
  toastMessage: string | null;
  toastType: 'success' | 'error' | 'info';
  viewMode: ViewMode;

  setUnlocked: (unlocked: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  setRecords: (records: Record[]) => void;
  addRecord: (record: Record) => void;
  updateRecord: (record: Record) => void;
  deleteRecord: (id: string) => void;
  setCategories: (categories: Category[]) => void;
  setSelectedCategory: (categoryId: string | null) => void;
  setSelectedRecord: (record: Record | null) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: Record[]) => void;
  setLoading: (loading: boolean) => void;
  toggleSidebar: () => void;
  toggleDarkMode: () => void;
  openRecordModal: (record?: Record) => void;
  closeRecordModal: () => void;
  openDeleteConfirm: (record: Record) => void;
  closeDeleteConfirm: () => void;
  openSettingsModal: () => void;
  closeSettingsModal: () => void;
  openSmartCapture: () => void;
  closeSmartCapture: () => void;
  openAssistant: () => void;
  closeAssistant: () => void;
  lockApp: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  hideToast: () => void;
  setViewMode: (mode: ViewMode) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      isUnlocked: false,
      isInitialized: false,

      records: [],
      categories: [],
      selectedCategoryId: null,
      selectedRecord: null,
      searchQuery: '',
      searchResults: [],

      isLoading: false,
      isSidebarCollapsed: false,
      isDarkMode: false,
      isRecordModalOpen: false,
      isDeleteConfirmOpen: false,
      isSettingsModalOpen: false,
      isSmartCaptureOpen: false,
      isAssistantOpen: false,
      toastMessage: null,
      toastType: 'info',
      viewMode: 'bento',

      setUnlocked: (isUnlocked) => set({ isUnlocked }),
      setInitialized: (isInitialized) => set({ isInitialized }),
      setRecords: (records) => set({ records }),
      addRecord: (record) => set((state) => ({ records: [record, ...state.records] })),
      updateRecord: (record) => set((state) => ({
        records: state.records.map((item) => (item.id === record.id ? record : item)),
        selectedRecord: state.selectedRecord?.id === record.id ? record : state.selectedRecord,
        searchResults: state.searchResults.map((item) => (item.id === record.id ? record : item)),
      })),
      deleteRecord: (id) => set((state) => ({
        records: state.records.filter((item) => item.id !== id),
        searchResults: state.searchResults.filter((item) => item.id !== id),
        selectedRecord: state.selectedRecord?.id === id ? null : state.selectedRecord,
      })),
      setCategories: (categories) => set({ categories }),
      setSelectedCategory: (categoryId) => set({
        selectedCategoryId: categoryId,
        searchQuery: '',
        searchResults: [],
      }),
      setSelectedRecord: (record) => set({ selectedRecord: record }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSearchResults: (results) => set({ searchResults: results }),
      setLoading: (isLoading) => set({ isLoading }),
      toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
      toggleDarkMode: () => set((state) => {
        const isDarkMode = !state.isDarkMode;
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
        return { isDarkMode };
      }),
      openRecordModal: (record) => set({ isRecordModalOpen: true, selectedRecord: record ?? null }),
      closeRecordModal: () => set({ isRecordModalOpen: false }),
      openDeleteConfirm: (record) => set({ isDeleteConfirmOpen: true, selectedRecord: record }),
      closeDeleteConfirm: () => set({ isDeleteConfirmOpen: false }),
      openSettingsModal: () => set({ isSettingsModalOpen: true }),
      closeSettingsModal: () => set({ isSettingsModalOpen: false }),
      openSmartCapture: () => set({ isSmartCaptureOpen: true }),
      closeSmartCapture: () => set({ isSmartCaptureOpen: false }),
      openAssistant: () => set({ isAssistantOpen: true }),
      closeAssistant: () => set({ isAssistantOpen: false }),
      lockApp: () => set({
        isUnlocked: false,
        records: [],
        selectedRecord: null,
        searchQuery: '',
        searchResults: [],
        isLoading: false,
        isRecordModalOpen: false,
        isDeleteConfirmOpen: false,
        isSettingsModalOpen: false,
        isSmartCaptureOpen: false,
        isAssistantOpen: false,
      }),
      showToast: (toastMessage, toastType = 'info') => set({ toastMessage, toastType }),
      hideToast: () => set({ toastMessage: null }),
      setViewMode: (viewMode) => set({ viewMode }),
    }),
    {
      name: 'secure-vault-storage',
      partialize: (state) => ({
        isDarkMode: state.isDarkMode,
        isSidebarCollapsed: state.isSidebarCollapsed,
        viewMode: state.viewMode,
      }),
    },
  ),
);

export const selectFilteredRecords = (state: AppState): Record[] => {
  if (state.searchQuery) {
    return state.searchResults;
  }
  if (state.selectedCategoryId) {
    return state.records.filter((record) => record.categoryId === state.selectedCategoryId);
  }
  return state.records;
};

export const selectRecordCount = (categoryId: string | null) => (state: AppState): number => {
  if (!categoryId) {
    return state.records.length;
  }
  return state.records.filter((record) => record.categoryId === categoryId).length;
};
