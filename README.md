# Daily Instagram Reels Automator

Automatically generates a fresh Reel idea + caption every day using Claude AI,
then posts it to your Instagram Business account via the Graph API.

---

## How it works

1. **Claude AI** generates a unique reel idea, hook, caption, and hashtags for your niche
2. **You drop a video** into the `videos/` folder (named `latest.mp4` or `video_YYYY-MM-DD.mp4`)
3. **The script runs daily** at your chosen time and posts it automatically
4. **Everything is logged** to `reels-log.json` so ideas are never repeated

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure your environment
```bash
cp .env.example .env
```
Then fill in your `.env` file:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `IG_ACCOUNT_ID` | Graph API Explorer → `/me/accounts` → `instagram_business_account` |
| `IG_ACCESS_TOKEN` | Graph API Explorer → generate long-lived token |
| `PUBLIC_VIDEO_BASE_URL` | Your S3 bucket / Cloudinary / server URL |

### 3. Add your video
Instagram requires a **publicly accessible** video URL. Options:

- **AWS S3**: Upload to a public S3 bucket, set `PUBLIC_VIDEO_BASE_URL` to your bucket URL
- **Cloudinary**: Free tier works great — upload via dashboard or CLI
- **Your own server**: Any web server with a public IP

Then drop your video into the `videos/` folder:
```
videos/
  latest.mp4          ← always used if no dated file found
  video_2025-05-24.mp4 ← used on May 24 specifically
```

### 4. Test (no posting)
```bash
npm test
# or
node index.js --test
```
This generates an idea and shows the full caption — no Instagram API calls made.

### 5. Post once immediately
```bash
npm run now
# or
node index.js --now
```

### 6. Start the daily scheduler
```bash
npm start
# or
node index.js
```
Runs in the background and posts at your `CRON_SCHEDULE` time every day.

---

## Niche examples

Change `NICHE` in your `.env` to anything:

```
NICHE=fitness and home workouts
NICHE=personal finance for beginners
NICHE=street food and cooking
NICHE=tech tools and productivity
NICHE=comedy and relatable situations
NICHE=fashion and styling tips
NICHE=travel on a budget in India
```

---

## Keep it running (production)

Use **PM2** to keep the scheduler alive:
```bash
npm install -g pm2
pm2 start index.js --name reels-bot
pm2 save
pm2 startup
```

Or deploy to a free server like **Railway**, **Render**, or **Fly.io**.

---

## Log file

Every post is saved to `reels-log.json`:
```json
[
  {
    "date": "2025-05-23",
    "title": "5 mindset shifts that changed my life",
    "hook": "Nobody tells you this about success...",
    "format": "talking-head",
    "mediaId": "17841400000000000",
    "status": "posted"
  }
]
```

---

## Video specs (Instagram requirements)

- Format: MP4 (H.264 video, AAC audio)
- Duration: 3–90 seconds
- Aspect ratio: 9:16 (1080×1920 recommended)
- Max file size: 1 GB
- The video URL must be **publicly accessible** at post time
