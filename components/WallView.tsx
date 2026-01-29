
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Wall, Post as PostType, UserRole, ClassroomCourse, WallType } from '../types';
import Post from './Post';
import PostEditor from './PostEditor';
import { ChevronLeft, Plus, Share2, Settings, X, Check, ZoomIn, ZoomOut, Maximize, Loader2, AlertCircle, LayoutGrid, Lock, Unlock, Image as ImageIcon, Copy, Search, School, Trash2, ShieldAlert, Upload, HardDrive, Link as LinkIcon, Sparkles, Grip, Layers, List, History, Kanban, Info, LogIn } from 'lucide-react';
import { WALL_GRADIENTS } from '../constants';
import { databaseService } from '../services/databaseService';
import { classroomService } from '../services/classroomService';
import { GoogleGenAI } from "@google/genai";
import EmojiPicker from 'emoji-picker-react';

declare const google: any;
const GOOGLE_CLIENT_ID = "6888240288-5v0p6nsoi64q1puv1vpvk1njd398ra8b.apps.googleusercontent.com";

const TIMELINE_AXIS_Y = 450; 
const MIN_MILESTONE_SPACING = 340; // 300px card + 40px gap
const KANBAN_COLUMN_WIDTH = 340;
const KANBAN_START_X = 50;

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
  isGuest?: boolean;
}

const WallView: React.FC<WallViewProps> = ({ 
  wallId, onBack, onAddPost, onDeletePost, onMovePost, onUpdateWall, onEditPost, currentUserId, authorName, userRole, isGuest 
}) => {
  const [wall, setWall] = useState<Wall | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
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
  const [showInfo, setShowInfo] = useState(false);
  
  const [showClassroomModal, setShowClassroomModal] = useState(false);
  const [courses, setCourses] = useState<ClassroomCourse[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [isSharingToClassroom, setIsSharingToClassroom] = useState(false);

  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [driveToken, setDriveToken] = useState<string | null>(sessionStorage.getItem('google_drive_token'));
  const driveTokenClient = useRef<any>(null);
  const classroomTokenClient = useRef<any>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitialZoomed = useRef(false);
  const bgInputRef = useRef<HTMLInputElement>(null);
  
  const [draggingPostId, setDraggingPostId] = useState<string | null>(null);

  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const wallRef = useRef<Wall | null>(null);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { wallRef.current = wall; }, [wall]);
  
  const optimisticPosts = useRef<Map<string, PostType>>(new Map());
  const optimisticTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastInteractionTime = useRef<number>(0);

  const isCanvasMode = wall?.type === 'freeform' || wall?.type === 'timeline' || wall?.type === 'kanban';
  const isInteractionBlocked = showEditor || showSettings || showShareOverlay || showClassroomModal || showDeleteConfirm || showInfo;

  useEffect(() => {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      driveTokenClient.current = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: any) => {
          if (response.access_token) {
            sessionStorage.setItem('google_drive_token', response.access_token);
            setDriveToken(response.access_token);
            fetchDriveFiles(response.access_token);
          }
        },
      });

      classroomTokenClient.current = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.announcements',
        callback: (response: any) => {
          if (response.access_token) {
            sessionStorage.setItem('google_access_token', response.access_token);
            openClassroomModal(response.access_token);
          }
        },
      });
    }
  }, []);

  useEffect(() => {
    if (driveToken && driveFiles.length === 0 && showSettings && bgPickerTab === 'drive') {
      fetchDriveFiles(driveToken);
    }
  }, [driveToken, showSettings, bgPickerTab, driveFiles.length]);

  const fetchDriveFiles = async (token: string) => {
    try {
        const q = "trashed = false and mimeType contains 'image/'";
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=20&fields=files(id,name,thumbnailLink,webViewLink)`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            setDriveFiles(data.files || []);
        } else if (res.status === 401) {
            sessionStorage.removeItem('google_drive_token');
            setDriveToken(null);
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

  const syncWall = useCallback(async () => {
    if (Date.now() - lastInteractionTime.current < 500 || draggingPostId) return;
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
        
        const currentType = remoteWall.type as string;
        if (currentType === 'timeline') {
           combinedPosts.sort((a, b) => {
              if (a.parentId && b.parentId && a.parentId === b.parentId) return a.createdAt - b.createdAt;
              if (!a.parentId && !b.parentId) return a.x - b.x;
              return a.createdAt - b.createdAt;
           });
        } else if (currentType === 'kanban') {
           combinedPosts.sort((a, b) => {
               if (!a.parentId && !b.parentId) return a.x - b.x; // Sort columns by X
               if (a.parentId && b.parentId && a.parentId === b.parentId) return a.y - b.y; // Sort items by Y
               return 0;
           });
        } else if (currentType === 'freeform') {
           combinedPosts.sort((a, b) => a.zIndex - b.zIndex);
        } else {
           combinedPosts.sort((a, b) => a.createdAt - b.createdAt);
        }
        
        setWall({ ...remoteWall, posts: combinedPosts });
        setError(null);
      } else { 
        if (!wallRef.current) {
            setError("Wall not found."); 
        }
      }
    } catch (err: any) { console.error("Sync error:", err); } finally { setIsSyncing(false); }
  }, [wallId, draggingPostId]);

  const zoomFit = useCallback(() => {
    if (!wall || wall.posts.length === 0 || !isCanvasMode) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
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
  }, [wall, isCanvasMode]);

  useEffect(() => {
    if (wall && wall.posts.length > 0 && isCanvasMode && !hasInitialZoomed.current) {
        setTimeout(() => { zoomFit(); hasInitialZoomed.current = true; }, 100);
    }
  }, [wall, zoomFit, isCanvasMode]);

  useEffect(() => {
    syncWall();
    const interval = setInterval(syncWall, 3000);
    return () => clearInterval(interval);
  }, [syncWall]);

  const isPanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (isInteractionBlocked || !isCanvasMode) return;
    if ((e.target as HTMLElement).closest('.post-container, .modal-overlay, header, .fixed')) return;
    isPanning.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isInteractionBlocked || !isCanvasMode) return;
    if (isPanning.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseUp = () => { isPanning.current = false; };

  // --- TOUCH HANDLERS FOR CANVAS PANNING ---
  const handleCanvasTouchStart = (e: React.TouchEvent) => {
    if (isInteractionBlocked || !isCanvasMode) return;
    if ((e.target as HTMLElement).closest('.post-container, .modal-overlay, header, .fixed')) return;
    
    const touch = e.touches[0];
    isPanning.current = true;
    lastMousePos.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleCanvasTouchMove = (e: React.TouchEvent) => {
    if (isInteractionBlocked || !isCanvasMode || !isPanning.current) return;
    
    // Crucial for iOS canvas panning
    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];
    const dx = touch.clientX - lastMousePos.current.x;
    const dy = touch.clientY - lastMousePos.current.y;
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    lastMousePos.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleCanvasTouchEnd = () => { isPanning.current = false; };

  const performZoomAtPoint = (newZoom: number, screenX: number, screenY: number) => {
    if (!isCanvasMode) return;
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
    if (isInteractionBlocked || !isCanvasMode) return;
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
    if (!el || !isCanvasMode) return;
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
    el.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => { el.removeEventListener('wheel', handleWheelNative); };
  }, [isInteractionBlocked, wall?.type, isCanvasMode]); 

  const findSmartSlot = (posts: PostType[]) => {
    const rootPosts = posts.filter(p => !p.parentId);

    if ((wall?.type as string) === 'timeline') {
       const milestones = rootPosts;
       const slotCount = milestones.length;
       return { x: slotCount * MIN_MILESTONE_SPACING, y: TIMELINE_AXIS_Y };
    }
    if ((wall?.type as string) === 'kanban') {
       const columns = rootPosts;
       const slotCount = columns.length;
       return { x: KANBAN_START_X + (slotCount * KANBAN_COLUMN_WIDTH), y: 50 };
    }
    
    // Freeform logic: Grid Packing relative to top-left of content
    if (rootPosts.length === 0) return { x: 100, y: 100 };

    const minX = Math.min(...rootPosts.map(p => p.x));
    const minY = Math.min(...rootPosts.map(p => p.y));
    
    // Normalize start to be somewhat aligned
    const startX = Math.floor(minX / 10) * 10;
    const startY = Math.floor(minY / 10) * 10;

    const CARD_W = 300;
    const GAP = 40;
    const COL_WIDTH = CARD_W + GAP;
    const ROW_HEIGHT = 320; 
    const MAX_COLS = 6; 

    let col = 0;
    let row = 0;

    while (true) {
        const x = startX + (col * COL_WIDTH);
        const y = startY + (row * ROW_HEIGHT);
        
        const collision = rootPosts.some(p => {
             // Check overlap with existing post p
             return (x < p.x + 280 && x + 280 > p.x && y < p.y + 200 && y + 200 > p.y);
        });

        if (!collision) {
            return { x, y };
        }

        col++;
        if (col >= MAX_COLS) {
            col = 0;
            row++;
        }
        
        if (row > 500) return { x: startX + 100, y: startY + 100 };
    }
  };

  const handlePostDragStart = (id: string) => {
      setDraggingPostId(id);
  };

  const handlePostMove = (id: string, x: number, y: number, clientX?: number, clientY?: number) => {
    if (wall?.isFrozen || isInteractionBlocked || !isCanvasMode) return;
    lastInteractionTime.current = Date.now();
    setWall(prev => {
      if (!prev) return prev;
      
      let updatedPosts = [...prev.posts];
      const targetPost = updatedPosts.find(p => p.id === id);
      if (!targetPost) return prev;
      
      let newParentId = targetPost.parentId;

      if ((prev.type as string) === 'timeline' && !targetPost.parentId) {
        // Timeline logic...
        const proposedIdx = Math.max(0, Math.round(x / MIN_MILESTONE_SPACING));
        const others = updatedPosts.filter(p => !p.parentId && p.id !== id).sort((a, b) => a.x - b.x);
        const reordered = [...others];
        reordered.splice(proposedIdx, 0, { ...targetPost, x }); 
        const finalMilestones = reordered.map((m, idx) => {
            const discreteX = idx * MIN_MILESTONE_SPACING;
            if (m.id === id) return { ...m, x }; 
            const updatedOther = { ...m, x: discreteX, y: TIMELINE_AXIS_Y };
            optimisticPosts.current.set(updatedOther.id, updatedOther);
            scheduleOptimisticCleanup(updatedOther.id);
            return updatedOther;
        });
        updatedPosts = updatedPosts.map(p => {
           const fm = finalMilestones.find(m => m.id === p.id);
           return fm ? fm : p;
        });
      } else if ((prev.type as string) === 'kanban') {
          // Kanban Logic
          if (targetPost.parentId && clientX !== undefined) {
              // It's a Card. Check for column switching using absolute clientX.
              // Calculate Canvas X.
              const el = containerRef.current;
              if (el) {
                  const rect = el.getBoundingClientRect();
                  const canvasX = (clientX - rect.left - pan.x) / zoom;
                  
                  // Identify nearest column
                  const columns = updatedPosts.filter(p => !p.parentId).sort((a, b) => a.x - b.x);
                  let targetColumn = columns[0];
                  
                  // Simple binning based on X
                  const colIndex = Math.max(0, Math.min(columns.length - 1, Math.floor((canvasX - KANBAN_START_X) / KANBAN_COLUMN_WIDTH)));
                  if (colIndex >= 0 && colIndex < columns.length) {
                      targetColumn = columns[colIndex];
                  }

                  if (targetColumn && targetColumn.id !== targetPost.parentId) {
                      // Switch Parent Live!
                      newParentId = targetColumn.id;
                      updatedPosts = updatedPosts.map(p => p.id === id ? { ...p, parentId: targetColumn.id, y } : p);
                  } else {
                      // Same Parent, just update Y
                      updatedPosts = updatedPosts.map(p => p.id === id ? { ...p, y } : p);
                  }
              }
          } else {
              // Just update X/Y (Columns or simple move)
              updatedPosts = updatedPosts.map(p => p.id === id ? { ...p, x, y } : p);
          }
          optimisticPosts.current.set(id, { ...targetPost, x, y, parentId: newParentId });
      } else {
        const finalY = ((prev.type as string) === 'timeline' && !targetPost.parentId) ? TIMELINE_AXIS_Y : y;
        updatedPosts = updatedPosts.map(p => p.id === id ? { ...p, x, y: finalY } : p);
        optimisticPosts.current.set(id, { ...targetPost, x, y: finalY });
      }
      scheduleOptimisticCleanup(id);

      return { ...prev, posts: updatedPosts };
    });
  };

  const handlePostMoveEnd = async (id: string, x: number, y: number) => {
    if (wall?.isFrozen || isInteractionBlocked || !isCanvasMode) return;
    lastInteractionTime.current = Date.now();
    setDraggingPostId(null);
    
    if ((wall?.type as string) === 'timeline') {
       const finalSlotIdx = Math.max(0, Math.round(x / MIN_MILESTONE_SPACING));
       const finalX = finalSlotIdx * MIN_MILESTONE_SPACING;
       setWall(prev => {
          if (!prev) return prev;
          return { ...prev, posts: prev.posts.map(p => p.id === id ? { ...p, x: finalX } : p) };
       });
       const milestones = wall.posts.filter(p => !p.parentId);
       const promises = milestones.map(m => {
          const mX = m.id === id ? finalX : m.x;
          return onMovePost(m.id, mX, TIMELINE_AXIS_Y);
       });
       await Promise.all(promises);

    } else if ((wall?.type as string) === 'kanban') {
       const optimisticState = optimisticPosts.current.get(id);
       const originalPost = wall.posts.find(p => p.id === id);
       
       if (originalPost?.parentId) {
           const finalParentId = optimisticState?.parentId || originalPost.parentId;
           const finalY = optimisticState?.y !== undefined ? optimisticState.y : y;

           if (finalParentId !== originalPost.parentId) {
               await onEditPost(id, { parentId: finalParentId });
           }
           await onMovePost(id, 0, finalY); 
       } else {
           const movedPost = originalPost;
           if (!movedPost) return;

           const colWidth = KANBAN_COLUMN_WIDTH;
           const proposedIdx = Math.max(0, Math.round((x - KANBAN_START_X) / colWidth));
           const columns = wall.posts.filter(p => !p.parentId && p.id !== id).sort((a, b) => a.x - b.x);
           columns.splice(proposedIdx, 0, movedPost);
           
           const updates = columns.map((col, idx) => ({ 
               id: col.id, 
               x: KANBAN_START_X + (idx * colWidth),
               y: 50 
           }));

           setWall(prev => prev ? ({ ...prev, posts: prev.posts.map(p => {
               const update = updates.find(u => u.id === p.id);
               return update ? { ...p, x: update.x, y: update.y } : p;
           })}) : null);

           await Promise.all(updates.map(u => onMovePost(u.id, u.x, u.y)));
       }
    } else {
       await onMovePost(id, x, y);
    }
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
    const slot = isCanvasMode ? findSmartSlot(wall?.posts || []) : { x: 0, y: 0 };
    
    // Auto-center on new post
    if (isCanvasMode) {
      const containerW = containerRef.current?.clientWidth || window.innerWidth;
      const containerH = containerRef.current?.clientHeight || window.innerHeight;
      
      const centerX = slot.x + 150; 
      const centerY = slot.y + 100;

      const newPanX = (containerW / 2) - (centerX * zoom);
      const newPanY = (containerH / 2) - (centerY * zoom);

      setPan({ x: newPanX, y: newPanY });
    }

    const tempId = 'temp_' + Date.now();
    const optimisticPost: PostType = {
      id: tempId, type: data.type || 'title', title: data.title, content: data.content || '',
      authorName, authorId: currentUserId, createdAt: Date.now(), x: slot.x, y: slot.y,
      zIndex: Math.max(0, ...(wall?.posts.map(p => p.zIndex) || [])) + 1,
      color: data.color || 'bg-white', metadata: data.metadata,
      parentId: data.parentId
    };
    optimisticPosts.current.set(tempId, optimisticPost);
    lastInteractionTime.current = Date.now();
    setWall(prev => prev ? ({ ...prev, posts: [...prev.posts, optimisticPost] }) : null);
    setShowEditor(false);
    setActiveParentId(null);
    const savedPost = await onAddPost({ ...data, x: slot.x, y: slot.y });
    if (savedPost) {
      optimisticPosts.current.delete(tempId);
      optimisticPosts.current.set(savedPost.id, savedPost);
      scheduleOptimisticCleanup(savedPost.id);
      setWall(prev => prev ? ({ ...prev, posts: prev.posts.map(p => p.id === tempId ? savedPost : p) }) : null);
    }
  };

  const handleEditClick = (postId: string) => { if (wall?.isFrozen) return; setEditingPostId(postId); setShowEditor(true); };
  const handleOpenSettings = () => { if (wall) setSettingsForm({ ...wall }); setShowSettings(true); setShowEmojiPicker(false); setBgSearch(''); };
  const handleSaveSettings = () => { lastInteractionTime.current = Date.now() + 10000; onUpdateWall(settingsForm); if (wall) setWall({ ...wall, ...settingsForm }); setShowSettings(false); };
  
  const handleAddDetail = (parentId: string) => {
    setActiveParentId(parentId);
    setEditingPostId(null);
    setShowEditor(true);
  };

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
            model: 'gemgemini-3-flash-preview',
            contents: `Find a direct URL to a high-quality professional wallpaper for "${bgSearch}". Return ONLY the URL string.`,
            config: { tools: [{ googleSearch: {} }] }
        });
        const url = response.text.trim().replace(/`/g, '');
        if (url.startsWith('http')) {
            setSettingsForm({ ...settingsForm, background: url });
        }
    } catch (e) { console.error(e); } finally { setIsBgSearching(false); }
  };

  const handleCopyLink = () => { const link = wall ? (window.location.origin + window.location.pathname + "?wall=" + wall.joinCode) : window.location.href; navigator.clipboard.writeText(link); setShowCopyToast(true); setTimeout(() => setShowCopyToast(false), 2000); };
  const handleShare = () => setShowShareOverlay(true);
  
  const openClassroomModal = async (token: string) => {
    setIsSyncing(true);
    const fetchedCourses = await classroomService.listCourses(token);
    setCourses(fetchedCourses);
    setShowClassroomModal(true);
    setShowShareOverlay(false);
    setIsSyncing(false);
  }

  const handleClassroomShareOpen = async () => {
    const token = sessionStorage.getItem('google_access_token');
    if (!token) {
        classroomTokenClient.current?.requestAccessToken();
        return;
    }
    await openClassroomModal(token);
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
    setShowClassroomModal(false); 
    setSelectedCourses(new Set());
  };

  const handleDeleteWall = async () => {
    if (!wall) return;
    setIsSyncing(true);
    const success = await databaseService.deleteWall(wall.id);
    if (success) onBack();
    setIsSyncing(false);
  };

  if (error) return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center"><AlertCircle className="mx-auto text-red-500 mb-4" size={48} /><h2 className="text-2xl font-bold">{error}</h2><button onClick={onBack} className="mt-4 px-6 py-2 bg-cyan-600 text-white rounded-xl">Back</button></div>;
  if (isSyncing && !wall) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-cyan-600" size={40} /></div>;
  if (!wall) return null;

  const isTeacher = (userRole === 'teacher' && wall.teacherId === currentUserId);
  const backgroundStyle = wall.background.startsWith('http') || wall.background.startsWith('data:') 
    ? { backgroundImage: `url(${wall.background})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }
    : { background: wall.background.includes('from-') ? undefined : wall.background };

  const isImageBackground = (settingsForm.background?.startsWith('http') || settingsForm.background?.startsWith('data:image')) && !WALL_GRADIENTS.includes(settingsForm.background!);

  const milestones = wall.type === 'timeline' ? wall.posts.filter(p => !p.parentId) : [];
  const kanbanColumns = wall.type === 'kanban' ? wall.posts.filter(p => !p.parentId).sort((a, b) => a.x - b.x) : [];
  
  const getAttachments = (parentId: string) => {
      const children = wall.posts.filter(p => p.parentId === parentId);
      if (wall.type === 'kanban') {
          return children.sort((a, b) => a.y - b.y);
      }
      return children;
  };

  const canContribute = !wall.requireLoginToPost || !isGuest;

  return (
    <div 
      ref={containerRef}
      className={`relative h-[100dvh] w-full overflow-hidden flex flex-col transition-all duration-700 ${wall.background.includes('from-') ? 'bg-gradient-to-br ' + wall.background : ''} ${wall.isFrozen ? 'grayscale-[0.1] contrast-[0.9]' : ''}`}
      style={backgroundStyle}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseUp}
      onTouchStart={handleCanvasTouchStart}
      onTouchMove={handleCanvasTouchMove}
      onTouchEnd={handleCanvasTouchEnd}
    >
      <header className="sticky top-0 z-[100] bg-white/80 backdrop-blur-xl border-b border-slate-200/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"><ChevronLeft size={24} /></button>
          <div className="flex items-center gap-3">
             <div className="h-10 w-10 bg-white/30 backdrop-blur-md rounded-xl flex items-center justify-center text-xl shadow-sm border border-slate-200/50">{wall.icon || '📝'}</div>
             <div>
                <div className="flex items-center gap-2">
                    <h2 className="text-xl font-extrabold text-slate-800 drop-shadow-sm leading-tight">{wall.name}</h2>
                    <button onClick={() => setShowInfo(true)} className="p-1 text-slate-400 hover:text-cyan-600 transition-colors"><Info size={16} /></button>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                        {wall.type === 'freeform' && <Grip size={8} />}
                        {wall.type === 'wall' && <Layers size={8} />}
                        {wall.type === 'stream' && <List size={8} />}
                        {wall.type === 'timeline' && <History size={8} />}
                        {wall.type === 'kanban' && <Kanban size={8} />}
                        {wall.type}
                      </span>
                    </div>
                </div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Code: {wall.joinCode}</p>
             </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleShare} className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full border border-slate-200/50 transition-all"><Share2 size={20} /></button>
          {isTeacher && <button onClick={handleOpenSettings} className="p-2.5 bg-slate-100 text-slate-600 rounded-full border border-slate-200/50 hover:bg-slate-200 transition-all"><Settings size={20} /></button>}
        </div>
      </header>

      <main id="canvas-root" className={`flex-1 relative ${isCanvasMode ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar p-6 pb-40'} ${wall.isFrozen || isInteractionBlocked ? 'cursor-default pointer-events-none' : (isCanvasMode ? 'cursor-grab active:cursor-grabbing' : '')}`}>
        {isCanvasMode ? (
           <div 
             className="absolute origin-top-left transition-transform duration-75"
             style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
           >
             <div className="relative w-[10000px] h-[10000px]">
               {wall.type === 'timeline' && (
                  <div className={`absolute left-[-30000px] w-[60000px] h-1 bg-white/60 shadow-md z-0 pointer-events-none`} style={{ top: `${TIMELINE_AXIS_Y}px` }} />
               )}

               {wall.type === 'timeline' ? (
                  milestones.map(milestone => (
                    <Post 
                      key={milestone.id} post={milestone} zoom={zoom}
                      onDelete={(id) => { setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null); onDeletePost(id); }} 
                      onEdit={handleEditClick} onMove={handlePostMove} onMoveEnd={handlePostMoveEnd}
                      onAddDetail={handleAddDetail}
                      isOwner={(milestone.authorId === currentUserId || isTeacher) && canContribute} 
                      snapToGrid={wall.snapToGrid} isWallAnonymous={wall.isAnonymous} isWallFrozen={wall.isFrozen}
                      isTimelineMilestone={true}
                    >
                      {getAttachments(milestone.id).map(attachment => (
                        <div key={attachment.id} className="scale-90 opacity-90 hover:opacity-100 hover:scale-95 transition-all w-[300px]">
                          <Post 
                            post={{...attachment, x: 0, y: 0}} zoom={1}
                            onDelete={(id) => { setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null); onDeletePost(id); }} 
                            onEdit={handleEditClick} onMove={() => {}} onMoveEnd={() => {}}
                            isOwner={(attachment.authorId === currentUserId || isTeacher) && canContribute} 
                            snapToGrid={false} isWallAnonymous={wall.isAnonymous} isWallFrozen={wall.isFrozen}
                          />
                        </div>
                      ))}
                    </Post>
                  ))
               ) : wall.type === 'kanban' ? (
                   kanbanColumns.map(column => (
                        <Post
                            key={column.id} post={column} zoom={zoom}
                            onDelete={(id) => { setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null); onDeletePost(id); }}
                            onEdit={handleEditClick} onMove={handlePostMove} onMoveEnd={handlePostMoveEnd}
                            onAddDetail={handleAddDetail}
                            isOwner={isTeacher && canContribute} // Only teachers move/edit columns
                            snapToGrid={false} isWallAnonymous={wall.isAnonymous} isWallFrozen={wall.isFrozen}
                            isKanbanColumn={true}
                        >
                            {getAttachments(column.id).map(card => {
                                if (card.id === draggingPostId) {
                                    return (
                                        <React.Fragment key={card.id}>
                                            <div className="w-full h-32 border-2 border-dashed border-cyan-300 bg-cyan-50/50 rounded-2xl mb-3" />
                                            <Post
                                                post={{...card, x: 0, y: 0}} zoom={zoom} 
                                                onDelete={(id) => { setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null); onDeletePost(id); }}
                                                onEdit={handleEditClick} onMove={handlePostMove} onMoveEnd={handlePostMoveEnd} onDragStart={handlePostDragStart}
                                                isOwner={(card.authorId === currentUserId || isTeacher) && canContribute}
                                                snapToGrid={false} isWallAnonymous={wall.isAnonymous} isWallFrozen={wall.isFrozen}
                                                isKanbanCard={true}
                                            />
                                        </React.Fragment>
                                    );
                                }
                                return (
                                    <div key={card.id} className="w-full relative">
                                        <Post
                                            post={{...card, x: 0, y: 0}} zoom={zoom} 
                                            onDelete={(id) => { setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null); onDeletePost(id); }}
                                            onEdit={handleEditClick} onMove={handlePostMove} onMoveEnd={handlePostMoveEnd} onDragStart={handlePostDragStart}
                                            isOwner={(card.authorId === currentUserId || isTeacher) && canContribute}
                                            snapToGrid={false} isWallAnonymous={wall.isAnonymous} isWallFrozen={wall.isFrozen}
                                            isKanbanCard={true}
                                        />
                                    </div>
                                );
                            })}
                        </Post>
                   ))
               ) : (
                  wall.posts.map(post => (
                    <Post 
                      key={post.id} post={post} zoom={zoom}
                      onDelete={(id) => { setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null); onDeletePost(id); }} 
                      onEdit={handleEditClick} onMove={handlePostMove} onMoveEnd={handlePostMoveEnd}
                      isOwner={(post.authorId === currentUserId || isTeacher) && canContribute} 
                      snapToGrid={wall.snapToGrid} isWallAnonymous={wall.isAnonymous} isWallFrozen={wall.isFrozen}
                    />
                  ))
               )}
             </div>
           </div>
        ) : (
          <div className={wall.type === 'wall' ? "max-w-7xl mx-auto columns-1 sm:columns-2 lg:columns-3 gap-4" : "max-w-3xl mx-auto space-y-4"}>
            {wall.posts.map(post => (
              <div key={post.id} className="break-inside-avoid mb-4">
                <Post 
                  post={{...post, x: 0, y: 0}} zoom={1}
                  onDelete={(id) => { setWall(prev => prev ? ({ ...prev, posts: prev.posts.filter(p => p.id !== id) }) : null); onDeletePost(id); }} 
                  onEdit={handleEditClick} onMove={() => {}} onMoveEnd={() => {}}
                  isOwner={(post.authorId === currentUserId || isTeacher) && canContribute} 
                  snapToGrid={false} isWallAnonymous={wall.isAnonymous} isWallFrozen={wall.isFrozen}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      {isCanvasMode && (
        <div className={`fixed bottom-10 left-10 z-[100] bg-white/90 backdrop-blur-md p-2 rounded-2xl shadow-2xl flex items-center gap-2 border border-slate-200 transition-opacity ${isInteractionBlocked ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
          <button onClick={() => handleManualZoom(-1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ZoomOut size={20} /></button>
          <span className="text-[10px] font-black text-slate-600 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => handleManualZoom(1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ZoomIn size={20} /></button>
          <div className="w-px h-6 bg-slate-200 mx-1" />
          <button onClick={zoomFit} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center gap-2 font-bold text-xs"><Maximize size={18} /> Fit</button>
        </div>
      )}

      {!wall.isFrozen && canContribute && (
        <button onClick={() => { setEditingPostId(null); setActiveParentId(null); setShowEditor(true); }} className={`fixed bottom-10 right-10 z-[100] h-20 w-20 bg-cyan-600 text-white rounded-full shadow-2xl hover:scale-110 flex items-center justify-center border-4 border-white/20 active:scale-95 transition-all ${isInteractionBlocked ? 'opacity-0 pointer-events-none scale-50' : 'opacity-100'}`}>
            <Plus size={40} />
        </button>
      )}

      {!wall.isFrozen && !canContribute && (
          <div className="fixed bottom-10 right-10 z-[100] px-6 py-3 bg-slate-800 text-white rounded-full shadow-xl flex items-center gap-2 font-bold text-xs border-2 border-slate-700 backdrop-blur-md">
              <Lock size={14} className="text-slate-400" />
              Read-only mode. Sign in to contribute.
          </div>
      )}

      {showCopyToast && <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[300] bg-slate-900/90 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 backdrop-blur-md border border-white/10 animate-in slide-in-from-top-4"><Check size={18} className="text-green-400" /> Link copied!</div>}

      {showShareOverlay && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setShowShareOverlay(false)}>
            <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-sm w-full text-center space-y-6 relative animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowShareOverlay(false)} className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600"><X size={24} /></button>
                <h3 className="text-2xl font-black text-slate-800">Join this Wall</h3>
                <div className="bg-white p-4 rounded-3xl border-2 border-cyan-100 inline-block shadow-sm">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(window.location.origin + window.location.pathname + "?wall=" + wall.joinCode)}&color=0891b2&bgcolor=ffffff`} alt="QR" className="w-48 h-48 rounded-xl object-contain"/>
                </div>
                <p className="text-4xl font-black text-cyan-600 tracking-tighter">{wall.joinCode}</p>
                <button onClick={handleCopyLink} className="w-full py-4 bg-white border border-slate-100 rounded-2xl flex items-center justify-center gap-2 font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm">
                    <Copy size={18} /> Copy Link
                </button>
                {isTeacher && (
                    <button onClick={handleClassroomShareOpen} className="w-full py-4 bg-slate-900 text-white rounded-2xl flex items-center justify-center gap-2 font-bold hover:bg-slate-800 transition-colors shadow-lg">
                        <School size={18} /> Share to Classroom
                    </button>
                )}
            </div>
        </div>
      )}

      {showInfo && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowInfo(false)}>
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl relative" onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowInfo(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
                <div className="flex items-center gap-3 mb-4">
                    <div className="text-3xl">{wall.icon}</div>
                    <h3 className="text-xl font-bold text-slate-800">{wall.name}</h3>
                </div>
                <p className="text-slate-600 leading-relaxed">{wall.description || "No description provided."}</p>
            </div>
        </div>
      )}

      {showSettings && isTeacher && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300 modal-overlay">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
             <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">Wall Settings</h3>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest flex items-center gap-2"><ImageIcon size={14} /> Identity</h4>
                <div className="grid grid-cols-[auto_1fr] gap-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 ml-1">Icon</label>
                        <div className="relative">
                            <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="h-16 w-16 bg-slate-100 rounded-2xl flex items-center justify-center text-4xl border border-slate-200 hover:bg-slate-200 transition-colors">{settingsForm.icon || '📝'}</button>
                            {showEmojiPicker && (
                                <div className="absolute top-full mt-2 left-0 z-50">
                                    <EmojiPicker 
                                      onEmojiClick={(emojiData) => { setSettingsForm({...settingsForm, icon: emojiData.emoji}); setShowEmojiPicker(false); }} 
                                      width={300} 
                                      height={400} 
                                      searchDisabled={false}
                                      skinTonesDisabled
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="space-y-3">
                         <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" value={settingsForm.name || ''} onChange={(e) => setSettingsForm({...settingsForm, name: e.target.value})} placeholder="Wall Name" />
                         <textarea className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 resize-none h-20" value={settingsForm.description || ''} onChange={(e) => setSettingsForm({...settingsForm, description: e.target.value})} placeholder="Description" />
                    </div>
                </div>
              </section>

              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest flex items-center gap-2"><LayoutGrid size={14} /> Background</h4>
                
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl overflow-x-auto">
                    {[
                        { id: 'presets', icon: LayoutGrid, label: 'Presets' },
                        { id: 'upload', icon: Upload, label: 'Upload' },
                        { id: 'drive', icon: HardDrive, label: 'Drive' },
                        { id: 'url', icon: LinkIcon, label: 'URL' },
                        { id: 'search', icon: Sparkles, label: 'Search' }
                    ].map(tab => (
                        <button key={tab.id} onClick={() => setBgPickerTab(tab.id as any)} className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all ${bgPickerTab === tab.id ? 'bg-white shadow-sm text-cyan-600' : 'text-slate-500 hover:bg-white/50'}`}>
                            <tab.icon size={14} /> {tab.label}
                        </button>
                    ))}
                </div>

                <div className="min-h-[160px] p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    {bgPickerTab === 'presets' && (
                        <div className="grid grid-cols-4 gap-3">
                            {WALL_GRADIENTS.map(g => (
                                <button key={g} onClick={() => setSettingsForm({ ...settingsForm, background: g })} className={`h-16 rounded-xl bg-gradient-to-br ${g} ${settingsForm.background === g ? 'ring-4 ring-cyan-500 ring-offset-2' : ''}`} />
                            ))}
                        </div>
                    )}
                    {bgPickerTab === 'upload' && (
                        <div className="flex flex-col items-center justify-center h-full gap-3 py-4 text-center">
                            {isImageBackground ? (
                                <div className="space-y-3">
                                    <img src={settingsForm.background} className="h-24 w-40 object-cover rounded-xl border-4 border-white shadow-md mx-auto" alt="Preview" />
                                    <p className="text-[10px] font-black text-cyan-600 uppercase tracking-widest">Image Set</p>
                                </div>
                            ) : (
                                <>
                                    <Upload className="text-slate-300" size={32} />
                                    <p className="text-xs font-bold text-slate-500">Upload a custom wallpaper</p>
                                </>
                            )}
                            <button onClick={() => bgInputRef.current?.click()} className="px-6 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-900 transition-colors">
                                {isImageBackground ? 'Change File' : 'Choose File'}
                            </button>
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
                                <div className="grid grid-cols-4 gap-3 h-40 overflow-y-auto custom-scrollbar pr-2 p-1">
                                    {driveFiles.map(file => {
                                        const directLink = file.thumbnailLink?.replace(/=s\d+$/, '=s0');
                                        const wallLink = directLink || file.webViewLink;
                                        return (
                                            <button key={file.id} onClick={() => setSettingsForm({ ...settingsForm, background: wallLink })} className="relative block aspect-square w-full rounded-xl overflow-hidden border-2 border-slate-200 group">
                                                <img src={file.thumbnailLink} className="absolute inset-0 w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                                                {settingsForm.background === wallLink && <div className="absolute inset-0 bg-cyan-600/40 flex items-center justify-center"><Check className="text-white" size={24} strokeWidth={3} /></div>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                    {bgPickerTab === 'url' && (
                        <div className="space-y-4 py-4">
                            <div className="flex gap-2">
                                <input type="text" placeholder="https://image-url.com/wallpaper.jpg" className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20" value={bgUrlInput} onChange={e => setBgUrlInput(e.target.value)} />
                                <button onClick={() => { setSettingsForm({ ...settingsForm, background: bgUrlInput }); setBgUrlInput(''); }} className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold">Apply</button>
                            </div>
                            {isImageBackground && (
                                <div className="text-center space-y-2">
                                    <img src={settingsForm.background} className="h-16 w-28 object-cover rounded-lg mx-auto border" alt="Preview" />
                                    <p className="text-[10px] font-black text-cyan-600 uppercase tracking-widest">URL Background Active</p>
                                </div>
                            )}
                        </div>
                    )}
                    {bgPickerTab === 'search' && (
                        <div className="space-y-4 py-4 text-center">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input type="text" placeholder="Space, Nature, Art..." className="w-full px-4 py-3 pl-10 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20" value={bgSearch} onChange={e => setBgSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && performBgSearch()} />
                                    <Search className="absolute left-3.5 top-3.5 text-slate-400" size={14} />
                                </div>
                                <button onClick={performBgSearch} disabled={isBgSearching} className="px-6 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                                    {isBgSearching ? <Loader2 className="animate-spin" size={14} /> : 'Search'}
                                </button>
                            </div>
                            {isImageBackground && !settingsForm.background?.includes('data:image') && (
                                <img src={settingsForm.background} className="h-12 w-20 object-cover rounded-lg mx-auto border" alt="Search Result Preview" />
                            )}
                        </div>
                    )}
                </div>
              </section>

              <section className="space-y-4">
                <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest flex items-center gap-2"><Lock size={14} /> Access Control</h4>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex flex-col"><span className="font-bold text-slate-800">Freeze Wall</span><span className="text-xs text-slate-500">Stop all changes</span></div>
                    <button onClick={() => setSettingsForm({ ...settingsForm, isFrozen: !settingsForm.isFrozen })} className={`w-12 h-6 rounded-full relative transition-colors ${settingsForm.isFrozen ? 'bg-indigo-600' : 'bg-slate-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settingsForm.isFrozen ? 'left-7' : 'left-1'}`} /></button>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex flex-col"><span className="font-bold text-slate-800">Anonymous Posting</span><span className="text-xs text-slate-500">Hide names</span></div>
                    <button onClick={() => setSettingsForm({ ...settingsForm, isAnonymous: !settingsForm.isAnonymous })} className={`w-12 h-6 rounded-full relative transition-colors ${settingsForm.isAnonymous ? 'bg-cyan-600' : 'bg-slate-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settingsForm.isAnonymous ? 'left-7' : 'left-1'}`} /></button>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex flex-col"><span className="font-bold text-slate-800">Require Login</span><span className="text-xs text-slate-500">Guests must sign in to post</span></div>
                    <button onClick={() => setSettingsForm({ ...settingsForm, requireLoginToPost: !settingsForm.requireLoginToPost })} className={`w-12 h-6 rounded-full relative transition-colors ${settingsForm.requireLoginToPost ? 'bg-cyan-600' : 'bg-slate-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settingsForm.requireLoginToPost ? 'left-7' : 'left-1'}`} /></button>
                </div>
              </section>

              <section className="pt-6 border-t border-red-50"><button onClick={() => setShowDeleteConfirm(true)} className="w-full p-4 bg-red-50 text-red-600 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"><Trash2 size={20} /> Delete Wall</button></section>
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button onClick={() => setShowSettings(false)} className="px-6 py-3 text-slate-500 font-bold hover:text-slate-700">Cancel</button>
              <button onClick={handleSaveSettings} className="px-8 py-3 bg-cyan-600 text-white font-bold rounded-xl shadow-lg hover:bg-cyan-700 transition-colors">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {showEditor && (
        <PostEditor 
            authorName={authorName} 
            initialPost={editingPostId ? wall.posts.find(p => p.id === editingPostId) : undefined} 
            parentId={activeParentId || undefined} 
            onClose={() => { setShowEditor(false); setEditingPostId(null); setActiveParentId(null); }} 
            onSubmit={handlePostSubmit}
            isKanbanColumn={wall.type === 'kanban' && !activeParentId && !editingPostId} // Only when creating a new column via main + button
        />
      )}

      {showClassroomModal && (
        <div className="fixed inset-0 z-[400] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowClassroomModal(false)}>
          <div className="bg-white rounded-[2rem] shadow-2xl p-8 max-w-lg w-full space-y-6 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowClassroomModal(false)} className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600"><X size={24} /></button>
            <h3 className="text-2xl font-black text-slate-800">Post to Classroom</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                {courses.map(course => (
                    <div key={course.id} onClick={() => toggleCourseSelection(course.id)} className={`p-4 rounded-2xl border-2 cursor-pointer flex items-center justify-between transition-all ${selectedCourses.has(course.id) ? 'border-green-500 bg-green-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                        <div className="flex items-center gap-3"><School size={20} className={selectedCourses.has(course.id) ? 'text-green-600' : 'text-slate-400'} /><p className="font-bold text-slate-800">{course.name}</p></div>
                        {selectedCourses.has(course.id) && <Check size={20} className="text-green-600" />}
                    </div>
                ))}
            </div>
            <div className="pt-4 flex gap-4">
              <button onClick={() => setShowClassroomModal(false)} className="flex-1 py-4 font-bold text-slate-500">Cancel</button>
              <button onClick={handleShareToClassroom} disabled={selectedCourses.size === 0 || isSharingToClassroom} className="flex-[2] py-4 rounded-2xl font-black bg-slate-900 text-white disabled:opacity-50 hover:bg-slate-800 transition-colors shadow-lg">
                {isSharingToClassroom ? <Loader2 className="animate-spin mx-auto" size={24} /> : 'Post to Classroom'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WallView;
