// Builds the demo video from a recording by demo/record.spec.js (demo-output/timeline.json + frames/):
//   tm4c123-simulator-demo.mp4            the frames at their painted times, 30 fps H.264, 1920x1080, silent
//   tm4c123-simulator-demo-captioned.mp4  the same with the voice-over text burned in
//   tm4c123-simulator-demo.srt            the voice-over text, timed to the recorded scenes
//   stills/NN-<scene>.png                 one frame per scene (for checking the video without playing it)
// Nothing is re-timed or cut: each frame is shown from the moment it was painted until the next one.
// Needs ffmpeg (with libx264 and libass). Usage: node demo/make-video.mjs [demo-output]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const OUT = process.argv[2] ?? "demo-output";
const NAME = "tm4c123-simulator-demo";
const { scenes: SCRIPT } = JSON.parse(readFileSync(new URL("./scenes.json", import.meta.url), "utf8"));
const { end, scenes, frames } = JSON.parse(readFileSync(`${OUT}/timeline.json`, "utf8"));
if (!frames.length) {
  throw new Error("no frames recorded");
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg ${args.join(" ")} failed (${result.status})`);
  }
}

// Frames at their painted times (concat demuxer: each image lasts until the next one).
const t0 = frames[0].t;
const total = end - t0;
const lines = [];
frames.forEach((frame, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].t : end;
  lines.push(`file '${frame.file}'`, `duration ${Math.max(next - frame.t, 0.001).toFixed(4)}`);
});
lines.push(`file '${frames.at(-1).file}'`);
writeFileSync(`${OUT}/frames.txt`, `${lines.join("\n")}\n`);
const video = `${OUT}/${NAME}.mp4`;
ffmpeg(["-f", "concat", "-safe", "0", "-i", `${OUT}/frames.txt`,
  "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", video]);

// Captions: each scene's text from its recorded start to the next scene, one sentence per cue,
// each sentence given time in proportion to its words.
const stamp = (seconds) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
const timed = scenes.map((mark, i) => ({
  ...mark,
  start: Math.max(0, mark.t - t0),
  end: i + 1 < scenes.length ? scenes[i + 1].t - t0 : total,
  text: SCRIPT.find((s) => s.id === mark.id).caption,
}));
const cues = [];
for (const scene of timed) {
  const sentences = scene.text.match(/[^.:;]+[.:;]?/g).map((s) => s.trim()).filter(Boolean);
  const words = sentences.map((s) => s.split(/\s+/).length);
  const sum = words.reduce((a, b) => a + b, 0);
  let at = scene.start;
  sentences.forEach((sentence, i) => {
    const length = (scene.end - scene.start) * words[i] / sum;
    cues.push({ start: at, end: at + length, text: sentence });
    at += length;
  });
}
const srt = `${OUT}/${NAME}.srt`;
writeFileSync(srt, cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end - 0.05)}\n${c.text}\n`).join("\n"));
ffmpeg(["-i", video,
  "-vf", `subtitles=${srt}:force_style='FontName=DejaVu Sans,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BackColour=&H90000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=14,Alignment=2'`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", `${OUT}/${NAME}-captioned.mp4`]);

// One still per scene, 60% into it, from the clean and the captioned video.
mkdirSync(`${OUT}/stills`, { recursive: true });
timed.forEach((scene, i) => {
  const at = (scene.start + 0.6 * (scene.end - scene.start)).toFixed(2);
  const name = `${String(i + 1).padStart(2, "0")}-${scene.id}`;
  ffmpeg(["-ss", at, "-i", video, "-frames:v", "1", `${OUT}/stills/${name}.png`]);
  ffmpeg(["-ss", at, "-i", `${OUT}/${NAME}-captioned.mp4`, "-frames:v", "1", "-vf", "scale=960:-1", `${OUT}/stills/${name}-captioned.png`]);
});

const summary = timed.map((s) => `${s.id} ${s.start.toFixed(1)}-${s.end.toFixed(1)} s`).join(", ");
console.log(`${frames.length} frames, ${total.toFixed(1)} s: ${summary}`);
if (total < 90 || total > 120) {
  console.log(`::warning title=Demo length::${total.toFixed(1)} s (target 90-120 s)`);
}
