export type DownloadPhase = "downloading" | "generating" | "zipping" | "uploading";

export type DownloadProgress = {
  progress: number; // 0-100
  phase: DownloadPhase;
  totalImages?: number;
  currentImage?: number;
  totalChunks?: number;
  currentChunk?: number;
};

const progressMap = new Map<string, DownloadProgress>();
const abortMap = new Map<string, AbortController>();

export function setDownloadProgress(
  groupId: string,
  data: DownloadProgress
): void {
  progressMap.set(groupId, data);
}

export function getDownloadProgress(
  groupId: string
): DownloadProgress | null {
  return progressMap.get(groupId) ?? null;
}

export function clearDownloadProgress(groupId: string): void {
  progressMap.delete(groupId);
  abortMap.delete(groupId);
}

export function setAbortController(
  groupId: string,
  controller: AbortController
): void {
  abortMap.set(groupId, controller);
}

export function abortCombine(groupId: string): boolean {
  const controller = abortMap.get(groupId);
  if (controller) {
    controller.abort();
    abortMap.delete(groupId);
    progressMap.delete(groupId);
    return true;
  }
  return false;
}
