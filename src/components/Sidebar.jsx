import { useState } from 'react'
import AccountModal from './AccountModal'

function groupByDate(convos) {
  const now = new Date()
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today - 86400000)
  const week      = new Date(today - 7 * 86400000)
  const month     = new Date(today - 30 * 86400000)
  const groups = { Today:[], Yesterday:[], 'This week':[], 'This month':[], Older:[] }
  convos.forEach(c => {
    const d = new Date(c.updated_at)
    if      (d >= today)     groups['Today'].push(c)
    else if (d >= yesterday) groups['Yesterday'].push(c)
    else if (d >= week)      groups['This week'].push(c)
    else if (d >= month)     groups['This month'].push(c)
    else                     groups['Older'].push(c)
  })
  return groups
}

export default function Sidebar({ open, conversations, activeId, profile, session, onSelect, onNew, onDelete, onSignOut }) {
  const [deletingId, setDeletingId] = useState(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const groups = groupByDate(conversations)

  return (
    <div style={{ width:'var(--sidebar-w)', flexShrink:0, height:'100dvh', background:'var(--sidebar-bg)', borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', transition:'transform .25s ease', transform:open?'translateX(0)':'translateX(-100%)', position:'fixed', top:0, left:0, zIndex:200, overflowX:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'16px 14px 12px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
          <div style={{ width:30, height:30, borderRadius:8, flexShrink:0, background:'linear-gradient(135deg,var(--accent),var(--accent2))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>✦</div>
          <span style={{ fontSize:14, fontWeight:600, color:'var(--text)', letterSpacing:'-0.01em' }}>AI Assistant</span>
        </div>
        <button onClick={onNew}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text2)', fontSize:13, fontWeight:500, transition:'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--text)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          New chat
        </button>
      </div>

      {/* Conversations */}
      <div style={{ flex:1, overflowY:'auto', padding:'8px' }}>
        {conversations.length === 0 && (
          <div style={{ padding:'20px 12px', color:'var(--text3)', fontSize:12.5, textAlign:'center', lineHeight:1.6 }}>
            No conversations yet.<br/>Click "New chat" to start.
          </div>
        )}
        {Object.entries(groups).map(([label, items]) => {
          if (!items.length) return null
          return (
            <div key={label} style={{ marginBottom:8 }}>
              <div style={{ padding:'6px 10px 4px', fontSize:11, fontWeight:600, color:'var(--text3)', letterSpacing:'.05em', textTransform:'uppercase' }}>{label}</div>
              {items.map(c => (
                <ConvoItem key={c.id} c={c} active={c.id===activeId} deleting={deletingId===c.id}
                  onSelect={() => onSelect(c.id)}
                  onDelete={() => setDeletingId(c.id)}
                  onDeleteConfirm={() => { onDelete(c.id); setDeletingId(null) }}
                  onDeleteCancel={() => setDeletingId(null)} />
              ))}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{ padding:'12px 10px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:'var(--surface2)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:600, color:'var(--accent)', flexShrink:0 }}>
            {(profile?.display_name||'U')[0].toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {profile?.display_name||'User'}
            </div>
          </div>
          <div style={{ display:'flex', gap:4 }}>
            <button onClick={() => setAccountOpen(true)} title="Account settings"
              style={{ background:'none', border:'none', color:'var(--text3)', padding:4, borderRadius:6, display:'flex', transition:'color .15s' }}
              onMouseEnter={e => e.currentTarget.style.color='var(--text)'}
              onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            </button>
            <button onClick={onSignOut} title="Sign out"
              style={{ background:'none', border:'none', color:'var(--text3)', padding:4, borderRadius:6, display:'flex', transition:'color .15s' }}
              onMouseEnter={e => e.currentTarget.style.color='var(--text)'}
              onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

      {accountOpen && <AccountModal profile={profile} session={session} onClose={() => setAccountOpen(false)} />}
    </div>
  )
}

function ConvoItem({ c, active, deleting, onSelect, onDelete, onDeleteConfirm, onDeleteCancel }) {
  const [hover, setHover] = useState(false)

  if (deleting) return (
    <div style={{ padding:'8px 10px', borderRadius:10, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', marginBottom:2 }}>
      <div style={{ fontSize:12, color:'#fca5a5', marginBottom:8 }}>Delete this chat?</div>
      <div style={{ display:'flex', gap:6 }}>
        <button onClick={onDeleteConfirm} style={{ flex:1, padding:'5px 0', background:'rgba(239,68,68,0.2)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:7, color:'#fca5a5', fontSize:12, fontWeight:500 }}>Delete</button>
        <button onClick={onDeleteCancel}  style={{ flex:1, padding:'5px 0', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:7, color:'var(--text2)', fontSize:12 }}>Cancel</button>
      </div>
    </div>
  )

  return (
    <div
      style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 10px', borderRadius:10, marginBottom:2, background:active?'var(--surface2)':hover?'rgba(255,255,255,0.03)':'transparent', border:`1px solid ${active?'var(--border)':'transparent'}`, cursor:'pointer', transition:'all .12s' }}
      onClick={onSelect} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ flexShrink:0 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span style={{ flex:1, fontSize:13, color:active?'var(--text)':'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.title}</span>
      {(hover||active) && (
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          style={{ background:'none', border:'none', color:'var(--text3)', padding:3, borderRadius:5, display:'flex', flexShrink:0, transition:'color .12s' }}
          onMouseEnter={e => e.currentTarget.style.color='#fca5a5'}
          onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>
        </button>
      )}
    </div>
  )
}
