/**
 * Auto Reels Generator & Poster
 * ─────────────────────────────
 * 1. Claude AI generates a motivational script (slides)
 * 2. Python + FFmpeg renders a 9:16 vertical video with text on screen
 * 3. Cloudinary hosts the video publicly
 * 4. Instagram Graph API posts it as a Reel
 *
 * No camera, no recording — fully automated!
 *
 * Install: npm install
 * Test:    node index.js --test
 * Post:    node index.js --now
 * Auto:    node index.js          (runs daily at scheduled time)
 */

import Anthropic from "@anthropic-ai/sdk";
import { v2 as cloudinary } from "cloudinary";
import cron from "node-cron";
import axios from "axios";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import "dotenv/config";

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  niche: process.env.NICHE || "motivation and business growth",
  audience: process.env.AUDIENCE || "young Indian entrepreneurs aged 18-30",
  igAccountId: process.env.IG_ACCOUNT_ID,
  igAccessToken: process.env.IG_ACCESS_TOKEN,
  igApiVersion: "v19.0",
  cronSchedule: process.env.CRON_SCHEDULE || "30 12 * * *",
  tmpDir: "./tmp",
  logFile: "./reels-log.json",
};

// ─── Cloudinary config ───────────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Anthropic client ────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Step 1: Generate reel script with Claude ────────────────────────────────

async function generateReelScript() {
  console.log("🤖 Generating reel script with Claude AI...");

  const history = loadLog();
  const recentTitles = history
    .slice(-10)
    .map((e) => e.title)
    .join(", ");

  const prompt = `You are a viral Instagram Reels content creator for ${CONFIG.niche}.

Create ONE viral text-on-screen reel for ${CONFIG.audience}.
Recent posts to avoid repeating: ${recentTitles || "none"}

Return ONLY a JSON object (no markdown):
{
  "title": "Internal title (max 6 words)",
  "topic": "What this reel is about (1 sentence)",
  "slides": [
    {"text": "Hook line — make them stop scrolling (max 8 words)", "duration": 3},
    {"text": "Point 1 (max 10 words)", "duration": 3},
    {"text": "Point 2 (max 10 words)", "duration": 3},
    {"text": "Point 3 (max 10 words)", "duration": 3},
    {"text": "Point 4 (max 10 words)", "duration": 3},
    {"text": "Strong closing line / CTA (max 10 words)", "duration": 3}
  ],
  "bg_color": "One of: #1a1a2e|#0f3460|#16213e|#1b1b2f|#2d132c|#1a1a1a|#0d0d0d",
  "text_color": "#FFFFFF",
  "accent_color": "A bright accent color hex like #E94560 or #FFD700 or #00FF88",
  "caption": "Full Instagram caption with hook, value, CTA. Conversational tone for Indian audience.",
  "hashtags": "#hashtag1 #hashtag2 ... (20 relevant hashtags)"
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0].text.trim().replace(/```json|```/gm, "").trim();
  const script = JSON.parse(raw);
  console.log(`✅ Script: "${script.title}"`);
  return script;
}

// ─── Step 2: Render video with Python + FFmpeg ───────────────────────────────

async function renderVideo(script) {
  console.log("🎬 Rendering video...");

  if (!fs.existsSync(CONFIG.tmpDir)) fs.mkdirSync(CONFIG.tmpDir);

  const scriptPath = path.join(CONFIG.tmpDir, "render_script.json");
  const outputPath = path.join(CONFIG.tmpDir, "reel.mp4");

  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));

  const pythonScript = `
import json, subprocess, os, sys
from PIL import Image, ImageDraw, ImageFont
import textwrap

with open('${scriptPath}') as f:
    data = json.load(f)

W, H = 1080, 1920
slides = data['slides']
bg = data['bg_color']
tc = data['text_color']
ac = data['accent_color']
title = data['title']
tmp = '${CONFIG.tmpDir}'

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

bg_rgb = hex_to_rgb(bg)
tc_rgb = hex_to_rgb(tc)
ac_rgb = hex_to_rgb(ac)

def make_slide(idx, text, duration, is_first=False):
    img = Image.new('RGB', (W, H), bg_rgb)
    draw = ImageDraw.Draw(img)

    # Gradient overlay (simple)
    for y in range(H):
        alpha = int(30 * (y / H))
        r = min(255, bg_rgb[0] + alpha)
        g = min(255, bg_rgb[1] + alpha)
        b = min(255, bg_rgb[2] + alpha)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Top accent bar
    draw.rectangle([(0, 0), (W, 8)], fill=ac_rgb)
    draw.rectangle([(0, H-8), (W, H)], fill=ac_rgb)

    # Slide number dots
    dot_y = H - 80
    dot_r = 10
    total = len(slides)
    spacing = 30
    start_x = W // 2 - (total * spacing) // 2
    for i in range(total):
        cx = start_x + i * spacing
        color = ac_rgb if i == idx else (100, 100, 100)
        draw.ellipse([(cx-dot_r, dot_y-dot_r), (cx+dot_r, dot_y+dot_r)], fill=color)

    # Brand watermark
    try:
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
    except:
        font_small = ImageFont.load_default()
    draw.text((W//2, 60), "@the__growth__club", fill=ac_rgb, font=font_small, anchor="mm")

    # Main text
    try:
        font_size = 72 if len(text) < 40 else 58 if len(text) < 70 else 48
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()

    wrapped = textwrap.fill(text, width=18)
    lines = wrapped.split('\\n')
    line_h = font_size + 20
    total_h = len(lines) * line_h
    start_y = H // 2 - total_h // 2

    # Text shadow
    for i, line in enumerate(lines):
        y = start_y + i * line_h
        draw.text((W//2 + 3, y + 3), line, fill=(0,0,0,100), font=font, anchor="mm")
        draw.text((W//2, y), line, fill=tc_rgb, font=font, anchor="mm")

    # Accent underline for first slide
    if is_first:
        uw = min(400, W - 100)
        uy = start_y + total_h + 20
        draw.rectangle([(W//2 - uw//2, uy), (W//2 + uw//2, uy + 5)], fill=ac_rgb)

    # Save
    img_path = os.path.join(tmp, f'slide_{idx:02d}.png')
    img.save(img_path)
    return img_path, duration

slide_files = []
for i, slide in enumerate(slides):
    p, d = make_slide(i, slide['text'], slide['duration'], i==0)
    slide_files.append((p, d))
    print(f"  Slide {i+1}: {slide['text'][:40]}")

# Build FFmpeg concat
concat = os.path.join(tmp, 'concat.txt')
with open(concat, 'w') as f:
    for p, d in slide_files:
        f.write(f"file '{os.path.abspath(p)}'\\n")
        f.write(f"duration {d}\\n")
    # Repeat last frame
    f.write(f"file '{os.path.abspath(slide_files[-1][0])}'\\n")

output = '${outputPath}'
cmd = [
    'ffmpeg', '-y',
    '-f', 'concat', '-safe', '0', '-i', concat,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output
]
result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode != 0:
    print('FFmpeg error:', result.stderr[-500:])
    sys.exit(1)

print(f'Video rendered: {output}')
size = os.path.getsize(output) / 1024 / 1024
print(f'File size: {size:.1f} MB')
`;

  const pyPath = path.join(CONFIG.tmpDir, "render.py");
  fs.writeFileSync(pyPath, pythonScript);

  try {
    const result = execSync(`python3 ${pyPath}`, { encoding: "utf8", timeout: 120000 });
    console.log(result);
    console.log(`✅ Video rendered: ${outputPath}`);
    return outputPath;
  } catch (err) {
    throw new Error(`Video render failed: ${err.message}`);
  }
}

// ─── Step 3: Upload to Cloudinary ────────────────────────────────────────────

async function uploadToCloudinary(videoPath) {
  console.log("☁️ Uploading to Cloudinary...");

  const result = await cloudinary.uploader.upload(videoPath, {
    resource_type: "video",
    folder: "reels-automator",
    public_id: `reel_${Date.now()}`,
    overwrite: true,
  });

  console.log(`✅ Uploaded: ${result.secure_url}`);
  return result.secure_url;
}

// ─── Step 4: Post to Instagram ───────────────────────────────────────────────

async function postToInstagram(videoUrl, script) {
  const caption = `${script.caption}\n\n${script.hashtags}`;
  const base = `https://graph.instagram.com/${CONFIG.igApiVersion}/${CONFIG.igAccountId}`;

  console.log("📦 Creating media container...");
  const container = await axios.post(`${base}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    share_to_feed: "true",
    access_token: CONFIG.igAccessToken,
  });
  const containerId = container.data.id;
  console.log(`✅ Container: ${containerId}`);

  // Poll for processing
  console.log("⏳ Waiting for processing...");
  for (let i = 0; i < 40; i++) {
    await sleep(8000);
    const status = await axios.get(`https://graph.instagram.com/${CONFIG.igApiVersion}/${containerId}`, {
      params: { fields: "status_code", access_token: CONFIG.igAccessToken },
    });
    const code = status.data.status_code;
    console.log(`   Status: ${code}`);
    if (code === "FINISHED") break;
    if (code === "ERROR" || code === "EXPIRED") throw new Error(`Processing failed: ${code}`);
  }

  // Publish
  console.log("🚀 Publishing...");
  const publish = await axios.post(`${base}/media_publish`, {
    creation_id: containerId,
    access_token: CONFIG.igAccessToken,
  });
  console.log(`✅ Published! Media ID: ${publish.data.id}`);
  return publish.data.id;
}

// ─── Full daily run ───────────────────────────────────────────────────────────

async function runDailyPost() {
  const runAt = new Date().toISOString();
  console.log(`\n${"═".repeat(50)}`);
  console.log(`🎬 Auto Reels — ${runAt}`);
  console.log(`${"═".repeat(50)}`);

  // Validate
  const required = ["ANTHROPIC_API_KEY", "IG_ACCOUNT_ID", "IG_ACCESS_TOKEN",
    "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
  }

  const script = await generateReelScript();
  const videoPath = await renderVideo(script);
  const videoUrl = await uploadToCloudinary(videoPath);
  const mediaId = await postToInstagram(videoUrl, script);

  // Cleanup tmp
  try { fs.rmSync(CONFIG.tmpDir, { recursive: true }); } catch {}

  const entry = {
    date: runAt.slice(0, 10),
    time: runAt,
    title: script.title,
    topic: script.topic,
    mediaId,
    status: "posted",
  };
  appendLog(entry);

  console.log(`\n🎉 "${script.title}" is live on @the__growth__club!`);
  return entry;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function loadLog() {
  try { return fs.existsSync(CONFIG.logFile) ? JSON.parse(fs.readFileSync(CONFIG.logFile, "utf8")) : []; }
  catch { return []; }
}
function appendLog(entry) {
  const log = loadLog();
  log.push(entry);
  fs.writeFileSync(CONFIG.logFile, JSON.stringify(log, null, 2));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--test")) {
  // Generate script only, no video/posting
  console.log("🧪 Test mode — generating script only...\n");
  generateReelScript().then((s) => {
    console.log("\n── Script ──");
    console.log(JSON.stringify(s, null, 2));
    console.log("\n── Slides preview ──");
    s.slides.forEach((sl, i) => console.log(`${i + 1}. ${sl.text}`));
    console.log("\n── Caption ──");
    console.log(s.caption);
    console.log("\n── Hashtags ──");
    console.log(s.hashtags);
  }).catch(console.error);
} else if (args.includes("--now")) {
  runDailyPost().catch((e) => { console.error("❌", e.message); process.exit(1); });
} else {
  console.log(`⏰ Scheduler started — posting daily at cron: "${CONFIG.cronSchedule}"`);
  console.log(`   Run with --now to post immediately, --test to preview script.\n`);
  cron.schedule(CONFIG.cronSchedule, () => {
    runDailyPost().catch((e) => {
      console.error("❌ Post failed:", e.message);
      appendLog({ date: new Date().toISOString().slice(0, 10), status: "failed", error: e.message });
    });
  });
}
