import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  MapPin, Briefcase, Sparkles, Target, Zap, TrendingUp, Users,
  CheckCircle2, Menu, X, ChevronDown, Star, ArrowRight, ArrowUpRight, Upload,
  UserPlus, Brain, Send, Award, Building2, Bookmark, Github, Linkedin, Mail,
  ShieldCheck, Gauge, Radar, ChevronRight, Quote, Globe2, Cloud,
  Code2, Layers, Cpu, HeartPulse, ShoppingBag, Factory, Wifi, Landmark,
  Loader2, Inbox, Sparkle, UserCheck, XCircle, Plus, Search, Clock,
  AlertTriangle, FileText, Filter, RefreshCw, WifiOff, LogOut, Lock,
  ArrowLeft, KeyRound, Phone, Paperclip, FileCheck2, FileWarning, Check,
  Bell, BellRing, ThumbsDown, PartyPopper, Lightbulb, SlidersHorizontal, Trash2,
} from "lucide-react";

/* ================================================================== */
/*  DATA LAYER — multi-tenant, backed by Supabase (see src/lib/db.js  */
/*  and supabase/schema.sql). Every job carries company_id + hr_id;   */
/*  every application inherits hr_id from its job, which is what      */
/*  routes "applied to HR1's job" -> HR1's dashboard and "applied to  */
/*  HR2's job" -> HR2's dashboard. Auth/session is Supabase Auth.     */
/* ================================================================== */
import {
  registerCandidate, loginCandidate, registerHR, loginHR, logout, getSession,
  createJob, listOpenJobs, listMyJobs, setJobStatus,
  addInternalEmployee, listInternalEmployees,
  submitApplication, listApplicationsForJob, updateApplicationStatus,
  updateCandidateResume,
  createNotification, listNotifications, markNotificationRead, markAllNotificationsRead,
} from "./lib/db";
import {
  extractSkillsFromResume, extractContactHints,
  extractNameGuess, extractRoleGuess, extractExperienceGuess, guessDepartmentFromRole,
  scoreResumeAgainstJob, matchInternalEmployees, recommendJobsForResume, MASTER_SKILLS,
} from "./lib/resumeAnalyzer";
import { pushJobToExternalBoards } from "./lib/externalBoards";
import { isAIEnabled, analyzeResumeWithAI, generateDecisionMessage, explainMatchWithAI, generateInterviewQuestions } from "./lib/aiClient";
import { analyzeResumeWithPython, isPythonBackendConfigured } from "./lib/pythonAnalyzer";

function initialsOf(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

// extractSkillsFromResume, extractContactHints, and MASTER_SKILLS now live in
// src/lib/resumeAnalyzer.js (imported above) — that version uses TF-IDF
// cosine similarity for overall scoring instead of plain keyword includes().

// Reads an uploaded resume file and returns its text content where possible.
// .txt is read directly. .docx is parsed with mammoth (loaded on demand so the
// app has no extra weight until someone actually uploads a Word file). Other
// formats (.pdf, .doc) can't be reliably parsed in-browser without a much
// heavier dependency, so we surface that clearly and let the candidate paste
// the text instead — the file itself is still attached to the application.
async function readResumeFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "txt") {
    const text = await file.text();
    return { text, extracted: true };
  }

  if (ext === "docx") {
    try {
      const mod = await import("mammoth/mammoth.browser");
      const mammoth = mod.default || mod;
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return { text: result.value || "", extracted: true };
    } catch (e) {
      return { text: "", extracted: false };
    }
  }

  // .pdf, .doc, or anything else we can't parse client-side yet
  return { text: "", extracted: false };
}

/* ------------------------------------------------------------------ */
/*  Reveal-on-scroll wrapper                                          */
/* ------------------------------------------------------------------ */
function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true);
            obs.unobserve(node);
          }
        });
      },
      { threshold: 0.15 }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0px)" : "translateY(28px)",
        transition: `opacity 0.7s cubic-bezier(.16,1,.3,1) ${delay}ms, transform 0.7s cubic-bezier(.16,1,.3,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated counter                                                  */
/* ------------------------------------------------------------------ */
function Counter({ target, suffix = "", duration = 1800 }) {
  const ref = useRef(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const tick = (now) => {
              const progress = Math.min((now - start) / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              setValue(Math.floor(eased * target));
              if (progress < 1) requestAnimationFrame(tick);
              else setValue(target);
            };
            requestAnimationFrame(tick);
            obs.unobserve(node);
          }
        });
      },
      { threshold: 0.4 }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [target, duration]);

  return (
    <span ref={ref}>
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

/* ================================================================== */
/*  LOGIN GATE — the front door. Picks a role, then routes into        */
/*  the matching dashboard. Session is stored locally so refreshing    */
/*  the page doesn't log you out.                                      */
/* ================================================================== */
function LoginGate({ onLogin }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [role, setRole] = useState("candidate");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [designation, setDesignation] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [companySize, setCompanySize] = useState("1-10");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isRegisterHR = mode === "register" && role === "hr";
  const canSubmit =
    email.trim().includes("@") &&
    password.trim().length >= 6 &&
    (mode === "login" || name.trim()) &&
    (!isRegisterHR || companyName.trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      let session;
      if (mode === "login") {
        session = role === "hr"
          ? await loginHR({ email: email.trim(), password })
          : await loginCandidate({ email: email.trim(), password });
      } else if (role === "hr") {
        session = await registerHR({
          name: name.trim(), workEmail: email.trim(), password, designation: designation.trim(),
          companyName: companyName.trim(), companyIndustry: companyIndustry.trim(),
          companySize, companyWebsite: companyWebsite.trim(),
        });
      } else {
        session = await registerCandidate({ name: name.trim(), email: email.trim(), phone: phone.trim(), password });
      }
      await onLogin(session);
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700&display=swap');
        .font-display { font-family: 'Space Grotesk', 'Inter', sans-serif; }
        @keyframes floatY { 0%, 100% { transform: translateY(0px) rotate(0deg); } 50% { transform: translateY(-14px) rotate(0.5deg); } }
        @keyframes floatY2 { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(12px); } }
        @keyframes spinSlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulseRing { 0% { transform: scale(0.9); opacity: 0.6; } 70% { transform: scale(1.4); opacity: 0; } 100% { transform: scale(1.4); opacity: 0; } }
        @keyframes gradientShift { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        .float-card { animation: floatY 6s ease-in-out infinite; }
        .float-card-slow { animation: floatY2 8s ease-in-out infinite; }
        .spin-slow { animation: spinSlow 14s linear infinite; }
        .pulse-ring { animation: pulseRing 2.4s cubic-bezier(0,0,0.2,1) infinite; }
        .gradient-mesh { background: linear-gradient(120deg, #eff6ff, #ffffff 45%, #dbeafe); background-size: 200% 200%; animation: gradientShift 12s ease infinite; }
        .btn-ripple { position: relative; overflow: hidden; }
        .btn-ripple::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(circle, rgba(255,255,255,0.5) 10%, transparent 10.5%); transform: scale(10, 10); opacity: 0; transition: transform 0.5s, opacity 1s; }
        .btn-ripple:active::after { transform: scale(0,0); opacity: 0.3; transition: 0s; }
        ::selection { background: #bfdbfe; color: #1e3a8a; }
      `}</style>

      <div className="min-h-screen grid lg:grid-cols-2">
        {/* LEFT — brand panel */}
        <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-600 to-blue-500 px-14 py-12">
          <div
            className="absolute inset-0 opacity-20"
            style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.16) 1.5px, transparent 1.5px)", backgroundSize: "22px 22px" }}
          />
          <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle, #fff, transparent 70%)" }} />

          <div className="relative flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-white/15 backdrop-blur-md flex items-center justify-center">
              <Sparkles className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="font-display font-bold text-lg text-white tracking-tight">ZONE Technologies</span>
          </div>

          <div className="relative">
            <h1 className="font-display font-bold text-4xl text-white leading-[1.15] tracking-tight max-w-md">
              One platform. Every hire, matched by AI.
            </h1>
            <p className="text-blue-100 mt-5 max-w-sm leading-relaxed">
              HR opens a role and the AI checks the internal team first. If no one clears the bar, it goes live for candidates — and every application flows straight back into HR's shortlist queue.
            </p>

            <div className="flex flex-col gap-3 mt-9">
              {[
                { icon: Building2, label: "HR assigns a role", sub: "AI scores it against the internal team" },
                { icon: Globe2, label: "Auto-posted if needed", sub: "Only unfilled roles reach candidates" },
                { icon: Brain, label: "Resume, scored instantly", sub: "Skills extracted and ranked for HR" },
              ].map((item, i) => (
                <div key={item.label} className="float-card-slow flex items-center gap-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-3 w-full max-w-sm" style={{ animationDelay: `${i * 0.5}s` }}>
                  <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                    <item.icon className="w-4.5 h-4.5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white leading-tight">{item.label}</p>
                    <p className="text-xs text-blue-100/80 mt-0.5">{item.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="relative text-xs text-blue-100/70">© 2026 ZONE Technologies. All rights reserved.</p>
        </div>

        {/* RIGHT — login form */}
        <div className="flex items-center justify-center px-6 py-16 gradient-mesh lg:bg-none">
          <Reveal className="w-full max-w-sm">
            <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="font-display font-bold text-lg tracking-tight">ZONE <span className="text-blue-600">Technologies</span></span>
            </div>

            <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2 text-center lg:text-left">
              {mode === "login" ? "Sign in" : "Create account"}
            </p>
            <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-center lg:text-left">
              {mode === "login" ? "Welcome back" : "Join TalentSphere AI"}
            </h2>
            <p className="text-sm text-slate-500 mt-2 text-center lg:text-left">
              {mode === "login"
                ? "Choose how you're signing in — this decides which dashboard you land on."
                : role === "hr"
                ? "Tell us about your company — every job you post will carry your company's name."
                : "One profile, apply to jobs across every company on the platform."}
            </p>

            <div className="flex items-center justify-center lg:justify-start gap-1 mt-4 text-sm">
              <button type="button" onClick={() => { setMode("login"); setError(""); }} className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${mode === "login" ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:text-slate-600"}`}>Login</button>
              <span className="text-slate-300">/</span>
              <button type="button" onClick={() => { setMode("register"); setError(""); }} className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${mode === "register" ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:text-slate-600"}`}>Register</button>
            </div>

            {/* Role tabs */}
            <div className="grid grid-cols-2 gap-2 mt-6 p-1 rounded-2xl bg-slate-100">
              {[
                { id: "candidate", label: "Candidate", icon: UserPlus },
                { id: "hr", label: "HR Team", icon: Building2 },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRole(r.id)}
                  className={`flex items-center justify-center gap-1.5 text-sm font-semibold py-2.5 rounded-xl transition-all ${
                    role === r.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <r.icon className="w-4 h-4" /> {r.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 mt-6">
              {mode === "register" && (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={role === "hr" ? "Work email" : "Email address"}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
              {mode === "register" && role === "candidate" && (
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number (optional)"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              )}
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (min 6 characters)"
                  className="w-full rounded-xl border border-slate-200 pl-11 pr-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>

              {isRegisterHR && (
                <div className="space-y-3 pt-2 border-t border-dashed border-slate-200">
                  <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 pt-2">
                    <Building2 className="w-3.5 h-3.5" /> Company details
                  </p>
                  <input
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="Your designation (e.g. Talent Acquisition Lead)"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Company name"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={companyIndustry}
                      onChange={(e) => setCompanyIndustry(e.target.value)}
                      placeholder="Industry"
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                    />
                    <select
                      value={companySize}
                      onChange={(e) => setCompanySize(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white"
                    >
                      {["1-10", "11-50", "51-200", "201-500", "500+"].map((s) => <option key={s} value={s}>{s} employees</option>)}
                    </select>
                  </div>
                  <input
                    value={companyWebsite}
                    onChange={(e) => setCompanyWebsite(e.target.value)}
                    placeholder="Company website (optional)"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    If your company is already registered by a colleague, use the same company name here — you'll be attached to it as a second HR, not a duplicate.
                  </p>
                </div>
              )}

              {error && (
                <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="btn-ripple w-full flex items-center justify-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed px-5 py-3 rounded-xl shadow-md shadow-blue-200 transition-all hover:-translate-y-0.5 mt-2"
              >
                {submitting ? (
                  <>{mode === "login" ? "Signing in" : "Creating account"} <Loader2 className="w-4 h-4 animate-spin" /></>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    {mode === "login" ? "Continue to" : "Create account →"} {mode === "login" && (role === "hr" ? "HR Dashboard" : "Candidate Portal")}
                  </>
                )}
              </button>
            </form>

            <p className="text-[11px] text-slate-400 mt-5 text-center lg:text-left leading-relaxed">
              {mode === "login"
                ? "New here? Switch to Register above to create a candidate profile or set up your company's HR account."
                : "Already have an account? Switch to Login above."}
            </p>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center animate-pulse">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <p className="text-sm text-slate-400">Loading ZONE…</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  CANDIDATE PORTAL                                                   */
/* ================================================================== */
const NAV_LINKS = ["What We Do", "Industries", "Careers", "Insights", "About", "Contact"];

const SERVICES = [
  { icon: Cloud, title: "Cloud & Infrastructure", copy: "Modernize infrastructure and migrate to the cloud without disrupting the business." },
  { icon: Code2, title: "Software Engineering", copy: "Full-cycle product engineering, from architecture to shipped release." },
  { icon: Brain, title: "Data & AI", copy: "Turn raw data into decisions with analytics and applied AI." },
  { icon: ShieldCheck, title: "Cybersecurity", copy: "Protect systems and data with security built into every layer." },
  { icon: Layers, title: "Enterprise Platforms", copy: "Implement and integrate the platforms that run core operations." },
  { icon: Cpu, title: "Managed Services", copy: "Ongoing support that keeps systems reliable, secure, and current." },
];

const INDUSTRIES = [
  { icon: Landmark, title: "Banking & Financial Services" },
  { icon: HeartPulse, title: "Healthcare & Life Sciences" },
  { icon: ShoppingBag, title: "Retail & Consumer Goods" },
  { icon: Factory, title: "Manufacturing" },
  { icon: Wifi, title: "Telecommunications" },
  { icon: Building2, title: "Public Sector" },
];

const LEADERSHIP = [
  { name: "Sri Ganesh", role: "Chief Executive Officer", initials: "SG" },
  { name: "Suban Raj", role: "Director", initials: "SR" },
  { name: "Sriram", role: "Executive", initials: "SM" },
  { name: "Sivaranjani", role: "Chief Officer", initials: "SV" },
  { name: "Sivadharshini", role: "Manager", initials: "SD" },
];

const HIRE_STEPS = [
  { icon: UserPlus, title: "Create Account" },
  { icon: Upload, title: "Upload Resume" },
  { icon: Brain, title: "AI Analysis" },
  { icon: Send, title: "Apply to Roles" },
  { icon: Users, title: "Interview" },
  { icon: Award, title: "Get Hired" },
];

const STATS = [
  { value: 300, suffix: "+", label: "IT Professionals" },
  { value: 50, suffix: "+", label: "Enterprise Clients" },
  { value: 12, suffix: "+", label: "Industries Served" },
  { value: 98, suffix: "%", label: "Client Retention" },
];

const TESTIMONIALS = [
  { name: "Priya Nair", role: "Product Designer · ZONE Technologies", quote: "I stopped guessing whether I'd be a fit. The match score told me exactly where I stood.", rating: 5 },
  { name: "Marcus Webb", role: "IT Director · Client Partner", quote: "ZONE's delivery team plugged into our roadmap in weeks, not quarters.", rating: 5 },
  { name: "Elena Ruiz", role: "Engineering Manager · ZONE Technologies", quote: "The skill gap reports gave candidates a clear next step instead of a form rejection.", rating: 5 },
];

const FAQS = [
  { q: "Is applying to ZONE free for candidates?", a: "Yes. Creating a profile, browsing open roles, and applying is always free for job seekers." },
  { q: "How does the AI match score work?", a: "We analyze your resume against a role's real requirements at ZONE — skills, experience level, and outcomes — then score the overlap, not just keyword hits." },
  { q: "Who reviews my application?", a: "Applications go straight to ZONE's HR team. Your profile becomes your application, tailored to the role you choose." },
  { q: "What happens after I click Apply Now?", a: "You'll confirm your account, upload or review your resume, and submit. Our AI analyzes it afterward — never before you've agreed to apply." },
  { q: "Does ZONE work with clients outside India?", a: "Yes. ZONE delivers across banking, healthcare, retail, manufacturing, telecom, and public-sector clients globally." },
];

/* ------------------------------------------------------------------ */
/*  Apply flow modal — pre-fills name/email from the logged-in session */
/* ------------------------------------------------------------------ */
function ApplyFlow({ job, session, onClose, onSubmitApplication, prefill }) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [name, setName] = useState(session?.name || "");
  const [email, setEmail] = useState(session?.email || "");
  const [phone, setPhone] = useState("");
  const [experience, setExperience] = useState("");
  // If the candidate arrived here from the AI Resume Recommender panel,
  // their resume text/file are already known — skip re-uploading.
  const [resumeText, setResumeText] = useState(prefill?.resumeText || "");
  const [resumeFile, setResumeFile] = useState(prefill?.resumeFile || null); // { name, size, ext }
  const [fileStatus, setFileStatus] = useState(prefill?.resumeText ? "parsed" : "idle"); // idle | reading | parsed | manual
  const flowSteps = ["Account", "Resume", "Resume Analyser", "Submitted"];

  const extracted = extractSkillsFromResume(resumeText);
  const contactHints = extractContactHints(resumeText);
  const phoneDigits = phone.replace(/\D/g, "");
  const canContinueStep0 = name.trim() && email.trim().includes("@") && phoneDigits.length >= 7;
  const canContinueStep1 = resumeText.trim().length > 20 && experience !== "";

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    setResumeFile({ name: file.name, size: file.size, ext });
    setFileStatus("reading");
    const { text, extracted: ok } = await readResumeFile(file);
    if (ok && text.trim()) {
      setResumeText(text.trim());
      setFileStatus("parsed");
    } else {
      setFileStatus("manual");
    }
  };

  const clearFile = () => {
    setResumeFile(null);
    setFileStatus("idle");
  };

  const goNext = async () => {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      setSubmitting(true);
      setSubmitError("");
      try {
        await onSubmitApplication({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          experience: Number(experience),
          resumeSummary: resumeText.trim(),
          resumeFileName: resumeFile?.name || null,
          skills: extracted,
        });
        setStep(3);
      } catch (e) {
        console.error("application submit failed", e);
        setSubmitError(
          e?.code === "23505" || /duplicate key|already exists/i.test(e?.message || "")
            ? "You've already applied to this role — check your applications list."
            : e?.message || "Something went wrong submitting your application. Please try again."
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setStep(step + 1);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-3xl border border-blue-100 bg-white shadow-2xl w-full max-w-md overflow-hidden"
        style={{ animation: "modalIn 0.35s cubic-bezier(.16,1,.3,1)" }}
      >
        <div className="bg-gradient-to-br from-blue-600 to-blue-500 px-6 py-5 text-white relative overflow-hidden">
          <div className="relative z-10 flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-blue-100 font-semibold">Applying to</p>
              <p className="text-lg font-bold mt-1">{job?.title}</p>
              <p className="text-sm text-blue-100">{job?.companies?.name}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/20 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-6 pt-5 flex items-center gap-2">
          {flowSteps.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors duration-300 ${
                  i <= step ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"
                }`}
              >
                {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              {i < flowSteps.length - 1 && (
                <div className={`h-0.5 flex-1 rounded-full transition-colors duration-500 ${i < step ? "bg-blue-600" : "bg-slate-100"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="px-6 py-6 min-h-[220px] flex flex-col justify-center">
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Confirm your details to continue.</p>
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
              <input
                type="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-xl border border-slate-200 pl-11 pr-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400">HR uses your phone number to reach out directly if you're shortlisted.</p>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Upload your resume — our AI reads it and extracts your skills automatically.</p>

              <label
                className={`flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3.5 cursor-pointer transition-all ${
                  resumeFile ? "border-blue-200 bg-blue-50/50" : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/30"
                }`}
              >
                <input type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={handleFileChange} />
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${resumeFile ? "bg-blue-100" : "bg-slate-100"}`}>
                  {fileStatus === "reading" ? (
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  ) : resumeFile ? (
                    <FileCheck2 className="w-4.5 h-4.5 text-blue-600" />
                  ) : (
                    <Paperclip className="w-4.5 h-4.5 text-slate-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {resumeFile ? (
                    <>
                      <p className="text-sm font-semibold text-slate-800 truncate">{resumeFile.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {fileStatus === "reading" && "Reading resume…"}
                        {fileStatus === "parsed" && "Text extracted — reviewed below, edit if needed"}
                        {fileStatus === "manual" && "Uploaded — please paste the text below too (can't auto-read this format)"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-700">Click to upload resume</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">PDF, DOC, DOCX or TXT</p>
                    </>
                  )}
                </div>
                {resumeFile && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); clearFile(); }}
                    className="p-1.5 rounded-full hover:bg-blue-100 shrink-0"
                  >
                    <X className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                )}
              </label>

              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Resume text will appear here once uploaded — or paste it directly, e.g. '4 years building SQL and Python risk dashboards using Tableau...'"
                rows={4}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
              />
              <input
                type="number" min="0"
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                placeholder="Years of experience"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-blue-600">
                <Brain className="w-4 h-4" />
                <p className="text-sm font-semibold">Resume Analyser results</p>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <UserPlus className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {name || "—"}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {email || "—"}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {phone || "—"}
                </div>
                {resumeFile && (
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {resumeFile.name}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1.5">Skills detected in resume text</p>
                {extracted.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {extracted.map((s) => (
                      <span key={s} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{s}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No known skill keywords found yet — you can still submit, HR will review manually.</p>
                )}
              </div>

              {(contactHints.email || contactHints.phone) && (
                <div className="flex items-start gap-1.5 bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-emerald-700 leading-relaxed">
                    Also spotted{contactHints.email ? ` ${contactHints.email}` : ""}{contactHints.email && contactHints.phone ? " and " : ""}{contactHints.phone ? ` ${contactHints.phone}` : ""} inside the resume text itself.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                This profile, scored against each role's requirements, goes straight to ZONE HR's shortlist queue — with {experience || 0} yrs experience on record.
              </p>
            </div>
          )}
          {step === 3 && (
            <div className="flex flex-col items-center text-center gap-2 py-4">
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-blue-600" />
              </div>
              <p className="font-semibold text-slate-800">Application submitted</p>
              <p className="text-sm text-slate-500 max-w-xs">
                Your AI-scored profile is now in ZONE HR's shortlist queue for this role.
              </p>
            </div>
          )}
        </div>

        {submitError && (
          <div className="mx-6 mb-3 flex items-start gap-2 bg-rose-50 border border-rose-100 rounded-lg p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-700 leading-relaxed">{submitError}</p>
          </div>
        )}
        <div className="px-6 pb-6 flex justify-end gap-2">
          {step < 3 ? (
            <button
              onClick={goNext}
              disabled={(step === 0 && !canContinueStep0) || (step === 1 && !canContinueStep1) || submitting}
              className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {submitting ? (
                <>Submitting <Loader2 className="w-3.5 h-3.5 animate-spin" /></>
              ) : (
                <>{step === 2 ? "Submit application" : "Continue"} <ArrowRight className="w-3.5 h-3.5" /></>
              )}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Notification bell — candidate's in-app inbox. HR's shortlist/reject */
/*  decision writes rows here (see decideApplicant in HRDashboard);     */
/*  there's no real email backend wired up, so this IS the "mail".     */
/* ------------------------------------------------------------------ */
function NotificationBell({ session }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listNotifications(session);
      setNotifications(rows || []);
    } catch (e) {
      console.error("failed to load notifications", e);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refresh();
    // No realtime channel wired up — light polling is enough for HR's
    // decisions to show up without a manual refresh.
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const togglePanel = async () => {
    const opening = !open;
    setOpen(opening);
    if (opening && unreadCount > 0) {
      try {
        await markAllNotificationsRead(session);
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      } catch (e) {
        console.error("failed to mark notifications read", e);
      }
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={togglePanel} className="relative p-2 rounded-lg hover:bg-blue-50 transition-colors" aria-label="Notifications">
        {unreadCount > 0 ? <BellRing className="w-4.5 h-4.5 text-blue-600" /> : <Bell className="w-4.5 h-4.5 text-slate-500" />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[440px] overflow-y-auto bg-white border border-slate-100 rounded-2xl shadow-2xl z-50">
          <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur">
            <p className="text-sm font-bold text-slate-800">Notifications</p>
            <button onClick={refresh} className="text-slate-400 hover:text-blue-600 p-1">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center">
              <Inbox className="w-5 h-5 text-slate-300 mx-auto mb-1.5" />
              <p className="text-xs text-slate-400">No notifications yet</p>
              <p className="text-[11px] text-slate-300 mt-1">HR updates on your applications will show up here</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {notifications.map((n) => (
                <div key={n.id} className={`px-4 py-3.5 ${!n.read ? "bg-blue-50/40" : ""}`}>
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        n.type === "hired" ? "bg-emerald-50" : n.type === "rejected" ? "bg-rose-50" : "bg-blue-50"
                      }`}
                    >
                      {n.type === "hired" ? (
                        <PartyPopper className="w-3.5 h-3.5 text-emerald-600" />
                      ) : n.type === "rejected" ? (
                        <Lightbulb className="w-3.5 h-3.5 text-rose-500" />
                      ) : (
                        <Bell className="w-3.5 h-3.5 text-blue-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 leading-tight">{n.title}</p>
                      <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed whitespace-pre-line">{n.message}</p>
                      <p className="text-[10px] text-slate-300 mt-2">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Job preference search — filters the Open Roles grid by keyword,    */
/*  location and minimum experience before it's even rendered.         */
/* ------------------------------------------------------------------ */
function JobPreferenceSearch({ query, setQuery, location, setLocation, maxExp, setMaxExp, locations, resultCount }) {
  const hasFilters = query.trim() || location !== "all" || maxExp !== "any";
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 mb-8 shadow-sm">
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by role, skill or keyword — e.g. 'React', 'Data Analyst'"
            className="w-full rounded-xl border border-slate-200 pl-10 pr-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
          />
        </div>
        <div className="relative">
          <MapPin className="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full lg:w-52 rounded-xl border border-slate-200 pl-10 pr-8 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all appearance-none bg-white"
          >
            <option value="all">Any location</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>
        <div className="relative">
          <SlidersHorizontal className="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            value={maxExp}
            onChange={(e) => setMaxExp(e.target.value)}
            className="w-full lg:w-52 rounded-xl border border-slate-200 pl-10 pr-8 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all appearance-none bg-white"
          >
            <option value="any">Any experience level</option>
            <option value="0">Fresher / 0+ yrs</option>
            <option value="2">2+ yrs</option>
            <option value="5">5+ yrs</option>
            <option value="8">8+ yrs</option>
          </select>
        </div>
        {hasFilters && (
          <button
            onClick={() => { setQuery(""); setLocation("all"); setMaxExp("any"); }}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-xl px-4 py-2.5 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>
      {hasFilters && (
        <p className="text-[11px] text-slate-400 mt-2.5 pl-1">{resultCount} role{resultCount === 1 ? "" : "s"} match your preferences</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Resume Recommender — candidate saves one resume to their        */
/*  profile (candidates.resume_text etc.) and gets it scored against   */
/*  every currently open role with the same scoreResumeAgainstJob()    */
/*  HR sees, surfaced as "best fit for you" before they apply.         */
/* ------------------------------------------------------------------ */
function ResumeRecommenderPanel({ session, openRoles, onApply }) {
  const [resumeText, setResumeText] = useState(session?.resume_text || "");
  const [resumeFile, setResumeFile] = useState(
    session?.resume_file_name ? { name: session.resume_file_name } : null
  );
  const [fileStatus, setFileStatus] = useState("idle");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(session?.resume_text));
  const [expanded, setExpanded] = useState(!session?.resume_text);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumeFile({ name: file.name });
    setFileStatus("reading");
    const { text, extracted: ok } = await readResumeFile(file);
    if (ok && text.trim()) {
      setResumeText(text.trim());
      setFileStatus("parsed");
    } else {
      setFileStatus("manual");
    }
    setSaved(false);
  };

  const recommendations = useMemo(
    () => recommendJobsForResume(resumeText, openRoles, { limit: 6, minScore: 1 }),
    [resumeText, openRoles]
  );
  const detectedSkills = useMemo(() => extractSkillsFromResume(resumeText), [resumeText]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await updateCandidateResume(session, {
        resumeText,
        resumeFileName: resumeFile?.name || null,
        skills: detectedSkills,
        experienceYears: extractExperienceGuess(resumeText),
      });
      setSaved(true);
    } catch (e) {
      console.error("failed to save resume profile", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-blue-100 rounded-2xl p-5 sm:p-6 mb-8 shadow-sm">
      <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-left">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">AI Resume Analyser &amp; Recommendations</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {saved ? "Resume saved to your profile — matched against every open role below" : "Upload once, get matched against every open role automatically"}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label
              className={`flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3.5 cursor-pointer transition-all ${
                resumeFile ? "border-blue-200 bg-blue-50/50" : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/30"
              }`}
            >
              <input type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={handleFileChange} />
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${resumeFile ? "bg-blue-100" : "bg-slate-100"}`}>
                {fileStatus === "reading" ? (
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                ) : resumeFile ? (
                  <FileCheck2 className="w-4.5 h-4.5 text-blue-600" />
                ) : (
                  <Paperclip className="w-4.5 h-4.5 text-slate-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-700 truncate">{resumeFile ? resumeFile.name : "Upload your resume"}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">PDF, DOC, DOCX or TXT</p>
              </div>
            </label>
            <button
              onClick={saveProfile}
              disabled={!resumeText.trim() || saving}
              className="flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed rounded-xl px-4 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              {saving ? "Saving…" : saved ? "Saved to profile" : "Save to my profile"}
            </button>
          </div>

          <textarea
            value={resumeText}
            onChange={(e) => { setResumeText(e.target.value); setSaved(false); }}
            placeholder="Resume text appears here once uploaded — or paste it directly to get instant recommendations"
            rows={3}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
          />

          {resumeText.trim().length > 15 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkle className="w-3.5 h-3.5 text-blue-500" />
                <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                  {recommendations.length ? "Best fit for you" : "No strong matches yet"}
                </p>
              </div>
              {recommendations.length === 0 ? (
                <p className="text-xs text-slate-400">None of the currently open roles line up well with this resume yet — check back as new roles open.</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recommendations.map(({ job, score }) => {
                    const tone = scoreTone(score, job.match_threshold ?? 75);
                    return (
                      <div key={job.id} className="rounded-xl border border-slate-100 p-3.5 bg-slate-50/50">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="text-xs font-semibold text-slate-800 leading-tight">{job.title}</p>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${tone.soft} ${tone.text}`}>{score}%</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mb-2.5">{job.companies?.name || "ZONE"} · {job.location}</p>
                        <button
                          onClick={() => onApply(job, { resumeText, resumeFile, skills: detectedSkills })}
                          className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          Apply with this resume <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Mascot — the real "NEXBOT" 3D robot (by Aximoris, community.    */
/*  spline.design), embedded via its public Spline share link. The     */
/*  cursor-follow behaviour (head/eyes tracking the mouse) is baked    */
/*  into the Spline scene itself — no extra JS needed on our side.     */
/*  Zoomed + offset so the character fills the card, and cropped so    */
/*  the "Built with Spline" watermark chip falls outside the visible   */
/*  frame instead of needing to be covered.                            */
/*  Used only on the Candidate Portal hero.                            */
/* ------------------------------------------------------------------ */
function MouseTrackingRobot({ className = "" }) {
  return (
    <div className={`relative select-none overflow-hidden ${className}`}>
      <iframe
        src="https://my.spline.design/nexbotrobotcharacterconcept-gEtQ3NaIGxsJrnVLZn4LSXAf/"
        title="NEXBOT 3D robot"
        frameBorder="0"
        loading="lazy"
        allow="fullscreen"
        style={{
          border: "none",
          pointerEvents: "auto",
          position: "absolute",
          top: "-14%",
          left: "-18%",
          width: "150%",
          height: "155%",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero background — "Flowing Ribbon" Spline scene (community,        */
/*  spline.design), embedded as a full-bleed ambient background for    */
/*  the Candidate Portal hero (#home). Purely decorative, so pointer   */
/*  events are disabled — clicks pass straight through to the hero's   */
/*  buttons/links sitting above it. Zoomed + offset the same way as    */
/*  MouseTrackingRobot so the "Built with Spline" watermark chip is    */
/*  cropped outside the visible frame.                                 */
/* ------------------------------------------------------------------ */
function FlowingRibbonBackground({ className = "" }) {
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none select-none ${className}`}>
      <iframe
        src="https://my.spline.design/flowingribbon-gIrTuIBwZw0meak1UV74i9ty/"
        title="Flowing Ribbon background"
        frameBorder="0"
        loading="lazy"
        tabIndex={-1}
        style={{
          border: "none",
          pointerEvents: "none",
          position: "absolute",
          top: "-10%",
          left: "-10%",
          width: "120%",
          height: "135%",
        }}
      />
    </div>
  );
}


function CandidatePortal({ session, onLogout }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [savedJobs, setSavedJobs] = useState({});
  const [applyJob, setApplyJob] = useState(null);
  const [applyPrefill, setApplyPrefill] = useState(null); // resume carried over from the AI recommender
  const [openRoles, setOpenRoles] = useState([]);
  const [rolesState, setRolesState] = useState("loading"); // loading | online | empty | error
  const [justApplied, setJustApplied] = useState(null);

  // Job preference search — filters the Open Roles grid before it renders.
  const [jobQuery, setJobQuery] = useState("");
  const [jobLocation, setJobLocation] = useState("all");
  const [jobMaxExp, setJobMaxExp] = useState("any");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Pull jobs across EVERY company on the platform. Only ones a company's HR
  // has cleared past internal review ("external_open" / "pushed_external")
  // ever surface here — the internal-first check happens before this point.
  const refreshRoles = useCallback(async () => {
    setRolesState("loading");
    try {
      const jobs = await listOpenJobs();
      setOpenRoles(jobs || []);
      setRolesState((jobs || []).length ? "online" : "empty");
    } catch (e) {
      console.error("failed to load open jobs", e);
      setRolesState("error");
    }
  }, []);

  useEffect(() => {
    refreshRoles();
  }, [refreshRoles]);

  const toggleSave = useCallback((title) => {
    setSavedJobs((prev) => ({ ...prev, [title]: !prev[title] }));
  }, []);

  const jobLocations = useMemo(
    () => [...new Set(openRoles.map((r) => r.location).filter(Boolean))].sort(),
    [openRoles]
  );

  const filteredRoles = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    return openRoles.filter((role) => {
      if (q) {
        const haystack = [role.title, role.department, role.description, ...(role.skills || [])]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (jobLocation !== "all" && role.location !== jobLocation) return false;
      if (jobMaxExp !== "any" && (role.min_experience ?? 0) > Number(jobMaxExp)) return false;
      return true;
    });
  }, [openRoles, jobQuery, jobLocation, jobMaxExp]);

  // Candidate picked "Apply with this resume" from the AI recommender —
  // opens the same ApplyFlow modal, just pre-filled so they don't have
  // to re-upload the resume they already gave the recommender.
  const handleRecommenderApply = useCallback((job, resumeData) => {
    setApplyPrefill(resumeData);
    setApplyJob(job);
  }, []);

  // This is the routing step: applyJob carries the company_id/hr_id of
  // whichever HR posted it, so this single insert makes the application
  // show up on THAT HR's dashboard only — HR1's job -> HR1, HR2's job -> HR2.
  const handleApplicationSubmit = useCallback(async (data) => {
    if (!applyJob) return;
    const resumeText = data.resumeSummary || "";
    // Three-tier scoring fallback, cheapest-to-set-up last:
    //   1. Python service (spaCy skill extraction + SBERT semantic match)
    //      — real NLP, see backend/. Configure VITE_PYTHON_API_URL to use it.
    //   2. Groq/Llama direct scoring (src/lib/aiClient.js) if a free key
    //      is configured but the Python service isn't running.
    //   3. Dependency-free TF-IDF scorer (src/lib/resumeAnalyzer.js) —
    //      always available, zero setup.
    // Same 0-100 scale and matched/missing-skills shape from all three,
    // so nothing downstream (HR dashboard, thresholds, notifications)
    // needs to know which one actually ran.
    const pyResult = await analyzeResumeWithPython(resumeText, applyJob).catch(() => null);
    const aiResult = pyResult ? null : await analyzeResumeWithAI(resumeText, applyJob).catch(() => null);
    const matchResult = pyResult || aiResult;
    const score = matchResult?.score ?? scoreResumeAgainstJob(resumeText, applyJob);
    await submitApplication({
      job: applyJob,
      candidate: session,
      resumeText,
      matchScore: score,
    });
    // The applications table has no skills column of its own — the AI
    // Insights modal's fallback matcher reads applicant.skills off the
    // candidate's *profile* (candidates.skills), not off this specific
    // application. Without this, a candidate who applies directly here
    // (without ever visiting the separate Resume Analyser panel) has an
    // empty profile, so the fallback tier always shows 0 matched skills
    // even though data.skills was extracted correctly from the resume.
    await updateCandidateResume(session, {
      resumeText,
      resumeFileName: data.resumeFileName || null,
      skills: data.skills || [],
      experienceYears: data.experience,
    }).catch((e) => console.error("failed to sync resume to candidate profile", e));
    setJustApplied(applyJob.title);
  }, [applyJob, session]);

  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700&display=swap');

        .font-display { font-family: 'Space Grotesk', 'Inter', sans-serif; }

        @keyframes floatY {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-14px) rotate(0.5deg); }
        }
        @keyframes floatY2 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(12px); }
        }
        @keyframes spinSlow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulseRing {
          0% { transform: scale(0.9); opacity: 0.6; }
          70% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .float-card { animation: floatY 6s ease-in-out infinite; }
        .float-card-slow { animation: floatY2 8s ease-in-out infinite; }
        .spin-slow { animation: spinSlow 14s linear infinite; }
        .pulse-ring { animation: pulseRing 2.4s cubic-bezier(0,0,0.2,1) infinite; }
        .shimmer-text {
          background: linear-gradient(90deg, #1e293b 0%, #2563EB 25%, #60A5FA 50%, #2563EB 75%, #1e293b 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: shimmer 5s linear infinite;
        }
        .gradient-mesh {
          background: linear-gradient(120deg, #eff6ff, #ffffff 45%, #dbeafe);
          background-size: 200% 200%;
          animation: gradientShift 12s ease infinite;
        }
        .job-card { transition: transform 0.35s cubic-bezier(.16,1,.3,1), box-shadow 0.35s ease, border-color 0.35s ease; }
        .job-card:hover { transform: translateY(-6px); box-shadow: 0 24px 48px -16px rgba(37,99,235,0.25); border-color: #93c5fd; }
        .feature-card { transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease; }
        .feature-card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px -18px rgba(37,99,235,0.3); border-color: #bfdbfe; }
        .btn-ripple { position: relative; overflow: hidden; }
        .btn-ripple::after {
          content: ''; position: absolute; inset: 0; border-radius: inherit;
          background: radial-gradient(circle, rgba(255,255,255,0.5) 10%, transparent 10.5%);
          transform: scale(10, 10); opacity: 0; transition: transform 0.5s, opacity 1s;
        }
        .btn-ripple:active::after { transform: scale(0,0); opacity: 0.3; transition: 0s; }
        .nav-link { position: relative; }
        .nav-link::after {
          content: ''; position: absolute; left: 0; bottom: -4px; width: 0; height: 2px;
          background: #2563EB; transition: width 0.3s ease;
        }
        .nav-link:hover::after { width: 100%; }
        html { scroll-behavior: smooth; }
        ::selection { background: #bfdbfe; color: #1e3a8a; }
      `}</style>

      {applyJob !== null && (
        <ApplyFlow
          job={applyJob}
          session={session}
          onClose={() => { setApplyJob(null); setApplyPrefill(null); }}
          onSubmitApplication={handleApplicationSubmit}
          prefill={applyPrefill}
        />
      )}

      {/* ============================= NAVBAR ============================= */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled ? "bg-white/80 backdrop-blur-xl shadow-sm border-b border-blue-50" : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between" style={{ height: scrolled ? "64px" : "80px", transition: "height 0.3s ease" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-md shadow-blue-200">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-bold text-lg tracking-tight">ZONE <span className="text-blue-600">Technologies</span></span>
          </div>

          <nav className="hidden lg:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <a key={link} href={`#${link.toLowerCase().replace(/\s+/g, "-")}`} className="nav-link text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
                {link}
              </a>
            ))}
          </nav>

          <div className="hidden lg:flex items-center gap-3">
            <NotificationBell session={session} />
            <div className="flex items-center gap-2 pl-1 pr-2 border-l border-r border-slate-200">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                {initialsOf(session?.name)}
              </div>
              <span className="text-sm font-semibold text-slate-700 max-w-[110px] truncate">{session?.name?.split(" ")[0] || "Candidate"}</span>
            </div>
            <button onClick={onLogout} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-blue-600 transition-colors px-2 py-2">
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
            <a href="#careers" className="btn-ripple text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-5 py-2.5 rounded-xl shadow-md shadow-blue-200 transition-all hover:shadow-lg hover:shadow-blue-300 hover:-translate-y-0.5">
              View Careers
            </a>
          </div>

          <div className="lg:hidden flex items-center gap-1">
            <NotificationBell session={session} />
            <button className="p-2" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <div
          className="lg:hidden overflow-hidden transition-all duration-300 bg-white border-t border-blue-50"
          style={{ maxHeight: menuOpen ? "400px" : "0px" }}
        >
          <div className="px-6 py-4 flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                {initialsOf(session?.name)}
              </div>
              <span className="text-sm font-semibold text-slate-700">{session?.name || "Candidate"}</span>
            </div>
            {NAV_LINKS.map((link) => (
              <a key={link} href={`#${link.toLowerCase().replace(/\s+/g, "-")}`} className="text-sm font-medium text-slate-600">{link}</a>
            ))}
            <div className="flex gap-3 pt-2">
              <button onClick={onLogout} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded-xl py-2.5">
                <LogOut className="w-3.5 h-3.5" /> Logout
              </button>
              <a href="#careers" className="flex-1 text-center text-sm font-semibold text-white bg-blue-600 rounded-xl py-2.5">Careers</a>
            </div>
          </div>
        </div>
      </header>

      {/* ============================= HERO ============================= */}
      <section id="home" className="relative pt-36 pb-20 lg:pt-44 lg:pb-28 overflow-hidden gradient-mesh">
        {/* Ambient Spline background — sits behind everything else in the hero */}
        <FlowingRibbonBackground className="z-0 opacity-70" />

        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, #60A5FA, transparent 70%)" }}
        />
        <div
          className="absolute top-1/3 -left-32 w-80 h-80 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #3B82F6, transparent 70%)" }}
        />

        <div className="max-w-7xl mx-auto px-6 relative z-10 grid lg:grid-cols-[1fr_1.15fr] gap-16 items-center">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-3 py-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Expanding across the IT sector
              </span>
            </Reveal>
            <Reveal delay={100}>
              <h1 className="font-display font-bold text-4xl sm:text-5xl lg:text-6xl leading-[1.08] tracking-tight mt-5">
                Technology solutions that <span className="shimmer-text">move business forward</span>
              </h1>
            </Reveal>
            <Reveal delay={200}>
              <p className="text-lg text-slate-500 mt-6 max-w-lg leading-relaxed">
                ZONE Technologies partners with enterprises across banking, healthcare, retail, and manufacturing to design, build, and run the systems they depend on.
              </p>
            </Reveal>
            <Reveal delay={300}>
              <div className="flex flex-wrap gap-4 mt-9">
                <a href="#what-we-do" className="btn-ripple group flex items-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-6 py-3.5 rounded-xl shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-300">
                  Explore Our Services <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </a>
                <a href="#careers" className="flex items-center gap-2 text-sm font-semibold text-slate-800 bg-white border border-slate-200 px-6 py-3.5 rounded-xl transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
                  <Briefcase className="w-4 h-4" /> View Open Roles
                </a>
              </div>
            </Reveal>
            <Reveal delay={400}>
              <div className="flex items-center gap-6 mt-10 text-sm text-slate-500">
                <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-blue-500" /> 50+ enterprise clients</div>
                <div className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-blue-500" /> 12+ industries served</div>
              </div>
            </Reveal>
          </div>

          {/* Right visual */}
          <Reveal delay={200}>
            <div className="relative h-[560px] lg:h-[620px] hidden sm:block">
              <div
                className="absolute inset-0 rounded-3xl bg-gradient-to-br from-slate-800 via-blue-800 to-blue-500 shadow-2xl shadow-blue-300/50 overflow-hidden"
                style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.14) 1.5px, transparent 1.5px)", backgroundSize: "22px 22px" }}
              >
                <div className="absolute inset-0 opacity-20 spin-slow" style={{ background: "conic-gradient(from 0deg, transparent, #fff, transparent 30%)" }} />
                {/* Soft glow behind the robot so it doesn't get lost in the dark gradient */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "radial-gradient(circle at 50% 42%, rgba(147,197,253,0.35), transparent 62%)" }}
                />

                <div className="absolute top-6 left-6 flex items-center gap-1.5 text-white/80 text-xs font-medium z-20">
                  <Globe2 className="w-3.5 h-3.5" /> ZONE Technologies
                </div>

                {/* Company snapshot card, docked to bottom of the panel */}
                <div className="absolute left-5 right-5 bottom-5 bg-white/95 backdrop-blur-md rounded-2xl px-5 py-4 flex items-center justify-between shadow-lg z-20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs">
                      SG
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Sri Ganesh</p>
                      <p className="text-[11px] text-slate-400">Chief Executive Officer</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-bold text-blue-600 leading-none"><Counter target={300} suffix="+" /></p>
                      <p className="text-[10px] text-slate-400 mt-1">Employees</p>
                    </div>
                    <div className="w-px h-8 bg-slate-100" />
                    <div className="text-right">
                      <p className="text-sm font-bold text-blue-600 leading-none"><Counter target={50} suffix="+" /></p>
                      <p className="text-[10px] text-slate-400 mt-1">Clients</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating cards */}
              <div className="absolute -left-6 top-10 float-card z-20">
                <div className="bg-white/90 backdrop-blur-md border border-blue-100 rounded-2xl shadow-xl shadow-blue-100 px-4 py-3 flex items-center gap-3 w-52">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                    <Cloud className="w-4.5 h-4.5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 font-medium">Service</p>
                    <p className="text-sm font-bold text-slate-800">Cloud & Infrastructure</p>
                  </div>
                </div>
              </div>

              <div className="absolute -right-4 top-28 float-card-slow z-20" style={{ animationDelay: "1s" }}>
                <div className="bg-white/90 backdrop-blur-md border border-blue-100 rounded-2xl shadow-xl shadow-blue-100 px-4 py-3 flex items-center gap-3 w-52">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                    <ShieldCheck className="w-4.5 h-4.5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 font-medium">Practice</p>
                    <p className="text-sm font-bold text-slate-800">Cybersecurity</p>
                  </div>
                </div>
              </div>

              {/* AI mascot — NEXBOT, now the centerpiece of the panel. Enlarged to
                  fill the space that used to hold the circle/Building2 icon block.
                  Eyes/head still follow the cursor (baked into the Spline scene). */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="pointer-events-auto w-[300px] h-[380px] sm:w-[480px] sm:h-[560px] lg:w-[560px] lg:h-[620px]">
                  <MouseTrackingRobot className="w-full h-full" />
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================= HIGH-END DIVIDER ============================= */}
      <div className="relative max-w-5xl mx-auto px-6 -mt-2 mb-2">
        <div className="flex items-center gap-4">
          <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, transparent, #bfdbfe)" }} />
          <div className="relative flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-white border border-blue-100 shadow-lg shadow-blue-100/60">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 pulse-ring" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
            </span>
            <span className="text-xs font-bold tracking-widest text-blue-700 uppercase">Now Hiring · ZONE Technologies</span>
          </div>
          <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, #bfdbfe, transparent)" }} />
        </div>
      </div>

      {/* ============================= CAREERS (hiring board) ============================= */}
      <section id="careers" className="relative bg-slate-50 py-20 lg:py-24 overflow-hidden">
        <div
          className="absolute -top-20 right-0 w-72 h-72 rounded-full opacity-30 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #60A5FA, transparent 70%)" }}
        />
        <div className="max-w-7xl mx-auto px-6 relative">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14">
              <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">Careers</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Open Roles at ZONE</h2>
              <p className="text-slate-500 mt-4">These roles open automatically when ZONE's internal AI hiring can't find a ready match on the existing team. Apply directly — no agencies in between.</p>
              {justApplied && (
                <div className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Application for "{justApplied}" sent to ZONE HR
                </div>
              )}
            </div>
          </Reveal>

          {rolesState === "online" && (
            <>
              <JobPreferenceSearch
                query={jobQuery} setQuery={setJobQuery}
                location={jobLocation} setLocation={setJobLocation}
                maxExp={jobMaxExp} setMaxExp={setJobMaxExp}
                locations={jobLocations}
                resultCount={filteredRoles.length}
              />
              <ResumeRecommenderPanel session={session} openRoles={openRoles} onApply={handleRecommenderApply} />
            </>
          )}

          {/* Job cards — sourced live from HR's shared roster; only roles HR's
              AI couldn't fill from the internal team appear here. */}
          {rolesState === "loading" && (
            <div className="flex items-center justify-center gap-2 text-slate-400 py-16 mb-20">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Checking with HR for open roles…</span>
            </div>
          )}

          {rolesState === "empty" && (
            <div className="border border-dashed border-blue-200 rounded-2xl p-10 text-center bg-white mb-20 max-w-xl mx-auto">
              <Inbox className="w-6 h-6 text-blue-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No external roles open right now</p>
              <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">
                ZONE's internal team currently covers every assigned role. New positions appear here automatically the moment HR's AI can't find an internal match.
              </p>
              <button onClick={refreshRoles} className="mt-4 text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1.5">
                <ArrowUpRight className="w-3.5 h-3.5" /> Check again
              </button>
            </div>
          )}

          {rolesState === "online" && filteredRoles.length === 0 && (
            <div className="border border-dashed border-blue-200 rounded-2xl p-10 text-center bg-white mb-20 max-w-xl mx-auto">
              <Filter className="w-6 h-6 text-blue-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No roles match your preferences</p>
              <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">Try widening your search, location or experience filter.</p>
              <button
                onClick={() => { setJobQuery(""); setJobLocation("all"); setJobMaxExp("any"); }}
                className="mt-4 text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> Clear filters
              </button>
            </div>
          )}

          {rolesState === "online" && filteredRoles.length > 0 && (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-7 mb-20">
              {filteredRoles.map((role, i) => (
                <Reveal key={role.id} delay={i * 70}>
                  <div className="job-card group relative bg-white border border-slate-100 rounded-2xl p-6 h-full flex flex-col">
                    <div
                      className="absolute inset-x-0 top-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{ background: "linear-gradient(90deg, #2563EB, #60A5FA)" }}
                    />
                    <div className="flex items-start justify-between mb-5">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                          {role.title.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 text-sm leading-tight">{role.title}</p>
                          <p className="text-xs text-slate-400 mt-1">{role.companies?.name || "Company"} · {role.department}</p>
                        </div>
                      </div>
                      <button onClick={() => toggleSave(role.title)} className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                        <Bookmark className={`w-4 h-4 transition-colors ${savedJobs[role.title] ? "fill-blue-600 text-blue-600" : "text-slate-300"}`} />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-5">
                      <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {role.location}
                      </span>
                      <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-slate-50 text-slate-500">{role.min_experience}+ yrs</span>
                      <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 flex items-center gap-1">
                        <Sparkle className="w-3 h-3" /> AI-opened role
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 mb-4 leading-relaxed">{role.description}</p>

                    <div className="flex flex-wrap gap-1.5 mb-6">
                      {role.skills.map((s) => (
                        <span key={s} className="text-[11px] px-2 py-1 rounded-md bg-slate-50 text-slate-500 border border-slate-100">{s}</span>
                      ))}
                    </div>

                    <div className="mt-auto flex items-center justify-between pt-5 border-t border-slate-50">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <span className="text-xs font-semibold text-blue-600">Internal team unavailable</span>
                      </div>
                      <button
                        onClick={() => setApplyJob(role)}
                        className="btn-ripple text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-all hover:-translate-y-0.5"
                      >
                        Apply Now
                      </button>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          )}

          {/* Mini how-it-works */}
          <Reveal>
            <div className="bg-white border border-slate-100 rounded-2xl p-8 sm:p-10">
              <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-8 text-center">How hiring works</p>
              <div className="relative">
                <div className="hidden lg:block absolute top-6 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-100 via-blue-300 to-blue-100" />
                <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-10 lg:gap-4">
                  {HIRE_STEPS.map((s, i) => (
                    <div key={s.title} className="relative flex flex-col items-center text-center">
                      <div className="w-11 h-11 rounded-full bg-white border-2 border-blue-500 flex items-center justify-center relative z-10 shadow-md shadow-blue-100 transition-transform duration-300 hover:scale-110">
                        <s.icon className="w-4.5 h-4.5 text-blue-600" />
                      </div>
                      <p className="text-[10px] font-bold text-blue-400 mt-3">STEP {i + 1}</p>
                      <p className="font-semibold text-xs mt-0.5">{s.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================= STATS ============================= */}
      <section className="relative py-16 overflow-hidden bg-gradient-to-br from-blue-600 to-blue-500">
        <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(circle at 20% 30%, #fff, transparent 40%)" }} />
        <div className="max-w-6xl mx-auto px-6 relative grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 100}>
              <p className="font-display font-bold text-4xl sm:text-5xl text-white">
                <Counter target={s.value} suffix={s.suffix} />
              </p>
              <p className="text-blue-100 text-sm mt-2 font-medium">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============================= WHAT WE DO ============================= */}
      <section id="what-we-do" className="max-w-7xl mx-auto px-6 py-24">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">What we do</p>
            <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Services built for enterprise scale</h2>
            <p className="text-slate-500 mt-4">From cloud foundations to applied AI, ZONE covers the full stack of enterprise technology delivery.</p>
          </div>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {SERVICES.map((f, i) => (
            <Reveal key={f.title} delay={i * 80}>
              <div className="feature-card bg-white border border-slate-100 rounded-2xl p-7 h-full">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-5">
                  <f.icon className="w-5.5 h-5.5 text-blue-600" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============================= INDUSTRIES ============================= */}
      <section id="industries" className="bg-gradient-to-b from-blue-50/60 to-white py-24">
        <div className="max-w-6xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14">
              <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">Industries</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Where ZONE delivers impact</h2>
            </div>
          </Reveal>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            {INDUSTRIES.map((ind, i) => (
              <Reveal key={ind.title} delay={i * 70}>
                <div className="feature-card bg-white border border-slate-100 rounded-2xl p-6 text-center h-full flex flex-col items-center justify-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center">
                    <ind.icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800">{ind.title}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================= ABOUT + LEADERSHIP ============================= */}
      <section id="about" className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center mb-20">
          <Reveal>
            <div className="relative h-96 rounded-3xl overflow-hidden bg-gradient-to-br from-blue-50 to-white border border-blue-100 flex items-center justify-center">
              <div className="grid grid-cols-3 gap-4 p-8">
                {[Globe2, Users, Award, ShieldCheck, TrendingUp, Building2].map((Icon, i) => (
                  <div key={i} className="w-20 h-20 rounded-2xl bg-white border border-blue-100 shadow-sm flex items-center justify-center float-card-slow" style={{ animationDelay: `${i * 0.4}s` }}>
                    <Icon className="w-7 h-7 text-blue-500" />
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <div>
            <Reveal>
              <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">About ZONE</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight mb-5">Growing fast across the IT sector</h2>
              <p className="text-slate-500 leading-relaxed mb-8">
                ZONE Technologies is scaling its engineering, design, and delivery teams as we expand our footprint across the IT sector. We build software that clients rely on — and a hiring process that respects every candidate's time along the way.
              </p>
            </Reveal>
            <div className="grid sm:grid-cols-2 gap-6">
              {[
                { title: "Mission", copy: "Deliver technology that measurably moves our clients' business forward." },
                { title: "Vision", copy: "Be the technology partner enterprises call first." },
                { title: "Values", copy: "Transparency, craftsmanship, and respect for every partner and candidate." },
                { title: "Growth", copy: "New teams, new offices, and new roles opening across the IT sector." },
              ].map((item, i) => (
                <Reveal key={item.title} delay={i * 80}>
                  <div className="border-l-2 border-blue-200 pl-4">
                    <p className="font-semibold text-sm">{item.title}</p>
                    <p className="text-sm text-slate-500 mt-1">{item.copy}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>

        {/* Leadership team */}
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">Meet the team</p>
            <h3 className="font-display font-bold text-2xl sm:text-3xl tracking-tight">Leadership at ZONE</h3>
          </div>
        </Reveal>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
          {LEADERSHIP.map((person, i) => (
            <Reveal key={person.name} delay={i * 90}>
              <div className="feature-card bg-white border border-slate-100 rounded-2xl p-6 text-center h-full flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg mb-4 shadow-md shadow-blue-100">
                  {person.initials}
                </div>
                <p className="font-semibold text-sm text-slate-800">{person.name}</p>
                <p className="text-xs text-blue-600 font-medium mt-1">{person.role}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============================= INSIGHTS / TESTIMONIALS ============================= */}
      <section id="insights" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14">
              <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">Insights & Voices</p>
              <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">What clients and our people say</h2>
            </div>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <div className="bg-white border border-slate-100 rounded-2xl p-7 h-full flex flex-col shadow-sm hover:shadow-lg hover:shadow-blue-100/50 transition-shadow duration-300">
                  <Quote className="w-6 h-6 text-blue-200 mb-4" />
                  <p className="text-sm text-slate-600 leading-relaxed flex-1">{t.quote}</p>
                  <div className="flex items-center gap-1 mt-5 mb-3">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="w-3.5 h-3.5 fill-blue-400 text-blue-400" />
                    ))}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                    <p className="text-xs text-slate-400">{t.role}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================= FAQ ============================= */}
      <section className="max-w-3xl mx-auto px-6 py-24">
        <Reveal>
          <div className="text-center mb-12">
            <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">Questions</p>
            <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Frequently Asked Questions</h2>
          </div>
        </Reveal>
        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 60}>
              <div className="border border-slate-100 rounded-2xl overflow-hidden bg-white">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-blue-50/40 transition-colors"
                >
                  <span className="font-semibold text-sm text-slate-800">{f.q}</span>
                  <ChevronDown
                    className="w-4 h-4 text-blue-500 shrink-0 transition-transform duration-300"
                    style={{ transform: openFaq === i ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>
                <div
                  className="overflow-hidden transition-all duration-300 ease-out"
                  style={{ maxHeight: openFaq === i ? "160px" : "0px" }}
                >
                  <p className="px-5 pb-4 text-sm text-slate-500 leading-relaxed">{f.a}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============================= CTA STRIP ============================= */}
      <section id="contact" className="max-w-7xl mx-auto px-6 pb-24">
        <Reveal>
          <div className="relative rounded-3xl bg-gradient-to-br from-blue-600 to-blue-500 px-8 sm:px-14 py-14 text-center overflow-hidden">
            <div className="absolute -top-10 -left-10 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-10 -right-10 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
            <h3 className="font-display font-bold text-2xl sm:text-3xl text-white relative">Let's build what's next, together</h3>
            <p className="text-blue-100 mt-3 relative">Whether you're a client or a candidate, ZONE would love to hear from you.</p>
            <div className="flex flex-wrap justify-center gap-3 relative mt-7">
              <a href="#careers" className="btn-ripple text-sm font-semibold text-blue-700 bg-white hover:bg-blue-50 px-7 py-3.5 rounded-xl transition-all hover:-translate-y-0.5 shadow-lg">
                Explore Careers
              </a>
              <a href="#" className="text-sm font-semibold text-white border border-white/40 hover:bg-white/10 px-7 py-3.5 rounded-xl transition-all hover:-translate-y-0.5">
                Talk to Us
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ============================= FOOTER ============================= */}
      <footer className="border-t border-slate-100 pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-10 pb-12">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <span className="font-display font-bold text-lg">ZONE Technologies</span>
              </div>
              <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                ZONE Technologies — enterprise IT services, expanding across the IT sector.
              </p>
              <div className="flex items-center gap-3 mt-5">
                {[Linkedin, Github, Mail].map((Icon, i) => (
                  <a key={i} href="#" className="w-9 h-9 rounded-lg bg-slate-50 hover:bg-blue-50 flex items-center justify-center transition-colors">
                    <Icon className="w-4 h-4 text-slate-500 hover:text-blue-600" />
                  </a>
                ))}
              </div>
            </div>
            {[
              { title: "What We Do", links: ["Cloud & Infrastructure", "Software Engineering", "Data & AI", "Cybersecurity"] },
              { title: "Industries", links: ["Banking & Finance", "Healthcare", "Retail", "Manufacturing"] },
              { title: "Careers", links: ["Open Roles", "Life at ZONE", "Leadership"] },
              { title: "Company", links: ["About", "Insights", "Contact"] },
            ].map((col) => (
              <div key={col.title}>
                <p className="text-sm font-semibold text-slate-800 mb-4">{col.title}</p>
                <div className="flex flex-col gap-3">
                  {col.links.map((l) => (
                    <a key={l} href="#" className="text-sm text-slate-500 hover:text-blue-600 transition-colors">{l}</a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-400">© 2026 ZONE Technologies. All rights reserved.</p>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <ChevronRight className="w-3 h-3" /> Privacy · Terms · Support
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ================================================================== */
/*  HR DASHBOARD                                                       */
/* ================================================================== */
function groupByRole(applications) {
  const map = {};
  applications.forEach((a) => {
    if (!map[a.roleId]) map[a.roleId] = [];
    map[a.roleId].push(a);
  });
  return map;
}

const DEPTS = ["Engineering", "Design", "Data", "Marketing", "Operations", "Security"];

// -- shape adapters between Supabase's snake_case columns and the UI's --
// existing camelCase field names (dept, minExp, threshold), so the rest of
// the component tree below didn't need to be touched field-by-field.
function toUiJob(row) {
  if (!row) return row;
  return {
    ...row,
    dept: row.department,
    minExp: row.min_experience,
    threshold: row.match_threshold,
    companyName: row.companies?.name,
  };
}

function toDbJobInput(uiJob) {
  return {
    title: uiJob.title,
    department: uiJob.dept,
    location: uiJob.location,
    minExperience: uiJob.minExp,
    threshold: uiJob.threshold,
    skills: uiJob.skills,
    description: uiJob.description,
  };
}

function toUiApplicant(row) {
  return {
    id: row.id,
    roleId: row.job_id,
    candidateId: row.candidate_id,
    name: row.candidates?.name || "Candidate",
    email: row.candidates?.email || "",
    phone: row.candidates?.phone || "",
    skills: row.candidates?.skills || [],
    experience: row.candidates?.experience_years || 0,
    resumeSummary: row.resume_text || "",
    status: row.status === "shortlisted" ? "Shortlisted" : row.status === "rejected" ? "Rejected" : "New",
    score: row.match_score,
  };
}

function toUiEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    dept: row.department,
    title: row.current_role,
    skills: row.skills || [],
    experience: row.experience_years || 0,
    initials: initialsOf(row.name),
  };
}

function matchScore(person, role) {
  const reqSkills = role.skills.map((s) => s.toLowerCase());
  const personSkills = person.skills.map((s) => s.toLowerCase());
  const matched = reqSkills.filter((s) => personSkills.includes(s));
  const skillFraction = reqSkills.length ? matched.length / reqSkills.length : 0;
  const expFraction = role.minExp ? Math.min(person.experience / role.minExp, 1) : 1;
  const score = Math.round(skillFraction * 75 + expFraction * 25);
  return { score, matched: matched.length, total: reqSkills.length, matchedSkills: matched };
}

// ------------------------------------------------------------------
// Formal in-app notification copy for HR's shortlist / reject decision.
// No email backend is wired up (see schema.sql notifications table), so
// these land in the candidate's own notification inbox instead of an
// outbound email — same formal tone, same content either way.
// ------------------------------------------------------------------
function buildHiredMessage(applicant, role, companyName) {
  return `Dear ${applicant.name},

Congratulations — you have been shortlisted and selected for the role of ${role.title} at ${companyName || "our company"}.

Our team was impressed by your profile and the skills you bring, and we're excited to move forward with you. HR will reach out shortly at ${applicant.phone || applicant.email || "the contact details on file"} with next steps and onboarding details.

Welcome aboard!

Warm regards,
${companyName || "The Hiring"} Team`;
}

function buildRejectionMessage(applicant, role, companyName) {
  const { matchedSkills } = matchScore(applicant, role);
  const missing = role.skills.filter((s) => !matchedSkills.includes(s.toLowerCase()));
  const improvementLines = missing.length
    ? missing.slice(0, 5).map((s) => `  • Gain hands-on experience or a certification in ${s}`).join("\n")
    : "  • Keep building depth in the core skills listed on this role — your profile was close.";

  return `Dear ${applicant.name},

Thank you for applying for the ${role.title} role at ${companyName || "our company"}. After careful review, we will not be moving forward with your application at this time.

This isn't a reflection of your potential — it simply means your current profile doesn't yet fully align with what this specific role needs. Based on our AI resume analysis, here's what would strengthen your fit for similar roles:

${improvementLines}

We'd genuinely encourage you to keep applying — please do reapply once you've built on these areas, or explore our other open roles that may already be a closer match.

Warm regards,
${companyName || "The Hiring"} Team`;
}

function scoreTone(score, threshold) {
  if (score >= threshold) return { text: "text-emerald-700", bg: "bg-emerald-500", soft: "bg-emerald-50", border: "border-emerald-200" };
  if (score >= threshold - 15) return { text: "text-amber-700", bg: "bg-amber-500", soft: "bg-amber-50", border: "border-amber-200" };
  return { text: "text-rose-700", bg: "bg-rose-500", soft: "bg-rose-50", border: "border-rose-200" };
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 flex items-center gap-4 shadow-sm">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${accent.soft}`}>
        <Icon className={`w-5 h-5 ${accent.text}`} />
      </div>
      <div>
        <p className="font-display font-bold text-2xl text-slate-900 leading-none">{value}</p>
        <p className="text-xs text-slate-500 mt-1.5">{label}</p>
      </div>
    </div>
  );
}

function ScoreBar({ score, threshold }) {
  const tone = scoreTone(score, threshold);
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-bold ${tone.text}`}>{score}% AI Match</span>
        <span className="text-[10px] text-slate-400">threshold {threshold}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden relative">
        <div
          className={`h-full rounded-full ${tone.bg} transition-all duration-700 ease-out`}
          style={{ width: `${score}%` }}
        />
        <div
          className="absolute top-0 h-full w-[2px] bg-slate-400/60"
          style={{ left: `${threshold}%` }}
          title={`Eligibility threshold: ${threshold}%`}
        />
      </div>
    </div>
  );
}

function SkillPill({ skill, matched }) {
  return (
    <span
      className={`text-[11px] px-2 py-1 rounded-md border ${
        matched
          ? "bg-blue-50 text-blue-700 border-blue-100 font-semibold"
          : "bg-slate-50 text-slate-400 border-slate-100"
      }`}
    >
      {skill}
    </span>
  );
}

function EmployeeMatchCard({ employee, role, best }) {
  const { score, matchedSkills } = matchScore(employee, role);
  const tone = scoreTone(score, role.threshold);
  const eligible = score >= role.threshold;
  return (
    <div className={`rounded-2xl border p-5 bg-white ${best ? "border-blue-200 ring-2 ring-blue-100" : "border-slate-100"}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {employee.initials}
          </div>
          <div>
            <p className="font-semibold text-sm text-slate-900 leading-tight">{employee.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">{employee.title} · {employee.dept}</p>
          </div>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${tone.soft} ${tone.text} flex items-center gap-1 shrink-0`}>
          {eligible ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          {eligible ? "Eligible" : "Below bar"}
        </span>
      </div>
      <ScoreBar score={score} threshold={role.threshold} />
      <div className="flex flex-wrap gap-1.5 mt-3">
        {role.skills.map((s) => (
          <SkillPill key={s} skill={s} matched={matchedSkills.includes(s.toLowerCase())} />
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">{employee.experience} yrs experience internally · resume + skill graph auto-scanned</p>
    </div>
  );
}

// ============================================================
// AI Insights modal — the "explain what spaCy/SBERT/Groq actually did"
// panel. Opened on demand from ApplicantCard (button below) rather than
// computed at apply-time, so it always reflects a fresh call to
// whichever backend tier is currently configured — useful for demos:
// point at this panel and walk through Resume -> spaCy -> SBERT ->
// Score -> Groq exactly like the flow diagram.
// ============================================================
function AIInsightsModal({ applicant, role, onClose }) {
  const [loading, setLoading] = useState(true);
  const [pyResult, setPyResult] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const py = await analyzeResumeWithPython(applicant.resumeSummary, role).catch(() => null);
      if (cancelled) return;

      let matchInfo = py;
      if (!matchInfo) {
        // Backend not configured/unreachable — fall back to the same
        // client-side skill compare ApplicantCard already uses, so the
        // panel still shows *something* instead of just erroring out.
        const { score, matchedSkills } = matchScore(applicant, role);
        const missingSkills = role.skills.filter((s) => !matchedSkills.includes(s.toLowerCase()));
        matchInfo = { score, matchedSkills, missingSkills, resumeSkills: applicant.skills || [] };
        setUsedFallback(true);
      }
      setPyResult(matchInfo);

      // Groq explanation + interview questions run regardless of which
      // scoring tier produced matchInfo — Groq's job is narrating
      // whatever score/skills it's handed, per the flow diagram.
      const [exp, qs] = await Promise.all([
        explainMatchWithAI({ resumeText: applicant.resumeSummary, job: role, matchInfo }).catch(() => null),
        generateInterviewQuestions({ job: role, matchInfo }).catch(() => null),
      ]);
      if (cancelled) return;
      setExplanation(exp);
      setQuestions(qs);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [applicant, role]);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            <h3 className="font-display font-bold text-slate-900">AI Match Insights</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">{applicant.name} · {role.title}</p>

        {/* Pipeline badges — which stage actually produced this result */}
        <div className="flex flex-wrap gap-1.5 mb-5">
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${!usedFallback && pyResult ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-400"}`}>
            spaCy skill extraction {!usedFallback && pyResult ? "✓" : "(offline — built-in matcher used)"}
          </span>
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${!usedFallback && pyResult ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-400"}`}>
            SBERT semantic match {!usedFallback && pyResult ? "✓" : "(offline)"}
          </span>
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${explanation ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
            Groq/Llama explanation {explanation ? "✓" : "(no key set)"}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Running spaCy + SBERT + Groq…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Score breakdown */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-lg font-bold text-slate-900">{pyResult?.score ?? "—"}%</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Overall score</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-lg font-bold text-slate-900">
                  {pyResult?.semanticSimilarity != null ? `${Math.round(pyResult.semanticSimilarity * 100)}%` : "—"}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">SBERT semantic sim.</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-lg font-bold text-slate-900">
                  {pyResult?.skillCoverage != null ? `${Math.round(pyResult.skillCoverage * 100)}%` : "—"}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">Skill coverage</p>
              </div>
            </div>

            {/* Matched / missing skills */}
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Matched skills</p>
              <div className="flex flex-wrap gap-1.5">
                {(pyResult?.matchedSkills || []).length
                  ? pyResult.matchedSkills.map((s) => <SkillPill key={s} skill={s} matched />)
                  : <span className="text-xs text-slate-400">None</span>}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Missing skills</p>
              <div className="flex flex-wrap gap-1.5">
                {(pyResult?.missingSkills || []).length
                  ? pyResult.missingSkills.map((s) => <SkillPill key={s} skill={s} matched={false} />)
                  : <span className="text-xs text-slate-400">None — full coverage</span>}
              </div>
            </div>
            {!!(pyResult?.resumeSkills || []).length && (
              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-1.5">All skills spaCy detected in resume</p>
                <div className="flex flex-wrap gap-1.5">
                  {pyResult.resumeSkills.map((s) => <SkillPill key={s} skill={s} matched />)}
                </div>
              </div>
            )}

            {/* Groq explanation */}
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Why this score (Groq/Llama)</p>
              <p className="text-xs text-slate-600 leading-relaxed bg-indigo-50/60 rounded-xl p-3">
                {explanation || "Not available — add VITE_GROQ_API_KEY in .env to enable AI explanations."}
              </p>
            </div>

            {/* Interview questions */}
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Suggested interview questions (Groq/Llama)</p>
              {questions?.length ? (
                <ol className="text-xs text-slate-600 leading-relaxed list-decimal list-inside space-y-1.5">
                  {questions.map((q, i) => <li key={i}>{q}</li>)}
                </ol>
              ) : (
                <p className="text-xs text-slate-400">Not available — add VITE_GROQ_API_KEY in .env to enable.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApplicantCard({ applicant, role, onShortlist, onReject, onUndo, isDeciding }) {
  const { score, matchedSkills } = matchScore(applicant, role);
  const tone = scoreTone(score, role.threshold);
  const [showInsights, setShowInsights] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5">
      {showInsights && (
        <AIInsightsModal applicant={applicant} role={role} onClose={() => setShowInsights(false)} />
      )}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {applicant.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
          </div>
          <div>
            <p className="font-semibold text-sm text-slate-900 leading-tight">{applicant.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">External applicant · {applicant.experience} yrs exp</p>
          </div>
        </div>
        {applicant.status === "Shortlisted" ? (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-blue-600 text-white flex items-center gap-1 shrink-0">
            <Star className="w-3 h-3 fill-white" /> Shortlisted
          </span>
        ) : applicant.status === "Rejected" ? (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-rose-100 text-rose-700 flex items-center gap-1 shrink-0">
            <XCircle className="w-3 h-3" /> Rejected
          </span>
        ) : (
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${tone.soft} ${tone.text} shrink-0`}>
            {score}% match
          </span>
        )}
      </div>
      <ScoreBar score={score} threshold={role.threshold} />
      <div className="flex flex-wrap gap-1.5 mt-3">
        {role.skills.map((s) => (
          <SkillPill key={s} skill={s} matched={matchedSkills.includes(s.toLowerCase())} />
        ))}
      </div>
      {(applicant.email || applicant.phone) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-500">
          {applicant.email && (
            <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-slate-400" /> {applicant.email}</span>
          )}
          {applicant.phone && (
            <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-slate-400" /> {applicant.phone}</span>
          )}
        </div>
      )}
      <div className="flex items-start gap-1.5 mt-3 bg-slate-50 rounded-lg p-2.5">
        <Brain className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 leading-relaxed">{applicant.resumeSummary}</p>
          {applicant.resumeFileName && (
            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
              <Paperclip className="w-3 h-3" /> {applicant.resumeFileName}
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end items-center gap-2 mt-3">
        <button
          onClick={() => setShowInsights(true)}
          className="text-xs font-semibold text-indigo-600 hover:text-white hover:bg-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 mr-auto"
        >
          <Brain className="w-3.5 h-3.5" /> AI Insights
        </button>
        {applicant.status === "Shortlisted" && (
          <button
            onClick={() => onUndo(applicant.id)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors"
          >
            Move back to review
          </button>
        )}
        {applicant.status === "Rejected" && (
          <button
            onClick={() => onUndo(applicant.id)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors"
          >
            Undo rejection
          </button>
        )}
        {applicant.status === "New" && isDeciding && (
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> AI is drafting the notification…
          </span>
        )}
        {applicant.status === "New" && !isDeciding && (
          <>
            <button
              onClick={() => onReject(applicant.id)}
              className="text-xs font-semibold text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 px-3.5 py-1.5 rounded-lg transition-all hover:-translate-y-0.5 flex items-center gap-1.5"
            >
              <ThumbsDown className="w-3.5 h-3.5" /> Reject
            </button>
            <button
              onClick={() => onShortlist(applicant.id)}
              className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3.5 py-1.5 rounded-lg transition-all hover:-translate-y-0.5 flex items-center gap-1.5"
            >
              <Star className="w-3.5 h-3.5" /> Shortlist &amp; hire
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CreateRoleForm({ onCreate }) {
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState(DEPTS[0]);
  const [location, setLocation] = useState("Chennai, TN");
  const [minExp, setMinExp] = useState(2);
  const [threshold, setThreshold] = useState(75);
  const [skillInput, setSkillInput] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skills, setSkills] = useState([]);
  const [description, setDescription] = useState("");

  const toggleSkill = (s) => {
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const addCustomSkill = () => {
    const v = skillInput.trim();
    if (v && !skills.includes(v)) setSkills((prev) => [...prev, v]);
    setSkillInput("");
  };

  const removeSkill = (s) => setSkills(skills.filter((x) => x !== s));

  const filteredMasterSkills = MASTER_SKILLS.filter((s) =>
    s.toLowerCase().includes(skillSearch.trim().toLowerCase())
  );

  const pickerRef = useRef(null);
  useEffect(() => {
    if (!skillPickerOpen) return;
    const onOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setSkillPickerOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [skillPickerOpen]);

  const canSubmit = title.trim() && skills.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate({
      id: `r${Date.now()}`,
      title: title.trim(),
      dept,
      location,
      minExp: Number(minExp),
      threshold: Number(threshold),
      skills,
      description: description.trim() || "Role requirements assigned by HR.",
    });
    setTitle(""); setSkills([]); setDescription(""); setSkillInput("");
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
          <Plus className="w-4.5 h-4.5 text-blue-600" />
        </div>
        <div>
          <p className="font-semibold text-sm text-slate-900">Assign a new role</p>
          <p className="text-xs text-slate-400">AI checks internal talent first, then opens external hiring if needed.</p>
        </div>
      </div>

      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Role title, e.g. DevOps Engineer"
          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
        />
        <div className="grid grid-cols-2 gap-3">
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white"
          >
            {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location"
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">Min. experience (yrs)</label>
            <input
              type="number" min="0"
              value={minExp}
              onChange={(e) => setMinExp(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">Eligibility threshold (%)</label>
            <input
              type="number" min="0" max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-slate-500 block">Required skills</label>
            {skills.length > 0 && <span className="text-[11px] text-blue-600 font-semibold">{skills.length} selected</span>}
          </div>

          {/* Selected skill chips */}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {skills.map((s) => (
                <span key={s} className="text-[11px] font-medium pl-2.5 pr-1.5 py-1 rounded-full bg-blue-50 text-blue-700 flex items-center gap-1">
                  {s}
                  <button onClick={() => removeSkill(s)} className="hover:bg-blue-100 rounded-full p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Dropdown trigger showing search + toggleable list of all applicable skills */}
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setSkillPickerOpen((v) => !v)}
              className="w-full flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-500 hover:border-blue-300 transition-colors bg-white"
            >
              <span className="flex items-center gap-2"><Search className="w-3.5 h-3.5 text-slate-300" /> Select from applicable skills…</span>
              <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${skillPickerOpen ? "rotate-180" : ""}`} />
            </button>

            {skillPickerOpen && (
              <div className="absolute z-10 mt-1.5 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                <div className="p-2 border-b border-slate-100">
                  <input
                    autoFocus
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    placeholder="Search skills…"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto py-1">
                  {filteredMasterSkills.length > 0 ? (
                    filteredMasterSkills.map((s) => {
                      const checked = skills.includes(s);
                      return (
                        <button
                          type="button"
                          key={s}
                          onClick={() => toggleSkill(s)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-slate-600 hover:bg-blue-50/60 transition-colors"
                        >
                          <span className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                            checked ? "bg-blue-600 border-blue-600" : "border-slate-300"
                          }`}>
                            {checked && <Check className="w-3 h-3 text-white" />}
                          </span>
                          {s}
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-xs text-slate-400 px-3 py-2">No matching skill in the list.</p>
                  )}
                </div>
                {/* Fallback: skill not in the master list */}
                <div className="p-2 border-t border-slate-100 flex gap-1.5">
                  <input
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomSkill())}
                    placeholder="Not listed? Type a custom skill"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <button onClick={addCustomSkill} className="px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors shrink-0">Add</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short role description (optional)"
          rows={2}
          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
        />

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed px-5 py-3 rounded-xl transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2"
        >
          <Zap className="w-4 h-4" /> Assign role &amp; run AI match
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Internal employee roster — this is the "collect internal team's    */
/*  resumes" step from the brief: HR adds employees (name, role, dept, */
/*  skills, resume text or file) once, and every job created afterward */
/*  gets scored against this list before ever going external.         */
/* ------------------------------------------------------------------ */
// Single-entry fields only (no outer card) — EmployeeIntakePanel supplies
// the surrounding card + header + bulk/single tab switcher.
function AddEmployeeFormFields({ onAdd }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [dept, setDept] = useState(DEPTS[0]);
  const [experienceYears, setExperienceYears] = useState(2);
  const [resumeText, setResumeText] = useState("");
  const [fileStatus, setFileStatus] = useState("idle");
  const [submitting, setSubmitting] = useState(false);

  const skills = extractSkillsFromResume(resumeText);
  const canSubmit = name.trim() && role.trim() && resumeText.trim().length > 20;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileStatus("reading");
    const { text, extracted } = await readResumeFile(file);
    if (extracted && text) {
      setResumeText(text);
      setFileStatus("parsed");
      // Auto-fill name/role if HR hasn't typed anything yet — same
      // heuristics the bulk importer uses, just for a single file.
      if (!name.trim()) setName(extractNameGuess(text));
      if (!role.trim()) {
        const guessedRole = extractRoleGuess(text);
        if (guessedRole) setRole(guessedRole);
      }
    } else {
      setFileStatus("manual"); // .pdf/.doc — ask them to paste text instead
    }
  };

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await onAdd({ name: name.trim(), role: role.trim(), department: dept, skills, resumeText, experienceYears: Number(experienceYears) });
      setName(""); setRole(""); setResumeText(""); setFileStatus("idle"); setExperienceYears(2);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Current role"
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white">
          {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input type="number" min={0} value={experienceYears} onChange={(e) => setExperienceYears(e.target.value)}
          placeholder="Years exp" className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer">
        <Upload className="w-3.5 h-3.5 text-slate-400" />
        Upload resume (.txt/.docx) or paste below
        <input type="file" accept=".txt,.docx" className="hidden" onChange={handleFile} />
      </label>
      <textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={3}
        placeholder="Paste resume text (used to auto-extract skills)"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
      {fileStatus === "manual" && (
        <p className="text-[10px] text-amber-600">Couldn't auto-read that file type — paste the resume text above instead.</p>
      )}
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skills.map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-100">{s}</span>)}
        </div>
      )}
      <button onClick={submit} disabled={!canSubmit || submitting}
        className="w-full text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 px-4 py-2.5 rounded-lg transition-colors">
        {submitting ? "Adding…" : "Add to internal roster"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bulk internal-employee import — drop in many resumes at once      */
/*  (e.g. onboarding a whole existing team, 50+ files). Each file is  */
/*  read client-side and auto-profiled (name / role / department /    */
/*  years / skills guessed from the text — see extractNameGuess etc.  */
/*  in src/lib/resumeAnalyzer.js), then shown as an editable draft     */
/*  list so HR can fix anything the heuristics got wrong before one    */
/*  batch submit creates every roster row.                            */
/* ------------------------------------------------------------------ */
let draftIdSeq = 0;

function BulkAddEmployeesForm({ onAdd }) {
  const [drafts, setDrafts] = useState([]); // { id, fileName, name, role, department, experienceYears, resumeText, skills, parseStatus }
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef(null);

  const buildDraftFromFile = async (file) => {
    const { text, extracted } = await readResumeFile(file);
    const nameFallback = file.name.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").trim();
    const role = extracted ? extractRoleGuess(text) : "";
    return {
      id: `draft-${++draftIdSeq}`,
      fileName: file.name,
      name: extracted ? extractNameGuess(text, nameFallback) : nameFallback,
      role,
      department: guessDepartmentFromRole(role),
      experienceYears: extracted ? (extractExperienceGuess(text) ?? 2) : 2,
      resumeText: extracted ? text : "",
      skills: extracted ? extractSkillsFromResume(text) : [],
      parseStatus: extracted ? "parsed" : "manual", // "manual" = .pdf/.doc, needs pasted text
    };
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setParsing(true);
    try {
      // Read/parse sequentially so 50 files don't all hit the mammoth
      // (docx) parser at once — keeps the UI responsive with a running list.
      for (const file of files) {
        const draft = await buildDraftFromFile(file);
        setDrafts((prev) => [...prev, draft]);
      }
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateDraft = (id, patch) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDraft = (id) => setDrafts((prev) => prev.filter((d) => d.id !== id));
  const clearAll = () => setDrafts([]);

  const readyDrafts = drafts.filter((d) => d.name.trim() && d.role.trim() && d.resumeText.trim().length > 20);
  const needsAttentionCount = drafts.length - readyDrafts.length;

  const submitAll = async () => {
    if (!readyDrafts.length || submitting) return;
    setSubmitting(true);
    setProgress({ done: 0, total: readyDrafts.length });
    try {
      // Sequential inserts (not Promise.all) so a batch of 50 doesn't fire
      // 50 concurrent requests at once, and so progress can be shown.
      for (const d of readyDrafts) {
        await onAdd({
          name: d.name.trim(),
          role: d.role.trim(),
          department: d.department,
          skills: d.skills,
          resumeText: d.resumeText,
          experienceYears: Number(d.experienceYears) || 0,
        });
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      // Only clear the ones that actually got submitted — leave any
      // still-incomplete drafts (missing resume text etc.) for HR to fix.
      setDrafts((prev) => prev.filter((d) => !readyDrafts.some((r) => r.id === d.id)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className={`flex flex-col items-center justify-center gap-1.5 text-center border-2 border-dashed rounded-xl px-4 py-6 cursor-pointer transition-colors ${
        parsing ? "border-blue-200 bg-blue-50/50" : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/30"
      }`}>
        {parsing ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin" /> : <Upload className="w-5 h-5 text-slate-400" />}
        <span className="text-xs font-semibold text-slate-600">
          {parsing ? "Reading resumes…" : "Drop multiple resumes here (.txt/.docx)"}
        </span>
        <span className="text-[10px] text-slate-400">Select up to ~50 files at once — each gets auto-profiled</span>
        <input ref={fileInputRef} type="file" accept=".txt,.docx" multiple className="hidden" onChange={handleFiles} />
      </label>

      {drafts.length > 0 && (
        <>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>{drafts.length} file{drafts.length === 1 ? "" : "s"} loaded{needsAttentionCount > 0 ? ` · ${needsAttentionCount} need attention` : ""}</span>
            <button onClick={clearAll} className="text-slate-400 hover:text-rose-600 font-semibold">Clear all</button>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {drafts.map((d) => {
              const incomplete = !(d.name.trim() && d.role.trim() && d.resumeText.trim().length > 20);
              return (
                <div key={d.id} className={`rounded-lg border p-2.5 space-y-1.5 ${incomplete ? "border-amber-200 bg-amber-50/40" : "border-slate-100 bg-slate-50/50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {d.parseStatus === "parsed" ? (
                        <FileCheck2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <FileWarning className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                      <span className="text-[10px] text-slate-400 truncate">{d.fileName}</span>
                    </div>
                    <button onClick={() => removeDraft(d.id)} className="text-slate-300 hover:text-rose-600 shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <input value={d.name} onChange={(e) => updateDraft(d.id, { name: e.target.value })} placeholder="Full name"
                      className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                    <input value={d.role} onChange={(e) => updateDraft(d.id, { role: e.target.value })} placeholder="Current role"
                      className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <select value={d.department} onChange={(e) => updateDraft(d.id, { department: e.target.value })}
                      className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] bg-white">
                      {DEPTS.map((dep) => <option key={dep} value={dep}>{dep}</option>)}
                    </select>
                    <input type="number" min={0} value={d.experienceYears}
                      onChange={(e) => updateDraft(d.id, { experienceYears: e.target.value })} placeholder="Years exp"
                      className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                  </div>

                  {d.parseStatus === "manual" && (
                    <textarea value={d.resumeText} onChange={(e) => updateDraft(d.id, { resumeText: e.target.value, skills: extractSkillsFromResume(e.target.value) })}
                      rows={2} placeholder="Couldn't auto-read this file — paste resume text here"
                      className="w-full rounded-md border border-amber-200 px-2 py-1.5 text-[11px] outline-none focus:border-amber-400" />
                  )}

                  {d.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {d.skills.slice(0, 6).map((s) => (
                        <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-white text-slate-500 border border-slate-200">{s}</span>
                      ))}
                      {d.skills.length > 6 && <span className="text-[9px] text-slate-400">+{d.skills.length - 6} more</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={submitAll} disabled={!readyDrafts.length || submitting}
            className="w-full text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 px-4 py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
            {submitting ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding {progress.done}/{progress.total}…</>
            ) : (
              <>Add {readyDrafts.length} employee{readyDrafts.length === 1 ? "" : "s"} to roster</>
            )}
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel wrapper: lets HR switch between adding one employee by hand  */
/*  and bulk-uploading a whole team's resumes at once.                 */
/* ------------------------------------------------------------------ */
function EmployeeIntakePanel({ onAdd }) {
  const [mode, setMode] = useState("bulk"); // "bulk" | "single"

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <UserPlus className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Add internal employees</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-50 rounded-lg p-0.5 border border-slate-100">
          <button onClick={() => setMode("bulk")}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${mode === "bulk" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
            Bulk upload
          </button>
          <button onClick={() => setMode("single")}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${mode === "single" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
            Single
          </button>
        </div>
      </div>

      {mode === "bulk" ? <BulkAddEmployeesForm onAdd={onAdd} /> : <AddEmployeeFormFields onAdd={onAdd} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HR Dashboard — now takes `session` + `onLogout`, and shows the     */
/*  logged-in HR person's own name instead of a hardcoded profile.     */
/* ------------------------------------------------------------------ */
function HRDashboard({ session, onLogout }) {
  const [roles, setRoles] = useState([]); // only THIS HR's own jobs (listMyJobs -> hr_id = session.id)
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [internalEmployees, setInternalEmployees] = useState([]);
  const [externalApplicants, setExternalApplicants] = useState({}); // { [jobId]: uiApplicant[] }
  const [syncState, setSyncState] = useState("loading"); // loading | online | error
  const [lastSynced, setLastSynced] = useState(null);
  const [pushingExternal, setPushingExternal] = useState(false);

  const loadAll = useCallback(async () => {
    setSyncState("loading");
    try {
      const [jobRows, employeeRows] = await Promise.all([
        listMyJobs(session),
        listInternalEmployees(session),
      ]);
      const uiJobs = jobRows.map(toUiJob);
      setRoles(uiJobs);
      setInternalEmployees(employeeRows.map(toUiEmployee));
      setSelectedRoleId((prev) => prev && uiJobs.some((r) => r.id === prev) ? prev : uiJobs[0]?.id ?? null);

      // Pull applicants for every job this HR owns (RLS already scopes this
      // to hr_id = session.id — this is exactly what keeps HR1 from ever
      // seeing HR2's applicants, even by accident).
      const appEntries = await Promise.all(
        uiJobs.map(async (job) => [job.id, (await listApplicationsForJob(session, job.id)).map(toUiApplicant)])
      );
      setExternalApplicants(Object.fromEntries(appEntries));

      setSyncState("online");
      setLastSynced(new Date());
    } catch (e) {
      console.error("HR dashboard load failed", e);
      setSyncState("error");
    }
  }, [session]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const syncNow = useCallback(() => loadAll(), [loadAll]);

  // Internal-first pass: every job is scored against this company's internal
  // employees. If someone clears the threshold, the job never needs to go
  // external at all. If not, HR gets a clear "open to external" action.
  const roleStatus = useMemo(() => {
    const map = {};
    roles.forEach((role) => {
      const scored = internalEmployees
        .map((emp) => ({ emp, ...matchScore(emp, role) }))
        .sort((a, b) => b.score - a.score);
      const bestScore = scored[0]?.score ?? 0;
      const postedExternally = role.status !== "internal_review"; // HR's own decision, not auto-computed
      map[role.id] = { scored, bestScore, clearedInternally: bestScore >= role.threshold, postedExternally, pushedToBoards: role.status === "pushed_external" };
    });
    return map;
  }, [roles, internalEmployees]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || roles[0];
  const status = selectedRole ? roleStatus[selectedRole.id] : null;
  const applicants = selectedRole ? (externalApplicants[selectedRole.id] || []) : [];

  const shortlistedCount = Object.values(externalApplicants).flat().filter((a) => a.status === "Shortlisted").length;
  const internalFillCount = roles.filter((r) => roleStatus[r.id]?.clearedInternally).length;
  const externalCount = roles.filter((r) => roleStatus[r.id]?.postedExternally).length;
  const applicantPool = Object.values(externalApplicants).flat().length;

  const createRole = async (uiRole) => {
    try {
      const created = await createJob(session, toDbJobInput(uiRole));
      setRoles((prev) => [toUiJob(created), ...prev]);
      setExternalApplicants((prev) => ({ ...prev, [created.id]: [] }));
      setSelectedRoleId(created.id);
    } catch (e) {
      console.error("failed to create job", e);
    }
  };

  // HR calls this once internal matching shows no one clears the bar —
  // this is what makes the job appear on the Candidate Portal for the
  // first time (see listOpenJobs, which only returns external_open/pushed_external).
  const openToExternal = async (jobId) => {
    await setJobStatus(jobId, "external_open");
    setRoles((prev) => prev.map((r) => (r.id === jobId ? { ...r, status: "external_open" } : r)));
  };

  // Push to LinkedIn/Naukri-style boards — see src/lib/externalBoards.js for
  // the real-world caveat: this queues/records the push in our own DB; wiring
  // real LinkedIn/Naukri partner APIs is a separate, gated integration.
  const pushExternal = async (job) => {
    setPushingExternal(true);
    try {
      await pushJobToExternalBoards(job, ["linkedin", "naukri"]);
      setRoles((prev) => prev.map((r) => (r.id === job.id ? { ...r, status: "pushed_external", external_boards: ["linkedin", "naukri"] } : r)));
    } catch (e) {
      console.error("external push failed", e);
    } finally {
      setPushingExternal(false);
    }
  };

  const addEmployee = async (employee) => {
    const created = await addInternalEmployee(session, employee);
    setInternalEmployees((prev) => [...prev, toUiEmployee(created)]);
  };

  // Shortlist / Reject / Undo — this is the "no email backend" decision
  // point: alongside the status update, it writes a formal in-app
  // notification straight into the candidate's own inbox (see
  // buildHiredMessage / buildRejectionMessage above and the Notifications
  // panel in CandidatePortal). dbStatus/uiStatus stay in the same
  // hr_id-scoped tables/RLS as everything else here.
  const [decidingId, setDecidingId] = useState(null);

  const decideApplicant = async (applicantId, decision) => {
    const role = selectedRole;
    const current = externalApplicants[role.id]?.find((a) => a.id === applicantId);
    if (!current) return;

    const dbStatus = decision === "shortlist" ? "shortlisted" : decision === "reject" ? "rejected" : "reviewed";
    const uiStatus = decision === "shortlist" ? "Shortlisted" : decision === "reject" ? "Rejected" : "New";

    // Shortlist/reject now waits on an AI-drafted message (see below), so
    // this button click can take a beat — flag it in the UI instead of
    // optimistically flipping status while a request is still in flight.
    if (decision === "shortlist" || decision === "reject") setDecidingId(applicantId);

    setExternalApplicants((prev) => ({
      ...prev,
      [role.id]: prev[role.id].map((a) => (a.id === applicantId ? { ...a, status: uiStatus } : a)),
    }));

    try {
      await updateApplicationStatus(applicantId, dbStatus);

      if (decision === "shortlist" || decision === "reject") {
        const { matchedSkills } = matchScore(current, role);
        const missingSkills = role.skills.filter((s) => !matchedSkills.includes(s.toLowerCase()));

        // AI-drafted, candidate-specific notification copy (src/lib/aiClient.js —
        // Groq/Llama, free tier). Falls back to the static buildHiredMessage /
        // buildRejectionMessage templates below if no key is configured or the
        // call fails, so a decision is never blocked on the AI call succeeding.
        const aiMessage = await generateDecisionMessage({
          decision,
          applicant: current,
          role,
          companyName: session?.companyName,
          matchInfo: { matchedSkills, missingSkills },
        }).catch(() => null);

        if (decision === "shortlist") {
          await createNotification({
            candidateId: current.candidateId,
            applicationId: applicantId,
            jobId: role.id,
            type: "hired",
            title: `You're hired — ${role.title}`,
            message: aiMessage || buildHiredMessage(current, role, session?.companyName),
          });
        } else {
          await createNotification({
            candidateId: current.candidateId,
            applicationId: applicantId,
            jobId: role.id,
            type: "rejected",
            title: `Update on your application — ${role.title}`,
            message: aiMessage || buildRejectionMessage(current, role, session?.companyName),
          });
        }
      }
    } catch (e) {
      console.error("failed to update application / send notification", e);
    } finally {
      setDecidingId(null);
    }
  };

  if (!selectedRole) {
    // No jobs posted yet — CreateRoleForm still renders inside the layout below
    // once `roles` has at least one entry; this early guard just avoids
    // reading properties off `undefined` before the first job exists.
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');
        .font-display { font-family: 'Space Grotesk', 'Inter', sans-serif; }
        ::selection { background: #bfdbfe; color: #1e3a8a; }
      `}</style>

      {/* ============================= TOP BAR ============================= */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-md shadow-blue-200">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-bold text-lg tracking-tight">ZONE <span className="text-blue-600">HR</span></span>
            <span className="hidden sm:inline text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full ml-2 flex items-center gap-1">
              <Brain className="w-3 h-3" /> AI Talent Matching
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={syncNow}
              disabled={syncState === "loading"}
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
              title="Pull new applications submitted from the Candidate Portal"
            >
              {syncState === "loading" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : syncState === "error" ? (
                <WifiOff className="w-3.5 h-3.5 text-rose-500" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {syncState === "error" ? "Sync failed" : "Sync candidate portal"}
            </button>
            <div className="w-px h-6 bg-slate-100 hidden sm:block" />
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white text-xs font-bold">
              {initialsOf(session?.name) || "HR"}
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-semibold text-slate-800 leading-none">{session?.name || "HR Manager"}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">HR Manager</p>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div
          className={`flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-lg mb-6 w-fit ${
            isPythonBackendConfigured() || isAIEnabled() ? "bg-indigo-50 text-indigo-700" : "bg-slate-50 text-slate-500"
          }`}
        >
          <Brain className="w-3.5 h-3.5" />
          {isPythonBackendConfigured()
            ? "AI resume scoring active — spaCy skill extraction + SBERT semantic match, with Groq/Llama explanations"
            : isAIEnabled()
            ? "AI resume scoring & notification drafting active (Groq / Llama 3.3) — Python NLP service not configured"
            : "AI resume scoring offline — running on built-in matcher. Add VITE_GROQ_API_KEY or VITE_PYTHON_API_URL in .env to enable."}
        </div>
        {/* ============================= STATS ============================= */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={Briefcase} label="Active roles" value={roles.length} accent={{ text: "text-blue-600", soft: "bg-blue-50" }} />
          <StatCard icon={UserCheck} label="Filled from internal team" value={internalFillCount} accent={{ text: "text-emerald-600", soft: "bg-emerald-50" }} />
          <StatCard icon={Globe2} label="Posted externally" value={externalCount} accent={{ text: "text-amber-600", soft: "bg-amber-50" }} />
          <StatCard icon={Star} label="Shortlisted candidates" value={shortlistedCount} accent={{ text: "text-indigo-600", soft: "bg-indigo-50" }} />
        </div>

        <div className="grid lg:grid-cols-12 gap-6">
          {/* ============================= LEFT: CREATE + PIPELINE ============================= */}
          <div className="lg:col-span-4 space-y-6">
            <CreateRoleForm onCreate={createRole} />
            <EmployeeIntakePanel onAdd={addEmployee} />

            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-4">Role pipeline</p>
              <div className="space-y-2">
                {roles.map((role) => {
                  const st = roleStatus[role.id];
                  const active = role.id === selectedRoleId;
                  return (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRoleId(role.id)}
                      className={`w-full text-left rounded-xl px-4 py-3 border transition-all ${
                        active ? "border-blue-200 bg-blue-50/60" : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800 leading-tight">{role.title}</p>
                        <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${active ? "rotate-90 text-blue-500" : "text-slate-300"}`} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          st.postedExternally ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                        }`}>
                          {st.postedExternally ? "External hiring" : "Internal match"}
                        </span>
                        <span className="text-[11px] text-slate-400">Best fit {st.bestScore}%</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ============================= RIGHT: ROLE DETAIL ============================= */}
          <div className="lg:col-span-8 space-y-6">
          {!selectedRole ? (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-10 text-center">
              <Briefcase className="w-6 h-6 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-600">No roles posted yet</p>
              <p className="text-xs text-slate-400 mt-1">Use the form on the left to post your first role.</p>
            </div>
          ) : (
          <>
            {/* Role header */}
            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-1">{selectedRole.dept}</p>
                  <h2 className="font-display font-bold text-2xl tracking-tight text-slate-900">{selectedRole.title}</h2>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {selectedRole.location}
                    </span>
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-slate-50 text-slate-500">{selectedRole.minExp}+ yrs exp</span>
                    {selectedRole.skills.map((s) => (
                      <span key={s} className="text-[11px] px-2.5 py-1 rounded-full bg-slate-50 text-slate-500 border border-slate-100">{s}</span>
                    ))}
                  </div>
                  <p className="text-sm text-slate-500 mt-3 leading-relaxed max-w-xl">{selectedRole.description}</p>
                </div>
              </div>
            </div>

            {/* Internal-first -> external workflow banner */}
            {selectedRole.status === "internal_review" && (
              <div className={`rounded-2xl border p-5 flex items-start gap-3 ${status.clearedInternally ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${status.clearedInternally ? "bg-emerald-100" : "bg-amber-100"}`}>
                  {status.clearedInternally ? <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" /> : <AlertTriangle className="w-4.5 h-4.5 text-amber-600" />}
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${status.clearedInternally ? "text-emerald-800" : "text-amber-800"}`}>
                    {status.clearedInternally
                      ? `Internal candidate available — best fit ${status.bestScore}%, above the ${selectedRole.threshold}% bar`
                      : `No internal employee cleared the ${selectedRole.threshold}% eligibility bar (best fit ${status.bestScore}%)`}
                  </p>
                  <p className={`text-xs mt-1 leading-relaxed ${status.clearedInternally ? "text-emerald-700/80" : "text-amber-700/80"}`}>
                    {status.clearedInternally
                      ? "This role stays internal-only unless you choose to open it to outside candidates anyway."
                      : "Open this role to the Candidate Portal so outside applicants can apply — it'll route straight back to your dashboard."}
                  </p>
                  <button
                    onClick={() => openToExternal(selectedRole.id)}
                    className="mt-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3.5 py-2 rounded-lg transition-colors"
                  >
                    Open to external candidates
                  </button>
                </div>
              </div>
            )}
            {selectedRole.status === "external_open" && (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                  <Globe2 className="w-4.5 h-4.5 text-indigo-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-indigo-800">Live on the Candidate Portal</p>
                  <p className="text-xs text-indigo-700/80 mt-1 leading-relaxed">
                    Any candidate on TalentSphere AI can apply now. Want more reach? Push this role out to LinkedIn and Naukri-style boards too.
                  </p>
                  <button
                    onClick={() => pushExternal(selectedRole)}
                    disabled={pushingExternal}
                    className="mt-3 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 px-3.5 py-2 rounded-lg transition-colors inline-flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" /> {pushingExternal ? "Pushing…" : "Push to LinkedIn + Naukri"}
                  </button>
                </div>
              </div>
            )}
            {selectedRole.status === "pushed_external" && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0 border border-slate-200">
                  <Send className="w-4.5 h-4.5 text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Pushed to external boards</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Queued for {(selectedRole.external_boards || ["linkedin", "naukri"]).join(" + ")}. Real posting requires each board's recruiter-partner API access — see MIGRATION.md for what's needed to go live.
                  </p>
                </div>
              </div>
            )}

            {/* Internal matches */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Radar className="w-4 h-4 text-blue-600" />
                <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Internal talent match, ranked by AI</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {status.scored.slice(0, 4).map(({ emp }, i) => (
                  <EmployeeMatchCard key={emp.id} employee={emp} role={selectedRole} best={i === 0} />
                ))}
              </div>
            </div>

            {/* External applicants */}
            {status.postedExternally && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Send className="w-4 h-4 text-indigo-600" />
                  <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                    External applicants · Candidate Portal ({applicants.length})
                  </p>
                </div>
                {applicants.length === 0 ? (
                  <div className="border border-dashed border-slate-200 rounded-2xl p-8 text-center bg-white">
                    <FileText className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-600">No applications yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                      This role is live on the Candidate Portal. As people apply, their resumes are auto-extracted and scored here for you to shortlist.
                    </p>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {applicants
                      .slice()
                      .sort((a, b) => matchScore(b, selectedRole).score - matchScore(a, selectedRole).score)
                      .map((applicant) => (
                        <ApplicantCard
                          key={applicant.id}
                          applicant={applicant}
                          role={selectedRole}
                          onShortlist={(id) => decideApplicant(id, "shortlist")}
                          onReject={(id) => decideApplicant(id, "reject")}
                          onUndo={(id) => decideApplicant(id, "undo")}
                          isDeciding={decidingId === applicant.id}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
          </>
          )}
          </div>
        </div>

        {/* ============================= GLOBAL SHORTLIST ============================= */}
        {shortlistedCount > 0 && (
          <div className="mt-10 bg-white border border-slate-100 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Award className="w-4 h-4 text-blue-600" />
              <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Shortlisted across all roles, ready for interview</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {roles.map((role) =>
                (externalApplicants[role.id] || [])
                  .filter((a) => a.status === "Shortlisted")
                  .map((a) => (
                    <div key={a.id} className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {a.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{a.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{role.title}</p>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ================================================================== */
/*  APP — the single entry point. Checks for a saved session, then     */
/*  routes to LoginGate / CandidatePortal / HRDashboard.                */
/* ================================================================== */
export default function ZoneApp() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = logged out

  useEffect(() => {
    (async () => {
      const s = await getSession();
      setSession(s);
    })();
  }, []);

  const handleLogin = useCallback(async (newSession) => {
    setSession(newSession);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setSession(null);
  }, []);

  if (session === undefined) return <LoadingScreen />;
  if (!session) return <LoginGate onLogin={handleLogin} />;
  if (session.role === "hr") return <HRDashboard session={session} onLogout={handleLogout} />;
  return <CandidatePortal session={session} onLogout={handleLogout} />;
}