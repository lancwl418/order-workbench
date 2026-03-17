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
}
