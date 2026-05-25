/**
 * Daily Instagram Reels Automator
 * Uses Claude AI to generate ideas + captions, then posts via Instagram Graph API
 * Runs on a daily cron schedule
 *
 * Setup:
 *   npm install @anthropic-ai/sdk node-cron axios dotenv form-data
 *   node index.js
 */

import Anthropic from "@anthropic-ai/sdk";
import cron from "node-cron";
import axios from "axios";
import fs from "fs";
import path from "path";
import "dotenv/config";

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  // Your niche — change to anything e.g. "fitness", "finance", "comedy", "tech"
  niche: process.env.NICHE || "motivation and personal growth",

  // Target audience context
  audience: process.env.AUDIENCE || "young Indians aged 18-30",

  // Instagram Graph API
  igAccountId: process.env.IG_ACCOUNT_ID,
  igAccessToken: process.env.IG_ACCESS_TOKEN,
  igApiVersion: "v19.0",

  // Local folder where your daily video files live
  // File naming convention: video_YYYY-MM-DD.mp4 OR just latest.mp4
  videosFolder: process.env.VIDEOS_FOLDER || "./videos",

  // Public base URL where your videos are accessible (Instagram requires a public URL)
  // Example: https://your-s3-bucket.s3.amazonaws.com or https://yourserver.com/videos
  publicVideoBaseUrl: process.env.PUBLIC_VIDEO_BASE_URL,

  // Cron schedule — default: every day at 6:00 PM IST (12:30 UTC)
  // Format: "minute hour day month weekday"
  cronSchedule: process.env.CRON_SCHEDULE || "30 12 * * *",

  // Log file path
  logFile: "./reels-log.json",
};

// ─── Anthropic client ────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Step 1: Generate idea + caption using Claude ────────────────────────────

async function generateReelContent() {
  console.log("🤖 Asking Claude to generate today's Reel idea...");

  // Load posting history to avoid repeating ideas
  const history = loadLog();
  const recentTitles = history
    .slice(-14)
    .map((e) => e.title)
    .join(", ");

  const prompt = `You are an expert Instagram Reels content strategist specializing in ${CONFIG.niche}.

Your task: Generate ONE fresh, viral-worthy Instagram Reel idea for today.

Target audience: ${CONFIG.audience}
Niche: ${CONFIG.niche}
Recent posts to AVOID repeating: ${recentTitles || "none yet"}

Respond ONLY with a JSON object — no markdown, no extra text:
{
  "title": "Short internal title for this reel (max 8 words)",
  "hook": "The first 1-2 spoken/text lines that appear on screen — must be attention-grabbing and make people stop scrolling (max 15 words)",
  "caption": "Full Instagram caption: engaging hook line, 3-4 sentences of value, clear call-to-action. Tone: conversational, relatable, genuine. Optimised for Indian audience.",
  "hashtags": "#hashtag1 #hashtag2 ... (15-20 relevant hashtags mixing niche, broad, and trending)",
  "script_outline": "3-5 bullet points outlining what to say/show in the reel",
  "format": "One of: talking-head | text-on-screen | voiceover-broll | tutorial | list-countdown",
  "hook_style": "One of: question | controversy | statistic | story | pov | secret-reveal"
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0].text.trim();

  // Strip any accidental markdown fences
  const clean = raw.replace(/^```json|^```|```$/gm, "").trim();
  const content = JSON.parse(clean);

  console.log(`✅ Idea generated: "${content.title}"`);
  console.log(`   Hook: ${content.hook}`);
  console.log(`   Format: ${content.format}`);

  return content;
}

// ─── Step 2: Find today's video file ─────────────────────────────────────────

function getTodayVideoPath() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Priority 1: video_YYYY-MM-DD.mp4
  const dated = path.join(CONFIG.videosFolder, `video_${today}.mp4`);
  if (fs.existsSync(dated)) return dated;

  // Priority 2: latest.mp4
  const latest = path.join(CONFIG.videosFolder, "latest.mp4");
  if (fs.existsSync(latest)) return latest;

  // Priority 3: any .mp4 in the folder (most recently modified)
  if (fs.existsSync(CONFIG.videosFolder)) {
    const files = fs
      .readdirSync(CONFIG.videosFolder)
      .filter((f) => f.endsWith(".mp4"))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(CONFIG.videosFolder, f)).mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      return path.join(CONFIG.videosFolder, files[0].name);
    }
  }

  return null;
}

function getVideoPublicUrl(localPath) {
  if (!CONFIG.publicVideoBaseUrl) {
    throw new Error(
      "PUBLIC_VIDEO_BASE_URL is not set. Instagram requires a publicly accessible video URL."
    );
  }
  const filename = path.basename(localPath);
  return `${CONFIG.publicVideoBaseUrl.replace(/\/$/, "")}/${filename}`;
}

// ─── Step 3: Post Reel to Instagram Graph API ─────────────────────────────────

async function createMediaContainer(videoUrl, caption) {
  console.log("📦 Creating Instagram media container...");

  const url = `https://graph.instagram.com/${CONFIG.igApiVersion}/${CONFIG.igAccountId}/media`;

  const response = await axios.post(url, {
    media_type: "REELS",
    video_url: videoUrl,
    caption: caption,
    share_to_feed: "true",
    access_token: CONFIG.igAccessToken,
  });

  const containerId = response.data.id;
  console.log(`✅ Container created: ${containerId}`);
  return containerId;
}

async function waitForProcessing(containerId, maxWaitMs = 5 * 60 * 1000) {
  console.log("⏳ Waiting for video processing...");

  const start = Date.now();
  const pollInterval = 8000; // Check every 8 seconds

  while (Date.now() - start < maxWaitMs) {
    await sleep(pollInterval);

    const response = await axios.get(
      `https://graph.instagram.com/${CONFIG.igApiVersion}/${containerId}`,
      {
        params: {
          fields: "status_code,status",
          access_token: CONFIG.igAccessToken,
        },
      }
    );

    const { status_code, status } = response.data;
    console.log(`   Status: ${status_code} ${status ? `(${status})` : ""}`);

    if (status_code === "FINISHED") {
      console.log("✅ Video processed successfully");
      return true;
    }

    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`Video processing failed with status: ${status_code}`);
    }
  }

  throw new Error("Video processing timed out after 5 minutes");
}

async function publishContainer(containerId) {
  console.log("🚀 Publishing Reel to Instagram...");

  const url = `https://graph.instagram.com/${CONFIG.igApiVersion}/${CONFIG.igAccountId}/media_publish`;

  const response = await axios.post(url, {
    creation_id: containerId,
    access_token: CONFIG.igAccessToken,
  });

  const mediaId = response.data.id;
  console.log(`✅ Reel published! Media ID: ${mediaId}`);
  return mediaId;
}

// ─── Step 4: Full daily automation run ───────────────────────────────────────

async function runDailyPost() {
  const runAt = new Date().toISOString();
  console.log(`\n${"─".repeat(50)}`);
  console.log(`🎬 Daily Reels Automator — ${runAt}`);
  console.log(`${"─".repeat(50)}`);

  // Validate config
  if (!CONFIG.igAccountId || !CONFIG.igAccessToken) {
    throw new Error(
      "IG_ACCOUNT_ID and IG_ACCESS_TOKEN must be set in your .env file"
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY must be set in your .env file");
  }

  // 1. Generate content with Claude
  const content = await generateReelContent();

  // 2. Find video file
  const videoPath = getTodayVideoPath();
  if (!videoPath) {
    throw new Error(
      `No video found in ${CONFIG.videosFolder}. Add a video_YYYY-MM-DD.mp4 or latest.mp4 file.`
    );
  }
  console.log(`📹 Using video: ${videoPath}`);

  // 3. Build full caption
  const fullCaption = buildCaption(content);
  console.log(`\n📝 Caption preview:\n${fullCaption.slice(0, 200)}...\n`);

  // 4. Get public video URL
  const videoUrl = getVideoPublicUrl(videoPath);
  console.log(`🔗 Video URL: ${videoUrl}`);

  // 5. Post to Instagram
  const containerId = await createMediaContainer(videoUrl, fullCaption);
  await waitForProcessing(containerId);
  const mediaId = await publishContainer(containerId);

  // 6. Log the post
  const logEntry = {
    date: runAt.slice(0, 10),
    time: runAt,
    title: content.title,
    hook: content.hook,
    format: content.format,
    mediaId,
    videoPath,
    captionPreview: fullCaption.slice(0, 120),
    status: "posted",
  };
  appendLog(logEntry);

  console.log(`\n🎉 Done! Reel "${content.title}" is live on Instagram.`);
  console.log(`   Media ID: ${mediaId}`);
  console.log(`   Script outline for reference:`);
  content.script_outline.forEach((line, i) =>
    console.log(`   ${i + 1}. ${line}`)
  );

  return logEntry;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildCaption(content) {
  return `${content.hook}\n\n${content.caption}\n\n${content.hashtags}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadLog() {
  try {
    if (fs.existsSync(CONFIG.logFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.logFile, "utf8"));
    }
  } catch {
    // ignore
  }
  return [];
}

function appendLog(entry) {
  const log = loadLog();
  log.push(entry);
  fs.writeFileSync(CONFIG.logFile, JSON.stringify(log, null, 2));
}

// ─── CLI: test run ────────────────────────────────────────────────────────────

async function testGenerate() {
  console.log("🧪 Test mode: generating idea only (no posting)\n");
  const content = await generateReelContent();
  console.log("\n─── Full output ───");
  console.log(JSON.stringify(content, null, 2));
  console.log("\n─── Full caption ───");
  console.log(buildCaption(content));
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--test")) {
  // node index.js --test  →  generate idea only, no posting
  testGenerate().catch(console.error);
} else if (args.includes("--now")) {
  // node index.js --now  →  run immediately once
  runDailyPost().catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  });
} else {
  // Default: start cron scheduler
  console.log(`⏰ Scheduler started. Cron: "${CONFIG.cronSchedule}"`);
  console.log(`   Next post will go out at the scheduled time.`);
  console.log(`   Run with --now to post immediately, --test to preview only.\n`);

  cron.schedule(CONFIG.cronSchedule, () => {
    runDailyPost().catch((err) => {
      console.error("❌ Post failed:", err.message);
      appendLog({
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toISOString(),
        status: "failed",
        error: err.message,
      });
    });
  });
}
