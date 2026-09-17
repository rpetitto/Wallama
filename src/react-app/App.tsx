import React, { useState, useEffect } from 'react';
import { User, Wall, Post, WallType } from './types';
import Auth from './components/Auth';
import WallDashboard from './components/WallDashboard';
import WallView from './components/WallView';
import { authService, databaseService } from './lib/api';
import { classroomService } from './lib/classroom';
import { clearAccessToken, storeAccessToken, storedAccessToken } from './lib/google';

/**
 * Resolve whatever `?wall=` holds.
 *
 * Share links carry the six-character join code, not the wall's id, so both
 * have to be tried. (The Classroom scan below used to look up only by id, which
 * is why walls shared to a class never appeared on a student's dashboard: the
 * link it found always held a code, and a code never matches an id.)
 */
const resolveWall = async (reference: string): Promise<Wall | null> => {
  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
  const wall = looksLikeId ? await databaseService.getWallById(reference) : null;
  return wall ?? (await databaseService.getWallByCode(reference));
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [myWalls, setMyWalls] = useState<Wall[]>([]);
  const [activeWallId, setActiveWallId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Who we are is the server's answer now, not a JSON blob this browser
      // wrote to localStorage and could edit at will.
      const currentUser = await authService.me();
      if (currentUser) {
        setUser(currentUser);
        loadWalls(currentUser);
      }

      const urlParams = new URLSearchParams(window.location.search);
      const wallIdFromUrl = urlParams.get('wall');

      if (wallIdFromUrl) {
        const wall = await resolveWall(wallIdFromUrl);

        if (wall) {
          // A shared link that lands on an open wall gets a guest identity, so
          // there is a real author behind anything posted from it.
          let visitor = currentUser;
          if (!visitor && (wall.privacyType === 'public' || wall.privacyType === 'link')) {
            visitor = await createGuestUser();
          }
          if (visitor) await databaseService.joinWall(wall.id);
          setActiveWallId(wall.id);
        }
      }

      setIsInitializing(false);
    };
    init();
  }, []);

  const loadWalls = async (currentUser: User) => {
    setIsSyncing(true);
    const walls = await databaseService.getMyWalls();
    setMyWalls(walls);
    setIsSyncing(false);

    if (currentUser.role === 'student' && !currentUser.isGuest) {
      const token = storedAccessToken();
      if (token) {
        classroomService.findWallsFromAnnouncements(token).then(async (references) => {
          const known = new Set(walls.flatMap(w => [w.id, w.joinCode]));
          const toFetch = references.filter(ref => !known.has(ref));
          if (toFetch.length === 0) return;

          const fetched = await Promise.all(toFetch.map(resolveWall));
          const validFetched = fetched.filter(w => w !== null) as Wall[];
          if (validFetched.length === 0) return;

          setMyWalls(prev => {
            const currentIds = new Set(prev.map(p => p.id));
            const novel = validFetched.filter(v => !currentIds.has(v.id));
            return [...novel, ...prev];
          });
          validFetched.forEach(w => databaseService.joinWall(w.id));
        });
      }
    }
  };

  const createGuestUser = async (): Promise<User | null> => {
    try {
      const guest = await authService.signInAsGuest();
      setUser(guest);
      return guest;
    } catch (err) {
      console.error('Could not start a guest session:', err);
      return null;
    }
  };

  const handleLogin = async (newUser: User, accessToken: string) => {
    setUser(newUser);
    // Kept in the browser for Classroom and Drive, which are still called
    // directly with the teacher's own token — the server never stores it.
    storeAccessToken(accessToken);
    loadWalls(newUser);
  };

  const handleQuickJoin = async (code: string) => {
    if (!code) return;
    setIsSyncing(true);
    const wall = await databaseService.getWallByCode(code);
    setIsSyncing(false);
    if (wall) {
      let visitor = user;
      if (!visitor) visitor = await createGuestUser();
      if (visitor) await databaseService.joinWall(wall.id);
      setActiveWallId(wall.id);
    } else {
      alert(`Could not find a wall with code "${code}".`);
    }
  };

  const handleCreateWall = async (name: string, description: string, type: WallType, icon: string, requireLoginToPost: boolean) => {
    if (!user || user.role !== 'teacher') return;

    setIsSyncing(true);
    // The join code is the server's to mint: it has to be unique across every
    // wall, which is not something a browser can promise.
    const createdWall = await databaseService.createWall({
      name: name || 'Untitled Wall',
      type,
      description: description || 'No description.',
      background: 'from-indigo-500 via-purple-500 to-pink-500',
      snapToGrid: true,
      isAnonymous: false,
      privacyType: 'link',
      icon,
      requireLoginToPost,
    });
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

  // The author is whoever the server says is making the request, so a post no
  // longer carries a name the client chose for itself.
  const handleAddPost = async (postData: Partial<Post>) => {
    if (!user || !activeWallId) return null;
    return await databaseService.addPost(activeWallId, {
      ...postData,
      color: postData.color || 'bg-white',
    });
  };

  const handleEditPost = async (postId: string, postData: Partial<Post>) => {
    if (!user || !activeWallId) return null;
    return await databaseService.updatePostContent(postId, postData);
  };

  const handleDeletePost = async (postId: string) => {
    await databaseService.deletePost(postId);
  };

  const handleMovePost = async (postId: string, x: number, y: number, parentId?: string | null) => {
    if (activeWallId) {
      await databaseService.updatePostPosition(postId, x, y, parentId);
    }
  };

  const handleLogout = async () => {
    await authService.signOut();
    setUser(null); setActiveWallId(null); setMyWalls([]);
    clearAccessToken();
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  if (isInitializing) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4">
        <div className="h-10 w-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">Connecting...</p>
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
        onLogin={handleLogin}
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
