
import React, { useState, useEffect } from 'react';
import { User, Wall, Post } from './types';
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
        const wall = await databaseService.getWallById(wallIdFromUrl);
        if (wall) {
          // Only create guest if NOT logged in
          if (!parsedUser && (wall.privacyType === 'public' || wall.privacyType === 'link')) {
            const guest = createGuestUser();
            databaseService.joinWall(wall.id, guest.id, 'student');
          } else if (parsedUser) {
            // Logged in user joining
            databaseService.joinWall(wall.id, parsedUser.id, parsedUser.role);
          }
          setActiveWallId(wallIdFromUrl);
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
        // 1. Get walls joined previously (DB persistence)
        walls = await databaseService.getStudentWalls(currentUser.id);
        
        // 2. Background Scan for Classroom Announcements
        // We do this non-blocking to populate new shares
        const token = sessionStorage.getItem('google_access_token');
        if (token) {
            classroomService.findWallsFromAnnouncements(token).then(async (newIds) => {
                if (newIds.length > 0) {
                    const existingIds = new Set(walls.map(w => w.id));
                    const toFetch = newIds.filter(id => !existingIds.has(id));
                    
                    if (toFetch.length > 0) {
                       // We can't batch fetch by ID in our current service easily without a new method
                       // For MVP, we just rely on the user clicking the link once.
                       // However, let's just add them to the list if we can fetch them.
                       const fetchedPromises = toFetch.map(id => databaseService.getWallById(id));
                       const fetched = await Promise.all(fetchedPromises);
                       const validFetched = fetched.filter(w => w !== null) as Wall[];
                       
                       if (validFetched.length > 0) {
                           setMyWalls(prev => {
                               // Merge and dedupe
                               const currentIds = new Set(prev.map(p => p.id));
                               const novel = validFetched.filter(v => !currentIds.has(v.id));
                               return [...novel, ...prev];
                           });
                           // Auto-join them in DB so we don't scan next time
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

  const handleCreateWall = async (name: string, description: string) => {
    // strict check: only teachers
    if (!user || user.role !== 'teacher') return;
    
    setIsSyncing(true);
    const newWallData: Partial<Wall> = {
      name: name || 'Untitled Wall',
      description: description || 'No description.',
      joinCode: GENERATE_JOIN_CODE(),
      teacherId: user.id,
      background: 'from-indigo-500 via-purple-500 to-pink-500',
      snapToGrid: true,
      isAnonymous: false,
      privacyType: 'link'
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

  const handleAddPost = async (postData: Partial<Post>) => {
    if (!user || !activeWallId) return null;
    const newPost: Partial<Post> = {
      ...postData,
      authorId: user.id,
      authorName: user.name,
      color: postData.color || 'bg-white',
    };
    return await databaseService.addPost(activeWallId, newPost);
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
            // Refresh dashboard list when returning
            if (user) loadWalls(user);
        }} 
        onAddPost={handleAddPost}
        onDeletePost={handleDeletePost}
        onMovePost={handleMovePost}
        onUpdateWall={handleUpdateWall}
        currentUserId={user?.id || ''}
        authorName={user?.name || 'Guest'}
        userRole={user?.role || 'student'}
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
      onLogout={handleLogout}
      isSyncing={isSyncing}
    />
  );
};

export default App;
