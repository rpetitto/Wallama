
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { ArrowRight, ShieldCheck, AlertCircle, Loader2, Globe, Lock, School } from 'lucide-react';
import { LlamaLogo } from './LlamaLogo';

// Declare global 'google' for Google Identity Services
declare const google: any;

interface AuthProps {
  onLogin: (user: User, accessToken: string) => void;
  onQuickJoin: (code: string) => void;
}

const GOOGLE_CLIENT_ID = "6888240288-5v0p6nsoi64q1puv1vpvk1njd398ra8b.apps.googleusercontent.com";

const Auth: React.FC<AuthProps> = ({ onLogin, onQuickJoin }) => {
  const [joinCode, setJoinCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenClient, setTokenClient] = useState<any>(null);

  useEffect(() => {
    const initGoogle = () => {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.rosters.readonly https://www.googleapis.com/auth/classroom.announcements https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
          callback: handleTokenResponse,
        });
        setTokenClient(client);
      } else {
        setTimeout(initGoogle, 100);
      }
    };

    initGoogle();
  }, []);

  const handleTokenResponse = async (response: any) => {
    if (response.error) {
      setError("Authorization failed. Please try again.");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const accessToken = response.access_token;
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profile = await profileRes.json();

      let role: 'teacher' | 'student' = 'student';
      try {
        const classroomRes = await fetch('https://classroom.googleapis.com/v1/courses?teacherId=me&pageSize=1', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (classroomRes.ok) {
            const classroomData = await classroomRes.json();
            if (classroomData.courses && classroomData.courses.length > 0) {
                role = 'teacher';
            }
        }
      } catch (e) {
        console.warn("Classroom check failed, defaulting to student", e);
      }

      const newUser: User = {
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        role: role,
        avatar: profile.picture
      };

      onLogin(newUser, accessToken);
    } catch (err) {
      console.error("Auth Error", err);
      setError("Failed to retrieve user information.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = () => {
    if (tokenClient) tokenClient.requestAccessToken();
    else setError("Google Services not ready yet. Refresh page.");
  };

  const handleJoinClick = () => {
    if (joinCode.length === 6) onQuickJoin(joinCode);
  };

  return (
    <div className="min-h-screen bg-sky-50 flex flex-col lg:flex-row items-stretch overflow-hidden font-sans">
      {/* Branding Side */}
      <div className="hidden lg:flex flex-1 bg-cyan-600 relative overflow-hidden items-center justify-center p-20">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-600 via-sky-600 to-blue-700 opacity-90" />
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
        
        <div className="relative z-10 text-white space-y-8 max-w-lg">
          <div className="h-28 w-28 bg-white rounded-[2rem] flex items-center justify-center shadow-2xl -rotate-3 hover:rotate-0 transition-transform duration-500">
            <LlamaLogo className="w-20 h-20" />
          </div>
          <div className="space-y-4">
            <h1 className="text-6xl font-black tracking-tight leading-tight">Wallama.</h1>
            <p className="text-xl text-cyan-100 font-medium leading-relaxed">
              The collaborative canvas for your classroom. Connect seamlessly with Google Classroom.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-6 pt-10">
            <div className="p-6 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20">
              <Globe className="mb-3 text-cyan-200" size={28} />
              <h3 className="font-bold text-lg text-white">Students</h3>
              <p className="text-sm text-cyan-100/70">Join walls instantly with a code.</p>
            </div>
            <div className="p-6 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20">
              <School className="mb-3 text-cyan-200" size={28} />
              <h3 className="font-bold text-lg text-white">Teachers</h3>
              <p className="text-sm text-cyan-100/70">Manage walls via Google Classroom.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Side */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 lg:p-20 relative bg-white">
        {isLoading && (
          <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-[100] flex flex-col items-center justify-center">
            <Loader2 className="animate-spin text-cyan-600 mb-4" size={48} />
            <p className="font-bold text-slate-800 text-lg tracking-tight">Verifying Classroom...</p>
          </div>
        )}

        <div className="max-w-md w-full space-y-10">
          <div className="lg:hidden text-center mb-10">
            <div className="h-20 w-20 bg-cyan-600 rounded-2xl flex items-center justify-center shadow-lg mx-auto mb-4">
              <LlamaLogo className="w-12 h-12" />
            </div>
            <h2 className="text-3xl font-black text-slate-900">Wallama</h2>
          </div>

          <div className="space-y-8">
            <div className="space-y-4 text-center lg:text-left">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Quick Join</h2>
              <p className="text-slate-500 font-medium text-sm leading-relaxed">Enter a 6-digit code to join a Wallama wall.</p>
            </div>

            <div className="bg-sky-50 p-6 rounded-[2.5rem] border border-sky-100 space-y-4 shadow-inner">
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase());
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinClick()}
                  placeholder="CODE12"
                  className="flex-1 px-5 py-4 bg-white border border-sky-200 rounded-2xl focus:ring-4 focus:ring-sky-100 focus:border-cyan-500 outline-none font-black text-center text-xl tracking-widest text-slate-800 uppercase placeholder:text-slate-300 transition-all shadow-sm"
                />
                <button
                  onClick={handleJoinClick}
                  disabled={joinCode.length < 6}
                  className="bg-cyan-600 text-white px-6 rounded-2xl hover:bg-cyan-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all active:scale-95 shadow-lg shadow-cyan-100"
                >
                  <ArrowRight size={24} />
                </button>
              </div>
            </div>
          </div>

          <div className="relative py-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
            <div className="relative flex justify-center text-xs">
              <span className="px-6 bg-white text-slate-400 font-bold uppercase tracking-widest text-[10px]">Or</span>
            </div>
          </div>

          <div className="space-y-6 flex flex-col items-center">
            {error && (
              <div className="w-full p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm font-medium">
                <AlertCircle size={18} />
                {error}
              </div>
            )}

            <div className="w-full space-y-4 text-center">
              <p className="text-slate-500 font-medium text-sm">Verify your role via Google Classroom.</p>
              
              <button 
                onClick={handleSignIn}
                className="w-full py-4 bg-white border border-slate-200 rounded-full shadow-sm hover:bg-slate-50 active:bg-slate-100 transition-all flex items-center justify-center gap-3 group"
              >
                <img src="https://www.gstatic.com/classroom/logo_square_48.svg" className="w-6 h-6" alt="Classroom" />
                <span className="font-bold text-slate-700 group-hover:text-slate-900">Sign in with Google Classroom</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
