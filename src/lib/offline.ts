import type { PendingScore } from './pending-scores';
import type { TournamentDetail } from './types';

/**
 * The offline queue: scores are written here first and sent second, so a save
 * survives a dead connection, a locked phone or a closed tab. Browser-only —
 * every function here is called from client components.
 */
const DB_NAME = 'padel-offline';
const DB_VERSION = 1;
const STORE = 'pending-scores';

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Used when IndexedDB is unavailable (private mode, storage blocked). The queue
 * then lives only as long as the tab does — still better than losing a score
 * the moment the connection drops.
 */
let memory: PendingScore[] = [];

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      // Keyed by match: entering a score twice replaces the queued one instead
      // of sending both.
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'matchId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function request<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = body(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readAll(): Promise<PendingScore[]> {
  const db = await openDb();
  if (!db) return [...memory];
  try {
    return await request<PendingScore[]>(db, 'readonly', (store) => store.getAll());
  } catch {
    return [...memory];
  }
}

async function put(entry: PendingScore): Promise<void> {
  memory = [...memory.filter((e) => e.matchId !== entry.matchId), entry];
  const db = await openDb();
  if (!db) return;
  try {
    await request(db, 'readwrite', (store) => store.put(entry));
  } catch {
    // The memory copy above is the fallback.
  }
}

async function drop(matchId: string): Promise<void> {
  memory = memory.filter((e) => e.matchId !== matchId);
  const db = await openDb();
  if (!db) return;
  try {
    await request(db, 'readwrite', (store) => store.delete(matchId));
  } catch {
    // Already gone as far as the caller is concerned.
  }
}

/** Queued scores for one tournament, oldest first. */
export async function readQueue(tournamentId: string): Promise<PendingScore[]> {
  const all = await readAll();
  return all
    .filter((entry) => entry.tournamentId === tournamentId)
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function queueScore(entry: PendingScore): Promise<void> {
  await put(entry);
}

export interface FlushResult {
  /** Fresh server state, if the server accepted anything for this tournament. */
  tournament: TournamentDetail | null;
  /** What is still queued for this tournament afterwards. */
  pending: PendingScore[];
  /** The network is gone — worth saying so rather than showing an error. */
  offline: boolean;
  /** Scores the server refused. They are dropped, not retried. */
  errors: string[];
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Sends everything queued, oldest first, and reports what is left. Calls are
 * serialised: saving three matches in a row must not race three flushes
 * against each other over the same entries.
 */
export function flushQueue(tournamentId: string): Promise<FlushResult> {
  const next = chain.then(
    () => sendAll(tournamentId),
    () => sendAll(tournamentId),
  );
  chain = next.catch(() => {});
  return next;
}

async function sendAll(tournamentId: string): Promise<FlushResult> {
  const queued = (await readAll()).sort((a, b) => a.queuedAt - b.queuedAt);
  let tournament: TournamentDetail | null = null;
  let offline = false;
  const errors: string[] = [];

  for (const entry of queued) {
    let response: Response;
    try {
      response = await fetch(`/api/tournaments/${entry.tournamentId}/matches/${entry.matchId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score1: entry.score1, score2: entry.score2 }),
      });
    } catch {
      // No connection: the rest of the queue would fail the same way.
      offline = true;
      break;
    }

    const data: { tournament?: TournamentDetail; error?: string } = await response
      .json()
      .catch(() => ({}));

    if (response.ok) {
      await drop(entry.matchId);
      if (entry.tournamentId === tournamentId && data.tournament) tournament = data.tournament;
      continue;
    }

    // A dropped session may come back, a 500 may pass next time — both stay
    // queued, and the rest of the queue waits with them.
    if (response.status === 401 || response.status >= 500) {
      errors.push(data.error ?? 'Не удалось отправить счёт — попробуем позже');
      break;
    }

    // Anything else the server will refuse forever. Keeping it would block
    // every score behind it, so it is dropped and reported.
    await drop(entry.matchId);
    errors.push(data.error ?? 'Сервер отклонил счёт');
  }

  return { tournament, pending: await readQueue(tournamentId), offline, errors };
}

/**
 * Called on logout: the queue and the cached pages belong to the account that
 * is leaving. The service worker keeps its shell — nothing in it is personal.
 */
export async function purgeOfflineData(): Promise<void> {
  memory = [];

  const db = await openDb();
  if (db) {
    try {
      await request(db, 'readwrite', (store) => store.clear());
    } catch {
      // Nothing else to do — the score is gone with the session anyway.
    }
  }

  navigator.serviceWorker?.controller?.postMessage('purge-pages');
}
