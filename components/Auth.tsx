import React, { useState } from 'react';
import { Lock, Mail, User, ArrowRight, ArrowLeft, Loader2, ShieldCheck, Zap, Eye, EyeOff } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { 
  sendPasswordResetEmail, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword 
} from "firebase/auth";
import { db, auth, backupAuth, handleFirestoreError, OperationType } from '../firebase';
import { User as UserType, UserRole, NotificationType } from '../types';
import { notifyAdmins, createNotification } from '../services/notificationService';
import { syncSetDoc } from '../services/firestoreSync';
import { parseApiResponse } from '../services/apiUtils';
import seededUsers from '../users.json';

interface AuthProps {
  onLogin: (user: UserType) => void;
}

type AuthView = 'login' | 'signup' | 'forgot-password';

// QAonCloud Logo — exact path from Logo.tsx, rendered in white
const QAonCloudLogo = ({ className }: { className?: string }) => (
  <svg
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 28.651 32"
    className={className}
  >
    <path
      d="M11.746 4.995C14.811 4.868 17.564 5.855 19.907 7.814l0.417 0.329C21.444 9.068 22.174 10.088 22.884 11.349c0.074 0.131 0.149 0.261 0.226 0.396 1.518 2.836 1.585 6.066 0.726 9.118 -0.462 1.391 -0.462 1.391 -0.977 1.706L22.511 22.698a81.86 81.86 0 0 1 -0.825 -0.698l-0.465 -0.393c-0.391 -0.405 -0.524 -0.589 -0.57 -1.142a31.256 31.256 0 0 1 0.372 -1.116c0.468 -2.48 0.147 -5.102 -1.286 -7.224C18.281 10.244 16.48 8.922 14.139 8.372c-2.797 -0.337 -5.174 0.142 -7.442 1.86 0.359 0.915 1.111 1.388 1.857 1.988C8.93 12.651 8.93 12.651 8.915 13.142 8.702 13.691 8.37 14.054 8 14.512c-0.792 1.672 -0.951 2.979 -0.366 4.758C8.191 20.67 9.045 21.359 10.419 21.953c1.455 0.455 2.979 0.267 4.37 -0.301 1.248 -0.687 1.927 -1.824 2.391 -3.14 0.385 -1.461 0.096 -2.686 -0.621 -4.001 -0.718 -1.056 -1.549 -1.861 -2.791 -2.233a15.628 15.628 0 0 0 -1.56 -0.153c-1.04 -0.07 -1.54 -0.249 -2.312 -0.975l-0.446 -0.413L9.116 10.419l0.186 -0.744c2.275 -0.739 4.11 -0.796 6.326 0.186 1.978 1.092 3.614 2.781 4.336 4.951 0.375 1.827 0.448 3.95 -0.434 5.634 -0.242 0.524 -0.349 0.928 -0.367 1.508 0.34 0.483 0.34 0.483 0.826 0.884 0.288 0.258 0.572 0.521 0.849 0.791v0.372l0.327 0.145c0.763 0.415 1.329 1.071 1.94 1.68l0.415 0.402 0.395 0.393 0.361 0.356c0.338 0.447 0.436 0.745 0.469 1.303 -0.448 0.634 -0.842 1.057 -1.488 1.488 -0.64 -0.058 -0.948 -0.324 -1.387 -0.774l-0.349 -0.354 -0.358 -0.372 -0.366 -0.374A155.72 155.72 0 0 1 19.907 26.977c-0.751 0.282 -1.443 0.637 -2.151 1.012 -2.699 1.36 -5.893 1.766 -8.837 0.919A23.442 23.442 0 0 1 7.814 28.465l-0.564 -0.233c-3.041 -1.38 -5.154 -3.738 -6.333 -6.846C0.097 18.784 0.015 15.622 0.93 13.023l0.558 -0.372a59.721 59.721 0 0 1 0.814 0.593l0.458 0.333C3.209 13.997 3.371 14.296 3.535 14.884c-0.052 0.435 -0.116 0.869 -0.186 1.302 -0.207 2.812 0.592 5.032 2.349 7.198 1.594 1.719 3.734 2.644 6.051 2.737 1.986 0.034 3.614 -0.454 5.367 -1.377h0.372l-0.558 -0.744 -0.396 0.161c-2.517 0.993 -4.91 1.415 -7.49 0.41 -1.924 -0.854 -3.351 -2.396 -4.194 -4.313C3.992 17.956 4.293 15.689 5.023 13.395l-0.374 -0.374L2.233 10.605c1.578 -2.755 4.03 -4.341 7.006 -5.235 0.855 -0.221 1.628 -0.312 2.507 -0.375"
      fill="white"
    />
  </svg>
);

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [view, setView] = useState<AuthView>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [resetLink, setResetLink] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');

  const clearState = () => {
    setError('');
    setSuccessMsg('');
    setResetLink('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setName('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const switchView = (newView: AuthView) => {
    clearState();
    setView(newView);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) { setError('Email address is required.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setIsLoading(true);
    const path = `users/${normalizedEmail}`;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      
      // Mirror registration to Backup Project Auth
      try {
        await createUserWithEmailAndPassword(backupAuth, normalizedEmail, password);
      } catch (bAuthErr) {
        console.warn("Backup Auth user mirror note:", bAuthErr);
      }

      const userRef = doc(db, "users", normalizedEmail);
      
      // Default admin logic: the user with the specified email is automatically a Super Admin
      const isDefaultSuperAdmin = normalizedEmail === 'shanmugapriya@qaoncloud.com' || normalizedEmail === 'sathya@qaoncloud.com';
      
      const newUser: UserType = {
        email: normalizedEmail,
        name: name.trim() || normalizedEmail.split('@')[0],
        role: isDefaultSuperAdmin ? UserRole.SUPER_ADMIN : UserRole.TEAM_MEMBER,
        assignedProjectIds: []
      };
      await syncSetDoc(userRef, { ...newUser, status: 'active', createdAt: new Date().toISOString() });
      await createNotification({
        recipientEmail: normalizedEmail,
        senderName: 'System Engine',
        type: NotificationType.USER_SIGNUP,
        title: 'Welcome to AutomatiQA',
        message: `Welcome ${newUser.name}! Your account has been registered successfully. Admin will assign workspace projects.`
      });
      await notifyAdmins('New User Registration', `${newUser.name} (${newUser.email}) registered a new account.`, 'System Engine', NotificationType.USER_SIGNUP);
      setIsLoading(false);
      setSuccessMsg('Account created successfully! Please sign in to establish your session.');
      setTimeout(() => { switchView('login'); setEmail(normalizedEmail); }, 2000);
    } catch (err: any) {
      if (err.code) {
        const code = err.code || '';
        if (code === 'auth/email-already-in-use') setError("This email is already associated with an account.");
        else if (code === 'auth/invalid-email') setError("The email address provided is not valid.");
        else if (code === 'auth/weak-password') setError("The password is too weak. Use at least 6 characters.");
        else if (code === 'auth/network-request-failed') setError("Network verification failed. Please check your connectivity.");
        else setError("Onboarding failed. Please ensure all fields are correct.");
      } else {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    const path = `users/${normalizedEmail}`;
    try {
      if (!normalizedEmail || !password) { setError('Please enter your email and password.'); setIsLoading(false); return; }
      await signInWithEmailAndPassword(auth, normalizedEmail, password);

      let userRef = doc(db, "users", normalizedEmail);
      let userSnap;
      try {
        userSnap = await getDoc(userRef);
      } catch (docErr) {
        handleFirestoreError(docErr, OperationType.GET, path);
        // Retry with active db after failover switch if needed
        userRef = doc(db, "users", normalizedEmail);
        try {
          userSnap = await getDoc(userRef);
        } catch (retryErr) {
          console.warn("User document fetch failed after failover:", retryErr);
        }
      }

      if (!userSnap || !userSnap.exists()) {
        // Find seeded user data if available
        const seeded = (seededUsers as any[]).find(u => u.id?.toLowerCase() === normalizedEmail || u.data?.email?.toLowerCase() === normalizedEmail);
        const seededData = seeded?.data;

        const isDefaultSuperAdmin = normalizedEmail === 'shanmugapriya@qaoncloud.com' || normalizedEmail === 'sathya@qaoncloud.com';
        const rawName = normalizedEmail.split('@')[0];
        const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

        const newUser: UserType = {
          email: normalizedEmail,
          name: seededData?.name || auth.currentUser?.displayName || formattedName,
          role: (seededData?.role as UserRole) || (isDefaultSuperAdmin ? UserRole.SUPER_ADMIN : UserRole.TEAM_MEMBER),
          assignedProjectIds: seededData?.assignedProjectIds || []
        };

        try {
          await syncSetDoc(userRef, { ...newUser, status: 'active', createdAt: new Date().toISOString() });
        } catch (syncErr) {
          console.warn("Failed to persist auto-provisioned profile to Firestore, proceeding with session:", syncErr);
        }

        setIsLoading(false);
        sessionStorage.setItem('automatiqa_user', JSON.stringify(newUser));
        onLogin(newUser);
        return;
      }

      const userData = userSnap.data() as UserType;
      setIsLoading(false);
      sessionStorage.setItem('automatiqa_user', JSON.stringify(userData));
      onLogin(userData);
    } catch (err: any) {
      if (err.code) {
        const code = err.code || '';
        const message = err.message || '';
        if (code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || message.includes('auth/invalid-credential') || message.includes('invalid-credential')) {
          setError("Invalid email or password credentials.");
        } else if (code === 'auth/too-many-requests') {
          setError("Access temporarily blocked due to multiple failed attempts. Please try again later.");
        } else if (code === 'auth/network-request-failed') {
          setError("Network error: Verification services are unreachable. Please check your connection.");
        } else {
          setError("Authentication failed. Please check your credentials.");
        }
      } else {
        handleFirestoreError(err, OperationType.GET, path);
        setError("Authentication failed. Please try again.");
      }
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    setError("");
    setSuccessMsg("");
    setResetLink("");

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError("Please enter your registered email.");
      return;
    }

    setIsLoading(true);

    try {
      await sendPasswordResetEmail(auth, normalizedEmail);

      // Attempt to retrieve a direct password reset link from the backend
      // to display as a reliable corporate firewall bypass backup option
      try {
        const linkRes = await fetch('/api/auth/reset-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: normalizedEmail })
        });
        const parsed = await parseApiResponse(linkRes);
        if (parsed.ok && parsed.data?.resetLink) {
          setResetLink(parsed.data.resetLink);
        }
      } catch (linkErr) {
        console.warn("Could not retrieve secure recovery bypass link:", linkErr);
      }

      setSuccessMsg(
        "Password reset email sent successfully. Please check your inbox."
      );
    } catch (err: any) {
      if (err.code === "auth/user-not-found") {
        setError("No account exists with this email.");
      } else if (err.code === "auth/invalid-email") {
        setError("Invalid email address.");
      } else {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };  // Shared input class — matching requested format
  const labelClass = "text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1";
  const iconClass = "absolute left-4 top-1/2 -translate-y-1/2 text-slate-400";

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#eef4f6] font-sans">
      <div className="w-full max-w-[460px] bg-white rounded-[2.5rem] overflow-hidden shadow-[0_20px_60px_rgba(15,23,42,0.06)] border border-slate-100 relative z-10 flex flex-col">
        
        {/* ── LOGIN VIEW ── */}
        {view === 'login' && (
          <form onSubmit={handleLogin} className="flex flex-col">
            {/* Upper white section */}
            <div className="p-8 md:p-10 bg-white flex flex-col gap-6">
              
              {/* Header block with inline logo and badge */}
              <div className="flex items-center justify-between w-full mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#e2f1f5] rounded-2xl flex items-center justify-center flex-shrink-0">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 28.651 32"
                      className="h-7 w-7 text-[#00A896]"
                    >
                      <path
                        d="M11.746 4.995C14.811 4.868 17.564 5.855 19.907 7.814l0.417 0.329C21.444 9.068 22.174 10.088 22.884 11.349c0.074 0.131 0.149 0.261 0.226 0.396 1.518 2.836 1.585 6.066 0.726 9.118 -0.462 1.391 -0.462 1.391 -0.977 1.706L22.511 22.698a81.86 81.86 0 0 1 -0.825 -0.698l-0.465 -0.393c-0.391 -0.405 -0.524 -0.589 -0.57 -1.142a31.256 31.256 0 0 1 0.372 -1.116c0.468 -2.48 0.147 -5.102 -1.286 -7.224C18.281 10.244 16.48 8.922 14.139 8.372c-2.797 -0.337 -5.174 0.142 -7.442 1.86 0.359 0.915 1.111 1.388 1.857 1.988C8.93 12.651 8.93 12.651 8.915 13.142 8.702 13.691 8.37 14.054 8 14.512c-0.792 1.672 -0.951 2.979 -0.366 4.758C8.191 20.67 9.045 21.359 10.419 21.953c1.455 0.455 2.979 0.267 4.37 -0.301 1.248 -0.687 1.927 -1.824 2.391 -3.14 0.385 -1.461 0.096 -2.686 -0.621 -4.001 -0.718 -1.056 -1.549 -1.861 -2.791 -2.233a15.628 15.628 0 0 0 -1.56 -0.153c-1.04 -0.07 -1.54 -0.249 -2.312 -0.975l-0.446 -0.413L9.116 10.419l0.186 -0.744c2.275 -0.739 4.11 -0.796 6.326 0.186 1.978 1.092 3.614 2.781 4.336 4.951 0.375 1.827 0.448 3.95 -0.434 5.634 -0.242 0.524 -0.349 0.928 -0.367 1.508 0.34 0.483 0.34 0.483 0.826 0.884 0.288 0.258 0.572 0.521 0.849 0.791v0.372l0.327 0.145c0.763 0.415 1.329 1.071 1.94 1.68l0.415 0.402 0.395 0.393 0.361 0.356c0.338 0.447 0.436 0.745 0.469 1.303 -0.448 0.634 -0.842 1.057 -1.488 1.488 -0.64 -0.058 -0.948 -0.324 -1.387 -0.774l-0.349 -0.354 -0.358 -0.372 -0.366 -0.374A155.72 155.72 0 0 1 19.907 26.977c-0.751 0.282 -1.443 0.637 -2.151 1.012 -2.699 1.36 -5.893 1.766 -8.837 0.919A23.442 23.442 0 0 1 7.814 28.465l-0.564 -0.233c-3.041 -1.38 -5.154 -3.738 -6.333 -6.846C0.097 18.784 0.015 15.622 0.93 13.023l0.558 -0.372a59.721 59.721 0 0 1 0.814 0.593l0.458 0.333C3.209 13.997 3.371 14.296 3.535 14.884c-0.052 0.435 -0.116 0.869 -0.186 1.302 -0.207 2.812 0.592 5.032 2.349 7.198 1.594 1.719 3.734 2.644 6.051 2.737 1.986 0.034 3.614 -0.454 5.367 -1.377h0.372l-0.558 -0.744 -0.396 0.161c-2.517 0.993 -4.91 1.415 -7.49 0.41 -1.924 -0.854 -3.351 -2.396 -4.194 -4.313C3.992 17.956 4.293 15.689 5.023 13.395l-0.374 -0.374L2.233 10.605c1.578 -2.755 4.03 -4.341 7.006 -5.235 0.855 -0.221 1.628 -0.312 2.507 -0.375"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-[#00A896] uppercase tracking-widest leading-none mb-1">QAONCLOUD</span>
                    <span className="text-xl font-black text-slate-800 leading-none">AutomatiQA</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#e2f1f5] rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00A896]" />
                  <span className="text-[9px] font-black text-[#00A896] uppercase tracking-wider">IDENTITY ACCESS</span>
                </div>
              </div>

              {/* Horizontal line divider */}
              <div className="w-full h-[1px] bg-slate-100" />

              {/* Error / Success Toast alerts inside top card section */}
              {error && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-semibold flex items-center gap-2.5 shadow-sm animate-in fade-in duration-200">
                  <Zap size={14} className="text-rose-500 flex-shrink-0" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              )}
              {successMsg && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-600 text-xs font-semibold flex items-center gap-2.5 shadow-sm animate-in fade-in duration-200">
                  <Zap size={14} className="text-emerald-500 flex-shrink-0" />
                  <span className="leading-relaxed">{successMsg}</span>
                </div>
              )}

              {/* Email Input */}
              <div className="flex flex-col gap-2">
                <label className={labelClass}>Registered Email</label>
                <div className="relative">
                  <Mail className={iconClass} size={16} />
                  <input 
                    type="email" 
                    required 
                    value={email || ''} 
                    onChange={e => setEmail(e.target.value)} 
                    className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#00A896]/20 focus:border-[#00A896] focus:bg-white transition-all shadow-sm" 
                    placeholder="name@company.com" 
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="flex flex-col gap-2">
                <label className={labelClass}>Password</label>
                <div className="relative">
                  <Lock className={iconClass} size={16} />
                  <input 
                    type={showPassword ? 'text' : 'password'} 
                    required 
                    value={password || ''} 
                    onChange={e => setPassword(e.target.value)} 
                    className="w-full pl-12 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#00A896]/20 focus:border-[#00A896] focus:bg-white transition-all shadow-sm" 
                    placeholder="••••••••" 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)} 
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-all cursor-pointer p-1"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

            </div>

            {/* Lower dark navy section */}
            <div className="px-8 py-10 md:px-10 md:py-10 bg-[#0a0e1a] flex flex-col gap-5">
              <button 
                type="submit" 
                disabled={isLoading} 
                className="w-full py-4 bg-[#00dfc2] hover:bg-[#00c5ac] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] text-[#0a0e1a] rounded-2xl font-black text-xs uppercase tracking-widest border-none cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-[#00dfc2]/20 transition-all"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin text-[#0a0e1a]" />
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </button>

              <div className="flex items-center justify-between w-full mt-2">
                <button 
                  type="button" 
                  onClick={() => switchView('forgot-password')} 
                  className="text-slate-400 hover:text-slate-300 font-bold text-[10px] uppercase tracking-wider bg-transparent border-none cursor-pointer transition-colors"
                >
                  Forgot Password?
                </button>
                <button 
                  type="button" 
                  onClick={() => switchView('signup')} 
                  className="text-[#00dfc2] hover:text-[#00c5ac] font-bold text-[10px] uppercase tracking-wider bg-transparent border-none cursor-pointer transition-colors"
                >
                  Create Account
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ── SIGNUP VIEW ── */}
        {view === 'signup' && (
          <form onSubmit={handleSignup} className="flex flex-col">
            {/* Upper white section */}
            <div className="p-8 md:p-10 bg-white flex flex-col gap-5">
              
              {/* Header block with inline logo and badge */}
              <div className="flex items-center justify-between w-full mb-1">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#e2f1f5] rounded-2xl flex items-center justify-center flex-shrink-0">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 28.651 32"
                      className="h-7 w-7 text-[#00A896]"
                    >
                      <path
                        d="M11.746 4.995C14.811 4.868 17.564 5.855 19.907 7.814l0.417 0.329C21.444 9.068 22.174 10.088 22.884 11.349c0.074 0.131 0.149 0.261 0.226 0.396 1.518 2.836 1.585 6.066 0.726 9.118 -0.462 1.391 -0.462 1.391 -0.977 1.706L22.511 22.698a81.86 81.86 0 0 1 -0.825 -0.698l-0.465 -0.393c-0.391 -0.405 -0.524 -0.589 -0.57 -1.142a31.256 31.256 0 0 1 0.372 -1.116c0.468 -2.48 0.147 -5.102 -1.286 -7.224C18.281 10.244 16.48 8.922 14.139 8.372c-2.797 -0.337 -5.174 0.142 -7.442 1.86 0.359 0.915 1.111 1.388 1.857 1.988C8.93 12.651 8.93 12.651 8.915 13.142 8.702 13.691 8.37 14.054 8 14.512c-0.792 1.672 -0.951 2.979 -0.366 4.758C8.191 20.67 9.045 21.359 10.419 21.953c1.455 0.455 2.979 0.267 4.37 -0.301 1.248 -0.687 1.927 -1.824 2.391 -3.14 0.385 -1.461 0.096 -2.686 -0.621 -4.001 -0.718 -1.056 -1.549 -1.861 -2.791 -2.233a15.628 15.628 0 0 0 -1.56 -0.153c-1.04 -0.07 -1.54 -0.249 -2.312 -0.975l-0.446 -0.413L9.116 10.419l0.186 -0.744c2.275 -0.739 4.11 -0.796 6.326 0.186 1.978 1.092 3.614 2.781 4.336 4.951 0.375 1.827 0.448 3.95 -0.434 5.634 -0.242 0.524 -0.349 0.928 -0.367 1.508 0.34 0.483 0.34 0.483 0.826 0.884 0.288 0.258 0.572 0.521 0.849 0.791v0.372l0.327 0.145c0.763 0.415 1.329 1.071 1.94 1.68l0.415 0.402 0.395 0.393 0.361 0.356c0.338 0.447 0.436 0.745 0.469 1.303 -0.448 0.634 -0.842 1.057 -1.488 1.488 -0.64 -0.058 -0.948 -0.324 -1.387 -0.774l-0.349 -0.354 -0.358 -0.372 -0.366 -0.374A155.72 155.72 0 0 1 19.907 26.977c-0.751 0.282 -1.443 0.637 -2.151 1.012 -2.699 1.36 -5.893 1.766 -8.837 0.919A23.442 23.442 0 0 1 7.814 28.465l-0.564 -0.233c-3.041 -1.38 -5.154 -3.738 -6.333 -6.846C0.097 18.784 0.015 15.622 0.93 13.023l0.558 -0.372a59.721 59.721 0 0 1 0.814 0.593l0.458 0.333C3.209 13.997 3.371 14.296 3.535 14.884c-0.052 0.435 -0.116 0.869 -0.186 1.302 -0.207 2.812 0.592 5.032 2.349 7.198 1.594 1.719 3.734 2.644 6.051 2.737 1.986 0.034 3.614 -0.454 5.367 -1.377h0.372l-0.558 -0.744 -0.396 0.161c-2.517 0.993 -4.91 1.415 -7.49 0.41 -1.924 -0.854 -3.351 -2.396 -4.194 -4.313C3.992 17.956 4.293 15.689 5.023 13.395l-0.374 -0.374L2.233 10.605c1.578 -2.755 4.03 -4.341 7.006 -5.235 0.855 -0.221 1.628 -0.312 2.507 -0.375"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-[#00A896] uppercase tracking-widest leading-none mb-1">QAONCLOUD</span>
                    <span className="text-xl font-black text-slate-800 leading-none">AutomatiQA</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#e2f1f5] rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00A896]" />
                  <span className="text-[9px] font-black text-[#00A896] uppercase tracking-wider">ONBOARDING</span>
                </div>
              </div>

              {/* Horizontal line divider */}
              <div className="w-full h-[1px] bg-slate-100" />

              {/* Error / Success messages */}
              {error && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-semibold flex items-center gap-2.5 shadow-sm animate-in fade-in duration-200">
                  <Zap size={14} className="text-rose-500 flex-shrink-0" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              )}
              {successMsg && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-600 text-xs font-semibold flex items-center gap-2.5 shadow-sm animate-in fade-in duration-200">
                  <Zap size={14} className="text-emerald-500 flex-shrink-0" />
                  <span className="leading-relaxed">{successMsg}</span>
                </div>
              )}

              {/* Full Name Input */}
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Full Name</label>
                <div className="relative">
                  <User className={iconClass} size={16} />
                  <input 
                    type="text" 
                    required 
                    value={name || ''} 
                    onChange={e => setName(e.target.value)} 
                    className="w-full pl-12 pr-6 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#00A896]/20 focus:border-[#00A896] focus:bg-white transition-all shadow-sm" 
                    placeholder="John Doe" 
                  />
                </div>
              </div>

              {/* Workspace Email Input */}
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Workspace Email</label>
                <div className="relative">
                  <Mail className={iconClass} size={16} />
                  <input 
                    type="email" 
                    required 
                    value={email || ''} 
                    onChange={e => setEmail(e.target.value)} 
                    className="w-full pl-12 pr-6 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#00A896]/20 focus:border-[#00A896] focus:bg-white transition-all shadow-sm" 
                    placeholder="name@company.com" 
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Set Password</label>
                <div className="relative">
                  <Lock className={iconClass} size={16} />
                  <input 
                    type={showPassword ? 'text' : 'password'} 
                    required 
                    value={password || ''} 
                    onChange={e => setPassword(e.target.value)} 
                    className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#00A896]/20 focus:border-[#00A896] focus:bg-white transition-all shadow-sm" 
                    placeholder="••••••••" 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)} 
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-all cursor-pointer p-1"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Verify Password Input */}
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Verify Password</label>
                <div className="relative">
                  <ShieldCheck className={iconClass} size={16} />
                  <input 
                    type={showConfirmPassword ? 'text' : 'password'} 
                    required 
                    value={confirmPassword || ''} 
                    onChange={e => setConfirmPassword(e.target.value)} 
                    className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#00A896]/20 focus:border-[#00A896] focus:bg-white transition-all shadow-sm" 
                    placeholder="••••••••" 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)} 
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-all cursor-pointer p-1"
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

            </div>

            {/* Lower dark navy section */}
            <div className="px-8 py-10 md:px-10 md:py-10 bg-[#0a0e1a] flex flex-col gap-5">
              <button 
                type="submit" 
                disabled={isLoading} 
                className="w-full py-4 bg-[#00dfc2] hover:bg-[#00c5ac] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] text-[#0a0e1a] rounded-2xl font-black text-xs uppercase tracking-widest border-none cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-[#00dfc2]/20 transition-all"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin text-[#0a0e1a]" />
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </button>

              <div className="flex items-center justify-between w-full mt-2">
                <span className="text-slate-500 font-bold text-[10px] uppercase tracking-wider">Already joined?</span>
                <button 
                  type="button" 
                  onClick={() => switchView('login')} 
                  className="text-[#00dfc2] hover:text-[#00c5ac] font-bold text-[10px] uppercase tracking-wider bg-transparent border-none cursor-pointer transition-colors"
                >
                  Sign In
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ── FORGOT PASSWORD VIEW ── */}
        {view === 'forgot-password' && (
          <form onSubmit={handleForgotPassword} className="flex flex-col">
            {/* Upper white section */}
            <div className="p-8 md:p-10 bg-white flex flex-col gap-6">
              
              {/* Header block with inline logo and badge */}
              <div className="flex items-center justify-between w-full mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#e2f1f5] rounded-2xl flex items-center justify-center flex-shrink-0">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 28.651 32"
                      className="h-7 w-7 text-[#00A896]"
                    >
                      <path
                        d="M11.746 4.995C14.811 4.868 17.564 5.855 19.907 7.814l0.417 0.329C21.444 9.068 22.174 10.088 22.884 11.349c0.074 0.131 0.149 0.261 0.226 0.396 1.518 2.836 1.585 6.066 0.726 9.118 -0.462 1.391 -0.462 1.391 -0.977 1.706L22.511 22.698a81.86 81.86 0 0 1 -0.825 -0.698l-0.465 -0.393c-0.391 -0.405 -0.524 -0.589 -0.57 -1.142a31.256 31.256 0 0 1 0.372 -1.116c0.468 -2.48 0.147 -5.102 -1.286 -7.224C18.281 10.244 16.48 8.922 14.139 8.372c-2.797 -0.337 -5.174 0.142 -7.442 1.86 0.359 0.915 1.111 1.388 1.857 1.988C8.93 12.651 8.93 12.651 8.915 13.142 8.702 13.691 8.37 14.054 8 14.512c-0.792 1.672 -0.951 2.979 -0.366 4.758C8.191 20.67 9.045 21.359 10.419 21.953c1.455 0.455 2.979 0.267 4.37 -0.301 1.248 -0.687 1.927 -1.824 2.391 -3.14 0.385 -1.461 0.096 -2.686 -0.621 -4.001 -0.718 -1.056 -1.549 -1.861 -2.791 -2.233a15.628 15.628 0 0 0 -1.56 -0.153c-1.04 -0.07 -1.54 -0.249 -2.312 -0.975l-0.446 -0.413L9.116 10.419l0.186 -0.744c2.275 -0.739 4.11 -0.796 6.326 0.186 1.978 1.092 3.614 2.781 4.336 4.951 0.375 1.827 0.448 3.95 -0.434 5.634 -0.242 0.524 -0.349 0.928 -0.367 1.508 0.34 0.483 0.34 0.483 0.826 0.884 0.288 0.258 0.572 0.521 0.849 0.791v0.372l0.327 0.145c0.763 0.415 1.329 1.071 1.94 1.68l0.415 0.402 0.395 0.393 0.361 0.356c0.338 0.447 0.436 0.745 0.469 1.303 -0.448 0.634 -0.842 1.057 -1.488 1.488 -0.64 -0.058 -0.948 -0.324 -1.387 -0.774l-0.349 -0.354 -0.358 -0.372 -0.366 -0.374A155.72 155.72 0 0 1 19.907 26.977c-0.751 0.282 -1.443 0.637 -2.151 1.012 -2.699 1.36 -5.893 1.766 -8.837 0.919A23.442 23.442 0 0 1 7.814 28.465l-0.564 -0.233c-3.041 -1.38 -5.154 -3.738 -6.333 -6.846C0.097 18.784 0.015 15.622 0.93 13.023l0.558 -0.372a59.721 59.721 0 0 1 0.814 0.593l0.458 0.333C3.209 13.997 3.371 14.296 3.535 14.884c-0.052 0.435 -0.116 0.869 -0.186 1.302 -0.207 2.812 0.592 5.032 2.349 7.198 1.594 1.719 3.734 2.644 6.051 2.737 1.986 0.034 3.614 -0.454 5.367 -1.377h0.372l-0.558 -0.744 -0.396 0.161c-2.517 0.993 -4.91 1.415 -7.49 0.41 -1.924 -0.854 -3.351 -2.396 -4.194 -4.313C3.992 17.956 4.293 15.689 5.023 13.395l-0.374 -0.374L2.233 10.605c1.578 -2.755 4.03 -4.341 7.006 -5.235 0.855 -0.221 1.628 -0.312 2.507 -0.375"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-[#00A896] uppercase tracking-widest leading-none mb-1">QAONCLOUD</span>
                    <span className="text-xl font-black text-slate-800 leading-none">AutomatiQA</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#e2f1f5] rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00A896]" />
                  <span className="text-[9px] font-black text-[#00A896] uppercase tracking-wider">RECOVERY</span>
                </div>
              </div>

              {/* Horizontal line divider */}
              <div className="w-full h-[1px] bg-slate-100" />

              {/* Warning/info text */}
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-indigo-700 text-xs font-semibold leading-relaxed shadow-sm">
                Enter your email address below and we'll send you a recovery link.
              </div>

              {/* Error / Success messages */}
              {error && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-semibold flex items-center gap-2.5 shadow-sm animate-in fade-in duration-200">
                  <Zap size={14} className="text-rose-500 flex-shrink-0" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              )}
              {successMsg && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-600 text-xs font-semibold flex items-center gap-2.5 shadow-sm animate-in fade-in duration-200">
                  <Zap size={14} className="text-emerald-500 flex-shrink-0" />
                  <span className="leading-relaxed">{successMsg}</span>
                </div>
              )}

              {/* Recovery Email Input */}
              <div className="flex flex-col gap-2">
                <label className={labelClass}>Recovery Email</label>
                <div className="relative">
                  <Mail className={iconClass} size={16} />
                  <input 
                    type="email" 
                    required 
                    value={email || ''} 
                    onChange={e => setEmail(e.target.value)} 
                    className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#00A896]/20 focus:border-[#00A896] focus:bg-white transition-all shadow-sm" 
                    placeholder="name@company.com" 
                  />
                </div>
              </div>

              {/* Direct recovery secure link for qaoncloud delivery bypass */}
              {resetLink && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex flex-col gap-3 shadow-sm animate-in fade-in duration-200">
                  <p className="text-xs text-emerald-700 font-semibold leading-relaxed">
                    ℹ️ <strong>Delivery Warning:</strong> Corporate email firewalls (such as <strong>qaoncloud.com</strong>) often completely block emails from sandbox domains (<em>automatiqa.firebaseapp.com</em>).
                  </p>
                  <p className="text-xs text-slate-600 font-medium leading-relaxed">
                    To guarantee you are not blocked, click the direct secure recovery link below to reset your password immediately:
                  </p>
                  <a 
                    href={resetLink} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="block w-full text-center py-3 bg-[#00dfc2] hover:bg-[#00c5ac] text-[#0a0e1a] rounded-xl font-black text-xs uppercase tracking-widest text-decoration-none shadow-md transition-all"
                  >
                    Reset Password Now
                  </a>
                </div>
              )}

            </div>

            {/* Lower dark navy section */}
            <div className="px-8 py-10 md:px-10 md:py-10 bg-[#0a0e1a] flex flex-col gap-5">
              <button 
                type="submit" 
                disabled={isLoading} 
                className="w-full py-4 bg-[#00dfc2] hover:bg-[#00c5ac] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] text-[#0a0e1a] rounded-2xl font-black text-xs uppercase tracking-widest border-none cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-[#00dfc2]/20 transition-all"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin text-[#0a0e1a]" />
                ) : (
                  <span>Send Reset Email</span>
                )}
              </button>

              <div className="flex items-center justify-between w-full mt-2">
                <span className="text-slate-500 font-bold text-[10px] uppercase tracking-wider">Remembered password?</span>
                <button 
                  type="button" 
                  onClick={() => switchView('login')} 
                  className="text-[#00dfc2] hover:text-[#00c5ac] font-bold text-[10px] uppercase tracking-wider bg-transparent border-none cursor-pointer transition-colors"
                >
                  Back to Sign In
                </button>
              </div>
            </div>
          </form>
        )}

      </div>

      <style>{`
        input:-webkit-autofill { -webkit-box-shadow: 0 0 0 1000px #f8fafc inset !important; -webkit-text-fill-color: #334155 !important; }
      `}</style>
    </div>
  );
};

export default Auth;