import { AttachmentRef, Profile } from "./shared";
import { emptyProfile } from "./rules";
import { validateProfile } from './protocol';

const PROFILE_KEY = "profile";
const DATABASE = "hanu-hsk-autofill";
const STORE = "attachments";

export async function getProfile(): Promise<Profile> {
  const result = await chrome.storage.local.get(PROFILE_KEY);
  const stored = result[PROFILE_KEY] as Profile | undefined;
  if (!stored) return emptyProfile();
  const defaults = emptyProfile();
  return {
    ...defaults,
    ...stored,
    values: { ...defaults.values, ...stored.values },
    attachments: { ...stored.attachments },
    mappings: { ...stored.mappings },
    customFields: stored.customFields ?? []
  };
}

export async function saveProfile(profile: Profile): Promise<void> {
  validateProfile(profile);
  const result = await chrome.storage.local.get('profileRevision');
  await chrome.storage.local.set({ [PROFILE_KEY]: profile, profileRevision: Number(result.profileRevision ?? 0) + 1 });
}

export async function getProfileRevision(): Promise<number> {
  return Number((await chrome.storage.local.get('profileRevision')).profileRevision ?? 0);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    let value: T;
    request.onsuccess = () => { value = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { database.close(); resolve(value); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Ghi ảnh đã bị hủy.')); };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveAttachment(id: string, blob: Blob): Promise<void> {
  await withStore("readwrite", (store) => store.put(blob, id));
}

export async function getAttachment(id: string): Promise<Blob | undefined> {
  return withStore("readonly", (store) => store.get(id));
}

export async function clearAttachments(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
}

export async function deleteAttachment(id: string): Promise<void> {
  await withStore('readwrite', store => store.delete(id));
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const [header, payload] = dataUrl.split(",", 2);
  const mime = header.match(/data:(.*?);base64/)?.[1] ?? "application/octet-stream";
  const binary = atob(payload ?? "");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export function attachmentReference(id: string, name: string, type: string, size: number): AttachmentRef {
  return { id, name, type, size, updatedAt: new Date().toISOString() };
}
