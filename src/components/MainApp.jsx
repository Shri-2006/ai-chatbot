import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Sidebar from './Sidebar'
import ChatWindow from './ChatWindow'

export default function MainApp({ session }) {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [profile, setProfile] = useState(null)
  // Default sidebar closed on mobile, open on desktop
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768)

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => { if (data) setProfile(data) })
  }, [session])

  useEffect(() => {
    loadConversations()
    const channel = supabase.channel('conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${session.user.id}` }, () => loadConversations())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [session])

  async function loadConversations() {
    const { data } = await supabase.from('conversations').select('*').eq('user_id', session.user.id).order('updated_at', { ascending: false })
    if (data) setConversations(data)
  }

  async function newConversation(modelOverride) {
    const { data } = await supabase.from('conversations')
      .insert({ user_id: session.user.id, title: 'New Chat', model: modelOverride || profile?.default_model || 'claude-46-sonnet' })
      .select().single()
    if (data) setConversations(prev => [data, ...prev])
    return data
  }

  async function deleteConversation(id) {
    await supabase.from('conversations').delete().eq('id', id)
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) setActiveId(null)
  }

  async function updateConversation(id, updates) {
    await supabase.from('conversations').update(updates).eq('id', id)
    setConversations(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
  }

  return (
    <div style={{ display:'flex', height:'100dvh', overflow:'hidden', position:'relative' }}>

      {/* Overlay — only visible on mobile via CSS class */}
      <div
        className="sidebar-overlay"
        onClick={() => setSidebarOpen(false)}
        style={{
          position:'fixed', inset:0,
          background:'rgba(0,0,0,0.55)',
          zIndex:199,
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? 'auto' : 'none',
          transition: 'opacity .25s ease',
        }}
      />

      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeId}
        profile={profile}
        onSelect={id => { setActiveId(id); setSidebarOpen(false) }}
        session={session}
        onNew={async () => { const data = await newConversation(); if (data) { setActiveId(data.id); setSidebarOpen(false) } }}
        onDelete={deleteConversation}
        onSignOut={() => supabase.auth.signOut()}
      />

      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', width:'100%', minWidth:0 }}>
        <ChatWindow
          conversation={conversations.find(c => c.id === activeId) || null}
          session={session}
          profile={profile}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
          onUpdateConversation={updateConversation}
          onNewConversation={newConversation}
          onSetActiveId={id => setActiveId(id)}
        />
      </div>
    </div>
  )
}
