
import React, { useState, useEffect } from 'react';
import { User, Wall, Post, WallType } from './types';
import Auth from './components/Auth';
import WallDashboard from './components/WallDashboard';
import WallView from './components/WallView';
import { GENERATE_JOIN_CODE } from './constants';
import { databaseService } from './services/databaseService';
import { classroomService } from './services/classroomService';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [myWalls, setMyWalls] = useState<Wall[]>([]);
  const [activeWallId, setActiveWallId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const init = async () => {
      const savedUser = localStorage.getItem('the_wall_user_v2');
      const parsedUser: User | null = savedUser ? JSON.parse(savedUser) : null;
      if (parsedUser) {
        setUser(parsedUser);
        loadWalls(parsedUser);
      }

      const urlParams = new URLSearchParams(window.location.search);
      const wallIdFromUrl = urlParams.get('wall');
      
      if (wallIdFromUrl) {
        let wall: Wall | null = null;
        
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wallIdFromUrl)) {
             wall = await databaseService.getWallById(wallIdFromUrl);
        }
        
        if (!wall) {
             wall = await databaseService.getWallByCode(wallIdFromUrl);
        }

        if (wall) {
          if (!parsedUser && (wall.privacyType === 'public' || wall.privacyType === 'link')) {
            const guest = createGuestUser();
            databaseService.joinWall(wall.id, guest.id, 'student');
          } else if (parsedUser) {
            databaseService.joinWall(wall.id, parsedUser.id, parsedUser.role);
          }
          setActiveWallId(wall.id);
        }
      }

      setIsInitializing(false);
    };
    init();
  }, []);

  const loadWalls = async (currentUser: User) => {
    setIsSyncing(true);
    let walls: Wall[] = [];
    if (currentUser.role === 'teacher') {
        walls = await databaseService.getTeacherWalls(currentUser.id);
    } else if (currentUser.role === 'student' && !currentUser.isGuest) {
        walls = await databaseService.getStudentWalls(currentUser.id);
        
        const token = sessionStorage.getItem('google_access_token');
        if (token) {
            classroomService.findWallsFromAnnouncements(token).then(async (newIds) => {
                if (newIds.length > 0) {
                    const existingIds = new Set(walls.map(w => w.id));
                    const toFetch = newIds.filter(id => !existingIds.has(id));
                    
                    if (toFetch.length > 0) {
                       const fetchedPromises = toFetch.map(id => databaseService.getWallById(id));
                       const fetched = await Promise.all(fetchedPromises);
                       const validFetched = fetched.filter(w => w !== null) as Wall[];
                       
                       if (validFetched.length > 0) {
                           setMyWalls(prev => {
                               const currentIds = new Set(prev.map(p => p.id));
                               const novel = validFetched.filter(v => !currentIds.has(v.id));
                               return [...novel, ...prev];
                           });
                           validFetched.forEach(w => databaseService.joinWall(w.id, currentUser.id, 'student'));
                       }
                    }
                }
            });
        }
    }
    setMyWalls(walls);
    setIsSyncing(false);
  };

  const createGuestUser = () => {
    const guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
    const guestUser: User = {
      id: guestId, name: 'Guest Contributor', email: '', role: 'student',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${guestId}`, isGuest: true
    };
    setUser(guestUser);
    localStorage.setItem('the_wall_user_v2', JSON.stringify(guestUser));
    return guestUser;
  };

  const handleLogin = async (newUser: User, accessToken: string) => {
    setUser(newUser);
    localStorage.setItem('the_wall_user_v2', JSON.stringify(newUser));
    sessionStorage.setItem('google_access_token', accessToken);
    loadWalls(newUser);
  };

  const handleQuickJoin = async (code: string) => {
    if (!code) return;
    setIsSyncing(true);
    const wall = await databaseService.getWallByCode(code);
    setIsSyncing(false);
    if (wall) {
      if (!user) createGuestUser();
      const currentUser = user || JSON.parse(localStorage.getItem('the_wall_user_v2') || '{}');
      if (currentUser.id) {
          await databaseService.joinWall(wall.id, currentUser.id, currentUser.role || 'student');
      }
      setActiveWallId(wall.id);
    } else {
      alert(`Could not find a wall with code "${code}".`);
    }
  };

  const handleCreateWall = async (name: string, description: string, type: WallType, icon: string) => {
    if (!user || user.role !== 'teacher') return;
    
    setIsSyncing(true);
    const newWallData: Partial<Wall> = {
      name: name || 'Untitled Wall',
      type: type,
      description: description || 'No description.',
      joinCode: GENERATE_JOIN_CODE(),
      teacherId: user.id,
      background: 'from-indigo-500 via-purple-500 to-pink-500',
      snapToGrid: true,
      isAnonymous: false,
      privacyType: 'link',
      icon: icon
    };
    const createdWall = await databaseService.createWall(newWallData);
    if (createdWall) {
      setMyWalls(prev => [createdWall, ...prev]);
      setActiveWallId(createdWall.id);
    }
    setIsSyncing(false);
  };

  const handleUpdateWall = async (wallUpdate: Partial<Wall>) => {
    if (!activeWallId || user?.isGuest) return;
    await databaseService.updateWall(activeWallId, wallUpdate);
  };

  const handleUpdateWallOnDashboard = async (wallId: string, updates: Partial<Wall>) => {
    if (user?.isGuest) return;
    const success = await databaseService.updateWall(wallId, updates);
    if (success) {
      setMyWalls(prev => prev.map(w => w.id === wallId ? { ...w, ...updates } : w));
    }
  };

  const handleDeleteWallOnDashboard = async (wallId: string) => {
    if (user?.isGuest) return;
    const success = await databaseService.deleteWall(wallId);
    if (success) {
      setMyWalls(prev => prev.filter(w => w.id !== wallId));
    }
  };

  const handleAddPost = async (postData: Partial<Post>) => {
    if (!user || !activeWallId) return null;
    const newPost: Partial<Post> = {
      ...postData,
      authorId: user.id,
      authorName: user.name,
      authorAvatar: user.avatar, 
      color: postData.color || 'bg-white',
    };
    return await databaseService.addPost(activeWallId, newPost);
  };

  const handleEditPost = async (postId: string, postData: Partial<Post>) => {
    if (!user || !activeWallId) return null;
    return await databaseService.updatePostContent(postId, postData);
  };

  const handleDeletePost = async (postId: string) => {
    await databaseService.deletePost(postId);
  };

  const handleMovePost = async (postId: string, x: number, y: number) => {
    if (activeWallId) {
      await databaseService.updatePostPosition(postId, x, y, activeWallId);
    }
  };

  const handleLogout = () => {
    setUser(null); setActiveWallId(null); setMyWalls([]);
    localStorage.removeItem('the_wall_user_v2');
    sessionStorage.removeItem('google_access_token');
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  if (isInitializing) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4">
        <div className="h-10 w-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">Connecting to SQL...</p>
      </div>
    </div>
  );

  if (!user && !activeWallId) {
    return <Auth onLogin={handleLogin} onQuickJoin={handleQuickJoin} />;
  }

  if (activeWallId) {
    return (
      <WallView 
        wallId={activeWallId}
        onBack={() => { 
            setActiveWallId(null); 
            window.history.replaceState({}, document.title, window.location.pathname); 
            if (user) loadWalls(user);
        }} 
        onAddPost={handleAddPost}
        onEditPost={handleEditPost}
        onDeletePost={handleDeletePost}
        onMovePost={handleMovePost}
        onUpdateWall={handleUpdateWall}
        currentUserId={user?.id || ''}
        authorName={user?.name || 'Guest'}
        userRole={user?.role || 'student'}
        isGuest={user?.isGuest || false}
      />
    );
  }

  return (
    <WallDashboard 
      user={user!} 
      walls={myWalls} 
      onCreateWall={handleCreateWall}
      onJoinWall={handleQuickJoin}
      onSelectWall={setActiveWallId}
      onUpdateWall={handleUpdateWallOnDashboard}
      onDeleteWall={handleDeleteWallOnDashboard}
      onLogout={handleLogout}
      isSyncing={isSyncing}
    />
  );
};

export default App;
