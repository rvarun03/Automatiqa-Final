import React, { useEffect, useState } from 'react';
import { getTokenLogs, calculateCreditsConsumed, TOTAL_CREDIT_POOL, getBasicPlanValidity } from '../services/tokenConsumptionService';
import { createSubscriptionRequest, getLocalSubscriptionRequests } from '../services/subscriptionService';
import { AlertTriangle, ShieldAlert, Sparkles, AlertCircle, Coins, ArrowRight, X, Send, CheckCircle2, Crown, RefreshCw } from 'lucide-react';

interface CreditAlertBannerProps {
  currentUserEmail?: string;
  currentUserName?: string;
  onNavigateToCredits?: () => void;
}

export const CreditAlertBanner: React.FC<CreditAlertBannerProps> = ({ 
  currentUserEmail, 
  currentUserName,
  onNavigateToCredits 
}) => {
  const [creditsState, setCreditsState] = useState<{
    totalUsed: number;
    remaining: number;
    percentUsed: number;
    threshold: number; // 0, 25, 50, 75, 100
  }>({
    totalUsed: 0,
    remaining: TOTAL_CREDIT_POOL,
    percentUsed: 0,
    threshold: 0
  });

  const [isHovered, setIsHovered] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [subscriptionSent, setSubscriptionSent] = useState(false);
  const [validityInfo, setValidityInfo] = useState(() => getBasicPlanValidity());

  const calculateCredits = () => {
    const logs = getTokenLogs();
    const email = currentUserEmail?.toLowerCase().trim();
    const name = currentUserName?.toLowerCase().trim();

    // Check user-specific logs if available, otherwise check all workspace logs
    const userLogs = logs.filter(l => {
      if (!email && !name) return true;
      const lEmail = (l.userEmail || '').toLowerCase().trim();
      const lName = (l.user || '').toLowerCase().trim();
      if (email && lEmail && lEmail === email) return true;
      if (name && lName && lName === name) return true;
      return false;
    });

    const relevantLogs = userLogs.length > 0 ? userLogs : logs;
    const totalUsed = relevantLogs.reduce((acc, l) => {
      return acc + (l.creditsConsumed ?? calculateCreditsConsumed(l.feature, l.itemsGenerated || 1, l.cached));
    }, 0);

    const pool = TOTAL_CREDIT_POOL; // 1000 credits
    const percentUsed = Math.min(100, Math.round((totalUsed / pool) * 100));
    const remaining = Math.max(0, pool - totalUsed);

    let threshold = 0;
    if (percentUsed >= 100) {
      threshold = 100;
    } else if (percentUsed >= 75) {
      threshold = 75;
    } else if (percentUsed >= 50) {
      threshold = 50;
    } else if (percentUsed >= 25) {
      threshold = 25;
    }

    setCreditsState({
      totalUsed,
      remaining,
      percentUsed,
      threshold
    });
    setValidityInfo(getBasicPlanValidity());

    // Check if subscription request was already sent for this user
    if (email) {
      const pending = getLocalSubscriptionRequests().find(r => r.userEmail === email && r.status === 'PENDING');
      if (pending) {
        setSubscriptionSent(true);
      }
    }
  };

  useEffect(() => {
    calculateCredits();

    const handleUpdate = () => {
      calculateCredits();
    };

    const handleLimitExceeded = (e: any) => {
      calculateCredits();
      setIsModalOpen(true);
    };

    window.addEventListener('storage', handleUpdate);
    window.addEventListener('token-consumption-updated', handleUpdate);
    window.addEventListener('credit-limit-exceeded', handleLimitExceeded);
    window.addEventListener('subscription-request-updated', handleUpdate);
    
    // Periodic check every 5 seconds to guarantee synchronization
    const interval = setInterval(calculateCredits, 5000);

    return () => {
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('token-consumption-updated', handleUpdate);
      window.removeEventListener('credit-limit-exceeded', handleLimitExceeded);
      window.removeEventListener('subscription-request-updated', handleUpdate);
      clearInterval(interval);
    };
  }, [currentUserEmail, currentUserName]);

  const { totalUsed, remaining, percentUsed, threshold } = creditsState;

  const handleSubscribeClick = async () => {
    setIsSubscribing(true);
    try {
      const email = currentUserEmail || 'automatiqa@qaoncloud.com';
      const name = currentUserName || 'Shanmugapriya';
      await createSubscriptionRequest(email, name, totalUsed, 'User exceeded 1,000 credit limit and clicked Subscribe in Credit Allocation popup.');
      setSubscriptionSent(true);
    } catch (e) {
      console.error("Failed to submit subscription request:", e);
    } finally {
      setIsSubscribing(false);
    }
  };

  // Configure clear format text and color themes based on threshold
  let badgeClasses = 'bg-teal-50 border-teal-200/90 text-teal-950 hover:bg-teal-100/70';
  let dotColor = 'bg-teal-500 animate-pulse';
  let iconColor = 'text-teal-600';
  let alertPrefix = 'Credit Status';
  let IconComponent = Coins;

  if (threshold >= 100) {
    badgeClasses = 'bg-rose-50 border-rose-300 text-rose-950 hover:bg-rose-100 animate-pulse';
    dotColor = 'bg-rose-600';
    iconColor = 'text-rose-600';
    alertPrefix = '100% Credit Limit Reached';
    IconComponent = ShieldAlert;
  } else if (threshold >= 75) {
    badgeClasses = 'bg-orange-50 border-orange-300 text-orange-950 hover:bg-orange-100';
    dotColor = 'bg-orange-600 animate-pulse';
    iconColor = 'text-orange-600';
    alertPrefix = '75% Credit Alert';
    IconComponent = AlertTriangle;
  } else if (threshold >= 50) {
    badgeClasses = 'bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100';
    dotColor = 'bg-amber-500 animate-pulse';
    iconColor = 'text-amber-600';
    alertPrefix = '50% Credit Alert';
    IconComponent = AlertTriangle;
  } else if (threshold >= 25) {
    badgeClasses = 'bg-indigo-50 border-indigo-200 text-indigo-950 hover:bg-indigo-100';
    dotColor = 'bg-indigo-500';
    iconColor = 'text-indigo-600';
    alertPrefix = '25% Credit Alert';
    IconComponent = AlertCircle;
  }

  return (
    <>
      <div 
        className="relative inline-flex items-center"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Permanent Text Label in Clear Format */}
        <div 
          id="permanent-credit-alert-label"
          onClick={() => setIsModalOpen(true)}
          className={`flex items-center gap-2.5 px-4 py-2 rounded-full border text-[11px] font-black uppercase tracking-wider transition-all duration-200 shadow-sm cursor-pointer select-none ${badgeClasses}`}
          title="Click to view Credit Allocation & Subscription details"
        >
          <div className="flex items-center gap-1.5 shrink-0">
            <div className={`w-2 h-2 rounded-full ${dotColor}`} />
            <IconComponent size={14} className={iconColor} />
          </div>

          {/* Clear Text Format Display */}
          <div className="flex items-center gap-2">
            {threshold >= 25 ? (
              <>
                <span className="font-black text-slate-900 tracking-tight">
                  {alertPrefix}:
                </span>
                <span className="font-mono font-bold text-slate-800">
                  {totalUsed} / {TOTAL_CREDIT_POOL} Used
                </span>
                <span className="text-slate-400 font-normal">|</span>
                <span className={`font-mono font-black ${threshold >= 100 ? 'text-rose-700 font-extrabold' : threshold >= 75 ? 'text-orange-700' : 'text-amber-700'}`}>
                  {remaining} Rem ({percentUsed}%)
                </span>
              </>
            ) : (
              <>
                <span className="font-bold text-teal-800 tracking-tight">
                  Credits:
                </span>
                <span className="font-mono font-extrabold text-teal-950">
                  {remaining} / {TOTAL_CREDIT_POOL} Rem
                </span>
                <span className="text-teal-300 font-normal">|</span>
                <span className="font-mono text-teal-700 font-bold">
                  {totalUsed} Used ({percentUsed}%)
                </span>
              </>
            )}
          </div>
        </div>

        {/* Hover Info Tooltip Card */}
        {isHovered && !isModalOpen && (
          <div className="absolute top-full right-0 mt-2 w-80 bg-slate-900 text-white rounded-2xl p-4 shadow-2xl border border-slate-800 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <Coins size={15} className="text-[#00E1C5]" />
                <span className="text-xs font-black uppercase tracking-wider text-white">Credit Allocation</span>
              </div>
              <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${threshold >= 100 ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : threshold >= 75 ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : threshold >= 25 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'}`}>
                {percentUsed}% Used
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-300">
                <span>Total Plan Pool:</span>
                <span className="font-mono font-bold text-white">{TOTAL_CREDIT_POOL} Credits</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>Consumed Credits:</span>
                <span className="font-mono font-bold text-amber-400">{totalUsed} Credits</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>Remaining Credits:</span>
                <span className="font-mono font-bold text-[#00E1C5]">{remaining} Credits</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>Plan Validity:</span>
                <span className="font-bold text-slate-300">32 Days Total (2d + 30d)</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${threshold >= 100 ? 'bg-rose-500' : threshold >= 75 ? 'bg-orange-500' : threshold >= 50 ? 'bg-amber-500' : threshold >= 25 ? 'bg-indigo-500' : 'bg-[#00E1C5]'}`}
                style={{ width: `${percentUsed}%` }}
              />
            </div>

            <button 
              onClick={() => setIsModalOpen(true)}
              className="mt-3 w-full py-2 bg-gradient-to-r from-[#00E1C5] to-teal-500 hover:opacity-90 text-slate-950 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-md"
            >
              <Coins size={14} /> Open Credit Allocation <ArrowRight size={12} />
            </button>
          </div>
        )}
      </div>

      {/* CREDIT ALLOCATION & SUBSCRIBE MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className={`p-6 text-white relative overflow-hidden ${threshold >= 100 ? 'bg-gradient-to-br from-rose-950 via-slate-900 to-slate-900' : 'bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900'}`}>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg font-black text-xl ${threshold >= 100 ? 'bg-rose-600 text-white' : 'bg-[#00E1C5] text-slate-950'}`}>
                  {threshold >= 100 ? <ShieldAlert size={26} /> : <Coins size={26} />}
                </div>
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-white/10 rounded-full text-[10px] font-black uppercase tracking-widest text-[#00E1C5] border border-white/10">
                    <Crown size={12} /> Basic Plan Allocation
                  </div>
                  <h3 className="text-xl font-black text-white mt-1">
                    {threshold >= 100 ? '1,000 Credit Limit Exceeded' : 'Credit Allocation Status'}
                  </h3>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Credit Status Summary Cards */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Total Pool</span>
                  <span className="text-xl font-black text-slate-900 font-mono mt-0.5 block">{TOTAL_CREDIT_POOL}</span>
                  <span className="text-[10px] text-slate-500 font-medium">Credits</span>
                </div>

                <div className="p-3.5 bg-amber-50 border border-amber-200/80 rounded-2xl">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block">Used</span>
                  <span className="text-xl font-black text-amber-600 font-mono mt-0.5 block">{totalUsed}</span>
                  <span className="text-[10px] text-amber-700 font-bold">{percentUsed}%</span>
                </div>

                <div className="p-3.5 bg-teal-50 border border-teal-200/80 rounded-2xl">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#008f7d] block">Remaining</span>
                  <span className="text-xl font-black text-[#00a693] font-mono mt-0.5 block">{remaining}</span>
                  <span className="text-[10px] text-[#008f7d] font-bold">Credits</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold text-slate-600">
                  <span>Quota Usage</span>
                  <span className={threshold >= 100 ? 'text-rose-600 font-black' : 'text-slate-900'}>
                    {percentUsed}% ({totalUsed} / {TOTAL_CREDIT_POOL} Credits)
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden p-0.5 border border-slate-200">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${threshold >= 100 ? 'bg-gradient-to-r from-amber-500 to-rose-600' : 'bg-gradient-to-r from-teal-400 to-[#00E1C5]'}`}
                    style={{ width: `${percentUsed}%` }}
                  />
                </div>
              </div>

              {/* Threshold Exceeded Box / Information */}
              {threshold >= 100 ? (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-rose-800 font-black text-xs uppercase tracking-wider">
                    <AlertTriangle size={15} /> 1,000 Credits Exceeded
                  </div>
                  <p className="text-xs text-rose-700 font-medium leading-relaxed">
                    You have reached the maximum 1,000 credit limit for your Basic Plan. Click <strong>Subscribe</strong> below to request a subscription renewal from the Super Admin (<span className="font-bold">automatiqa@qaoncloud.com</span>). Once approved, your 1,000 credits and 32-day validity will be re-enabled immediately.
                  </p>
                  <p className="text-[11px] text-slate-500 font-medium pt-1">
                    * All manual test cases, manual executions, test script runs, and reports remain 100% free and unlimited.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs space-y-1.5 text-slate-600">
                  <div className="flex items-center gap-2 text-slate-900 font-bold">
                    <CheckCircle2 size={14} className="text-teal-600" /> Plan Validity: {validityInfo.daysRemaining} Days Remaining
                  </div>
                  <p className="font-medium text-slate-500">
                    The 32-day pack includes full access across all 10 specialized AI generator modules.
                  </p>
                </div>
              )}

              {/* SUBSCRIBE BUTTON / NOTIFICATION CONFIRMATION */}
              <div className="pt-2 space-y-3">
                {subscriptionSent ? (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3 animate-in fade-in duration-300">
                    <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-black text-emerald-900 uppercase tracking-wide">
                        Subscription Request Received & Sent
                      </h4>
                      <p className="text-xs text-emerald-800 font-medium leading-relaxed">
                        Super Admin (<strong className="text-emerald-950">automatiqa@qaoncloud.com</strong>) has received an in-app notification & email request to re-enable your subscription.
                      </p>
                    </div>
                  </div>
                ) : (
                  <button
                    id="credit-allocation-subscribe-button"
                    onClick={handleSubscribeClick}
                    disabled={isSubscribing}
                    className="w-full py-3.5 bg-gradient-to-r from-[#00E1C5] to-teal-500 hover:from-[#00cbb2] hover:to-teal-600 text-slate-950 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-teal-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    {isSubscribing ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" /> Submitting Request...
                      </>
                    ) : (
                      <>
                        <Send size={16} /> Subscribe (Notify Super Admin to Re-Enable)
                      </>
                    )}
                  </button>
                )}

                {/* Secondary Action */}
                {onNavigateToCredits && (
                  <button
                    onClick={() => {
                      setIsModalOpen(false);
                      onNavigateToCredits();
                    }}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                  >
                    View Detailed Credit Analytics <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const CreditAlertLabel = CreditAlertBanner;
export default CreditAlertBanner;

