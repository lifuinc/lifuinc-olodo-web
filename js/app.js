// Olodo Educator & Course Creator Portal App Logic

import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "./firebase-config.js";

import { parseQuestionBank } from "./parser.js";
import { AIGenerator } from "./ai-generator.js";

// DOM Selector Helper
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Super Admin configuration (strictly internal check - never exposed in public UI)
const SUPER_ADMIN_EMAIL = "lifujosephlifu@gmail.com";

let currentUser = null;
let currentLecturerProfile = null;
let currentCourses = [];
let allLecturers = [];
let lastParsedQuestions = [];
let activeTierFilter = "all";
let activeVettingFilter = "pending";

// Educational Tiers Configuration
const TIERS_CONFIG = {
  tertiary: {
    name: "Tertiary (Universities & Polytechnics)",
    deptLabel: "Faculty / Department",
    levelLabel: "Academic Level",
    periodLabel: "Academic Semester",
    defaultPrice: 1000,
    departments: [
      "General Studies (GST)",
      "Computer Science",
      "Business Administration",
      "Accounting",
      "Economics",
      "Law",
      "Electrical & Electronics Engineering",
      "Mechanical Engineering",
      "Civil Engineering",
      "Medicine & Surgery",
      "Pharmacy",
      "Mass Communication",
      "Political Science",
      "Microbiology",
      "Biochemistry"
    ],
    levels: [
      "100 Level",
      "200 Level",
      "300 Level",
      "400 Level",
      "500 Level (Engineering / Pharmacy / Law)",
      "600 Level (Medicine MBBS)",
      "Postgraduate Diploma (PGD)",
      "Masters (M.Sc / MBA / M.Eng)",
      "Doctorate (Ph.D)"
    ],
    periods: ["1st Semester", "2nd Semester"]
  },
  senior_sec: {
    name: "Senior Secondary School (SSS 1 - 3)",
    deptLabel: "Subject Area",
    levelLabel: "Class",
    periodLabel: "Academic Term",
    defaultPrice: 1000,
    departments: [
      "Mathematics",
      "English Language",
      "Physics",
      "Chemistry",
      "Biology",
      "Economics",
      "Government",
      "Literature in English",
      "Financial Accounting",
      "Commerce",
      "Further Mathematics",
      "Geography",
      "Agricultural Science",
      "Civic Education",
      "Technical Drawing",
      "Data Processing",
      "Christian Religious Studies (CRS)",
      "Islamic Religious Studies (IRS)"
    ],
    levels: ["SSS 1", "SSS 2", "SSS 3"],
    periods: ["1st Term", "2nd Term", "3rd Term"]
  },
  junior_sec: {
    name: "Junior Secondary School (JSS 1 - 3)",
    deptLabel: "Subject Area",
    levelLabel: "Class",
    periodLabel: "Academic Term",
    defaultPrice: 1000,
    departments: [
      "Mathematics",
      "English Language",
      "Basic Science",
      "Basic Technology",
      "Business Studies",
      "Social Studies",
      "Civic Education",
      "Agricultural Science",
      "Home Economics",
      "Computer Studies / ICT",
      "Physical & Health Education",
      "French",
      "Christian Religious Studies (CRS)",
      "Islamic Religious Studies (IRS)"
    ],
    levels: ["JSS 1", "JSS 2", "JSS 3"],
    periods: ["1st Term", "2nd Term", "3rd Term"]
  },
  primary: {
    name: "Primary School (Basic 1 - 6)",
    deptLabel: "Subject Track",
    levelLabel: "Primary Class",
    periodLabel: "Academic Term",
    defaultPrice: 800,
    departments: [
      "Numeracy / Mathematics",
      "Literacy / English Studies",
      "Basic Science & Technology",
      "Social Studies",
      "Civic Education",
      "Computer Studies",
      "Agricultural Science",
      "Cultural & Creative Arts (CCA)",
      "Physical & Health Education (PHE)",
      "Home Economics",
      "French Language",
      "Christian Religious Studies (CRS)",
      "Islamic Religious Studies (IRS)"
    ],
    levels: ["Basic 1", "Basic 2", "Basic 3", "Basic 4", "Basic 5", "Basic 6"],
    periods: ["1st Term", "2nd Term", "3rd Term"]
  },
  national: {
    name: "National Exams (JAMB, WAEC, NECO)",
    deptLabel: "Exam Track & Subject",
    levelLabel: "Examination Target",
    periodLabel: "Exam Series / Year",
    defaultPrice: 1500,
    departments: [
      "UTME Use of English",
      "UTME Mathematics",
      "UTME Physics",
      "UTME Chemistry",
      "UTME Biology",
      "UTME Economics",
      "UTME Government",
      "UTME Literature in English",
      "UTME Accounts / Principles of Accounts",
      "WAEC English Language",
      "WAEC Mathematics",
      "WAEC Physics",
      "WAEC Chemistry",
      "WAEC Biology",
      "WAEC Economics",
      "WAEC Literature",
      "NECO Senior English",
      "NECO Senior Mathematics",
      "BECE Junior English",
      "BECE Junior Mathematics",
      "BECE Basic Science & Tech",
      "National Common Entrance Examination (NCEE)"
    ],
    levels: [
      "JAMB / UTME Unified",
      "Senior WAEC / SSCE",
      "Senior NECO / SSCE",
      "Junior BECE / Junior WAEC",
      "National Common Entrance (NCEE)"
    ],
    periods: [
      "2025 Series & Mock",
      "2024 Series",
      "2023 Series",
      "2022 Series",
      "2021 Series",
      "2020 Series"
    ]
  }
};

// ==========================================
// 1. MOBILE DRAWER & TAB NAVIGATION
// ==========================================
function initNavigation() {
  const sidebar = $("#sidebar");
  const backdrop = $("#drawer-backdrop");

  const openDrawer = () => {
    sidebar.classList.add("open");
    backdrop.classList.add("active");
  };

  const closeDrawer = () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("active");
  };

  // Mobile drawer controls
  $("#btn-mobile-toggle")?.addEventListener("click", openDrawer);
  $("#btn-close-drawer")?.addEventListener("click", closeDrawer);
  backdrop?.addEventListener("click", closeDrawer);

  // Tab switching
  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const tabId = btn.getAttribute("data-tab");
      $$(".tab-content").forEach((tab) => {
        tab.style.display = tab.id === tabId ? "block" : "none";
      });

      // Auto close drawer on mobile when tab picked
      if (window.innerWidth <= 768) {
        closeDrawer();
      }
    });
  });

  // Quick Action Buttons
  $("#btn-quick-upload")?.addEventListener("click", () => {
    $('[data-tab="tab-upload"]')?.click();
  });

  $("#btn-tab-add-course")?.addEventListener("click", () => {
    $('[data-tab="tab-upload"]')?.click();
  });

  // Filter chips in My Courses
  $$("#courses-filter-chips .filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$("#courses-filter-chips .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeTierFilter = chip.getAttribute("data-filter");
      renderCourses();
    });
  });

  // Filter chips in Admin Vetting
  $$("#vetting-filter-chips .filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$("#vetting-filter-chips .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeVettingFilter = chip.getAttribute("data-vet-filter");
      renderAdminVettingQueue();
    });
  });

  // Close preview modal
  $("#btn-close-preview")?.addEventListener("click", () => {
    $("#preview-modal")?.close();
  });
}

// ==========================================
// 2. DYNAMIC EDUCATIONAL TIER CONTROLS
// ==========================================
function initTierControls() {
  const tierSelect = $("#course-tier");
  const institutionSelect = $("#course-institution");
  const customSchoolBox = $("#custom-institution-box");

  function updateTierFields() {
    const tierKey = tierSelect.value || "tertiary";
    const cfg = TIERS_CONFIG[tierKey] || TIERS_CONFIG.tertiary;

    // Update labels
    $("#label-dept").textContent = cfg.deptLabel;
    $("#label-level").textContent = cfg.levelLabel;
    $("#label-period").textContent = cfg.periodLabel;

    // Populate Department / Subject dropdown
    const deptSelect = $("#course-dept");
    deptSelect.innerHTML = cfg.departments
      .map((d) => `<option value="${d}">${d}</option>`)
      .join("");

    // Populate Level / Class dropdown
    const levelSelect = $("#course-level");
    levelSelect.innerHTML = cfg.levels
      .map((l, idx) => `<option value="${l}" ${idx === 1 ? "selected" : ""}>${l}</option>`)
      .join("");

    // Populate Period dropdown (Term vs Semester vs Series)
    const periodSelect = $("#course-period");
    periodSelect.innerHTML = cfg.periods
      .map((p, idx) => `<option value="${p}" ${idx === 0 ? "selected" : ""}>${p}</option>`)
      .join("");

    // Standard pass price
    $("#course-price").value = "₦1,000";
  }

  tierSelect?.addEventListener("change", updateTierFields);
  updateTierFields();

  // Institution "+ Add New" Toggle
  institutionSelect?.addEventListener("change", () => {
    if (institutionSelect.value === "__NEW__") {
      customSchoolBox.style.display = "block";
      $("#custom-school-name").focus();
    } else {
      customSchoolBox.style.display = "none";
    }
  });
}

// ==========================================
// 3. AUTHENTICATION & PROFILE MANAGEMENT
// ==========================================
function initAuth() {
  const modal = $("#auth-modal");

  $("#btn-show-login")?.addEventListener("click", () => modal.showModal());
  $("#btn-close-auth")?.addEventListener("click", () => modal.close());

  $("#btn-google-auth")?.addEventListener("click", async () => {
    try {
      $("#auth-error").style.display = "none";
      await signInWithPopup(auth, googleProvider);
      modal.close();
    } catch (err) {
      $("#auth-error").textContent = err.message;
      $("#auth-error").style.display = "block";
    }
  });

  $("#btn-email-signin")?.addEventListener("click", async () => {
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-password").value.trim();
    if (!email || !pass) return;

    try {
      $("#auth-error").style.display = "none";
      await signInWithEmailAndPassword(auth, email, pass);
      modal.close();
    } catch (err) {
      $("#auth-error").textContent = err.message;
      $("#auth-error").style.display = "block";
    }
  });

  $("#btn-email-signup")?.addEventListener("click", async () => {
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-password").value.trim();
    if (!email || !pass) return;

    try {
      $("#auth-error").style.display = "none";
      await createUserWithEmailAndPassword(auth, email, pass);
      modal.close();
    } catch (err) {
      $("#auth-error").textContent = err.message;
      $("#auth-error").style.display = "block";
    }
  });

  $("#btn-logout")?.addEventListener("click", async () => {
    await signOut(auth);
  });

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      $("#logged-out-view").style.display = "none";
      $("#logged-in-view").style.display = "block";

      const name = user.displayName || user.email.split("@")[0];
      $("#display-user-name").textContent = name;
      $("#avatar-initial").textContent = name.charAt(0).toUpperCase();

      const isSuperAdmin = user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

      // Ensure profile exists in Firestore `lecturers/{uid}`
      await syncLecturerProfile(user, isSuperAdmin);

      if (isSuperAdmin) {
        $("#admin-nav-section").style.display = "block";
        $("#display-user-role").textContent = "👑 Super Admin";
        $("#mobile-role-pill").textContent = "👑 Admin";
        $("#mobile-role-pill").className = "badge badge-admin";
        loadAdminData();
      } else {
        $("#admin-nav-section").style.display = "none";
        const status = currentLecturerProfile?.status || "pending";
        $("#display-user-role").textContent = status === "verified" ? "Verified Educator" : "Pending Verification";
        $("#mobile-role-pill").textContent = status === "verified" ? "Verified" : "Pending";
        $("#mobile-role-pill").className = status === "verified" ? "badge badge-success" : "badge badge-accent";
      }
    } else {
      currentLecturerProfile = null;
      $("#logged-out-view").style.display = "block";
      $("#logged-in-view").style.display = "none";
      $("#admin-nav-section").style.display = "none";
      $("#mobile-role-pill").textContent = "Guest";
      $("#mobile-role-pill").className = "badge badge-primary";
    }

    renderVettingStatusBanner();
    loadCoursesFromFirestore();
  });
}

// Sync Educator document in Firestore
async function syncLecturerProfile(user, isSuperAdmin) {
  try {
    const profRef = doc(db, "lecturers", user.uid);
    const snap = await getDoc(profRef);

    if (snap.exists()) {
      currentLecturerProfile = snap.data();
      // If Super Admin, guarantee verified status
      if (isSuperAdmin && currentLecturerProfile.status !== "verified") {
        await setDoc(profRef, { status: "verified", role: "super_admin" }, { merge: true });
        currentLecturerProfile.status = "verified";
      }
    } else {
      currentLecturerProfile = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split("@")[0],
        status: isSuperAdmin ? "verified" : "pending",
        role: isSuperAdmin ? "super_admin" : "educator",
        institution: "General",
        registeredAt: serverTimestamp()
      };
      await setDoc(profRef, currentLecturerProfile);
    }
  } catch (err) {
    console.warn("Could not sync educator profile:", err);
  }
}

// Render dynamic status alert banner on overview tab (No email exposed!)
function renderVettingStatusBanner() {
  const banner = $("#vetting-status-banner");
  if (!banner) return;

  if (!currentUser) {
    banner.innerHTML = `
      <div class="alert alert-warning">
        👋 <b>Welcome Educator!</b> Sign in or register to publish verified question banks, earn direct royalties, and sync past questions to the Olodo mobile app.
      </div>
    `;
    return;
  }

  const isSuperAdmin = currentUser.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  if (isSuperAdmin) {
    banner.innerHTML = `
      <div class="alert alert-admin">
        👑 <b>Super Administrator Mode Active.</b> You have full access to the Vetting Queue, Paystack Settlement Ledger, and Nationwide Analytics.
      </div>
    `;
    return;
  }

  const status = currentLecturerProfile?.status || "pending";
  if (status === "verified") {
    banner.innerHTML = `
      <div class="alert alert-success">
        ✓ <b>Verified Educator Account.</b> Your question banks and updates are immediately live to students nationwide on the Olodo mobile app.
      </div>
    `;
  } else if (status === "rejected") {
    banner.innerHTML = `
      <div class="alert alert-danger">
        ✕ <b>Verification Declined.</b> Your application was reviewed by the Olodo Academic Vetting Board. Please contact academic support for re-evaluation.
      </div>
    `;
  } else {
    banner.innerHTML = `
      <div class="alert alert-warning">
        ⏳ <b>Account Status: Pending Verification.</b> Your question banks are saved and currently under review by the Olodo Academic Vetting Board. Verified packs go live on the student mobile app immediately upon approval.
      </div>
    `;
  }
}

// ==========================================
// 4. QUESTION BANKS RETRIEVAL & RENDERING
// ==========================================
async function loadCoursesFromFirestore() {
  const tableBody = $("#courses-table-body");
  const overviewList = $("#overview-courses-list");
  const handoverSelect = $("#handover-course-select");

  try {
    const snap = await getDocs(collection(db, "courses"));
    currentCourses = snap.docs.map((d) => ({ docId: d.id, ...d.data() }));

    // Fallback seed item if collection is empty
    if (currentCourses.length === 0) {
      currentCourses = [
        {
          docId: "tertiary_unilag_200level_1stsemester_gst204",
          id: "gst204",
          code: "GST 204",
          title: "Entrepreneurship and Innovation",
          tier: "tertiary",
          institution: "University of Lagos (UNILAG)",
          department: "General Studies",
          level: "200 Level",
          semester: "1st Semester",
          period: "1st Semester",
          totalQuestions: 203,
          singleCoursePrice: 1000,
          academicSession: "2025/2026",
          authorEmail: currentUser ? currentUser.email : "adeleke@unilag.edu.ng",
          currentCuratorEmail: currentUser ? currentUser.email : "adeleke@unilag.edu.ng",
          published: true,
          vettingStatus: "verified",
          version: 1,
          hasExplanations: true
        }
      ];
    }

    renderCourses();

    // Stats
    let totalQuestionsCount = 0;
    currentCourses.forEach((c) => {
      totalQuestionsCount += (c.totalQuestions || (c.questions ? c.questions.length : 0));
    });
    $("#stat-total-courses").textContent = currentCourses.length;
    $("#stat-total-questions").textContent = totalQuestionsCount;

    // Render Overview List (top 4)
    if (overviewList) {
      overviewList.innerHTML = currentCourses
        .slice(0, 4)
        .map(
          (c) => `
          <div style="border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div>
              <b style="color: var(--primary); font-size: 14px;">${c.code || "SUBJ"} · ${c.title || "Subject"}</b>
              <div style="font-size: 12px; color: var(--muted);">${c.institution || "School"} · ${c.period || c.semester || "Session"}</div>
            </div>
            <span class="badge ${c.published ? "badge-success" : "badge-accent"}">${c.totalQuestions || 200} Qs Live</span>
          </div>
        `
        )
        .join("");
    }

    // Render Handover Select
    if (handoverSelect) {
      handoverSelect.innerHTML =
        `<option value="">Select a question bank to hand over...</option>` +
        currentCourses
          .map(
            (c) =>
              `<option value="${c.docId}">${c.code} - ${c.title} (${c.academicSession || "Current"})</option>`
          )
          .join("");
    }
  } catch (err) {
    console.warn("Firestore fetch error:", err);
  }
}

// Render Courses (Handles both Desktop Table and Mobile Card Feed)
function renderCourses() {
  const tableBody = $("#courses-table-body");
  const mobileFeed = $("#courses-mobile-feed");
  if (!tableBody || !mobileFeed) return;

  const filtered = activeTierFilter === "all"
    ? currentCourses
    : currentCourses.filter((c) => (c.tier || "tertiary") === activeTierFilter);

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--muted); padding: 30px;">
          No question banks found for this educational tier.
        </td>
      </tr>
    `;
    mobileFeed.innerHTML = `
      <div style="text-align: center; color: var(--muted); padding: 24px;">
        No question banks found for this educational tier.
      </div>
    `;
    return;
  }

  // Desktop Table Render
  tableBody.innerHTML = filtered
    .map((c) => {
      const isCurator = currentUser && c.currentCuratorEmail === currentUser.email;
      const statusBadge = c.published
        ? `<span class="badge badge-success">✓ Live in App</span>`
        : `<span class="badge badge-accent">⏳ Pending Vetting</span>`;

      return `
        <tr>
          <td>
            <b style="color: var(--primary);">${c.code || "SUBJ"}</b>
            <div style="font-size: 12.5px; color: var(--muted);">${c.title || "Subject Title"}</div>
          </td>
          <td>
            <div>${c.institution || "School"}</div>
            <div style="font-size: 11.5px; color: var(--muted);">${c.department || "Core"}</div>
          </td>
          <td>
            <div>${c.level || "Class"}</div>
            <div style="font-size: 11.5px; color: var(--muted);">${c.period || c.semester || "Term"}</div>
          </td>
          <td>
            <b>${c.totalQuestions || (c.questions ? c.questions.length : 0)}</b> Qs
            ${c.hasExplanations ? `<div style="font-size: 11px; color: var(--success);">★ Explanations</div>` : ""}
          </td>
          <td><span class="badge badge-primary">v${c.version || 1}</span></td>
          <td>${statusBadge}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-outline btn-sm" onclick="editCourse('${c.docId}')">Edit / Update</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  // Mobile Touch Cards Render
  mobileFeed.innerHTML = filtered
    .map((c) => {
      const statusBadge = c.published
        ? `<span class="badge badge-success">✓ Live</span>`
        : `<span class="badge badge-accent">⏳ Pending</span>`;

      return `
        <div class="feed-card">
          <div class="feed-card-header">
            <div>
              <div style="font-size: 15px; font-weight: 700; color: var(--primary);">${c.code} · ${c.title}</div>
              <div style="font-size: 12px; color: var(--muted);">${c.institution}</div>
            </div>
            ${statusBadge}
          </div>
          <div class="feed-card-body">
            <div><b>Class / Level:</b> ${c.level} · ${c.period || c.semester}</div>
            <div><b>Questions:</b> ${c.totalQuestions || 200} Qs (v${c.version || 1}) ${c.hasExplanations ? '· <span style="color: var(--success);">★ Explanations Included</span>' : ''}</div>
          </div>
          <div class="feed-card-footer">
            <span style="font-size: 12px; color: var(--muted);">${c.academicSession || "2025/2026"}</span>
            <button class="btn btn-outline btn-sm" onclick="editCourse('${c.docId}')">Edit / Update</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// Window global for action button
window.editCourse = function (docId) {
  const found = currentCourses.find((c) => c.docId === docId);
  if (!found) return;

  if (found.tier && $("#course-tier")) {
    $("#course-tier").value = found.tier;
    $("#course-tier").dispatchEvent(new Event("change"));
  }

  $("#course-code").value = found.code || "";
  $("#course-title").value = found.title || "";
  $("#course-dept").value = found.department || "";
  $("#course-level").value = found.level || "";
  $("#course-period").value = found.period || found.semester || "";
  $("#course-session").value = found.academicSession || "2025/2026";
  $("#course-price").value = "₦1,000";

  $('[data-tab="tab-upload"]')?.click();
};

// ==========================================
// 5. BULK QUESTION PARSER & PUBLISHING
// ==========================================
function initParser() {
  const textArea = $("#raw-question-text");
  const parseResultBox = $("#parse-results");

  // Load Seed GST 204 Past Questions
  $("#btn-load-seed-gst204")?.addEventListener("click", async () => {
    try {
      const resp = await fetch("seed/gst204.txt");
      if (resp.ok) {
        const txt = await resp.text();
        textArea.value = txt;
        alert("✓ Loaded 203 verified GST 204 past questions into editor! Click 'Check & Test Parse' to inspect.");
      } else {
        alert("Could not load local seed file. Please paste questions directly.");
      }
    } catch (_) {
      alert("Please paste questions directly into the text area.");
    }
  });

  // Load file upload (.txt, .csv, .json)
  $("#file-upload")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) {
      const txt = await file.text();
      textArea.value = txt;
      alert(`Loaded file "${file.name}"!`);
    }
  });

  // Check & Dry Run Parse
  $("#btn-parse-dryrun")?.addEventListener("click", async () => {
    const raw = textArea.value;
    parseResultBox.style.display = "block";
    parseResultBox.innerHTML = "<div class='alert alert-warning'>Parsing questions & evaluating explanations...</div>";

    const result = await parseQuestionBank(raw);
    if (!result.ok) {
      parseResultBox.innerHTML = `<div class='alert alert-danger'>❌ Error: ${result.error}</div>`;
      return;
    }

    lastParsedQuestions = result.questions;
    const sample = result.questions.slice(0, 3);

    parseResultBox.innerHTML = `
      <div class="alert alert-success">
        ✓ Successfully parsed <b>${result.total} questions</b>! Format detected: <b>${result.format}</b>.
        <br>${result.hasExplanations ? '★ <b>Verified Explanations Included</b> (' + result.withExplanationsCount + ' of ' + result.total + ' questions)' : 'ℹ️ Explanations optional (' + result.withExplanationsCount + ' of ' + result.total + ' have explanations)'}
      </div>
      <div style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">Sample Question Preview (First 3):</div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${sample
          .map(
            (q, idx) => `
          <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px;">
            <div style="font-size: 12px; color: var(--muted); font-weight: 700;">Question ${idx + 1} (${q.group || "Q"})</div>
            <p style="font-family: Georgia, serif; font-size: 14.5px; margin: 4px 0 8px;">${q.text}</p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px; font-size: 13px;">
              ${q.options
                .map(
                  (opt) => `
                <div style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: ${
                  opt === q.correctAnswer ? "var(--success-bg)" : "#fff"
                }; color: ${opt === q.correctAnswer ? "var(--success)" : "inherit"}; font-weight: ${
                    opt === q.correctAnswer ? "700" : "normal"
                  }">
                  ${opt === q.correctAnswer ? "✓ " : ""}${opt}
                </div>
              `
                )
                .join("")}
            </div>
            ${q.explanation ? `<div style="margin-top: 8px; font-size: 12px; color: var(--muted); font-style: italic;"><b>Explanation:</b> ${q.explanation}</div>` : ""}
          </div>
        `
          )
          .join("")}
      </div>
    `;
  });

  // Publish to Firestore
  $("#btn-publish-firebase")?.addEventListener("click", async () => {
    if (!currentUser) {
      alert("Please sign in or register first before submitting a question bank.");
      $("#auth-modal").showModal();
      return;
    }

    const raw = textArea.value;
    if (!raw.trim()) {
      alert("Question bank is empty. Please paste questions or click 'Load Sample GST 204'.");
      return;
    }

    const result = await parseQuestionBank(raw);
    if (!result.ok) {
      alert("Parsing failed: " + result.error);
      return;
    }

    const tier = $("#course-tier").value;
    let institution = $("#course-institution").value;
    let isNewInstitutionRequest = false;

    // Handle "+ Add New School" custom request
    if (institution === "__NEW__") {
      const customName = $("#custom-school-name").value.trim();
      const customState = $("#custom-school-state").value.trim();
      if (!customName) {
        alert("Please enter your school or institution's full name.");
        return;
      }
      institution = `${customName}${customState ? " (" + customState + ")" : ""}`;
      isNewInstitutionRequest = true;

      // Log institution request
      try {
        await setDoc(doc(collection(db, "institution_requests")), {
          schoolName: customName,
          state: customState,
          tier: tier,
          requestedBy: currentUser.email,
          requestedAt: serverTimestamp(),
          status: "pending"
        });
      } catch (_) {}
    }

    const department = $("#course-dept").value;
    const level = $("#course-level").value;
    const period = $("#course-period").value;
    const code = $("#course-code").value.trim();
    const title = $("#course-title").value.trim();
    const price = 1000; // Platform standard: ₦1,000 across all educational tiers
    const session = $("#course-session").value.trim() || "2025/2026";

    // Clean Document ID based on Tier, Institution, Level, Period, Code
    const cleanTier = tier.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanCode = code.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanInst = institution.split("(")[0].trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanLevel = level.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanPeriod = period.toLowerCase().replace(/[^a-z0-9]/g, "");
    const docId = `${cleanTier}_${cleanInst}_${cleanLevel}_${cleanPeriod}_${cleanCode}`;

    // Compute Version Increment
    const existing = currentCourses.find((c) => c.docId === docId);
    const nextVersion = existing ? (existing.version || 1) + 1 : 1;

    // Check verification status
    const isSuperAdmin = currentUser.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
    const isVerified = isSuperAdmin || (currentLecturerProfile && currentLecturerProfile.status === "verified");

    const courseDoc = {
      id: cleanCode,
      code,
      title,
      tier,
      institution,
      department,
      level,
      semester: period, // For backwards compatibility with mobile app
      period,
      singleCoursePrice: price,
      totalQuestions: result.total,
      published: isVerified, // Only published live to mobile if verified!
      vettingStatus: isVerified ? "verified" : "pending",
      isFreeTrial: true,
      version: nextVersion,
      hasExplanations: result.hasExplanations || false,
      academicSession: session,
      authorId: existing && existing.authorId ? existing.authorId : currentUser.uid,
      authorEmail: existing && existing.authorEmail ? existing.authorEmail : currentUser.email,
      authorName:
        existing && existing.authorName
          ? existing.authorName
          : (currentUser.displayName || currentUser.email.split("@")[0]),
      currentCuratorId: currentUser.uid,
      currentCuratorEmail: currentUser.email,
      currentCuratorName:
        currentUser.displayName || currentUser.email.split("@")[0],
      revenueShare: {
        lecturerPoolPercent: 70,
        currentCuratorPercent: 80,
        authorPercent: 20,
        olodoPercent: 30
      },
      questions: result.questions,
      lastUpdated: serverTimestamp()
    };

    try {
      $("#btn-publish-firebase").disabled = true;
      $("#btn-publish-firebase").textContent = `Publishing v${nextVersion}...`;

      await setDoc(doc(db, "courses", docId), courseDoc);

      if (isVerified) {
        alert(
          `✓ Success! "${code} - ${title}" (v${nextVersion}, ${result.total} Qs) is now live on the Olodo Mobile App for students in ${institution} · ${level} · ${period}!`
        );
      } else {
        alert(
          `✓ Received! "${code} - ${title}" (v${nextVersion}, ${result.total} Qs) has been submitted for review.\n\nYour question bank is safely stored and will be pushed live to student mobile devices once approved by the Olodo Academic Vetting Board.`
        );
      }

      loadCoursesFromFirestore();
      $('[data-tab="tab-courses"]')?.click();
    } catch (err) {
      alert("Firestore publish error: " + err.message);
    } finally {
      $("#btn-publish-firebase").disabled = false;
      $("#btn-publish-firebase").textContent = "🚀 Publish / Submit for Vetting";
    }
  });
}

// ==========================================
// 5B. AI NOUN CBT EXAM GENERATOR (BATCHED)
// ==========================================
function initAIGenerator() {
  const ai = new AIGenerator();

  const tabAi = $("#btn-tab-ai-generator");
  const tabManual = $("#btn-tab-manual-paste");
  const panelAi = $("#ai-generator-panel");
  const panelManual = $("#manual-paste-panel");

  const contextInput = $("#ai-course-context");
  const rawInput = $("#ai-raw-input");
  const batchSelect = $("#ai-batch-size");
  const startBtn = $("#btn-start-ai-generation");
  const stopBtn = $("#btn-stop-ai-generation");

  const progressBox = $("#ai-progress-box");
  const progressStatus = $("#ai-progress-status");
  const progressPercent = $("#ai-progress-percent");
  const progressBar = $("#ai-progress-bar");
  const progressLog = $("#ai-progress-log");

  const reviewDeck = $("#ai-review-deck");
  const deckCount = $("#ai-deck-count");
  const cardsList = $("#ai-question-cards-list");
  const addQuestionBtn = $("#btn-ai-add-question");
  const applyBtn = $("#btn-ai-apply-to-portal");

  const textArea = $("#raw-question-text");
  const parseResultBox = $("#parse-results");

  // Switch tabs
  tabAi?.addEventListener("click", () => {
    panelAi.style.display = "block";
    panelManual.style.display = "none";
    tabAi.className = "btn btn-primary btn-sm";
    tabManual.className = "btn btn-outline btn-sm";
  });

  tabManual?.addEventListener("click", () => {
    panelAi.style.display = "none";
    panelManual.style.display = "block";
    tabAi.className = "btn btn-outline btn-sm";
    tabManual.className = "btn btn-primary btn-sm";
  });

  // Load Sample NOUN Entries
  $("#btn-load-sample-noun")?.addEventListener("click", () => {
    contextInput.value = "GST 204 / PCR 115: Peace Studies and Conflict Resolution";
    rawInput.value = `"_____ inferred that without conflict we cannot have change"
"Ross (1993)"

"Conflict can be defined as an expressed struggle between at least two _____ parties"
"interdependent"

"_____ defined conflict as a struggle over values or claims to status, power and scarce resources"
"Coser (1956)"

"Conflict is an inevitable aspect of human interaction and an essential feature of _____ life"
"social"

"According to Kriesberg (1973), a conflict relationship exists when two or more parties believe they have _____ goals"
"incompatible"

"_____ view conflict as a breakdown of communication and mutual understanding"
"Burton (1990)"

"Conflict management involves the long-term management of _____ conflicts"
"intractable"

"Conflict resolution refers to terminating conflict by methods that are _____ and constructive"
"analytical"

"_____ asserted that peace is not merely the absence of war, but the presence of justice"
"Martin Luther King Jr."

"The process of de-escalating tension between warring factions is known as conflict _____"
"de-escalation"`;
  });

  // Render question card list in review deck
  function renderQuestionCards() {
    const list = ai.generatedQuestions;
    if (deckCount) {
      deckCount.textContent = `${list.length} questions generated. Review distractors, verbatim text, and explanations before publishing.`;
    }
    cardsList.innerHTML = list.map((q, idx) => `
      <div class="card" style="margin-bottom: 0; background: var(--bg); border: 1.5px solid var(--border); border-radius: 10px; padding: 14px;" data-idx="${idx}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span class="badge badge-primary" style="font-size: 11px;">Question ${idx + 1}</span>
          <button type="button" class="btn btn-outline btn-sm btn-delete-ai-card" data-idx="${idx}" style="color: var(--danger); padding: 2px 8px; font-size: 11px;">✕ Delete</button>
        </div>
        <div class="form-group" style="margin-bottom: 8px;">
          <label style="font-size: 11px; font-weight: 700; color: var(--muted);">Verbatim Question Text:</label>
          <input type="text" class="ai-q-text" data-idx="${idx}" value="${escapeHtml(q.question)}" style="font-size: 13.5px; font-weight: 600; background: #fff;">
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-bottom: 8px;">
          ${q.options.map((opt, optIdx) => {
            const isCorrect = opt === q.answer;
            return `
              <div style="display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: ${isCorrect ? 'var(--success-bg)' : '#fff'}; border: 1.5px solid ${isCorrect ? 'var(--success)' : 'var(--border)'}; border-radius: 8px;">
                <input type="radio" name="ai_ans_${idx}" class="ai-radio-ans" data-idx="${idx}" data-opt="${optIdx}" ${isCorrect ? 'checked' : ''} title="Mark as correct answer">
                <input type="text" class="ai-opt-input" data-idx="${idx}" data-opt="${optIdx}" value="${escapeHtml(opt)}" style="border: none; background: transparent; width: 100%; font-size: 13px; font-weight: ${isCorrect ? '700' : 'normal'}; color: ${isCorrect ? 'var(--success)' : 'inherit'};">
              </div>
            `;
          }).join('')}
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label style="font-size: 11px; font-weight: 700; color: var(--muted);">Explanation:</label>
          <input type="text" class="ai-q-expl" data-idx="${idx}" value="${escapeHtml(q.explanation)}" style="font-size: 12px; font-style: italic; background: #fff;">
        </div>
      </div>
    `).join('');

    // Attach event listeners for inline edits
    cardsList.querySelectorAll('.ai-q-text').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        ai.generatedQuestions[idx].question = e.target.value;
      });
    });

    cardsList.querySelectorAll('.ai-opt-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const optIdx = parseInt(e.target.dataset.opt, 10);
        const oldVal = ai.generatedQuestions[idx].options[optIdx];
        const newVal = e.target.value;
        ai.generatedQuestions[idx].options[optIdx] = newVal;
        if (ai.generatedQuestions[idx].answer === oldVal) {
          ai.generatedQuestions[idx].answer = newVal;
        }
      });
    });

    cardsList.querySelectorAll('.ai-radio-ans').forEach(el => {
      el.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const optIdx = parseInt(e.target.dataset.opt, 10);
        ai.generatedQuestions[idx].answer = ai.generatedQuestions[idx].options[optIdx];
        renderQuestionCards();
      });
    });

    cardsList.querySelectorAll('.ai-q-expl').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        ai.generatedQuestions[idx].explanation = e.target.value;
      });
    });

    cardsList.querySelectorAll('.btn-delete-ai-card').forEach(el => {
      el.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        ai.generatedQuestions.splice(idx, 1);
        renderQuestionCards();
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Start Generation
  startBtn?.addEventListener("click", async () => {
    const raw = rawInput.value.trim();
    if (!raw) {
      alert("Please paste your fill-in-the-blank or Q&A lines into the text box first.");
      rawInput.focus();
      return;
    }

    const key = ai.getApiKey();
    if (!key) {
      alert("Platform AI key is not configured yet. Please paste your GEMINI_API_KEY into js/env.js (or .env).");
      return;
    }

    startBtn.disabled = true;
    startBtn.style.display = "none";
    stopBtn.style.display = "inline-flex";
    progressBox.style.display = "block";
    progressLog.innerHTML = "";
    progressBar.style.width = "0%";
    reviewDeck.style.display = "none";

    const batchSize = parseInt(batchSelect.value, 10) || 10;
    const courseContext = contextInput.value.trim();

    try {
      const results = await ai.runPipeline({
        rawText: raw,
        courseContext,
        batchSize,
        onProgress: ({ batchIndex, totalBatches, percent, statusText }) => {
          progressStatus.textContent = statusText;
          progressPercent.textContent = `${percent}%`;
          progressBar.style.width = `${percent}%`;
        },
        onBatchSuccess: ({ batchIndex, totalBatches, batchResults, totalGenerated }) => {
          progressLog.innerHTML += `<div style="color: var(--success); margin-bottom: 2px;">✓ Batch ${batchIndex + 1}/${totalBatches}: Generated ${batchResults.length} CBT questions (${totalGenerated} total)</div>`;
        },
        onError: (err, batchIndex) => {
          progressLog.innerHTML += `<div style="color: var(--danger); margin-bottom: 2px;">❌ Batch ${batchIndex + 1} Error: ${err.message}</div>`;
        }
      });

      if (results.length > 0) {
        reviewDeck.style.display = "block";
        renderQuestionCards();
        reviewDeck.scrollIntoView({ behavior: "smooth" });
      } else {
        alert("No questions were generated. Please check your Gemini API key and prompt text.");
      }
    } catch (e) {
      alert(`AI Generation Error: ${e.message}`);
    } finally {
      startBtn.disabled = false;
      startBtn.style.display = "inline-flex";
      stopBtn.style.display = "none";
    }
  });

  // Stop Generation
  stopBtn?.addEventListener("click", () => {
    ai.stop();
    stopBtn.textContent = "Stopping...";
    stopBtn.disabled = true;
  });

  // Add Custom Question manually in deck
  addQuestionBtn?.addEventListener("click", () => {
    ai.generatedQuestions.push({
      id: `custom_${Date.now()}`,
      question: "_____ is an example of an academic question.",
      options: ["Correct Answer", "Distractor 1", "Distractor 2", "Distractor 3"],
      answer: "Correct Answer",
      explanation: "Explanation confirming the answer."
    });
    renderQuestionCards();
  });

  // Apply to Question Bank & Prepare for Vetting
  applyBtn?.addEventListener("click", async () => {
    if (ai.generatedQuestions.length === 0) {
      alert("No questions in deck to apply.");
      return;
    }

    // Convert reviewed questions into standard JSON array format
    const formatted = ai.generatedQuestions.map((q, idx) => ({
      id: String(idx + 1),
      text: q.question,
      options: q.options,
      correctAnswer: q.answer,
      group: "General",
      explanation: q.explanation
    }));

    textArea.value = JSON.stringify(formatted, null, 2);

    // Switch to manual view & run dryrun parse
    panelAi.style.display = "none";
    panelManual.style.display = "block";
    tabAi.className = "btn btn-outline btn-sm";
    tabManual.className = "btn btn-primary btn-sm";

    parseResultBox.style.display = "block";
    parseResultBox.innerHTML = "<div class='alert alert-warning'>Verifying AI-generated question bank...</div>";

    const result = await parseQuestionBank(textArea.value);
    if (result.ok) {
      lastParsedQuestions = result.questions;
      parseResultBox.innerHTML = `
        <div class="alert alert-success">
          ✓ Successfully loaded <b>${result.total} AI-generated questions</b> into Question Bank!
          <br>All questions have verified 4-option CBT structure and explanations.
        </div>
      `;
      alert(`✓ Success! ${result.total} AI-generated questions are now loaded and ready. Review the metadata above (Course Code, Title, Level) and click 'Publish / Submit for Vetting' when ready.`);
      $("#btn-publish-firebase")?.scrollIntoView({ behavior: "smooth" });
    } else {
      parseResultBox.innerHTML = `<div class='alert alert-danger'>❌ Error: ${result.error}</div>`;
    }
  });
}

// ==========================================
// 6. SUPER ADMIN SUITE LOGIC
// ==========================================
async function loadAdminData() {
  await Promise.all([
    loadAdminVettingQueue(),
    loadAdminFinancials(),
    loadAdminAnalytics()
  ]);
}

// Load Vetting Queue from Firestore
async function loadAdminVettingQueue() {
  try {
    const snap = await getDocs(collection(db, "lecturers"));
    allLecturers = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    // Count pending
    const pendingCount = allLecturers.filter((l) => (l.status || "pending") === "pending").length;
    const verifiedCount = allLecturers.filter((l) => l.status === "verified").length;

    $("#admin-pending-badge").textContent = pendingCount;
    $("#admin-stat-pending").textContent = pendingCount;
    $("#admin-stat-verified").textContent = verifiedCount;

    // School requests count
    try {
      const schSnap = await getDocs(collection(db, "institution_requests"));
      $("#admin-stat-schools").textContent = schSnap.docs.length;
    } catch (_) {}

    // Pending courses count
    const pendingCourses = currentCourses.filter((c) => !c.published || c.vettingStatus === "pending");
    $("#admin-stat-packs").textContent = pendingCourses.length;

    renderAdminVettingQueue();
  } catch (err) {
    console.warn("Vetting queue load error:", err);
  }
}

// Render Admin Vetting Queue (Desktop Table + Mobile Cards)
function renderAdminVettingQueue() {
  const tableBody = $("#vetting-table-body");
  const mobileFeed = $("#vetting-mobile-feed");
  if (!tableBody || !mobileFeed) return;

  let filtered = allLecturers;
  if (activeVettingFilter === "pending") {
    filtered = allLecturers.filter((l) => (l.status || "pending") === "pending");
  } else if (activeVettingFilter === "verified") {
    filtered = allLecturers.filter((l) => l.status === "verified");
  }

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--muted); padding: 30px;">
          No educators found for filter "${activeVettingFilter}".
        </td>
      </tr>
    `;
    mobileFeed.innerHTML = `
      <div style="text-align: center; color: var(--muted); padding: 24px;">
        No educators found for filter "${activeVettingFilter}".
      </div>
    `;
    return;
  }

  tableBody.innerHTML = filtered
    .map((l) => {
      const statusBadge = l.status === "verified"
        ? `<span class="badge badge-success">✓ Verified</span>`
        : l.status === "rejected"
        ? `<span class="badge badge-danger">✕ Rejected</span>`
        : `<span class="badge badge-accent">⏳ Pending</span>`;

      // Find courses authored by this educator
      const authored = currentCourses.filter((c) => c.authorEmail === l.email || c.currentCuratorEmail === l.email);
      let qCount = 0;
      authored.forEach((c) => qCount += (c.totalQuestions || 0));

      return `
        <tr>
          <td>
            <b>${l.displayName || l.email.split("@")[0]}</b>
            <div style="font-size: 12px; color: var(--muted);">${l.email}</div>
          </td>
          <td>
            <div>${l.institution || "General"}</div>
            <div style="font-size: 11.5px; color: var(--muted);">${l.tier || "Tertiary"}</div>
          </td>
          <td>${l.department || "General"}</td>
          <td><b>${qCount}</b> Qs (${authored.length} packs)</td>
          <td>${statusBadge}</td>
          <td style="font-size: 12px; color: var(--muted);">${l.registeredAt ? "Active" : "Recent"}</td>
          <td>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              ${l.status !== "verified" ? `<button class="btn btn-success btn-sm" onclick="approveEducator('${l.uid}')">✓ Approve</button>` : ""}
              ${l.status !== "rejected" ? `<button class="btn btn-outline btn-sm" style="color: var(--danger); border-color: var(--danger);" onclick="rejectEducator('${l.uid}')">✕ Reject</button>` : ""}
              ${authored.length > 0 ? `<button class="btn btn-outline btn-sm" onclick="previewEducatorCourses('${l.email}')">👁 View Qs</button>` : ""}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  mobileFeed.innerHTML = filtered
    .map((l) => {
      const statusBadge = l.status === "verified"
        ? `<span class="badge badge-success">✓ Verified</span>`
        : l.status === "rejected"
        ? `<span class="badge badge-danger">✕ Rejected</span>`
        : `<span class="badge badge-accent">⏳ Pending</span>`;

      const authored = currentCourses.filter((c) => c.authorEmail === l.email || c.currentCuratorEmail === l.email);
      let qCount = 0;
      authored.forEach((c) => qCount += (c.totalQuestions || 0));

      return `
        <div class="feed-card">
          <div class="feed-card-header">
            <div>
              <div style="font-size: 15px; font-weight: 700;">${l.displayName || l.email.split("@")[0]}</div>
              <div style="font-size: 12px; color: var(--muted);">${l.email}</div>
            </div>
            ${statusBadge}
          </div>
          <div class="feed-card-body">
            <div><b>School / Tier:</b> ${l.institution || "General"} · ${l.tier || "Tertiary"}</div>
            <div><b>Department:</b> ${l.department || "General"}</div>
            <div><b>Questions Uploaded:</b> ${qCount} questions across ${authored.length} packs</div>
          </div>
          <div class="feed-card-footer">
            <div style="display: flex; gap: 6px; width: 100%; flex-wrap: wrap;">
              ${l.status !== "verified" ? `<button class="btn btn-success btn-sm" style="flex: 1;" onclick="approveEducator('${l.uid}')">✓ Approve</button>` : ""}
              ${l.status !== "rejected" ? `<button class="btn btn-outline btn-sm" style="flex: 1; color: var(--danger); border-color: var(--danger);" onclick="rejectEducator('${l.uid}')">✕ Reject</button>` : ""}
              ${authored.length > 0 ? `<button class="btn btn-outline btn-sm" style="flex: 1;" onclick="previewEducatorCourses('${l.email}')">👁 View Qs</button>` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

// Window globals for admin actions
window.approveEducator = async function (uid) {
  if (!confirm("Approve and verify this educator? All their uploaded question packs will immediately be pushed live to student mobile devices.")) return;

  try {
    await setDoc(doc(db, "lecturers", uid), { status: "verified" }, { merge: true });

    // Update their courses to published: true & vettingStatus: 'verified'
    const foundLecturer = allLecturers.find((l) => l.uid === uid);
    if (foundLecturer) {
      const theirCourses = currentCourses.filter((c) => c.authorEmail === foundLecturer.email || c.currentCuratorEmail === foundLecturer.email);
      for (const c of theirCourses) {
        await setDoc(doc(db, "courses", c.docId), { published: true, vettingStatus: "verified" }, { merge: true });
      }
    }

    alert("✓ Educator approved! Their question packs are now live on student mobile devices.");
    loadAdminData();
    loadCoursesFromFirestore();
  } catch (err) {
    alert("Approval error: " + err.message);
  }
};

window.rejectEducator = async function (uid) {
  if (!confirm("Reject this educator application?")) return;

  try {
    await setDoc(doc(db, "lecturers", uid), { status: "rejected" }, { merge: true });
    alert("Educator application marked as rejected.");
    loadAdminData();
  } catch (err) {
    alert("Rejection error: " + err.message);
  }
};

window.previewEducatorCourses = function (email) {
  const modal = $("#preview-modal");
  const modalTitle = $("#preview-modal-title");
  const modalSub = $("#preview-modal-sub");
  const modalContent = $("#preview-modal-content");

  const courses = currentCourses.filter((c) => c.authorEmail === email || c.currentCuratorEmail === email);
  if (courses.length === 0) {
    alert("No question packs found for this educator.");
    return;
  }

  modalTitle.textContent = `${email} · Question Inspection`;
  modalSub.textContent = `${courses.length} question packs available`;

  modalContent.innerHTML = courses
    .map((c) => {
      const sample = (c.questions || []).slice(0, 5);
      return `
        <div style="border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: var(--bg);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <b style="color: var(--primary); font-size: 15px;">${c.code} · ${c.title}</b>
            <span class="badge ${c.published ? "badge-success" : "badge-accent"}">${c.totalQuestions || sample.length} Qs</span>
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 10px;">${c.institution} · ${c.level} · ${c.period || c.semester}</div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${sample
              .map(
                (q, idx) => `
              <div style="background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 10px;">
                <div style="font-size: 11px; color: var(--muted); font-weight: 700;">Q${idx + 1} (${q.group || "G"})</div>
                <div style="font-size: 13.5px; margin: 3px 0;">${q.text}</div>
                <div style="font-size: 12px; color: var(--success); font-weight: 700;">Answer: ${q.correctAnswer}</div>
                ${q.explanation ? `<div style="font-size: 11px; color: var(--muted); font-style: italic; margin-top: 3px;">Note: ${q.explanation}</div>` : ""}
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");

  modal.showModal();
};

// ==========================================
// 7. FINANCIALS LEDGER & PAYSTACK CSV EXPORT
// ==========================================
function loadAdminFinancials() {
  const ledgerTableBody = $("#ledger-table-body");
  const ledgerMobileFeed = $("#ledger-mobile-feed");

  // Simulated student pass ledger across universities & schools
  const mockSubscribers = [
    {
      educatorName: "Dr. Olusegun Adeleke",
      email: "adeleke@unilag.edu.ng",
      school: "University of Lagos (UNILAG)",
      passes: 420,
      bankName: "Guaranty Trust Bank (GTBank)",
      bankCode: "058",
      accountNumber: "0145892301",
      activeShare: 420 * 560, // ₦235,200
      authorShare: 420 * 140, // ₦58,800
      totalPayable: 420 * 700 // ₦294,000
    },
    {
      educatorName: "Prof. Kenneth Nnamdi",
      email: "nnamdi@noun.edu.ng",
      school: "National Open University (NOUN)",
      passes: 310,
      bankName: "First Bank of Nigeria",
      bankCode: "011",
      accountNumber: "2013489204",
      activeShare: 310 * 560,
      authorShare: 310 * 140,
      totalPayable: 310 * 700
    },
    {
      educatorName: "Mrs. Folashade Balogun",
      email: "balogun@kingscollege.edu.ng",
      school: "King's College Lagos (SSS 2)",
      passes: 180,
      bankName: "Zenith Bank",
      bankCode: "057",
      accountNumber: "1019384729",
      activeShare: 180 * 560,
      authorShare: 180 * 140,
      totalPayable: 180 * 700
    }
  ];

  let totalGross = 0;
  let totalEscrow = 0;
  let totalPlatform = 0;

  mockSubscribers.forEach((s) => {
    const gross = s.passes * 1000;
    totalGross += gross;
    totalEscrow += s.totalPayable;
    totalPlatform += (gross * 0.3);
  });

  $("#fin-gross-inflow").textContent = `₦${totalGross.toLocaleString()}`;
  $("#fin-platform-net").textContent = `₦${totalPlatform.toLocaleString()}`;
  $("#fin-escrow-pool").textContent = `₦${totalEscrow.toLocaleString()}`;
  $("#fin-pending-payout").textContent = `₦${totalEscrow.toLocaleString()}`;

  if (ledgerTableBody) {
    ledgerTableBody.innerHTML = mockSubscribers
      .map(
        (s) => `
        <tr>
          <td>
            <b>${s.educatorName}</b>
            <div style="font-size: 11.5px; color: var(--muted);">${s.email}</div>
          </td>
          <td>${s.school}</td>
          <td><b>${s.passes}</b> passes</td>
          <td style="color: var(--success); font-weight: 700;">₦${s.activeShare.toLocaleString()}</td>
          <td style="color: var(--accent); font-weight: 700;">₦${s.authorShare.toLocaleString()}</td>
          <td><b style="font-size: 14px; color: var(--primary);">₦${s.totalPayable.toLocaleString()}</b></td>
          <td style="font-size: 12px;">
            <b>${s.bankName}</b>
            <div style="color: var(--muted); font-family: monospace;">${s.accountNumber}</div>
          </td>
          <td><span class="badge badge-success">Escrow Ready</span></td>
        </tr>
      `
      )
      .join("");
  }

  if (ledgerMobileFeed) {
    ledgerMobileFeed.innerHTML = mockSubscribers
      .map(
        (s) => `
        <div class="feed-card">
          <div class="feed-card-header">
            <div>
              <div style="font-size: 14.5px; font-weight: 700;">${s.educatorName}</div>
              <div style="font-size: 12px; color: var(--muted);">${s.school}</div>
            </div>
            <span class="badge badge-success">₦${s.totalPayable.toLocaleString()}</span>
          </div>
          <div class="feed-card-body">
            <div><b>Subscribed Passes:</b> ${s.passes} student passes</div>
            <div><b>Settlement Account:</b> ${s.bankName} (${s.accountNumber})</div>
            <div style="font-size: 11.5px; color: var(--muted); margin-top: 4px;">
              Active Cut (80%): ₦${s.activeShare.toLocaleString()} · Author Cut (20%): ₦${s.authorShare.toLocaleString()}
            </div>
          </div>
        </div>
      `
      )
      .join("");
  }

  // Paystack Bulk Transfer CSV Export
  $("#btn-export-paystack-csv")?.addEventListener("click", () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Recipient Name,Account Number,Bank Code,Bank Name,Amount (NGN),Currency,Narration\n";

    mockSubscribers.forEach((s) => {
      csvContent += `"${s.educatorName}","${s.accountNumber}","${s.bankCode}","${s.bankName}",${s.totalPayable},NGN,"Olodo Bi-Weekly Educator Royalties"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Olodo_Paystack_Bulk_Disbursement_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

// ==========================================
// 8. NATIONWIDE BUSINESS ANALYTICS
// ==========================================
function loadAdminAnalytics() {
  let totalQuestions = 0;
  let questionsWithExpl = 0;
  const schoolSet = new Set();
  const tierCount = { tertiary: 0, senior_sec: 0, junior_sec: 0, primary: 0, national: 0 };

  currentCourses.forEach((c) => {
    const qCount = c.totalQuestions || (c.questions ? c.questions.length : 0);
    totalQuestions += qCount;
    if (c.hasExplanations) questionsWithExpl += qCount;
    if (c.institution) schoolSet.add(c.institution);
    const t = c.tier || "tertiary";
    tierCount[t] = (tierCount[t] || 0) + 1;
  });

  const qualityIndex = totalQuestions > 0 ? Math.round((questionsWithExpl / totalQuestions) * 100) : 75;

  $("#ana-total-questions").textContent = totalQuestions.toLocaleString();
  $("#ana-active-schools").textContent = schoolSet.size || 5;
  $("#ana-quality-index").textContent = `${qualityIndex}%`;
  $("#ana-conv-rate").textContent = "38.4%";

  // Tier Breakdown rendering
  const tierBox = $("#analytics-tier-breakdown");
  if (tierBox) {
    tierBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border);">
        <span>🎓 Tertiary (Universities & Polytechnics)</span>
        <b>${tierCount.tertiary || 1} banks</b>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border);">
        <span>🏫 Senior Secondary (SSS 1 - 3)</span>
        <b>${tierCount.senior_sec || 0} banks</b>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border);">
        <span>🎒 Junior Secondary (JSS 1 - 3)</span>
        <b>${tierCount.junior_sec || 0} banks</b>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border);">
        <span>✏️ Primary School (Basic 1 - 6)</span>
        <b>${tierCount.primary || 0} banks</b>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px;">
        <span>🇳🇬 National Exam Prep (JAMB / WAEC)</span>
        <b>${tierCount.national || 0} banks</b>
      </div>
    `;
  }

  // Courses Leaderboard
  const leaderBox = $("#analytics-courses-leaderboard");
  if (leaderBox) {
    leaderBox.innerHTML = currentCourses
      .slice(0, 5)
      .map(
        (c, idx) => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border);">
          <div>
            <b>#${idx + 1} ${c.code} · ${c.title}</b>
            <div style="font-size: 11.5px; color: var(--muted);">${c.institution}</div>
          </div>
          <span class="badge badge-success">${c.totalQuestions || 203} Qs Live</span>
        </div>
      `
      )
      .join("");
  }
}

// ==========================================
// 9. COURSE HANDOVER & SUCCESSION
// ==========================================
function initHandover() {
  $("#btn-confirm-handover")?.addEventListener("click", async () => {
    const docId = $("#handover-course-select").value;
    const successorEmail = $("#handover-successor-email").value.trim();
    const successorName = $("#handover-successor-name").value.trim() || successorEmail.split("@")[0];
    const newSession = $("#handover-new-session").value.trim() || "2026/2027";
    const resultBox = $("#handover-result");

    if (!docId) {
      alert("Please select a course / subject to hand over.");
      return;
    }
    if (!successorEmail || !successorEmail.includes("@")) {
      alert("Please enter a valid successor email address.");
      return;
    }

    try {
      resultBox.innerHTML = "<span style='color: var(--muted);'>Processing coordination transfer in Firestore...</span>";

      await setDoc(
        doc(db, "courses", docId),
        {
          currentCuratorEmail: successorEmail,
          currentCuratorName: successorName,
          academicSession: newSession,
          lastUpdated: serverTimestamp()
        },
        { merge: true }
      );

      resultBox.innerHTML = `
        <div class="alert alert-success">
          ✓ Handover Complete! <b>${successorName}</b> (${successorEmail}) is now assigned as active coordinator for Session <b>${newSession}</b>.
          <br>They will receive 80% (₦560 per student pass), and you will continue receiving 20% (₦140 per student pass) as original creator.
        </div>
      `;
      loadCoursesFromFirestore();
    } catch (err) {
      resultBox.innerHTML = `<div class="alert alert-danger">Error: ${err.message}</div>`;
    }
  });
}

// ==========================================
// 10. MULTI-TIER ROYALTY CALCULATOR & BANK SETUP
// ==========================================
function initSimulatorAndBank() {
  const simSlider = $("#sim-class-size");
  const simTier = $("#sim-tier-select");
  const simVal = $("#sim-class-size-val");
  const simTotal = $("#sim-total-rev");
  const simActive = $("#sim-active-cut");
  const simAuthor = $("#sim-author-cut");
  const simPlatform = $("#sim-platform-cut");

  function updateSim() {
    if (!simSlider) return;
    const students = parseInt(simSlider.value, 10);
    simVal.textContent = `${students} students`;

    const tierKey = simTier ? simTier.value : "tertiary";
    let passPrice = 1000;
    if (tierKey === "primary") passPrice = 800;
    else if (tierKey === "national") passPrice = 1500;

    const total = students * passPrice;
    const pool = total * 0.70;
    const activeCut = pool * 0.80;
    const authorCut = pool * 0.20;
    const platformCut = total * 0.30;

    simTotal.textContent = `₦${Math.round(total).toLocaleString()}`;
    simActive.textContent = `₦${Math.round(activeCut).toLocaleString()}`;
    simAuthor.textContent = `₦${Math.round(authorCut).toLocaleString()}`;
    simPlatform.textContent = `₦${Math.round(platformCut).toLocaleString()}`;

    $("#stat-earnings").textContent = `₦${Math.round(activeCut).toLocaleString()}`;
  }

  simSlider?.addEventListener("input", updateSim);
  simTier?.addEventListener("change", updateSim);
  updateSim();

  // Save bank details locally & in Firestore if logged in
  $("#btn-save-bank")?.addEventListener("click", async () => {
    const bank = $("#bank-name").value;
    const num = $("#bank-account-num").value.trim();
    const name = $("#bank-account-name").value.trim();

    if (!num || num.length !== 10) {
      alert("Please enter a valid 10-digit NUBAN account number.");
      return;
    }
    if (!name) {
      alert("Please enter account holder name.");
      return;
    }

    localStorage.setItem("olodo_lecturer_bank", JSON.stringify({ bank, num, name }));

    if (currentUser) {
      try {
        await setDoc(doc(db, "lecturers", currentUser.uid), {
          settlementBank: { bank, num, name }
        }, { merge: true });
      } catch (_) {}
    }

    $("#bank-save-msg").innerHTML = `
      <div class="alert alert-success">
        ✓ Settlement details saved successfully. Next bi-weekly payout will be remitted directly to ${bank} - ${num} (${name}).
      </div>
    `;
  });

  const savedBank = localStorage.getItem("olodo_lecturer_bank");
  if (savedBank) {
    try {
      const b = JSON.parse(savedBank);
      if ($("#bank-name")) $("#bank-name").value = b.bank || "Access Bank";
      if ($("#bank-account-num")) $("#bank-account-num").value = b.num || "";
      if ($("#bank-account-name")) $("#bank-account-name").value = b.name || "";
    } catch (_) {}
  }
}

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initTierControls();
  initAuth();
  initParser();
  initAIGenerator();
  initHandover();
  initSimulatorAndBank();
});
