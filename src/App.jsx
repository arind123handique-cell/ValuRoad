import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Bot, Cpu, HardDrive, Share2, Plus, 
  Trash2, Eye, FileSpreadsheet, FileDown, 
  Printer, LogOut, Terminal, Activity, 
  TrendingUp, RefreshCw, Layers, Shield
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showAiPulse, setShowAiPulse] = useState(true);
  const [projects, setProjects] = useState([
    { id: 1, name: 'Valuation estimate for highways', workName: 'Valuation estimate of building/Structure on NH-37 stretch', date: '2026-07-20', entries: 3, cost: '₹ 3,19,924.00', status: 'synchronized' },
    { id: 2, name: 'Left out valuation estimate', workName: 'Valuation estimate of building/Structure on NH-37 stretch', date: '2026-07-18', entries: 12, cost: '₹ 14,82,450.00', status: 'synchronized' },
    { id: 3, name: 'Kacha House Plinth Expansion', workName: 'Estimate for zirat structures in Golaghat district', date: '2026-07-15', entries: 2, cost: '₹ 2,46,000.00', status: 'local' }
  ]);
  const [chatMessages, setChatMessages] = useState([
    { id: 1, type: 'bot', text: 'Quantum AI Core initialized. Standing by for zirat valuation calculations.' }
  ]);
  const [chatInput, setChatInput] = useState('');

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    show: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 100 } }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const userMsg = { id: Date.now(), type: 'user', text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');

    // Mock bot reply after a short delay
    setTimeout(() => {
      setChatMessages(prev => [...prev, {
        id: Date.now() + 1,
        type: 'bot',
        text: `Analysis complete. Dimension conversion factor parsed. All temporary shed structures are automatically calibrated to feet measurement grids.`
      }]);
    }, 1000);
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#030712',
      color: '#f3f4f6',
      fontFamily: 'Inter, system-ui, sans-serif',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Sci-Fi Background Scanlines and Grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 50% 50%, rgba(30, 58, 138, 0.15), rgba(3, 7, 18, 0))',
        zIndex: 1
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'linear-gradient(rgba(18, 24, 38, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(18, 24, 38, 0.1) 1px, transparent 1px)',
        backgroundSize: '30px 30px',
        zIndex: 1
      }} />

      {/* Main Container Layout */}
      <div style={{ display: 'flex', minHeight: '100vh', position: 'relative', zIndex: 10 }}>
        
        {/* Holographic Sidebar */}
        <aside style={{
          width: '260px',
          borderRight: '1px solid rgba(6, 182, 212, 0.15)',
          background: 'rgba(9, 15, 30, 0.7)',
          backdropFilter: 'blur(20px)',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2.5rem' }}>
              <div style={{
                background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
                padding: '0.5rem',
                borderRadius: '8px',
                boxShadow: '0 0 15px rgba(6, 182, 212, 0.4)'
              }}>
                <Cpu style={{ width: '20px', height: '20px', color: '#fff' }} />
              </div>
              <div>
                <span style={{ fontWeight: '800', fontSize: '1.15rem', tracking: '0.05em', color: '#fff' }}>VALU</span>
                <span style={{ color: '#06b6d4', fontWeight: '800', fontSize: '1.15rem' }}>ROAD</span>
                <span style={{ fontSize: '0.65rem', display: 'block', color: '#6b7280', letterSpacing: '0.1em' }}>AI CORE v3.0</span>
              </div>
            </div>

            {/* Menu */}
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {['dashboard', 'templates', 'profile'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: activeTab === tab ? 'rgba(6, 182, 212, 0.1)' : 'transparent',
                    color: activeTab === tab ? '#06b6d4' : '#9ca3af',
                    fontWeight: activeTab === tab ? '600' : '400',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  {activeTab === tab && (
                    <motion.div 
                      layoutId="sidebarActiveBg"
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: '15%',
                        height: '70%',
                        width: '3px',
                        background: '#06b6d4',
                        boxShadow: '0 0 10px #06b6d4',
                        borderRadius: '0 2px 2px 0'
                      }}
                    />
                  )}
                  <Layers style={{ width: '16px', height: '16px' }} />
                  <span style={{ textTransform: 'capitalize' }}>{tab}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Footer Info */}
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem',
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.03)',
              marginBottom: '1rem',
              fontSize: '0.75rem'
            }}>
              <Shield style={{ width: '14px', height: '14px', color: '#10b981' }} />
              <span>Secure Cloud Sync Active</span>
            </div>
            <button style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              width: '100%',
              padding: '0.5rem 1rem',
              color: '#ef4444',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer'
            }}>
              <LogOut style={{ width: '16px', height: '16px' }} />
              <span>Log Out</span>
            </button>
          </div>
        </aside>

        {/* Content Area */}
        <main style={{ flexGrow: 1, padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem', overflowY: 'auto' }}>
          
          {/* Header Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: '700', color: '#fff' }}>Holographic Operations Grid</h1>
              <p style={{ margin: '0.25rem 0 0 0', color: '#9ca3af', fontSize: '0.85rem' }}>Estimate, trace boundary paths, and generate secure DC zirat valuations.</p>
            </div>
            
            <motion.button 
              whileHover={{ scale: 1.05, boxShadow: '0 0 15px rgba(6, 182, 212, 0.5)' }}
              whileTap={{ scale: 0.95 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1.25rem',
                background: '#06b6d4',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              <Plus style={{ width: '16px', height: '16px' }} />
              New Valuation Project
            </motion.button>
          </div>

          {/* Stats Bar */}
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="show"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}
          >
            <motion.div variants={itemVariants} style={{
              background: 'rgba(17, 24, 39, 0.45)',
              border: '1px solid rgba(6, 182, 212, 0.15)',
              borderRadius: '12px',
              padding: '1.25rem',
              backdropFilter: 'blur(10px)',
              position: 'relative'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ color: '#9ca3af', fontSize: '0.8rem', fontWeight: '500' }}>ACTIVE CORE PROJECTS</span>
                <Activity style={{ width: '16px', height: '16px', color: '#06b6d4' }} />
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: '800', color: '#fff' }}>3 Projects</div>
              <span style={{ fontSize: '0.75rem', color: '#10b981' }}>+1 Added today</span>
            </motion.div>

            <motion.div variants={itemVariants} style={{
              background: 'rgba(17, 24, 39, 0.45)',
              border: '1px solid rgba(6, 182, 212, 0.15)',
              borderRadius: '12px',
              padding: '1.25rem',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ color: '#9ca3af', fontSize: '0.8rem', fontWeight: '500' }}>TOTAL STRUCTURES QUANTIFIED</span>
                <HardDrive style={{ width: '16px', height: '16px', color: '#8b5cf6' }} />
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: '800', color: '#fff' }}>17 Blocks</div>
              <span style={{ fontSize: '0.75rem', color: '#8b5cf6' }}>All dimensions verified</span>
            </motion.div>

            <motion.div variants={itemVariants} style={{
              background: 'rgba(17, 24, 39, 0.45)',
              border: '1px solid rgba(6, 182, 212, 0.15)',
              borderRadius: '12px',
              padding: '1.25rem',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ color: '#9ca3af', fontSize: '0.8rem', fontWeight: '500' }}>CUMULATIVE VALUATION</span>
                <TrendingUp style={{ width: '16px', height: '16px', color: '#10b981' }} />
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: '800', color: '#10b981' }}>₹ 20,48,374.00</div>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Updated 2 mins ago</span>
            </motion.div>
          </motion.div>

          {/* Project List */}
          <div style={{
            background: 'rgba(17, 24, 39, 0.35)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '1.5rem',
            backdropFilter: 'blur(10px)'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: '600' }}>Project Valuation Snapshots</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <AnimatePresence>
                {projects.map(proj => (
                  <motion.div
                    key={proj.id}
                    layoutId={`card-${proj.id}`}
                    whileHover={{ scale: 1.01, borderColor: 'rgba(6, 182, 212, 0.3)', background: 'rgba(17, 24, 39, 0.6)' }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem',
                      borderRadius: '8px',
                      background: 'rgba(17, 24, 39, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      transition: 'border-color 0.2s'
                    }}
                  >
                    <div>
                      <h4 style={{ margin: 0, fontWeight: '600', color: '#fff' }}>{proj.projectName || proj.name}</h4>
                      {proj.workName && (
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.15rem' }}>
                          Name of Work: {proj.workName}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                        <span>Created: {proj.date}</span>
                        <span>•</span>
                        <span>{proj.entries} Owner Entries</span>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: '700', color: '#10b981', display: 'block' }}>{proj.cost}</span>
                        <span style={{
                          fontSize: '0.65rem',
                          padding: '0.15rem 0.4rem',
                          borderRadius: '4px',
                          background: proj.status === 'synchronized' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: proj.status === 'synchronized' ? '#10b981' : '#f59e0b'
                        }}>
                          {proj.status}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '0.25rem' }} title="View details"><Eye style={{ width: '15px', height: '15px' }} /></button>
                        <button style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '0.25rem' }} title="Export to Excel"><FileSpreadsheet style={{ width: '15px', height: '15px' }} /></button>
                        <button style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '0.25rem' }} title="Export to PDF"><FileDown style={{ width: '15px', height: '15px' }} /></button>
                        <button style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '0.25rem' }} title="Print"><Printer style={{ width: '15px', height: '15px' }} /></button>
                        <button style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem' }} title="Delete"><Trash2 style={{ width: '15px', height: '15px' }} /></button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>

      {/* Floating Holographic AI Chat Assistant */}
      <div style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        width: '320px',
        background: 'rgba(9, 15, 30, 0.85)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(6, 182, 212, 0.3)',
        borderRadius: '12px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5), 0 0 15px rgba(6, 182, 212, 0.15)',
        zIndex: 100,
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid rgba(6, 182, 212, 0.15)',
          background: 'rgba(6, 182, 212, 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Bot style={{ width: '16px', height: '16px', color: '#06b6d4' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: '700', letterSpacing: '0.05em' }}>QUANTUM ESTIMATOR AI</span>
          </div>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#10b981',
            boxShadow: '0 0 8px #10b981',
            animation: 'pulse 2s infinite'
          }} />
        </div>
        
        {/* Messages body */}
        <div style={{
          height: '200px',
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          fontSize: '0.75rem'
        }}>
          {chatMessages.map(msg => (
            <div 
              key={msg.id} 
              style={{
                alignSelf: msg.type === 'user' ? 'flex-end' : 'flex-start',
                background: msg.type === 'user' ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.03)',
                border: msg.type === 'user' ? '1px solid rgba(6, 182, 212, 0.25)' : '1px solid rgba(255,255,255,0.05)',
                color: msg.type === 'user' ? '#06b6d4' : '#d1d5db',
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                maxWidth: '85%'
              }}
            >
              {msg.text}
            </div>
          ))}
        </div>

        {/* Input area */}
        <div style={{
          padding: '0.75rem',
          borderTop: '1px solid rgba(6, 182, 212, 0.15)',
          display: 'flex',
          gap: '0.5rem'
        }}>
          <input
            type="text"
            placeholder="Query zirat calculations..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            style={{
              flexGrow: 1,
              background: '#030712',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              borderRadius: '6px',
              padding: '0.35rem 0.5rem',
              color: '#fff',
              fontSize: '0.75rem',
              outline: 'none'
            }}
          />
          <button 
            onClick={handleSendMessage}
            style={{
              padding: '0.35rem 0.75rem',
              background: '#06b6d4',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
