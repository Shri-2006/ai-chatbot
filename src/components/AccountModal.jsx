import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AccountModal({ profile, session, onClose }) {
  const [tab, setTab] = useState('password')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function reset() { setError(''); setSuccess('') }

  async function changePassword(e) {
    e.preventDefault()
    reset()
    if (newPassword !== confirmPassword) return setError("New passwords don't match.")
    if (newPassword.length < 6) return setError('Password must be at least 6 characters.')
    setLoading(true)

    // Re-authenticate first to verify current password
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: currentPassword,
    })
    if (signInError) { setLoading(false); return setError('Current password is incorrect.') }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (error) setError(error.message)
    else {
      setSuccess('Password changed successfully!')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    }
  }

  async function deleteAccount(e) {
    e.preventDefault()
    reset()
    if (deleteConfirm !== session.user.email) return setError('Email does not match. Please type your email exactly.')
    setLoading(true)

    // Delete all user data from Supabase (cascades to conversations + messages)
    const { error: profileError } = await supabase.from('profiles').delete().eq('id', session.user.id)
    if (profileError) { setLoading(false); return setError('Failed to delete account data: ' + profileError.message) }

    // Sign out — account deletion from auth requires service role key so we just sign out
    // The profile + all data is deleted. You can delete the auth user from Supabase dashboard if needed.
    await supabase.auth.signOut()
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', background: 'var(--surface2)',
    border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)',
    fontSize: 14, outline: 'none', transition: 'border-color .15s',
    fontFamily: 'var(--font)',
  }
  const focus = e => e.target.style.borderColor = 'var(--accent)'
  const blur  = e => e.target.style.borderColor = 'var(--border)'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div style={{ width:'100%', maxWidth:440, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:20, overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 24px 16px', borderBottom:'1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:600, color:'var(--text)' }}>Account Settings</div>
            <div style={{ fontSize:12.5, color:'var(--text2)', marginTop:2 }}>{session.user.email}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text2)', fontSize:20, lineHeight:1, padding:4, borderRadius:6, transition:'color .15s' }}
            onMouseEnter={e=>e.currentTarget.style.color='var(--text)'}
            onMouseLeave={e=>e.currentTarget.style.color='var(--text2)'}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', padding:'12px 24px 0', gap:4, borderBottom:'1px solid var(--border)' }}>
          {[['password','🔑 Change Password'], ['delete','🗑️ Delete Account']].map(([t, label]) => (
            <button key={t} onClick={() => { setTab(t); reset() }} style={{
              padding:'8px 14px', border:'none', background:'none', fontSize:13, fontWeight:500,
              color: tab===t ? 'var(--text)' : 'var(--text2)',
              borderBottom: tab===t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom:-1, transition:'color .15s', cursor:'pointer',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ padding:24, display:'flex', flexDirection:'column', gap:16 }}>

          {/* Change Password Tab */}
          {tab === 'password' && (
            <form onSubmit={changePassword} style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:12.5, fontWeight:500, color:'var(--text2)', display:'block', marginBottom:6 }}>Current Password</label>
                <input style={inputStyle} type="password" placeholder="••••••••" required
                  value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} onFocus={focus} onBlur={blur} />
              </div>
              <div>
                <label style={{ fontSize:12.5, fontWeight:500, color:'var(--text2)', display:'block', marginBottom:6 }}>New Password</label>
                <input style={inputStyle} type="password" placeholder="••••••••" required
                  value={newPassword} onChange={e=>setNewPassword(e.target.value)} onFocus={focus} onBlur={blur} />
              </div>
              <div>
                <label style={{ fontSize:12.5, fontWeight:500, color:'var(--text2)', display:'block', marginBottom:6 }}>Confirm New Password</label>
                <input style={inputStyle} type="password" placeholder="••••••••" required
                  value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} onFocus={focus} onBlur={blur} />
              </div>
              {error   && <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#fca5a5' }}>{error}</div>}
              {success && <div style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#86efac' }}>{success}</div>}
              <button type="submit" disabled={loading} style={{
                padding:'11px 0', border:'none', borderRadius:10, fontSize:14, fontWeight:600, color:'#fff',
                background: loading ? 'var(--border)' : 'linear-gradient(135deg, var(--accent), var(--accent2))',
                opacity: loading ? 0.7 : 1, transition:'opacity .15s',
              }}>{loading ? 'Changing...' : 'Change Password'}</button>
            </form>
          )}

          {/* Delete Account Tab */}
          {tab === 'delete' && (
            <form onSubmit={deleteAccount} style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:10, padding:'14px 16px', fontSize:13.5, color:'#fca5a5', lineHeight:1.6 }}>
                ⚠️ <strong>This cannot be undone.</strong> Your account, all conversations, and all messages will be permanently deleted.
              </div>
              <div>
                <label style={{ fontSize:12.5, fontWeight:500, color:'var(--text2)', display:'block', marginBottom:6 }}>
                  Type your email to confirm: <strong style={{ color:'var(--text)' }}>{session.user.email}</strong>
                </label>
                <input style={inputStyle} type="email" placeholder={session.user.email} required
                  value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)} onFocus={focus} onBlur={blur} />
              </div>
              {error && <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#fca5a5' }}>{error}</div>}
              <button type="submit" disabled={loading || deleteConfirm !== session.user.email} style={{
                padding:'11px 0', border:'none', borderRadius:10, fontSize:14, fontWeight:600, color:'#fff',
                background: loading || deleteConfirm !== session.user.email ? 'var(--border)' : '#dc2626',
                opacity: loading ? 0.7 : 1, transition:'all .15s',
              }}>{loading ? 'Deleting...' : 'Delete My Account'}</button>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}