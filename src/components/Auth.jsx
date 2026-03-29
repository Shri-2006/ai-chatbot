import { useState } from 'react'
import { supabase } from '../lib/supabase'

const s = {
  page: { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--main-bg)', backgroundImage:'radial-gradient(ellipse 70% 50% at 50% 0%,rgba(78,127,255,0.08) 0%,transparent 70%)' },
  card: { width:'100%', maxWidth:400, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:20, padding:'40px 36px', display:'flex', flexDirection:'column', gap:24 },
  logo: { width:44, height:44, borderRadius:13, background:'linear-gradient(135deg,var(--accent),var(--accent2))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, marginBottom:4 },
  h1: { fontSize:22, fontWeight:700, letterSpacing:'-0.02em', color:'var(--text)' },
  sub: { fontSize:13.5, color:'var(--text2)', marginTop:4 },
  tabs: { display:'flex', background:'var(--surface2)', borderRadius:10, padding:4, gap:4 },
  tab: a => ({ flex:1, padding:'8px 0', border:'none', borderRadius:8, fontSize:13.5, fontWeight:500, background:a?'var(--surface)':'transparent', color:a?'var(--text)':'var(--text2)', boxShadow:a?'0 1px 3px rgba(0,0,0,0.3)':'none', transition:'all .15s' }),
  form: { display:'flex', flexDirection:'column', gap:14 },
  label: { fontSize:12.5, fontWeight:500, color:'var(--text2)', marginBottom:5, display:'block' },
  input: { width:'100%', padding:'10px 14px', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text)', fontSize:14, outline:'none', transition:'border-color .15s' },
  btn: l => ({ width:'100%', padding:'11px 0', border:'none', borderRadius:10, background:l?'var(--border)':'linear-gradient(135deg,var(--accent),var(--accent2))', color:'#fff', fontSize:14, fontWeight:600, opacity:l?0.7:1, transition:'opacity .15s' }),
  error: { background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#fca5a5' },
  success: { background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#86efac' },
}

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name || email.split('@')[0] } } })
      if (error) setError(error.message)
      else setSuccess('Account created! You can now log in.')
    }
    setLoading(false)
  }

  const focus = e => e.target.style.borderColor = 'var(--accent)'
  const blur  = e => e.target.style.borderColor = 'var(--border)'

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div>
          <div style={s.logo}>✦</div>
          <div style={s.h1}>AI Knowledge System</div>
          <div style={s.sub}>Powered by Claude · SAP AI Core</div>
        </div>
        <div style={s.tabs}>
          <button style={s.tab(mode==='login')}   onClick={() => { setMode('login');  setError(''); setSuccess('') }}>Log in</button>
          <button style={s.tab(mode==='signup')}  onClick={() => { setMode('signup'); setError(''); setSuccess('') }}>Sign up</button>
        </div>
        <form style={s.form} onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div>
              <label style={s.label}>Name</label>
              <input style={s.input} type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} onFocus={focus} onBlur={blur} />
            </div>
          )}
          <div>
            <label style={s.label}>Email</label>
            <input style={s.input} type="email" placeholder="you@example.com" required value={email} onChange={e => setEmail(e.target.value)} onFocus={focus} onBlur={blur} />
          </div>
          <div>
            <label style={s.label}>Password</label>
            <input style={s.input} type="password" placeholder="••••••••" required value={password} onChange={e => setPassword(e.target.value)} onFocus={focus} onBlur={blur} />
          </div>
          {error   && <div style={s.error}>{error}</div>}
          {success && <div style={s.success}>{success}</div>}
          <button style={s.btn(loading)} type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}