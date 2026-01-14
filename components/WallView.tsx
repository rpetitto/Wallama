
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Wall, Post as PostType, UserRole, ClassroomCourse } from '../types';
import Post from './Post';
import PostEditor from './PostEditor';
import { ChevronLeft, Plus, Share2, Settings, X, Check, ZoomIn, ZoomOut, Maximize, Loader2, AlertCircle, LayoutGrid, Lock, Unlock, Image as ImageIcon } from 'lucide-react';
import { WALL_GRADIENTS } from '../constants';
import { databaseService } from '../services/databaseService';
import { classroomService } from '../services/classroomService';

interface WallViewProps {
  wallId: string;
  onBack: () => void;
  onAddPost: (post: Partial<PostType>) => Promise<PostType | null>;
  onDeletePost: (id: string) => void;
  onMovePost: (id: string, x: number, y: number) => Promise<void>;
  onUpdateWall: (wall: Partial<Wall>) => void;
  currentUserId: string;
  authorName: string;
  userRole: UserRole;
}

const WallView: React.FC<WallViewProps> = ({ 
  wallId, onBack, onAddPost, onDeletePost, onMovePost, onUpdateWall, currentUserId, authorName, userRole 
}) => {
  const [wall, setWall] = useState<Wall | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [settingsForm, setSettingsForm] = useState<Partial<Wall>>({});
  
  const [showShareOverlay, setShowShareOverlay] = useState(false);
  const [showCopyToast, setShowCopyToast] = useState(false);
  
  const [showClassroomModal, setShowClassroomModal] = useState(false);
  const [courses, setCourses] = useState<ClassroomCourse[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [isSharingToClassroom, setIsSharingToClassroom] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitialZoomed = useRef(false);
  
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  
  const optimisticPosts = useRef<Map<string, PostType>>(new Map());
  const optimisticTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastInteractionTime = useRef<number>(0);

  const lastTouchDistance = useRef<number | null>(null);
  const initialZoom = useRef<number>(1);

  const scheduleOptimisticCleanup = (postId: string) => {
    if (optimisticTimers.current.has(postId)) {
      clearTimeout(optimisticTimers.current.get(postId)!);
    }
    const timer = setTimeout(() => {
      optimisticPosts.current.delete(postId);
      optimisticTimers.current.delete(postId);
    }, 5000); 
    optimisticTimers.current.set(postId, timer);
  };

  const zoomFit = useCallback(() => {
    if (!wall || wall.posts.length === 0) {
      setZoom(1); setPan({ x: 0, y: 0 }); return;
    }
    const padding = 100;
    const minX = Math.min(...wall.posts.map(p => p.x));
    const maxX = Math.max(...wall.posts.map(p => p.x + 300));
    const minY = Math.min(...wall.posts.map(p => p.y));
    const maxY = Math.max(...wall.posts.map(p => p.y + 250));
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
    const containerHeight = containerRef.current?.clientHeight || window.innerHeight;
    
    if (contentWidth <= 0 || contentHeight <= 0) return;

    const scaleX = (containerWidth - padding) / contentWidth;
    const scaleY = (containerHeight - padding) / contentHeight;
    const newZoom = Math.min(Math.min(scaleX, scaleY), 1);
    
    setZoom(newZoom);
    setPan({ 
      x: (containerWidth / 2) - ((minX + contentWidth / 2) * newZoom),
      y: (containerHeight / 2) - ((minY + contentHeight / 2) * newZoom)
    });
  }, [wall]);

  const syncWall = useCallback(async () => {
    if (Date.now() - lastInteractionTime.current < 500) return;

    try {
      const remoteWall = await databaseService.getWallById(wallId);
      if (remoteWall) {
        const combinedPosts: PostType[] = [];
        const remoteIds = new Set(remoteWall.posts.map(p => p.id));

        remoteWall.posts.forEach(rp => {
          if (optimisticPosts.current.has(rp.id)) {
            combinedPosts.push(optimisticPosts.current.get(rp.id)!);
          } else {
            combinedPosts.push(rp);
          }
        });

        optimisticPosts.current.forEach((op, id) => {
          if (!remoteIds.has(id)) {
            combinedPosts.push(op);
          }
        });

        combinedPosts.sort((a, b) => a.zIndex - b.zIndex);
        const updatedWall = { ...remoteWall, posts: combinedPosts };
        setWall(updatedWall);
        setError(null);
      } else {
        setError("Wall not found.");
      }
    } catch (err: any) {
      console.error("Sync error:", err);
    } finally {
      setIsSyncing(false);
    }
  }, [wallId]);

  useEffect(() => {
    if (wall && wall.posts.length > 0 && !hasInitialZoomed.current) {
        setTimeout(() => {
            zoomFit();
            hasInitialZoomed.current = true;
        }, 100);
    }
  }, [wall, zoomFit]);

  useEffect(() => {
    syncWall();
    const interval = setInterval(syncWall, 3000);
    return () => clearInterval(interval);
  }, [syncWall]);

  const isPanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.post-container, .modal-overlay')) return;
    isPanning.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseUp = () => { isPanning.current = false; };

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const currentZoom = zoomRef.current;
        const currentPan = panRef.current;
        const zoomSensitivity = 0.005; 
        const delta = -e.deltaY * zoomSensitivity;
        const newZoom = Math.min(Math.max(currentZoom + delta, 0.05), 4);
        
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const worldX = (mouseX - currentPan.x) / currentZoom;
            const worldY = (mouseY - currentPan.y) / currentZoom;
            const newPanX = mouseX - worldX * newZoom;
            const newPanY = mouseY - worldY * newZoom;
            setPan({ x: newPanX, y: newPanY });
            setZoom(newZoom);
        } else {
            setZoom(newZoom);
        }
      }
    };
    
    const el = containerRef.current;
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
    return () => { if (el) el.removeEventListener('wheel', handleWheel); };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && !(e.target as HTMLElement).closest('.post-container, .modal-overlay')) {
      isPanning.current = true;
      lastMousePos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      lastTouchDistance.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      initialZoom.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isPanning.current) {
      const dx = e.touches[0].clientX - lastMousePos.current.x;
      const dy = e.touches[0].clientY - lastMousePos.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && lastTouchDistance.current) {
      e.preventDefault();
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setZoom(Math.min(Math.max(initialZoom.current * (dist / lastTouchDistance.current), 0.05), 4));
    }
  };

  const handleTouchEnd = () => {
    isPanning.current = false;
    lastTouchDistance.current = null;
  };

  const findSmartSlot = (posts: PostType[]) => {
    if (posts.length === 0) return { x: 100, y: 100 };
    const POST_W = 320;
    const POST_H = 270;
    const minX = Math.min(...posts.map(p => p.x));
    const maxX = Math.max(...posts.map(p => p.x));
    const minY = Math.min(...posts.map(p => p.y));
    const maxY = Math.max(...posts.map(p => p.y));
    const currentW = (maxX + POST_W) - minX;
    const currentH = (maxY + POST_H) - minY;
    const candidates: { x: number, y: number, score: number }[] = [];
    const centerX = minX + currentW / 2;
    const centerY = minY + currentH / 2;
    const GRID_SIZE = 50;
    const SEARCH_RADIUS = 500;
    for (let x = minX - SEARCH_RADIUS; x <= maxX + SEARCH_RADIUS; x += GRID_SIZE) {
      for (let y = minY - SEARCH_RADIUS; y <= maxY + SEARCH_RADIUS; y += GRID_SIZE) {
        const collision = posts.some(p => Math.abs(p.x - x) < POST_W && Math.abs(p.y - y) < POST_H);
        if (collision) continue;
        const ratio = ((Math.max(maxX, x) + POST_W) - Math.min(minX, x)) / ((Math.max(maxY, y) + POST_H) - Math.min(minY, y));
        const ratioCost = Math.pow(ratio - 1, 2) * 500000;
        const distCost = Math.hypot(x - centerX, y - centerY);
        candidates.push({ x, y, score: ratioCost + distCost });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.length > 0 ? { x: candidates[0].x, y: candidates[0].y } : { x: maxX + 50, y: maxY + 50 };
  };

  const handleShare = () => {
    if (!wall) return;
    setShowShareOverlay(true);
  };

  const fetchCourses = async () => {
    const token = sessionStorage.getItem('google_access_token');
    if (token) {
        const list = await classroomService.listCourses(token);
        setCourses(list);
    }
  };

  const handleClassroomShareOpen = () => {
    fetchCourses();
    setShowClassroomModal(true);
  };

  const handleShareToClassroom = async () => {
    if (!wall || selectedCourses.size === 0) return;
    setIsSharingToClassroom(true);
    const token = sessionStorage.getItem('google_access_token');
    
    if (token) {
        const promises = Array.from(selectedCourses).map(courseId => 
            classroomService.shareWallToCourse(token, courseId, wall)
        );
        await Promise.all(promises);
        setShareSuccess(true);
        setTimeout(() => {
            setShareSuccess(false);
            setShowClassroomModal(false);
            setSelectedCourses(new Set());
        }, 2000);
    }
    setIsSharingToClassroom(false);
  };

  const toggleCourse = (id: string) => {
    const next = new Set(selectedCourses);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCourses(next);
  };

  const handlePostMove = (id: string, x: number, y: number) => {
    lastInteractionTime.current = Date.now();
    setWall(prev => {
      if (!prev) return prev;
      const maxZ = Math.max(0, ...prev.posts.map(p => p.zIndex));
      const updatedPosts = prev.posts.map(p => p.id === id ? { ...p, x, y, zIndex: maxZ + 1 } : p);
      const movedPost = updatedPosts.find(p => p.id === id);
      if (movedPost) {
        optimisticPosts.current.set(id, movedPost);
        scheduleOptimisticCleanup(id);
      }
      return { ...prev, posts: updatedPosts };
    });
  };

  const handlePostMoveEnd = async (id: string, x: number, y: number) => {
    lastInteractionTime.current = Date.now();
    await onMovePost(id, x, y);
  };

  const handleOptimisticAddPost = async (data: Partial<PostType>) => {
    const slot = findSmartSlot(wall?.posts || []);
    const tempId = 'temp_' + Date.now();
    
    if (containerRef.current) {
        const containerW = containerRef.current.clientWidth;
        const containerH = containerRef.current.clientHeight;
        const targetX = slot.x + 150; 
        const targetY = slot.y + 100;
        const newPanX = (containerW / 2) - (targetX * zoom);
        const newPanY = (containerH / 2) - (targetY * zoom);
        setPan({ x: newPanX, y: newPanY });
    }

    const optimisticPost: PostType = {
      id: tempId,
      type: data.type || 'text',
      content: data.content || '',
      authorName: authorName,
      authorId: currentUserId,
      createdAt: Date.now(),
      x: slot.x,
      y: slot.y,
      zIndex: Math.max(0, ...(wall?.posts.map(p => p.zIndex) || [])) + 1,
      color: data.color || 'bg-white',
      metadata: data.metadata
    };

    optimisticPosts.current.set(tempId, optimisticPost);
    lastInteractionTime.current = Date.now();
    setWall(prev => prev ? ({ ...prev, posts: [...prev.posts, optimisticPost] }) : null);
    setShowEditor(false);

    const savedPost = await onAddPost({ ...data, x: slot.x, y: slot.y });
    if (savedPost) {
      optimisticPosts.current.delete(tempId as string);
      optimisticPosts.current.set(savedPost.id, savedPost);
      scheduleOptimisticCleanup(savedPost.id);
      setWall(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          posts: prev.posts.map(p => p.id === tempId ? savedPost : p)
        };
      });
    }
  };

  const handleOpenSettings = () => {
    if (wall) setSettingsForm({ ...wall });
    setShowSettings(true);
  };

  const handleSaveSettings = () => {
    onUpdateWall(settingsForm);
    if (wall) setWall({ ...wall, ...settingsForm });
    setShowSettings(false);
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
        <div className="max-w-md space-y-4">
          <AlertCircle className="mx-auto text-red-500" size={48} />
          <h2 className="text-2xl font-bold text-slate-800">Connection Error</h2>
          <p className="text-slate-500">{error}</p>
          <button onClick={onBack} className="px-6 py-3 bg-cyan-600 text-white rounded-xl font-bold shadow-lg">Return to Dashboard</button>
        </div>
      </div>
    );
  }

  if (isSyncing && !wall) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4">
          <Loader2 className="animate-spin text-cyan-600 mx-auto" size={40} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Entering Canvas...</p>
        </div>
      </div>
    );
  }

  if (!wall) return null;
  const isTeacher = (userRole === 'teacher' && wall.teacherId === currentUserId);

  return (
    <div 
      ref={containerRef}
      className={`relative min-h-screen w-full bg-gradient-to-br ${wall.background} overflow-hidden flex flex-col`}
      style={{ 
        backgroundImage: wall.background.startsWith('from') ? '' : wall.background,
        background: wall.background.startsWith('from') ? undefined : wall.background,
        touchAction: 'none'
      }}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <header className="relative z-[100] bg-white/20 backdrop-blur-xl border-b border-white/20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-white/20 rounded-xl text-white transition-colors"><ChevronLeft size={24} /></button>
          <div className="flex items-center gap-3">
             <div className="h-10 w-10 bg-white/30 backdrop-blur-md rounded-xl flex items-center justify-center text-xl shadow-sm border border-white/20">
                {wall.icon || '📝'}
             </div>
             <div>
                <h2 className="text-xl font-extrabold text-white drop-shadow-md leading-tight">{wall.name}</h2>
                <p className="text-[10px] text-white/70 font-bold uppercase tracking-widest">Code: {wall.joinCode}</p>
             </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleShare} className="p-2.5 bg-white/20 hover:bg-white/30 text-white rounded-full backdrop-blur-md border border-white/20 transition-all">
            <Share2 size={20} />
          </button>
          {isTeacher && <button onClick={handleOpenSettings} className="p-2.5 bg-white/20 text-white rounded-full border border-white/20 hover:bg-white/30 transition-all"><Settings size={20} /></button>}
        </div>
      </header>

      <main id="canvas-root" className="flex-1 relative cursor-grab active:cursor-grabbing overflow-hidden">
        <div 
          className="absolute origin-top-left transition-transform duration-75"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <div className="relative w-[10000px] h-[10000px]">
            {wall.posts.map(post => (
              <Post 
                key={post.id} 
                post={post} 
                onDelete={(id) => {
                   setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null);
                   optimisticPosts.current.delete(id);
                   onDeletePost(id);
                }} 
                onMove={handlePostMove}
                onMoveEnd={handlePostMoveEnd}
                isOwner={post.authorId === currentUserId || isTeacher} 
                snapToGrid={wall.snapToGrid}
                isWallAnonymous={wall.isAnonymous}
                zoom={zoom}
              />
            ))}
          </div>
        </div>
      </main>

      <div className="fixed bottom-10 left-10 z-[100] bg-white/90 backdrop-blur-md p-2 rounded-2xl shadow-2xl flex items-center gap-2 border border-slate-200">
        <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.05))} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"><ZoomOut size={20} /></button>
        <span className="text-[10px] font-black text-slate-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(z + 0.1, 4))} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"><ZoomIn size={20} /></button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button onClick={zoomFit} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center gap-2 font-bold text-xs"><Maximize size={18} /> Fit</button>
      </div>

      <button onClick={() => setShowEditor(true)} className="fixed bottom-10 right-10 z-[100] h-20 w-20 bg-cyan-600 text-white rounded-full shadow-2xl hover:scale-110 transition-all flex items-center justify-center border-4 border-white/20 active:scale-95">
        <Plus size={40} />
      </button>

      {/* Copy Toast */}
      {showCopyToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[300] bg-slate-900/90 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 backdrop-blur-md border border-white/10">
            <Check size={18} className="text-green-400" />
            <span className="font-bold text-sm tracking-wide">Link copied to clipboard!</span>
        </div>
      )}

      {/* Share Overlay */}
      {showShareOverlay && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200 modal-overlay" onClick={() => setShowShareOverlay(false)}>
            <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-sm w-full text-center space-y-6 relative transform transition-all scale-100" onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowShareOverlay(false)} className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                    <X size={24} />
                </button>
                <div className="space-y-2">
                    <h3 className="text-2xl font-black text-slate-800 tracking-tight">Join this Wall</h3>
                    <p className="text-slate-500 text-sm font-medium">Scan the QR code or use the code below.</p>
                </div>
                
                <div className="bg-white p-4 rounded-3xl border-2 border-cyan-100 shadow-[0_0_40px_-10px_rgba(8,145,178,0.2)] inline-block">
                    <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(window.location.origin + window.location.pathname + "?wall=" + wall.id)}&color=0891b2&bgcolor=ffffff`} 
                        alt="QR Code" 
                        className="w-48 h-48 rounded-xl object-contain"
                    />
                </div>
                
                <div className="bg-sky-50 p-5 rounded-2xl border border-sky-100 relative group cursor-pointer hover:bg-sky-100 transition-colors" onClick={() => { navigator.clipboard.writeText(wall.joinCode); setShowCopyToast(true); setTimeout(() => setShowCopyToast(false), 2000); }}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Join Code</p>
                    <p className="text-4xl font-black text-cyan-600 tracking-widest">{wall.joinCode}</p>
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
                        <span className="text-xs font-bold text-cyan-600 uppercase tracking-widest">Click to Copy</span>
                    </div>
                </div>

                {isTeacher && (
                    <button 
                        onClick={handleClassroomShareOpen}
                        className="w-full py-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:bg-slate-50 active:bg-slate-100 transition-all flex items-center justify-center gap-3 group"
                    >
                        <div className="p-1 rounded bg-green-100"><img src="https://www.gstatic.com/classroom/logo_square_48.svg" className="w-5 h-5" alt="Classroom" /></div>
                        <span className="font-bold text-slate-700 group-hover:text-slate-900">Share to Google Classroom</span>
                    </button>
                )}
            </div>
        </div>
      )}

      {/* Classroom Share Modal */}
      {showClassroomModal && (
        <div className="fixed inset-0 z-[400] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl relative">
                <button onClick={() => setShowClassroomModal(false)} className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"><X size={20} /></button>
                <h3 className="text-2xl font-bold text-slate-900 mb-6 tracking-tight">Share to Classroom</h3>
                
                {shareSuccess ? (
                    <div className="py-12 text-center text-green-600">
                        <Check size={48} className="mx-auto mb-4" />
                        <h4 className="text-xl font-bold">Posted successfully!</h4>
                    </div>
                ) : (
                    <>
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-2 mb-6">
                            {courses.length === 0 ? (
                                <p className="text-center text-slate-400 py-8">No active courses found.</p>
                            ) : (
                                courses.map(course => (
                                    <div 
                                        key={course.id} 
                                        onClick={() => toggleCourse(course.id)}
                                        className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${selectedCourses.has(course.id) ? 'border-cyan-600 bg-cyan-50' : 'border-slate-100 hover:bg-slate-50'}`}
                                    >
                                        <div>
                                            <p className="font-bold text-slate-800">{course.name}</p>
                                            <p className="text-xs text-slate-500">{course.section}</p>
                                        </div>
                                        {selectedCourses.has(course.id) && <Check size={20} className="text-cyan-600" />}
                                    </div>
                                ))
                            )}
                        </div>
                        <button 
                            onClick={handleShareToClassroom}
                            disabled={selectedCourses.size === 0 || isSharingToClassroom}
                            className="w-full py-4 bg-cyan-600 text-white rounded-2xl font-bold hover:bg-cyan-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all flex items-center justify-center gap-2"
                        >
                            {isSharingToClassroom ? <Loader2 className="animate-spin" size={20} /> : 'Post Announcement'}
                        </button>
                    </>
                )}
            </div>
        </div>
      )}

      {showEditor && (
        <PostEditor 
          authorName={authorName}
          onClose={() => setShowEditor(false)} 
          onSubmit={handleOptimisticAddPost} 
        />
      )}

      {/* Settings Modal (Existing) */}
      {showSettings && isTeacher && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300 modal-overlay">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">
             {/* ... existing settings content ... */}
             <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">Wall Settings</h3>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400"><X size={24} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><ImageIcon size={14} /> Identity</h4>
                <div className="grid grid-cols-[auto_1fr] gap-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 ml-1">Icon</label>
                        <div className="h-16 w-16 bg-slate-100 rounded-2xl flex items-center justify-center text-3xl border border-slate-200">
                             <input 
                                type="text" 
                                className="w-full h-full text-center bg-transparent outline-none cursor-pointer" 
                                value={settingsForm.icon || '📝'} 
                                onChange={(e) => setSettingsForm({...settingsForm, icon: e.target.value.slice(0, 2)})}
                             />
                        </div>
                    </div>
                    <div className="space-y-4">
                         <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 ml-1">Wall Name</label>
                            <input 
                                type="text" 
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-cyan-500/20"
                                value={settingsForm.name || ''}
                                onChange={(e) => setSettingsForm({...settingsForm, name: e.target.value})}
                            />
                         </div>
                         <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 ml-1">Description</label>
                            <input 
                                type="text" 
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 outline-none focus:ring-2 focus:ring-cyan-500/20"
                                value={settingsForm.description || ''}
                                onChange={(e) => setSettingsForm({...settingsForm, description: e.target.value})}
                            />
                         </div>
                    </div>
                </div>
              </section>

              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><LayoutGrid size={14} /> Appearance</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {WALL_GRADIENTS.map(g => (
                    <button 
                        key={g} 
                        onClick={() => setSettingsForm({ ...settingsForm, background: g })} 
                        className={`h-20 rounded-2xl bg-gradient-to-br ${g} ${settingsForm.background === g ? 'ring-4 ring-cyan-500 ring-offset-2 scale-95' : 'hover:scale-105'} transition-all shadow-sm`} 
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 mt-4">
                    <span className="font-bold text-slate-700">Snap Posts to Grid</span>
                    <button onClick={() => setSettingsForm({ ...settingsForm, snapToGrid: !settingsForm.snapToGrid })} className={`w-12 h-6 rounded-full relative transition-colors ${settingsForm.snapToGrid ? 'bg-cyan-600' : 'bg-slate-300'}`}>
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settingsForm.snapToGrid ? 'left-7' : 'left-1'}`} />
                    </button>
                </div>
              </section>

              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Lock size={14} /> Privacy & Access</h4>
                
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex flex-col">
                        <span className="font-bold text-slate-700">Anonymous Posting</span>
                        <span className="text-xs text-slate-500">Hide author names on posts</span>
                    </div>
                    <button onClick={() => setSettingsForm({ ...settingsForm, isAnonymous: !settingsForm.isAnonymous })} className={`w-12 h-6 rounded-full relative transition-colors ${settingsForm.isAnonymous ? 'bg-cyan-600' : 'bg-slate-300'}`}>
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settingsForm.isAnonymous ? 'left-7' : 'left-1'}`} />
                    </button>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => setSettingsForm({...settingsForm, privacyType: 'link'})}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${settingsForm.privacyType !== 'private' ? 'bg-white shadow-md text-cyan-600' : 'text-slate-400 hover:bg-slate-200'}`}
                        >
                            <Unlock size={16} /> Open Access
                        </button>
                        <button 
                            onClick={() => setSettingsForm({...settingsForm, privacyType: 'private'})}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${settingsForm.privacyType === 'private' ? 'bg-white shadow-md text-cyan-600' : 'text-slate-400 hover:bg-slate-200'}`}
                        >
                            <Lock size={16} /> Restricted
                        </button>
                    </div>
                </div>
              </section>
            </div>
            
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button onClick={() => setShowSettings(false)} className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-200 rounded-xl transition-colors">Cancel</button>
                <button onClick={handleSaveSettings} className="px-8 py-3 bg-cyan-600 text-white font-bold rounded-xl shadow-lg hover:bg-cyan-700 active:scale-95 transition-all">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WallView;
