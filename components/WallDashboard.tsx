
import React, { useState } from 'react';
import { User, Wall } from '../types';
import { Plus, LogOut, ArrowRight, Layout, Users, Calendar, X, Loader2, BookOpen } from 'lucide-react';
import { LlamaLogo } from './LlamaLogo';

interface WallDashboardProps {
  user: User;
  walls: Wall[];
  onCreateWall: (name: string, desc: string) => void;
  onJoinWall: (code: string) => void;
  onSelectWall: (id: string) => void;
  onLogout: () => void;
  isSyncing?: boolean;
}

const WallDashboard: React.FC<WallDashboardProps> = ({ 
  user, walls, onCreateWall, onJoinWall, onSelectWall, onLogout, isSyncing 
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWallName, setNewWallName] = useState('');
  const [newWallDesc, setNewWallDesc] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const isTeacher = user.role === 'teacher';
  const sectionTitle = isTeacher ? 'My Created Walls' : 'My Joined Walls';

  return (
    <div className="min-h-screen bg-sky-50">
      <nav className="bg-white border-b border-sky-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-cyan-600 rounded-xl flex items-center justify-center shadow-md">
            <LlamaLogo className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight">Wallama</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <img src={user.avatar} className="h-9 w-9 rounded-full border border-sky-200" alt="Avatar" />
            <div className="hidden sm:block text-left">
              <p className="text-sm font-bold text-slate-800 leading-tight">{user.name}</p>
              <p className="text-[10px] font-bold text-cyan-600 uppercase tracking-widest">
                {user.isGuest ? 'Guest' : (user.role.charAt(0).toUpperCase() + user.role.slice(1))}
              </p>
            </div>
          </div>
          <button onClick={onLogout} title="Sign Out" className="p-2 text-slate-400 hover:text-red-500 transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 sm:p-10 space-y-10">
        <div className={`grid grid-cols-1 ${isTeacher ? 'md:grid-cols-2' : 'max-w-xl mx-auto'} gap-6`}>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2 tracking-tight">Join a Wall</h2>
              <p className="text-slate-500 mb-6 font-medium">Have a code? Paste it here to jump into a shared wall.</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && onJoinWall(joinCode)}
                  placeholder="CODE12"
                  className="flex-1 px-5 py-4 bg-sky-50 border border-sky-100 rounded-2xl focus:ring-4 focus:ring-cyan-100 outline-none font-black text-lg text-slate-900 uppercase placeholder:text-slate-300 transition-all"
                />
                <button 
                  onClick={() => onJoinWall(joinCode)}
                  disabled={isSyncing}
                  className="bg-slate-900 text-white p-4 rounded-2xl hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-2 font-bold px-6 disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="animate-spin" size={20} /> : <><span className="hidden sm:inline">Join</span> <ArrowRight size={20} /></>}
                </button>
              </div>
            </div>
          </div>

          {isTeacher && (
            <div className="bg-cyan-600 p-8 rounded-[2.5rem] shadow-xl flex flex-col justify-between text-white relative overflow-hidden">
               <div className="absolute top-0 right-0 p-10 opacity-10 transform rotate-12">
                   <LlamaLogo className="w-48 h-48" />
               </div>
              <div className="relative z-10">
                <h2 className="text-2xl font-bold mb-2 tracking-tight">Create New Wall</h2>
                <p className="text-cyan-100 mb-6 font-medium">Start a fresh canvas for your classroom discussions.</p>
                <button 
                  onClick={() => setShowCreateModal(true)}
                  className="w-full bg-white text-cyan-600 p-4 rounded-2xl hover:bg-cyan-50 transition-all active:scale-95 font-bold flex items-center justify-center gap-2 shadow-lg"
                >
                  <Plus size={24} /> Create Wall
                </button>
              </div>
            </div>
          )}
        </div>

        {!user.isGuest && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Layout size={16} /> {sectionTitle}
            </h3>
            {isSyncing && (
              <div className="flex items-center gap-2 text-cyan-500 text-[10px] font-bold uppercase tracking-widest">
                <Loader2 size={12} className="animate-spin" /> Syncing...
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {walls.map(wall => (
              <div 
                key={wall.id} 
                onClick={() => onSelectWall(wall.id)}
                className="group bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer"
              >
                <div className={`h-32 bg-gradient-to-br ${wall.background} p-6 flex flex-col justify-between`}>
                  <div className="flex justify-between items-start">
                    <span className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-wider border border-white/20">
                      {wall.posts.length} Posts
                    </span>
                    <span className="text-white/80 font-mono text-sm font-bold tracking-widest">{wall.joinCode}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl bg-white/20 backdrop-blur-md rounded-lg h-10 w-10 flex items-center justify-center shadow-sm border border-white/10">{wall.icon || '📝'}</span>
                    <h4 className="text-white font-bold text-xl truncate tracking-tight">{wall.name}</h4>
                  </div>
                </div>
                <div className="p-6">
                  <p className="text-sm text-slate-500 line-clamp-2 mb-4 h-10 font-medium leading-relaxed">{wall.description}</p>
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-4 border-t border-slate-50">
                    <div className="flex items-center gap-1"><Users size={12} /> Collaborative</div>
                    <div className="flex items-center gap-1"><Calendar size={12} /> Active</div>
                  </div>
                </div>
              </div>
            ))}
            {walls.length === 0 && !isSyncing && (
              <div className="col-span-full py-20 text-center bg-slate-100 rounded-[2.5rem] border-2 border-dashed border-slate-200">
                <BookOpen size={48} className="mx-auto text-slate-300 mb-4" />
                <h4 className="text-slate-500 font-bold text-lg mb-1">{isTeacher ? "No walls yet" : "No walls joined"}</h4>
                <p className="text-slate-400 text-sm font-medium">
                    {isTeacher ? "Create a Wall to get started." : "Join a Wall using a code."}
                </p>
              </div>
            )}
          </div>
        </div>
        )}
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl relative">
            <button onClick={() => setShowCreateModal(false)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors">
              <X size={20} />
            </button>
            <h3 className="text-2xl font-bold text-slate-900 mb-6 tracking-tight">New Wall</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Title</label>
                <input
                  autoFocus
                  type="text"
                  value={newWallName}
                  onChange={(e) => setNewWallName(e.target.value)}
                  placeholder="Class Reflection"
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-cyan-100 outline-none text-slate-900 font-bold placeholder:text-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Description</label>
                <textarea
                  value={newWallDesc}
                  onChange={(e) => setNewWallDesc(e.target.value)}
                  placeholder="A space for sharing thoughts..."
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-cyan-100 outline-none h-32 resize-none text-slate-900 font-medium placeholder:text-slate-300"
                />
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button 
                onClick={() => { onCreateWall(newWallName, newWallDesc); setShowCreateModal(false); }}
                disabled={!newWallName || isSyncing}
                className="flex-1 bg-cyan-600 text-white py-4 rounded-2xl hover:bg-cyan-700 transition-all font-bold shadow-lg disabled:bg-slate-200 active:scale-95 flex items-center justify-center gap-2"
              >
                {isSyncing && <Loader2 className="animate-spin" size={20} />}
                Create Wall
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WallDashboard;
