import { useCallback, useEffect, useRef, useState } from 'react';
import DeleteConfirm from './components/DeleteConfirm';
import Header from './components/Header';
import InitScreen from './components/InitScreen';
import RecordGrid from './components/RecordGrid';
import RecordModal from './components/RecordModal';
import Sidebar from './components/Sidebar';
import TitleBar from './components/TitleBar';
import Toast from './components/Toast';
import UnlockScreen from './components/UnlockScreen';
import SettingsModal from './components/SettingsModal';
import SmartCaptureModal from './components/SmartCaptureModal';
import AssistantModal from './components/AssistantModal';
import { normalizeRecord, SecuritySettings } from './lib/contracts';
import { selectFilteredRecords, useStore } from './store';

const defaultSecuritySettings: SecuritySettings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
};

function parseNumberSetting(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, numeric);
}

function App() {
  const {
    isUnlocked,
    isInitialized,
    isLoading,
    isDarkMode,
    isRecordModalOpen,
    isDeleteConfirmOpen,
    isSettingsModalOpen,
    isSmartCaptureOpen,
    isAssistantOpen,
    toastMessage,
    toastType,
    selectedCategoryId,
    setUnlocked,
    setInitialized,
    setRecords,
    setCategories,
    setLoading,
    hideToast,
    setSearchResults,
    openRecordModal,
    openSettingsModal,
    showToast,
    lockApp,
  } = useStore();

  const filteredRecords = useStore(selectFilteredRecords);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>(defaultSecuritySettings);
  const autoLockTimerRef = useRef<number | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const dbRecords = await window.api.getRecords();
      setRecords((dbRecords || []).map(normalizeRecord));
    } catch (error) {
      console.error('Failed to load records:', error);
    } finally {
      setLoading(false);
    }
  }, [setLoading, setRecords]);

  useEffect(() => {
    const init = async () => {
      try {
        const [initialized, categories, autoLockMinutes, clipboardClearSeconds] = await Promise.all([
          window.api.getSetting('vaultInitialized'),
          window.api.getCategories(),
          window.api.getSetting('autoLockMinutes'),
          window.api.getSetting('clipboardClearSeconds'),
        ]);
        setInitialized(initialized === 'true' || initialized === true);

        if (isDarkMode) {
          document.documentElement.setAttribute('data-theme', 'dark');
        }

        setCategories(categories || []);
        setSecuritySettings({
          autoLockMinutes: parseNumberSetting(autoLockMinutes, defaultSecuritySettings.autoLockMinutes),
          clipboardClearSeconds: parseNumberSetting(clipboardClearSeconds, defaultSecuritySettings.clipboardClearSeconds),
        });
      } catch (error) {
        console.error('Failed to initialize app:', error);
      }
    };

    init();
  }, [isDarkMode, setCategories, setInitialized]);

  useEffect(() => {
    if (isUnlocked) {
      loadRecords();
    }
  }, [isUnlocked, loadRecords]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const results = await window.api.searchRecords(query, selectedCategoryId || undefined);
      setSearchResults((results || []).map(normalizeRecord));
    } catch (error) {
      console.error('Search failed:', error);
    }
  }, [selectedCategoryId, setSearchResults]);

  const handleLockVault = useCallback(async (message: string = '保险库已锁定') => {
    try {
      const result = await window.api.lockVault();
      if (!result.success) {
        throw new Error(result.error || '锁定失败');
      }
      lockApp();
      showToast(message, 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '锁定失败', 'error');
    }
  }, [lockApp, showToast]);

  const autoLockDelayMs = securitySettings.autoLockMinutes * 60 * 1000;

  useEffect(() => {
    if (!isUnlocked || autoLockDelayMs <= 0) {
      if (autoLockTimerRef.current) {
        window.clearTimeout(autoLockTimerRef.current);
        autoLockTimerRef.current = null;
      }
      return;
    }

    const resetAutoLockTimer = () => {
      if (autoLockTimerRef.current) {
        window.clearTimeout(autoLockTimerRef.current);
      }
      autoLockTimerRef.current = window.setTimeout(() => {
        void handleLockVault(`已因 ${securitySettings.autoLockMinutes} 分钟无操作自动锁定`);
      }, autoLockDelayMs);
    };

    const activityEvents: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    resetAutoLockTimer();
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, resetAutoLockTimer, true);
    }

    return () => {
      if (autoLockTimerRef.current) {
        window.clearTimeout(autoLockTimerRef.current);
        autoLockTimerRef.current = null;
      }
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, resetAutoLockTimer, true);
      }
    };
  }, [autoLockDelayMs, handleLockVault, isUnlocked, securitySettings.autoLockMinutes]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        window.dispatchEvent(new Event('secure-vault:focus-search'));
        return;
      }

      if (key === 'n') {
        event.preventDefault();
        openRecordModal();
        return;
      }

      if (key === 'l') {
        event.preventDefault();
        void handleLockVault();
        return;
      }

      if (key === ',') {
        event.preventDefault();
        openSettingsModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleLockVault, isUnlocked, openRecordModal, openSettingsModal]);

  let content;
  if (!isInitialized) {
    content = <InitScreen onInit={() => setInitialized(true)} />;
  } else if (!isUnlocked) {
    content = <UnlockScreen onUnlock={() => setUnlocked(true)} />;
  } else {
    content = (
      <div className="app-container">
        <TitleBar />
        <div className="main-content">
          <Sidebar />
          <div className="content-area">
            <Header onSearch={handleSearch} onLockVault={() => void handleLockVault()} />
            <main className="record-area">
              {isLoading ? (
                <div className="loading-state h-full flex items-center justify-center flex-col gap-3">
                  <div className="loading-spinner" />
                  <p>加载中...</p>
                </div>
              ) : (
                <RecordGrid records={filteredRecords} />
              )}
            </main>
          </div>
        </div>

        {isRecordModalOpen ? <RecordModal /> : null}
        {isDeleteConfirmOpen ? <DeleteConfirm /> : null}
        {isSettingsModalOpen ? (
          <SettingsModal
            onDataChanged={loadRecords}
            onSecuritySettingsChanged={setSecuritySettings}
          />
        ) : null}
        {isSmartCaptureOpen ? <SmartCaptureModal /> : null}
        {isAssistantOpen ? <AssistantModal /> : null}
      </div>
    );
  }

  return (
    <>
      {content}
      {toastMessage ? <Toast message={toastMessage} type={toastType} onClose={hideToast} /> : null}
    </>
  );
}

export default App;
