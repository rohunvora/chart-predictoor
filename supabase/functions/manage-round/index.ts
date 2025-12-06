// Supabase Edge Function: manage-round
// Handles round lifecycle: start, lock, end, score

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Fetch BTC price from Binance
async function getBTCPrice(): Promise<number> {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
    const data = await response.json()
    return parseFloat(data.price)
  } catch (e) {
    console.error('Failed to fetch BTC price:', e)
    throw new Error('Failed to fetch price')
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action, round_id } = await req.json()

    switch (action) {
      case 'check_rounds': {
        // Called every few seconds to manage round lifecycle
        const now = new Date()
        
        // 1. Start any waiting rounds that should be active
        const { data: waitingRounds } = await supabase
          .from('rounds')
          .select('*')
          .eq('status', 'waiting')
          .lte('start_time', now.toISOString())
        
        for (const round of waitingRounds || []) {
          const price = await getBTCPrice()
          await supabase
            .from('rounds')
            .update({ status: 'active', open_price: price })
            .eq('id', round.id)
          console.log(`Round ${round.id} started at price ${price}`)
        }
        
        // 2. Lock any active rounds past lock time
        const { data: activeRounds } = await supabase
          .from('rounds')
          .select('*')
          .eq('status', 'active')
          .lte('lock_time', now.toISOString())
        
        for (const round of activeRounds || []) {
          await supabase
            .from('rounds')
            .update({ status: 'locked' })
            .eq('id', round.id)
          console.log(`Round ${round.id} locked`)
        }
        
        // 3. End any locked rounds past end time
        const { data: lockedRounds } = await supabase
          .from('rounds')
          .select('*')
          .eq('status', 'locked')
          .lte('end_time', now.toISOString())
        
        for (const round of lockedRounds || []) {
          const price = await getBTCPrice()
          
          // Score the round
          await supabase.rpc('score_round', {
            p_round_id: round.id,
            p_close_price: price
          })
          console.log(`Round ${round.id} scored at price ${price}`)
        }
        
        // 4. Ensure there's always a next round
        const { data: futureRounds } = await supabase
          .from('rounds')
          .select('*')
          .in('status', ['waiting', 'active', 'locked'])
          .gt('end_time', now.toISOString())
        
        if (!futureRounds || futureRounds.length === 0) {
          // Create next round
          const nextMinute = new Date(Math.ceil(now.getTime() / 60000) * 60000)
          const endTime = new Date(nextMinute.getTime() + 60000)
          const lockTime = new Date(endTime.getTime() - 5000)
          
          await supabase.from('rounds').insert({
            start_time: nextMinute.toISOString(),
            end_time: endTime.toISOString(),
            lock_time: lockTime.toISOString(),
            status: 'waiting'
          })
          console.log(`Created new round starting at ${nextMinute.toISOString()}`)
        }
        
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'get_current': {
        const { data, error } = await supabase.rpc('get_current_round')
        
        if (error) throw error
        
        return new Response(
          JSON.stringify({ round: data?.[0] || null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'get_results': {
        if (!round_id) throw new Error('round_id required')
        
        // Get round info
        const { data: round } = await supabase
          .from('rounds')
          .select('*')
          .eq('id', round_id)
          .single()
        
        // Get predictions with user info
        const { data: predictions } = await supabase
          .from('predictions')
          .select(`
            *,
            users (nickname, avatar_color)
          `)
          .eq('round_id', round_id)
          .order('rank', { ascending: true })
          .limit(20)
        
        return new Response(
          JSON.stringify({ round, predictions }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

