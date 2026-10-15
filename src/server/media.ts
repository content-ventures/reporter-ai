import "server-only";
import { spawn } from "node:child_process";
import { z } from "zod";
import { MAX_DURATION_SECONDS } from "../domain/reporter";
import { FlowError } from "./errors";
import { mediaExecutable } from './worker-media.ts';

function inputProtocols(source: string, remote: boolean) {
  const formats = ['-format_whitelist', 'mov,mp3,wav,flac,ogg,matroska,webm'];
  if (!remote) return [...formats, '-protocol_whitelist', 'file,pipe'];
  const url = new URL(source);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw new FlowError('SOURCE_UNAVAILABLE', 422);
  return [...formats, '-protocol_whitelist', 'http,tcp', '-rw_timeout', '30000000'];
}

export async function checkMediaTools() {
  await Promise.all((['ffmpeg', 'ffprobe'] as const).map(async tool => runMedia(await mediaExecutable(tool), ['-version'])));
}

export async function runMedia(executable: string, args: string[], signal?: AbortSignal, timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, signal, stdio: ["ignore", "pipe", "ignore"] });
    let output = "", oversized = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", data => {
      if (output.length + data.length > 1024 * 1024) { oversized = true; child.kill("SIGKILL"); }
      else output += data.toString();
    });
    child.once("error", () => { clearTimeout(timer); reject(new FlowError("MEDIA_TOOL_UNAVAILABLE", 503)); });
    child.once("close", code => {
      clearTimeout(timer);
      if (signal?.aborted) reject(new FlowError("JOB_INTERRUPTED", 503, true));
      else if (code !== 0 || oversized) reject(new FlowError("INVALID_MEDIA", 415));
      else resolve(output);
    });
  });
}

export async function inspectMedia(path: string, signal?: AbortSignal, remote = false) {
  const output = await runMedia(await mediaExecutable('ffprobe'),
    ["-v", "error", ...inputProtocols(path, remote), "-show_format", "-show_streams", "-of", "json", path], signal);
  const parsed = z.object({
    format: z.object({ format_name: z.string(), duration: z.string() }),
    streams: z.array(z.object({ codec_type: z.string() })),
  }).safeParse(JSON.parse(output));
  if (!parsed.success || !parsed.data.streams.some(stream => stream.codec_type === "audio")) throw new FlowError("NO_AUDIO_TRACK", 415);
  const duration = Number(parsed.data.format.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) throw new FlowError("MEDIA_DURATION", 422);
  const format = parsed.data.format.format_name;
  const video = parsed.data.streams.some(stream => stream.codec_type === "video");
  const contentType = format.includes("mp3") ? "audio/mpeg" : format.includes("wav") ? "audio/wav" :
    format.includes("flac") ? "audio/flac" : format.includes("ogg") ? "audio/ogg" :
    format.includes("mp4") ? (video ? "video/mp4" : "audio/mp4") :
    format.includes("webm") ? (video ? "video/webm" : "audio/webm") : null;
  if (!contentType) throw new FlowError("UNSUPPORTED_MEDIA", 415);
  return { duration, contentType };
}

export async function prepareChunk(source: string, destination: string, start: number, duration: number, signal: AbortSignal, remote = false) {
  await runMedia(await mediaExecutable('ffmpeg'), [
    "-nostdin", "-v", "error", ...inputProtocols(source, remote), "-ss", String(start), "-i", source,
    "-t", String(duration), "-map", "0:a:0", "-vn", "-ar", "16000", "-ac", "1", "-c:a", "flac", "-y", destination,
  ], signal, 180000);
}
