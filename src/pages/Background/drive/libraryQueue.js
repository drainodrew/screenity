import libraryConfig from "screenity-library-config";

const QUEUE_KEY = "jevLibraryQueue";
let processing = false;
let queueWrites = Promise.resolve();

// Storage has no atomic read/modify/write. Serialize arrivals and completions
// so a finished job cannot erase a recording uploaded at the same time.
function updateQueue(change) {
  const write = queueWrites.catch(() => {}).then(async () => {
    const state = await chrome.storage.local.get(QUEUE_KEY);
    const queue = state[QUEUE_KEY] || {};
    change(queue);
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  });
  queueWrites = write;
  return write;
}

export async function enqueueLibraryRecording(fileId, title) {
  if (!libraryConfig.enabled) return;
  await updateQueue((queue) => {
    queue[fileId] = { fileId, title, queuedAt: Date.now() };
  });
  // Once Drive has saved the recording, classifier availability must not turn
  // a successful upload into a failed upload or risk losing the recording.
  void drainLibraryQueue();
}

export async function drainLibraryQueue() {
  if (!libraryConfig.enabled || processing) return;
  processing = true;
  try {
    const auth = await chrome.identity.getAuthToken({ interactive: false });
    const accessToken = typeof auth === "string" ? auth : auth?.token;
    if (!accessToken) return;
    const state = await chrome.storage.local.get(QUEUE_KEY);
    for (const item of Object.values(state[QUEUE_KEY] || {})) {
      try {
        const response = await chrome.runtime.sendNativeMessage(
          libraryConfig.nativeHost,
          {
            action: "enqueue",
            file_id: item.fileId,
            title: item.title,
            root_folder_id: libraryConfig.rootFolderId,
            access_token: accessToken,
          },
        );
        if (response?.status === "complete") {
          await updateQueue((queue) => { delete queue[item.fileId]; });
        } else if (response?.status === "error") {
          console.warn("[Jev library] Recording remains in queue:", item.fileId);
        }
      } catch {
        console.warn("[Jev library] Native worker unavailable; recording remains safely in Inbox.");
      }
    }
  } catch {
    // Fresh account consent may be required. The user's videos remain in Drive.
  } finally {
    processing = false;
  }
}

export function initializeLibraryQueue() {
  if (!libraryConfig.enabled) return;
  chrome.runtime.onStartup.addListener(() => void drainLibraryQueue());
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "jev-library-retry") void drainLibraryQueue();
  });
  chrome.alarms.create("jev-library-retry", { periodInMinutes: 2 });
  void drainLibraryQueue();
}
