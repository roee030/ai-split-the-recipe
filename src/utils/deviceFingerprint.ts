const STORAGE_KEY = 'splitsnap_device_id';

function generateFingerprint(): string {
  const components = [
    screen.width,
    screen.height,
    screen.colorDepth,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency ?? 0,
    (navigator.languages ?? []).join(','),
  ];

  // Canvas fingerprint
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('SplitSnap🧾', 2, 2);
      components.push(canvas.toDataURL().slice(-50));
    }
  } catch {
    // canvas blocked — fine, use other signals
  }

  // Simple hash
  const str = components.join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function getDeviceId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = generateFingerprint() + '_' + Date.now().toString(36);
    localStorage.setItem(STORAGE_KEY, id);
    persistToIndexedDB(id);
  }
  return id;
}

function persistToIndexedDB(id: string) {
  try {
    const req = indexedDB.open('splitsnap', 1);
    req.onupgradeneeded = (e) => {
      (e.target as IDBOpenDBRequest).result.createObjectStore('meta');
    };
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      db.transaction('meta', 'readwrite').objectStore('meta').put(id, 'deviceId');
    };
  } catch {
    // IndexedDB not available — localStorage only is fine
  }
}
