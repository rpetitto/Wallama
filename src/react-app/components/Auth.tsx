import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { ArrowRight, AlertCircle, Loader2, Globe, School, Info, RotateCcw } from 'lucide-react';
import { LlamaLogo } from './LlamaLogo';
import { authService } from '../lib/api';
import { SIGN_IN_SCOPES, tokenClient, type TokenClient } from '../lib/google';
import type { RoleCheck } from '../../shared/roleCheck';

/**
 * Why someone just landed as a student, in words, and what to do about it.
 *
 * Only for the two results that might be wrong: an account with no classes at
 * all, and a check Google wouldn't answer. The reasons are worked out by the
 * Worker (src/worker/lib/role.ts); this is the wording.
 */
const explainRoleCheck = (check: RoleCheck, email: string) => {
  const account = email || 'this Google account';
  if (check.result === 'no_classes') {
    return {
      title: "You're signed in as a student",
      why: `Google Classroom doesn't show any active classes that ${account} teaches. Wallama makes you a teacher when you teach at least one.`,
      lead: "If you're a teacher, check that:",
      steps: [
        'This is the Google account you use for Classroom. Try again lets you pick a different one.',
        "Your class isn't archived. Archived classes don't count.",
        "You've opened any class your school set up for you and accepted it as its teacher.",
      ],
    };
  }
  if (check.result !== 'unchecked') return null;
  const title = "Wallama couldn't check whether you teach";
  switch (check.reason) {
    case 'no_permission':
      return {
        title,
        why: "Wallama wasn't given permission to see your Google Classroom classes.",
        lead: 'To fix it:',
        steps: ["Choose Try again, and tick every box on Google's permission screen."],
      };
    case 'admin_blocked':
      return {
        title,
        why: "Your school's Google admin has turned off Classroom access for outside apps, so Google wouldn't tell Wallama about your classes.",
        lead: 'To fix it:',
        steps: ["Ask your school's IT admin to let apps use Google Classroom data. The setting is in the Google Admin console, under Classroom, then Data access."],
      };
    case 'api_off':
      return {
        title,
        why: "Wallama's connection to Google Classroom is switched off on Wallama's side. This isn't anything you did.",
        lead: 'To fix it:',
        steps: ['Let whoever runs Wallama know. Until it is fixed, everyone signs in as a student.'],
      };
    case 'unreachable':
      return {
        title,
        why: "Google Classroom didn't answer, so Wallama couldn't ask about your classes.",
        lead: 'To fix it:',
        steps: ['Try again in a moment.'],
      };
    default:
      return {
        title,
        why: `Google Classroom refused the check and said: "${check.googleMessage ?? 'no reason given'}"`,
        lead: 'To fix it:',
        steps: ['Try again in a moment. If it keeps happening, send that message to whoever runs Wallama.'],
      };
  }
};

interface AuthProps {
  onLogin: (user: User, accessToken: string) => void;
  onQuickJoin: (code: string) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin, onQuickJoin }) => {
  const [joinCode, setJoinCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useRef<TokenClient | null>(null);
  const [isReady, setIsReady] = useState(false);
  /**
   * A sign-in that came back as a student for a reason worth showing. The
   * session already exists; this holds the screen until the person reads why
   * and either carries on or tries again.
   */
  const [heldSignIn, setHeldSignIn] = useState<{ user: User; accessToken: string; roleCheck: RoleCheck } | null>(null);

  useEffect(() => {
    let cancelled = false;
    tokenClient(SIGN_IN_SCOPES, handleToken, (message) => {
      setError(message);
      setIsLoading(false);
    }).then((c) => {
      if (cancelled) return;
      client.current = c;
      setIsReady(!!c);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * Hand the token to our own server and let it say who this is.
   *
   * This used to fetch the Google profile here, ask Classroom whether the
   * person taught anything, and then tell the app the answer — which meant the
   * browser decided its own role, and the role is what says who may create and
   * delete walls. The server does both now; all this does is pass along the
   * token it was given.
   */
  const handleToken = async (accessToken: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const { user, roleCheck } = await authService.signInWithGoogle({ accessToken });
      if (roleCheck && (roleCheck.result === 'no_classes' || roleCheck.result === 'unchecked')) {
        setHeldSignIn({ user, accessToken, roleCheck });
        return;
      }
      setHeldSignIn(null);
      onLogin(user, accessToken);
    } catch (err: any) {
      console.error('Auth error', err);
      setError(err?.message ?? 'Failed to sign in.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = () => {
    if (client.current) client.current.requestAccessToken();
    else setError('Google sign-in is still loading — give it a moment and try again.');
  };

  // Ask Google to show the account chooser and the permission screen again,
  // which are the two things most of the reasons above need another go at.
  const handleTryAgain = () => {
    setError(null);
    if (client.current) client.current.requestAccessToken({ prompt: 'select_account consent' });
    else setError('Google sign-in is still loading — give it a moment and try again.');
  };

  const explanation = heldSignIn ? explainRoleCheck(heldSignIn.roleCheck, heldSignIn.user.email) : null;

  // The panel is taller than the button it replaces, so on a laptop-height
  // window its buttons would open below the fold.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (heldSignIn) panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [heldSignIn]);

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
            <p className="font-bold text-slate-800 text-lg tracking-tight">Signing you in...</p>
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

            {heldSignIn && explanation ? (
              <div ref={panelRef} data-testid="role-check" role="status" className="w-full p-5 sm:p-6 bg-amber-50 border border-amber-200 rounded-[2rem] space-y-4">
                <div className="flex items-start gap-3">
                  <Info size={20} className="shrink-0 mt-0.5 text-amber-600" />
                  <div className="min-w-0 space-y-1">
                    <h3 className="font-bold text-slate-900 leading-snug">{explanation.title}</h3>
                    <p className="text-xs font-bold text-slate-500 truncate">
                      {heldSignIn.user.name}{heldSignIn.user.email ? ` · ${heldSignIn.user.email}` : ''}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">{explanation.why}</p>
                <div className="space-y-2">
                  <p className="text-sm font-bold text-slate-800">{explanation.lead}</p>
                  <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700 leading-relaxed">
                    {explanation.steps.map(step => <li key={step}>{step}</li>)}
                  </ul>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <button
                    onClick={() => onLogin(heldSignIn.user, heldSignIn.accessToken)}
                    className="sm:flex-[3] py-3 px-4 bg-cyan-600 text-white font-bold rounded-full hover:bg-cyan-700 active:scale-[0.98] transition-all whitespace-nowrap"
                  >
                    Continue as a student
                  </button>
                  <button
                    onClick={handleTryAgain}
                    className="sm:flex-[2] py-3 px-4 bg-white border border-slate-200 text-slate-700 font-bold rounded-full hover:bg-slate-50 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <RotateCcw size={16} /> Try again
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full space-y-4 text-center">
                <p className="text-slate-500 font-medium text-sm">Verify your role via Google Classroom.</p>
                
                <button 
                  onClick={handleSignIn}
                  disabled={!isReady}
                  className="w-full py-4 bg-white border border-slate-200 rounded-full shadow-sm hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 group"
                >
                  <img src="https://www.gstatic.com/classroom/logo_square_48.svg" className="w-6 h-6" alt="Classroom" />
                  <span className="font-bold text-slate-700 group-hover:text-slate-900">Sign in with Google Classroom</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
