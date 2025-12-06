# Predictoor - Production Setup Guide

This guide will help you set up Predictoor for production with real multiplayer support.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐
│   Vercel        │────▶│    Supabase     │
│   (Frontend)    │     │  ┌───────────┐  │
└─────────────────┘     │  │ Postgres  │  │
                        │  │ Realtime  │  │
                        │  │ Edge Func │  │
                        │  └───────────┘  │
                        └─────────────────┘
```

## Prerequisites

- [Supabase](https://supabase.com) account (free tier works)
- [Vercel](https://vercel.com) account
- Node.js 18+

---

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Name it `predictoor` (or whatever you like)
4. Choose a strong database password (save it!)
5. Select a region close to your users
6. Wait ~2 minutes for setup

---

## Step 2: Set Up Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Copy the entire contents of `supabase/migrations/001_initial_schema.sql`
4. Paste and click **Run**

This creates:
- `users` table (anonymous players with stats)
- `rounds` table (60-second synchronized rounds)
- `predictions` table (player predictions with draw paths)
- RLS policies (security)
- Database functions (scoring, leaderboard, etc.)

---

## Step 3: Enable Realtime

1. Go to **Database** → **Replication**
2. Under "Realtime", enable these tables:
   - `rounds`
   - `predictions`

This allows players to see each other's predictions in real-time.

---

## Step 4: Deploy Edge Function

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Login:
   ```bash
   supabase login
   ```

3. Link your project:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```
   (Find your project ref in Settings → General)

4. Deploy the edge function:
   ```bash
   supabase functions deploy manage-round
   ```

---

## Step 5: Set Up Automatic Round Creation

Supabase's `pg_cron` extension creates new rounds automatically.

1. Go to **SQL Editor**
2. Run this query to enable pg_cron:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   ```

3. Create the cron job (runs every minute):
   ```sql
   SELECT cron.schedule(
     'create-rounds',
     '* * * * *',
     $$SELECT get_current_round();$$
   );
   ```

---

## Step 6: Configure Frontend

1. Get your Supabase credentials:
   - Go to **Settings** → **API**
   - Copy `URL` and `anon public` key

2. Update `public/app.js`:
   ```javascript
   const CONFIG = {
     SUPABASE_URL: 'https://xxxxx.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
     MULTIPLAYER_ENABLED: true,  // <-- Enable multiplayer!
   };
   ```

---

## Step 7: Deploy to Vercel

```bash
npx vercel --prod
```

---

## Monitoring & Debugging

### Check Active Players
```sql
SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL '5 minutes';
```

### Check Current Round
```sql
SELECT * FROM rounds WHERE status IN ('waiting', 'active', 'locked') ORDER BY start_time DESC LIMIT 1;
```

### Check Recent Predictions
```sql
SELECT p.*, u.nickname 
FROM predictions p 
JOIN users u ON p.user_id = u.id 
ORDER BY p.submitted_at DESC 
LIMIT 20;
```

### View Leaderboard
```sql
SELECT * FROM get_leaderboard(20);
```

---

## Scaling Considerations

### For 100-500 concurrent users (Free Supabase tier)
- Works out of the box
- Realtime subscriptions handle this easily
- Consider adding connection pooling

### For 500-5000 concurrent users
- Upgrade to Supabase Pro ($25/month)
- Add rate limiting on edge functions
- Consider caching leaderboard with Redis/Upstash

### For 5000+ concurrent users
- Use Supabase Enterprise
- Add read replicas
- Implement sharding by round_id
- Use CDN for static assets

---

## Troubleshooting

### "Realtime not working"
- Check that tables are added to replication (Step 3)
- Ensure RLS policies allow SELECT

### "Round not starting"
- Check pg_cron is enabled
- Manually call `SELECT get_current_round();` to create one

### "Predictions not saving"
- Check browser console for errors
- Verify SUPABASE_URL and key are correct
- Ensure round status is 'active'

### "Leaderboard empty"
- Need at least one completed round
- Check that `score_round` function ran

---

## Cost Estimates

| Users | Supabase | Vercel | Total |
|-------|----------|--------|-------|
| 100 | Free | Free | $0 |
| 500 | Free | Free | $0 |
| 1000 | $25/mo | Free | $25/mo |
| 5000 | $25/mo | $20/mo | $45/mo |

---

## Security Notes

1. **RLS is enabled** - Users can only read predictions, not modify others'
2. **Server timestamps** - Predictions use server time, not client
3. **Lock time** - Submissions blocked 5 seconds before round ends
4. **No auth required** - Anonymous play via session tokens
5. **Rate limiting** - Consider adding on edge function for production

---

## Next Steps

- [ ] Add nickname customization UI
- [ ] Add "Share Result" feature with canvas snapshot
- [ ] Add hourly challenge feature
- [ ] Add sound effects for results
- [ ] Add streak notifications

