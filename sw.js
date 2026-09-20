/* iomma 서비스 워커 — 마감 임박 알림 표시 + 알림 탭 처리
   index 파일과 같은 폴더에 두세요. */

const DB_NAME = 'iomma-sw';
const STORE = 'kv';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function kvGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const q = db.transaction(STORE).objectStore(STORE).get(key);
        q.onsuccess = () => { db.close(); resolve(q.result); };
        q.onerror = () => { db.close(); reject(q.error); };
    });
}
async function kvSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysLeft(str) {
    const p = String(str || '').split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return NaN;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((new Date(p[0], p[1] - 1, p[2]) - today) / 86400000);
}
function fill(tpl, name, n) {
    return String(tpl || '').replace('{name}', () => name).replace('{n}', () => n);
}

// 앱이 저장해 둔 재료 목록을 읽어, 오늘 알림을 아직 안 보냈다면 한 번 보낸다.
async function checkAndNotify() {
    const state = await kvGet('state');
    if (!state || !state.enabled) return;

    const today = todayStr();
    if ((await kvGet('lastNotified')) === today) return;

    const alerts = (state.items || [])
        .map(i => ({ name: i.name, d: daysLeft(i.expiryDate) }))
        .filter(a => isFinite(a.d) && a.d <= state.days)
        .sort((a, b) => a.d - b.d);
    if (!alerts.length) return;

    const m = state.msgs || {};
    const lines = alerts.slice(0, 5).map(a =>
        fill(a.d < 0 ? m.msgExpired : (a.d === 0 ? m.msgToday : m.msgSoon), a.name, Math.abs(a.d))
    );
    if (alerts.length > 5) lines.push(fill(m.msgMore, '', alerts.length - 5));

    await self.registration.showNotification(`${m.pushTitle || 'iomma'} (${alerts.length})`, {
        body: lines.join('\n'),
        tag: 'iomma-expiry',
        data: { url: './' }
    });
    await kvSet('lastNotified', today);
}

// Chrome이 허용하는 환경에서, 앱을 닫아 둔 동안 주기적으로 호출됨(시각은 브라우저가 결정)
self.addEventListener('periodicsync', e => {
    if (e.tag === 'iomma-expiry-check') e.waitUntil(checkAndNotify());
});

// 알림을 탭하면 앱을 앞으로 가져오거나 새로 연다
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const url = (e.notification.data && e.notification.data.url) || './';
    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const c of list) { if ('focus' in c) return c.focus(); }
            return self.clients.openWindow(url);
        })
    );
});
