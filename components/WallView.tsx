
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Wall, Post as PostType, UserRole, ClassroomCourse } from '../types';
import Post from './Post';
import PostEditor from './PostEditor';
import { ChevronLeft, Plus, Share2, Settings, X, Check, ZoomIn, ZoomOut, Maximize, Loader2, AlertCircle, LayoutGrid, Lock, Unlock, Image as ImageIcon, Copy, Search, School, Trash2, ShieldAlert, Upload, HardDrive, Link as LinkIcon, Sparkles } from 'lucide-react';
import { WALL_GRADIENTS, POPULAR_EMOJIS } from '../constants';
import { databaseService } from '../services/databaseService';
import { classroomService } from '../services/classroomService';
import { GoogleGenAI } from "@google/genai";

declare const google: any;
const GOOGLE_CLIENT_ID = "6888240288-5v0p6nsoi64q1puv1vpvk1njd398ra8b.apps.googleusercontent.com";

interface WallViewProps {
  wallId: string;
  onBack: () => void;
  onAddPost: (post: Partial<PostType>) => Promise<PostType | null>;
  onDeletePost: (id: string) => void;
  onMovePost: (id: string, x: number, y: number) => Promise<void>;
  onUpdateWall: (wall: Partial<Wall>) => void;
  onEditPost: (id: string, post: Partial<PostType>) => Promise<PostType | null>; 
  currentUserId: string;
  authorName: string;
  userRole: UserRole;
}

const WallView: React.FC<WallViewProps> = ({ 
  wallId, onBack, onAddPost, onDeletePost, onMovePost, onUpdateWall, onEditPost, currentUserId, authorName, userRole 
}) => {
  const [wall, setWall] = useState<Wall | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [settingsForm, setSettingsForm] = useState<Partial<Wall>>({});
  const [bgPickerTab, setBgPickerTab] = useState<'presets' | 'upload' | 'drive' | 'url' | 'search'>('presets');
  const [bgSearch, setBgSearch] = useState('');
  const [bgUrlInput, setBgUrlInput] = useState('');
  const [isBgSearching, setIsBgSearching] = useState(false);
  
  const [showShareOverlay, setShowShareOverlay] = useState(false);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  
  const [showClassroomModal, setShowClassroomModal] = useState(false);
  const [courses, setCourses] = useState<ClassroomCourse[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [isSharingToClassroom, setIsSharingToClassroom] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  // Drive state for settings
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const driveTokenClient = useRef<any>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitialZoomed = useRef(false);
  const bgInputRef = useRef<HTMLInputElement>(null);
  
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const startZoomRef = useRef<number>(1); 

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  
  const optimisticPosts = useRef<Map<string, PostType>>(new Map());
  const optimisticTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastInteractionTime = useRef<number>(0);
  const lastTouchDistance = useRef<number | null>(null);
  const initialZoom = useRef<number>(1);

  useEffect(() => {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      driveTokenClient.current = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: any) => {
          if (response.access_token) {
            setDriveToken(response.access_token);
            fetchDriveFiles(response.access_token);
          }
        },
      });
    }
  }, []);

  const fetchDriveFiles = async (token: string) => {
    try {
        const q = "trashed = false and mimeType contains 'image/'";
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=20&fields=files(id,name,thumbnailLink,webViewLink)`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            setDriveFiles(data.files || []);
        }
    } catch (e) { console.error(e); }
  };

  const scheduleOptimisticCleanup = (postId: string) => {
    if (optimisticTimers.current.has(postId)) clearTimeout(optimisticTimers.current.get(postId)!);
    const timer = setTimeout(() => {
      optimisticPosts.current.delete(postId);
      optimisticTimers.current.delete(postId);
    }, 5000); 
    optimisticTimers.current.set(postId, timer);
  };

  const zoomFit = useCallback(() => {
    if (!wall || wall.posts.length === 0) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
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
          if (optimisticPosts.current.has(rp.id)) combinedPosts.push(optimisticPosts.current.get(rp.id)!);
          else combinedPosts.push(rp);
        });
        optimisticPosts.current.forEach((op, id) => { if (!remoteIds.has(id)) combinedPosts.push(op); });
        combinedPosts.sort((a, b) => a.zIndex - b.zIndex);
        setWall({ ...remoteWall, posts: combinedPosts });
        setError(null);
      } else { setError("Wall not found."); }
    } catch (err: any) { console.error("Sync error:", err); } finally { setIsSyncing(false); }
  }, [wallId]);

  useEffect(() => {
    if (wall && wall.posts.length > 0 && !hasInitialZoomed.current) {
        setTimeout(() => { zoomFit(); hasInitialZoomed.current = true; }, 100);
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
    if (isInteractionBlocked) return;
    if ((e.target as HTMLElement).closest('.post-container, .modal-overlay')) return;
    isPanning.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isInteractionBlocked) return;
    if (isPanning.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseUp = () => { isPanning.current = false; };

  const performZoomAtPoint = (newZoom: number, screenX: number, screenY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const targetX = screenX - rect.left;
    const targetY = screenY - rect.top;
    const curZoom = zoomRef.current;
    const curPan = panRef.current;
    const worldX = (targetX - curPan.x) / curZoom;
    const worldY = (targetY - curPan.y) / curZoom;
    const nextPanX = targetX - (worldX * newZoom);
    const nextPanY = targetY - (worldY * newZoom);
    setZoom(newZoom);
    setPan({ x: nextPanX, y: nextPanY });
    zoomRef.current = newZoom;
    panRef.current = { x: nextPanX, y: nextPanY };
  };

  const handleManualZoom = (direction: 1 | -1) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const nextZoom = Math.min(Math.max(zoomRef.current + (direction * 0.15), 0.05), 5);
    performZoomAtPoint(nextZoom, centerX, centerY);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheelNative = (e: WheelEvent) => {
      if (isInteractionBlocked) return;
      e.preventDefault(); 
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const zoomSensitivity = 0.003; 
        const delta = -e.deltaY * zoomSensitivity;
        const nextZoom = Math.min(Math.max(zoomRef.current + delta, 0.05), 5);
        performZoomAtPoint(nextZoom, e.clientX, e.clientY);
      } else {
        const nextPan = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY };
        setPan(nextPan);
        panRef.current = nextPan;
      }
    };
    const handleGestureStartNative = (e: any) => { e.preventDefault(); startZoomRef.current = zoomRef.current; };
    const handleGestureChangeNative = (e: any) => { e.preventDefault(); const nextZoom = Math.min(Math.max(startZoomRef.current * e.scale, 0.05), 5); performZoomAtPoint(nextZoom, e.clientX, e.clientY); };
    el.addEventListener('wheel', handleWheelNative, { passive: false });
    el.addEventListener('gesturestart', handleGestureStartNative as any);
    el.addEventListener('gesturechange', handleGestureChangeNative as any);
    return () => { 
      el.removeEventListener('wheel', handleWheelNative); 
      el.removeEventListener('gesturestart', handleGestureStartNative as any);
      el.removeEventListener('gesturechange', handleGestureChangeNative as any);
    };
  }, [showEditor, showSettings]); // Re-bind if blocking state changes

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isInteractionBlocked) return;
    if (e.touches.length === 1 && !(e.target as HTMLElement).closest('.post-container, .modal-overlay')) {
      isPanning.current = true;
      lastMousePos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      lastTouchDistance.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      initialZoom.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isInteractionBlocked) return;
    if (e.touches.length > 1) e.preventDefault();
    if (e.touches.length === 1 && isPanning.current) {
      const dx = e.touches[0].clientX - lastMousePos.current.x;
      const dy = e.touches[0].clientY - lastMousePos.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && lastTouchDistance.current) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const scaleFactor = dist / lastTouchDistance.current;
      const nextZoom = Math.min(Math.max(initialZoom.current * scaleFactor, 0.05), 5);
      performZoomAtPoint(nextZoom, centerX, centerY);
    }
  };

  const handleTouchEnd = () => { isPanning.current = false; lastTouchDistance.current = null; };

  const findSmartSlot = (posts: PostType[]) => {
    if (posts.length === 0) return { x: 100, y: 100 };
    const minX = Math.min(...posts.map(p => p.x)), maxX = Math.max(...posts.map(p => p.x + 300));
    const minY = Math.min(...posts.map(p => p.y)), maxY = Math.max(...posts.map(p => p.y + 250));
    if ((maxX - minX) >= (maxY - minY)) return { x: minX, y: maxY + 50 };
    return { x: maxX + 50, y: minY };
  };

  const handlePostMove = (id: string, x: number, y: number) => {
    if (wall?.isFrozen || isInteractionBlocked) return;
    lastInteractionTime.current = Date.now();
    setWall(prev => {
      if (!prev) return prev;
      const maxZ = Math.max(0, ...prev.posts.map(p => p.zIndex));
      const updatedPosts = prev.posts.map(p => p.id === id ? { ...p, x, y, zIndex: maxZ + 1 } : p);
      const movedPost = updatedPosts.find(p => p.id === id);
      if (movedPost) { optimisticPosts.current.set(id, movedPost); scheduleOptimisticCleanup(id); }
      return { ...prev, posts: updatedPosts };
    });
  };

  const handlePostMoveEnd = async (id: string, x: number, y: number) => {
    if (wall?.isFrozen || isInteractionBlocked) return;
    lastInteractionTime.current = Date.now();
    await onMovePost(id, x, y);
  };

  const handlePostSubmit = async (data: Partial<PostType>) => {
    if (wall?.isFrozen) return;
    if (editingPostId) {
        lastInteractionTime.current = Date.now();
        setWall(prev => prev ? ({ ...prev, posts: prev.posts.map(p => p.id === editingPostId ? { ...p, ...data } : p) }) : null);
        await onEditPost(editingPostId, data);
        setEditingPostId(null); setShowEditor(false);
        return;
    }
    const slot = findSmartSlot(wall?.posts || []);
    const tempId = 'temp_' + Date.now();
    const optimisticPost: PostType = {
      id: tempId, type: data.type || 'text', content: data.content || '',
      authorName, authorId: currentUserId, createdAt: Date.now(), x: slot.x, y: slot.y,
      zIndex: Math.max(0, ...(wall?.posts.map(p => p.zIndex) || [])) + 1,
      color: data.color || 'bg-white', metadata: data.metadata
    };
    optimisticPosts.current.set(tempId, optimisticPost);
    lastInteractionTime.current = Date.now();
    setWall(prev => prev ? ({ ...prev, posts: [...prev.posts, optimisticPost] }) : null);
    setShowEditor(false);
    const savedPost = await onAddPost({ ...data, x: slot.x, y: slot.y });
    if (savedPost) {
      optimisticPosts.current.delete(tempId);
      optimisticPosts.current.set(savedPost.id, savedPost);
      scheduleOptimisticCleanup(savedPost.id);
      setWall(prev => prev ? ({ ...prev, posts: prev.posts.map(p => p.id === tempId ? savedPost : p) }) : null);
    }
  };

  const handleEditClick = (postId: string) => { if (wall?.isFrozen) return; setEditingPostId(postId); setShowEditor(true); };
  const handleOpenSettings = () => { if (wall) setSettingsForm({ ...wall }); setShowSettings(true); setShowEmojiPicker(false); setEmojiSearch(''); };
  const handleSaveSettings = () => { lastInteractionTime.current = Date.now() + 10000; onUpdateWall(settingsForm); if (wall) setWall({ ...wall, ...settingsForm }); setShowSettings(false); };
  
  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSettingsForm({ ...settingsForm, background: reader.result as string });
      reader.readAsDataURL(file);
    }
  };

  const performBgSearch = async () => {
    if (!bgSearch) return;
    setIsBgSearching(true);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Find a high-quality, professional, and educational wallpaper image URL related to "${bgSearch}". Return ONLY the URL string.`,
            config: { tools: [{ googleSearch: {} }] }
        });
        const url = response.text.trim();
        if (url.startsWith('http')) {
            setSettingsForm({ ...settingsForm, background: url });
        }
    } catch (e) { console.error(e); } finally { setIsBgSearching(false); }
  };

  const handleCopyLink = () => { const link = wall ? (window.location.origin + window.location.pathname + "?wall=" + wall.joinCode) : window.location.href; navigator.clipboard.writeText(link); setShowCopyToast(true); setTimeout(() => setShowCopyToast(false), 2000); };
  const handleShare = () => setShowShareOverlay(true);
  const handleClassroomShareOpen = async () => {
    const token = sessionStorage.getItem('google_access_token');
    if (!token) return;
    setIsSyncing(true);
    const fetchedCourses = await classroomService.listCourses(token);
    setCourses(fetchedCourses);
    setShowClassroomModal(true);
    setShowShareOverlay(false);
    setIsSyncing(false);
  };

  const toggleCourseSelection = (id: string) => {
    const newSet = new Set(selectedCourses);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedCourses(newSet);
  };

  const handleShareToClassroom = async () => {
    const token = sessionStorage.getItem('google_access_token');
    if (!token || !wall || selectedCourses.size === 0) return;
    setIsSharingToClassroom(true);
    const courseIds = Array.from(selectedCourses);
    for (const cid of courseIds) { await classroomService.shareWallToCourse(token, cid, wall); }
    setIsSharingToClassroom(false);
    setShareSuccess(true);
    setTimeout(() => { setShareSuccess(false); setShowClassroomModal(false); setSelectedCourses(new Set()); }, 2000);
  };

  const handleDeleteWall = async () => {
    if (!wall) return;
    setIsSyncing(true);
    const success = await databaseService.deleteWall(wall.id);
    if (success) onBack();
    setIsSyncing(false);
  };

  const isInteractionBlocked = showEditor || showSettings || showShareOverlay || showClassroomModal || showDeleteConfirm;

  if (error) return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center"><AlertCircle className="mx-auto text-red-500 mb-4" size={48} /><h2 className="text-2xl font-bold">{error}</h2><button onClick={onBack} className="mt-4 px-6 py-2 bg-cyan-600 text-white rounded-xl">Back</button></div>;
  if (isSyncing && !wall) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-cyan-600" size={40} /></div>;
  if (!wall) return null;

  const isTeacher = (userRole === 'teacher' && wall.teacherId === currentUserId);
  const wallDeepLink = window.location.origin + window.location.pathname + "?wall=" + wall.joinCode;
  const filteredEmojis = emojiSearch ? POPULAR_EMOJIS.filter(e => e.includes(emojiSearch)) : POPULAR_EMOJIS;

  const backgroundStyle = wall.background.startsWith('http') || wall.background.startsWith('data:') 
    ? { backgroundImage: `url(${wall.background})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }
    : { background: wall.background.includes('from-') ? undefined : wall.background };

  return (
    <div 
      ref={containerRef}
      className={`relative min-h-screen w-full overflow-hidden flex flex-col transition-all duration-700 ${wall.background.includes('from-') ? 'bg-gradient-to-br ' + wall.background : ''} ${wall.isFrozen ? 'grayscale-[0.1] contrast-[0.9]' : ''}`}
      style={backgroundStyle}
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
             <div className="h-10 w-10 bg-white/30 backdrop-blur-md rounded-xl flex items-center justify-center text-xl shadow-sm border border-white/20">{wall.icon || '📝'}</div>
             <div>
                <div className="flex items-center gap-2">
                    <h2 className="text-xl font-extrabold text-white drop-shadow-md leading-tight">{wall.name}</h2>
                    {wall.isFrozen && <div className="px-2 py-0.5 bg-indigo-600/60 backdrop-blur-md rounded-full flex items-center gap-1 border border-white/20"><Lock size={10} className="text-white"/><span className="text-[10px] font-black text-white uppercase tracking-wider">Frozen</span></div>}
                </div>
                <p className="text-[10px] text-white/70 font-bold uppercase tracking-widest">Code: {wall.joinCode}</p>
             </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleShare} className="p-2.5 bg-white/20 hover:bg-white/30 text-white rounded-full backdrop-blur-md border border-white/20 transition-all"><Share2 size={20} /></button>
          {isTeacher && <button onClick={handleOpenSettings} className="p-2.5 bg-white/20 text-white rounded-full border border-white/20 hover:bg-white/30 transition-all"><Settings size={20} /></button>}
        </div>
      </header>

      <main id="canvas-root" className={`flex-1 relative overflow-hidden ${wall.isFrozen || isInteractionBlocked ? 'cursor-default pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}>
        <div 
          className="absolute origin-top-left transition-transform duration-75"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <div className="relative w-[10000px] h-[10000px]">
            {wall.posts.map(post => (
              <Post 
                key={post.id} post={post} zoom={zoom}
                onDelete={(id) => { setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null); onDeletePost(id); }} 
                onEdit={handleEditClick} onMove={handlePostMove} onMoveEnd={handlePostMoveEnd}
                isOwner={post.authorId === currentUserId || isTeacher} 
                snapToGrid={wall.snapToGrid} isWallAnonymous={wall.isAnonymous} isWallFrozen={wall.isFrozen}
              />
            ))}
          </div>
        </div>
      </main>

      <div className={`fixed bottom-10 left-10 z-[100] bg-white/90 backdrop-blur-md p-2 rounded-2xl shadow-2xl flex items-center gap-2 border border-slate-200 transition-opacity ${isInteractionBlocked ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        <button onClick={() => handleManualZoom(-1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ZoomOut size={20} /></button>
        <span className="text-[10px] font-black text-slate-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => handleManualZoom(1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ZoomIn size={20} /></button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button onClick={zoomFit} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center gap-2 font-bold text-xs"><Maximize size={18} /> Fit</button>
      </div>

      {!wall.isFrozen && (
        <button onClick={() => { setEditingPostId(null); setShowEditor(true); }} className={`fixed bottom-10 right-10 z-[100] h-20 w-20 bg-cyan-600 text-white rounded-full shadow-2xl hover:scale-110 flex items-center justify-center border-4 border-white/20 active:scale-95 transition-all ${isInteractionBlocked ? 'opacity-0 pointer-events-none scale-50' : 'opacity-100'}`}>
            <Plus size={40} />
        </button>
      )}

      {showCopyToast && <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[300] bg-slate-900/90 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 backdrop-blur-md border border-white/10 animate-in slide-in-from-top-4"><Check size={18} className="text-green-400" /> Link copied!</div>}

      {showSettings && isTeacher && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300 modal-overlay">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
             <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">Wall Settings</h3>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
              {/* Identity Section */}
              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><ImageIcon size={14} /> Identity</h4>
                <div className="grid grid-cols-[auto_1fr] gap-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 ml-1">Icon</label>
                        <div className="relative">
                            <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="h-16 w-16 bg-slate-100 rounded-2xl flex items-center justify-center text-4xl border border-slate-200 hover:bg-slate-200 transition-colors">{settingsForm.icon || '📝'}</button>
                            {showEmojiPicker && (
                                <div className="absolute top-full mt-2 left-0 z-50 bg-white rounded-2xl shadow-xl border border-slate-100 p-4 w-72 h-80 flex flex-col">
                                    <input type="text" placeholder="Search..." value={emojiSearch} onChange={(e) => setEmojiSearch(e.target.value)} className="w-full px-4 py-2 bg-slate-50 rounded-lg text-sm mb-2 outline-none" />
                                    <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-5 gap-2 content-start">
                                        {filteredEmojis.map((emoji, idx) => <button key={idx} onClick={() => { setSettingsForm({...settingsForm, icon: emoji}); setShowEmojiPicker(false); }} className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-slate-100 text-xl">{emoji}</button>)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="space-y-3">
                         <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold" value={settingsForm.name || ''} onChange={(e) => setSettingsForm({...settingsForm, name: e.target.value})} placeholder="Wall Name" />
                         <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600" value={settingsForm.description || ''} onChange={(e) => setSettingsForm({...settingsForm, description: e.target.value})} placeholder="Description" />
                    </div>
                </div>
              </section>

              {/* Appearance Section */}
              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><LayoutGrid size={14} /> Background</h4>
                
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl overflow-x-auto">
                    {[
                        { id: 'presets', icon: LayoutGrid, label: 'Presets' },
                        { id: 'upload', icon: Upload, label: 'Upload' },
                        { id: 'drive', icon: HardDrive, label: 'Drive' },
                        { id: 'url', icon: LinkIcon, label: 'URL' },
                        { id: 'search', icon: Sparkles, label: 'Search' }
                    ].map(tab => (
                        <button key={tab.id} onClick={() => setBgPickerTab(tab.id as any)} className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all ${bgPickerTab === tab.id ? 'bg-white shadow-sm text-cyan-600' : 'text-slate-400 hover:bg-white/50'}`}>
                            <tab.icon size={14} /> {tab.label}
                        </button>
                    ))}
                </div>

                <div className="min-h-[140px] p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    {bgPickerTab === 'presets' && (
                        <div className="grid grid-cols-4 gap-3">
                            {WALL_GRADIENTS.map(g => (
                                <button key={g} onClick={() => setSettingsForm({ ...settingsForm, background: g })} className={`h-16 rounded-xl bg-gradient-to-br ${g} ${settingsForm.background === g ? 'ring-4 ring-cyan-500 ring-offset-2' : ''}`} />
                            ))}
                        </div>
                    )}
                    {bgPickerTab === 'upload' && (
                        <div className="flex flex-col items-center justify-center h-full gap-3 py-4">
                            <Upload className="text-slate-300" size={32} />
                            <p className="text-xs font-bold text-slate-500">Upload a custom wallpaper</p>
                            <button onClick={() => bgInputRef.current?.click()} className="px-6 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold">Choose File</button>
                            <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                        </div>
                    )}
                    {bgPickerTab === 'drive' && (
                        <div className="space-y-3">
                            {!driveToken ? (
                                <div className="text-center py-4">
                                    <button onClick={() => driveTokenClient.current?.requestAccessToken()} className="px-6 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold">Connect Google Drive</button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-4 gap-2 h-32 overflow-y-auto custom-scrollbar pr-2">
                                    {driveFiles.map(file => (
                                        <button key={file.id} onClick={() => setSettingsForm({ ...settingsForm, background: file.webViewLink })} className="relative aspect-square bg-white rounded-lg overflow-hidden border border-slate-200 group">
                                            <img src={file.thumbnailLink} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                                            {settingsForm.background === file.webViewLink && <div className="absolute inset-0 bg-cyan-600/40 flex items-center justify-center"><Check className="text-white" size={20} /></div>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {bgPickerTab === 'url' && (
                        <div className="space-y-4 py-4">
                            <div className="flex gap-2">
                                <input type="text" placeholder="https://image-url.com/wallpaper.jpg" className="flex-1 px-4 py-2 bg-white border rounded-xl text-xs" value={bgUrlInput} onChange={e => setBgUrlInput(e.target.value)} />
                                <button onClick={() => setSettingsForm({ ...settingsForm, background: bgUrlInput })} className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold">Apply</button>
                            </div>
                        </div>
                    )}
                    {bgPickerTab === 'search' && (
                        <div className="space-y-4 py-4 text-center">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input type="text" placeholder="Space, Nature, Art..." className="w-full px-4 py-2 pl-9 bg-white border rounded-xl text-xs" value={bgSearch} onChange={e => setBgSearch(e.target.value)} />
                                    <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                                </div>
                                <button onClick={performBgSearch} disabled={isBgSearching} className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                                    {isBgSearching ? <Loader2 className="animate-spin" size={14} /> : 'Search'}
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Uses Gemini to find the perfect background</p>
                        </div>
                    )}
                </div>
              </section>

              {/* Controls Section */}
              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Lock size={14} /> Access Control</h4>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex flex-col"><span className="font-bold text-slate-700">Freeze Wall</span><span className="text-xs text-slate-500">Stop all changes</span></div>
                    <button onClick={() => setSettingsForm({ ...settingsForm, isFrozen: !settingsForm.isFrozen })} className={`w-12 h-6 rounded-full relative transition-colors ${settingsForm.isFrozen ? 'bg-indigo-600' : 'bg-slate-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settingsForm.isFrozen ? 'left-7' : 'left-1'}`} /></button>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex flex-col"><span className="font-bold text-slate-700">Anonymous Posting</span><span className="text-xs text-slate-500">Hide names</span></div>
                    <button onClick={() => setSettingsForm({ ...settingsForm, isAnonymous: !settingsForm.isAnonymous })} className={`w-12 h-6 rounded-full relative transition-colors ${settingsForm.isAnonymous ? 'bg-cyan-600' : 'bg-slate-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settingsForm.isAnonymous ? 'left-7' : 'left-1'}`} /></button>
                </div>
              </section>

              <section className="pt-6 border-t border-red-50"><button onClick={() => setShowDeleteConfirm(true)} className="w-full p-4 bg-red-50 text-red-600 rounded-2xl font-bold flex items-center justify-center gap-2"><Trash2 size={20} /> Delete Wall</button></section>
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3"><button onClick={() => setShowSettings(false)} className="px-6 py-3 text-slate-500 font-bold">Cancel</button><button onClick={handleSaveSettings} className="px-8 py-3 bg-cyan-600 text-white font-bold rounded-xl shadow-lg">Save Changes</button></div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
          <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
              <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full text-center space-y-6 animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                  <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600"><ShieldAlert size={32} /></div>
                  <h3 className="text-xl font-black">Delete Wall?</h3>
                  <div className="flex gap-4"><button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 font-bold bg-slate-100 rounded-xl">No</button><button onClick={handleDeleteWall} className="flex-1 py-3 font-black text-white bg-red-600 rounded-xl">Delete</button></div>
              </div>
          </div>
      )}

      {/* Share Modals (Unchanged logic) */}
      {showShareOverlay && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 modal-overlay" onClick={() => setShowShareOverlay(false)}>
            <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-sm w-full text-center space-y-6 relative" onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowShareOverlay(false)} className="absolute top-6 right-6 p-2 text-slate-400"><X size={24} /></button>
                <h3 className="text-2xl font-black">Join this Wall</h3>
                <div className="bg-white p-4 rounded-3xl border-2 border-cyan-100 inline-block">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(wallDeepLink)}&color=0891b2&bgcolor=ffffff`} alt="QR" className="w-48 h-48 rounded-xl object-contain"/>
                </div>
                <p className="text-4xl font-black text-cyan-600">{wall.joinCode}</p>
                <div className="flex gap-2"><button onClick={handleCopyLink} className="flex-1 py-4 bg-white border rounded-2xl flex items-center justify-center gap-2 font-bold"><Copy size={18} /> Copy Link</button></div>
                {isTeacher && <button onClick={handleClassroomShareOpen} className="w-full py-4 bg-white border rounded-2xl flex items-center justify-center gap-3 font-bold"><img src="https://www.gstatic.com/classroom/logo_square_48.svg" className="w-5 h-5" alt="" /> Share to Classroom</button>}
            </div>
        </div>
      )}

      {showEditor && <PostEditor authorName={authorName} initialPost={editingPostId ? wall.posts.find(p => p.id === editingPostId) : undefined} onClose={() => { setShowEditor(false); setEditingPostId(null); }} onSubmit={handlePostSubmit} />}

      {showClassroomModal && (
        <div className="fixed inset-0 z-[400] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowClassroomModal(false)}>
          <div className="bg-white rounded-[2rem] shadow-2xl p-8 max-w-lg w-full space-y-6 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowClassroomModal(false)} className="absolute top-6 right-6 p-2 text-slate-400"><X size={24} /></button>
            <h3 className="text-2xl font-black">Post to Classroom</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                {courses.map(course => (
                    <div key={course.id} onClick={() => toggleCourseSelection(course.id)} className={`p-4 rounded-2xl border-2 cursor-pointer flex items-center justify-between ${selectedCourses.has(course.id) ? 'border-green-500 bg-green-50' : 'border-slate-100 bg-white'}`}>
                        <div className="flex items-center gap-3"><School size={20} className={selectedCourses.has(course.id) ? 'text-green-600' : 'text-slate-400'} /><p className="font-bold text-slate-800">{course.name}</p></div>
                        {selectedCourses.has(course.id) && <Check size={20} className="text-green-600" />}
                    </div>
                ))}
            </div>
            <div className="pt-4 flex gap-4"><button onClick={() => setShowClassroomModal(false)} className="flex-1 py-4 font-bold">Cancel</button><button onClick={handleShareToClassroom} disabled={selectedCourses.size === 0 || isSharingToClassroom} className="flex-[2] py-4 rounded-2xl font-black bg-slate-900 text-white disabled:opacity-50">{isSharingToClassroom ? <Loader2 className="animate-spin" /> : 'Post to Classroom'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WallView;
