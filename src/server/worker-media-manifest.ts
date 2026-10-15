// Neon runs Linux ARM64. Keep large executables in private Object Storage so
// the JavaScript function stays within Neon's 10 MiB compressed bundle limit.
export const WORKER_MEDIA_BUCKET = 'reporter-source-media';
export const WORKER_MEDIA = {
  ffmpeg: {
    archive: 'https://registry.npmjs.org/@ffmpeg-installer/linux-arm64/-/linux-arm64-4.1.4.tgz',
    integrity: 'dljEqAOD0oIM6O6DxBW9US/FkvqvQwgJ2lGHOwHDDwu/pX8+V0YsDL1xqHbj1DMX/+nP9rxw7G7gcUvGspSoKg==',
    sha256: '115a825e246078acf820ea2afcaf1b3ff87f1b93f7035ecad38d3223cca55297',
    size: 32808336,
  },
  ffprobe: {
    archive: 'https://registry.npmjs.org/@ffprobe-installer/linux-arm64/-/linux-arm64-5.2.0.tgz',
    integrity: 'X1VvWtlLs6ScP73biVLuHD5ohKJKsMTa0vafCESOen4mOoNeLAYbxOVxDWAdFz9cpZgRiloFj5QD6nDj8E28yQ==',
    sha256: '9b63a1715f87c0c476dacf237a4adcb0bf26de29854b137dae4e79f69a98b624',
    size: 50245776,
  },
} as const;
export type MediaTool = keyof typeof WORKER_MEDIA;
export function workerMediaKey(tool: MediaTool) { return `worker-tools/${WORKER_MEDIA[tool].sha256}/${tool}`; }
