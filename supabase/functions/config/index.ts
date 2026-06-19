import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  if (req.method === 'POST') {
    const { action, usuario, senha } = await req.json()
    if (action === 'login') {
      const senhaDaniel = Deno.env.get('SENHA_DANIEL')
      const senhaEquipe = Deno.env.get('SENHA_EQUIPE')
      const senhaCorreta = (usuario === 'Daniel') ? senhaDaniel : senhaEquipe
      
      if (senha && senha === senhaCorreta) {
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' } })
      }
      return new Response(JSON.stringify({ success: false }), { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } })
    }
  }

  return new Response(JSON.stringify({ 
      supabaseUrl: Deno.env.get('MY_SUPABASE_URL'),  // Alterado aqui
      supabaseKey: Deno.env.get('MY_SUPABASE_ANON_KEY') // Alterado aqui
  }), { headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' } })
})