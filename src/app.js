import { DSR_CURATED } from './dsr_curated.js';
import { SiteSketcher } from './sketcher.js';
import { exportToPDF, formatIndianCurrency, numberToIndianWords } from './pdf.js';
import { 
  auth, 
  loginUser, 
  registerUser, 
  logoutUser, 
  onAuthStateChanged,
  fetchUserProjects,
  saveUserProject,
  deleteUserProject,
  fetchUserCustomDsr,
  saveUserCustomDsr,
  fetchUserPdfTemplate,
  saveUserPdfTemplate
} from './firebase.js';

// Application State
let projects = [];
let activeProject = null;
let activeEntry = null;
let originalEntryCopy = null;
let customDsrCatalog = [];
let gpsTraceNodes = [];
let sketcher = null;
let isNewEntryMode = false;

const DEFAULT_NB_NOTE = `This estimate has been prepared as per Addl. District Commissioner cum Competent Authority (LA), Golaghat vide order No. 2/2023/KNP-NK-37/ Dtd. Golaghat the 8th Dec'2025. The area to be acquisitioned for proposed implementation of wildlife-friendly measures proposed on Kaziranga National Park (KNP) stretch of NH-37 from Kaliabor (Ch. 315+315) to Numaligarh (Ch. 402+300) of NH-37 (New NH-715) under Golaghat District was shown by the Revenue & NHAI Officials during the Joint Survey. The above mentioned particulars of Occupier is subjected to be verified by Competent Authority. The application of the valuation estimate is the discretion of the Competent Authority.`;

// DOM Elements
const views = {
  dashboard: document.getElementById('view-dashboard'),
  projectDetails: document.getElementById('view-project-details'),
  projectEditor: document.getElementById('view-project-editor'),
  editor: document.getElementById('view-editor'),
  settings: document.getElementById('view-settings'),
  pdfTemplate: document.getElementById('view-pdf-template')
};

const navBtns = {
  dashboard: document.getElementById('nav-projects-btn'),
  newProject: document.getElementById('nav-new-project-btn'),
  settings: document.getElementById('nav-settings-btn'),
  pdfTemplate: document.getElementById('nav-pdf-template-btn')
};

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  setupAuthUI();
  setupNavigation();
  setupDashboard();
  setupProjectDetails();
  setupProjectEditor();
  setupEditor();
  setupDsrSettings();
  setupGpsTracingModal();
  setupTheme();

  // Mobile Navigation toggle
  const openMenuBtn = document.getElementById('mobile-menu-open-btn');
  const closeMenuBtn = document.getElementById('mobile-menu-close-btn');
  const asideElement = document.querySelector('aside');

  if (openMenuBtn && asideElement) {
    openMenuBtn.addEventListener('click', () => {
      asideElement.classList.add('active');
    });
  }

  if (closeMenuBtn && asideElement) {
    closeMenuBtn.addEventListener('click', () => {
      asideElement.classList.remove('active');
    });
  }

  const navButtons = document.querySelectorAll('aside nav button');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        asideElement.classList.remove('active');
      }
    });
  });

  const authOverlay = document.getElementById('auth-overlay');
  const sidebarProfile = document.getElementById('sidebar-user-profile');
  const userEmailDisplay = document.getElementById('user-email-display');

  const urlParams = new URLSearchParams(window.location.search);
  const isTestMode = urlParams.get('test') === 'true';

  if (isTestMode) {
    console.log("Running in test mode. Bypassing Firebase Auth...");
    authOverlay.style.display = 'none';
    sidebarProfile.style.display = 'flex';
    userEmailDisplay.innerText = 'test@valuroad.com';
    loadProjects();
    loadCustomDsrCatalog();
    renderProjects();
    updateGlobalMetrics();
    setupPdfTemplate();
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    const userEmailDisplay = document.getElementById('user-email-display');
    const authSubmitBtn = document.getElementById('auth-submit-btn');

    if (user) {
      // User is logged in
      authOverlay.style.display = 'none';
      sidebarProfile.style.display = 'flex';
      userEmailDisplay.innerText = user.email;
      
      // Reset submit button state
      authSubmitBtn.disabled = false;

      console.log(`User logged in: ${user.email}. Syncing from Cloud...`);
      
      try {
        // Fetch projects
        projects = await fetchUserProjects(user.uid);
        saveProjects(); // cache locally
        renderProjects();
        updateGlobalMetrics();

        // Fetch custom DSR catalog
        customDsrCatalog = await fetchUserCustomDsr(user.uid);
        saveCustomDsrCatalog(); // cache locally

        // Fetch PDF template settings
        const tplSettings = await fetchUserPdfTemplate(user.uid);
        if (tplSettings) {
          localStorage.setItem(PDF_TEMPLATE_KEY, JSON.stringify(tplSettings));
        }
        setupPdfTemplate(); // redraw template settings fields
      } catch (e) {
        console.error("Sync Error:", e);
      }
    } else {
      // User is logged out
      authOverlay.style.display = 'flex';
      sidebarProfile.style.display = 'none';
      
      // Clear app state
      projects = [];
      activeProject = null;
      activeEntry = null;
      customDsrCatalog = [];
      
      localStorage.removeItem('projects');
      localStorage.removeItem('customDsrCatalog');
      localStorage.removeItem(PDF_TEMPLATE_KEY);

      renderProjects();
      updateGlobalMetrics();
      setupPdfTemplate();

      switchView('dashboard');
    }
  });

  // Render initial dashboard
  renderProjects();
  switchView('dashboard');
  
  // Create icons
  lucide.createIcons();
});

// Setup Light/Dark Theme
function setupTheme() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (!toggleBtn) return;
  
  // Load saved theme
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  toggleBtn.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
  });
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (!icon) return;
  if (theme === 'dark') {
    icon.setAttribute('data-lucide', 'sun');
  } else {
    icon.setAttribute('data-lucide', 'moon');
  }
  lucide.createIcons();
}

// Router Navigation
function setupNavigation() {
  if (navBtns.dashboard) {
    navBtns.dashboard.addEventListener('click', () => {
      if (confirmLeaveEditor()) switchView('dashboard');
    });
  }
  if (navBtns.newProject) {
    navBtns.newProject.addEventListener('click', () => {
      if (confirmLeaveEditor()) initNewProject();
    });
  }
  if (navBtns.settings) {
    navBtns.settings.addEventListener('click', () => {
      if (confirmLeaveEditor()) switchView('settings');
    });
  }
  if (navBtns.pdfTemplate) {
    navBtns.pdfTemplate.addEventListener('click', () => {
      if (confirmLeaveEditor()) switchView('pdfTemplate');
    });
  }
}

function switchView(viewName) {
  Object.keys(navBtns).forEach(key => {
    if (navBtns[key]) {
      if (key === viewName) {
        navBtns[key].classList.add('active');
      } else {
        navBtns[key].classList.remove('active');
      }
    }
  });

  Object.keys(views).forEach(key => {
    if (views[key]) {
      if (key === viewName) {
        views[key].classList.add('active');
      } else {
        views[key].classList.remove('active');
      }
    }
  });

  if (viewName === 'dashboard') {
    renderProjects();
  } else if (viewName === 'projectDetails') {
    renderProjectDetails();
  } else if (viewName === 'editor') {
    setTimeout(() => {
      if (sketcher) sketcher.draw();
    }, 100);
  }
}

function confirmLeaveEditor() {
  if (views.editor.classList.contains('active') && activeEntry && activeEntry.status === 'draft') {
    return confirm('You have unsaved changes. Are you sure you want to leave?');
  }
  return true;
}

// Auth UI Setup & Handlers
let currentAuthTab = 'login'; // 'login' or 'signup'

function setupAuthUI() {
  const authTabLogin = document.getElementById('auth-tab-login');
  const authTabSignup = document.getElementById('auth-tab-signup');
  const authForm = document.getElementById('auth-form');
  const authEmailInput = document.getElementById('auth-email');
  const authPasswordInput = document.getElementById('auth-password');
  const authSubmitBtn = document.getElementById('auth-submit-btn');
  const authErrorMsg = document.getElementById('auth-error-msg');
  const logoutBtn = document.getElementById('auth-logout-btn');

  if (authTabLogin) {
    authTabLogin.addEventListener('click', () => {
      currentAuthTab = 'login';
      authTabLogin.style.background = 'var(--bg-primary)';
      authTabLogin.style.fontWeight = '600';
      authTabLogin.style.color = 'var(--text-primary)';
      authTabSignup.style.background = 'transparent';
      authTabSignup.style.fontWeight = '500';
      authTabSignup.style.color = 'var(--text-secondary)';
      authSubmitBtn.textContent = 'Log In';
      authErrorMsg.style.display = 'none';
    });
  }

  if (authTabSignup) {
    authTabSignup.addEventListener('click', () => {
      currentAuthTab = 'signup';
      authTabSignup.style.background = 'var(--bg-primary)';
      authTabSignup.style.fontWeight = '600';
      authTabSignup.style.color = 'var(--text-primary)';
      authTabLogin.style.background = 'transparent';
      authTabLogin.style.fontWeight = '500';
      authTabLogin.style.color = 'var(--text-secondary)';
      authSubmitBtn.textContent = 'Create Account';
      authErrorMsg.style.display = 'none';
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = authEmailInput.value.trim();
      const password = authPasswordInput.value;
      
      authErrorMsg.style.display = 'none';
      authSubmitBtn.disabled = true;
      const origText = authSubmitBtn.textContent;
      authSubmitBtn.textContent = 'Please wait...';

      try {
        if (currentAuthTab === 'login') {
          await loginUser(email, password);
        } else {
          await registerUser(email, password);
        }
      } catch (err) {
        console.error(err);
        authErrorMsg.textContent = formatAuthError(err.code || err.message);
        authErrorMsg.style.display = 'block';
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = origText;
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to log out?')) {
        try {
          await logoutUser();
        } catch (err) {
          console.error("Logout Error:", err);
        }
      }
    });
  }
}

function formatAuthError(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password.';
    case 'auth/email-already-in-use':
      return 'This email address is already in use.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    default:
      return code.replace('auth/', '').replace(/-/g, ' ');
  }
}

// LocalStorage helpers
function loadProjects() {
  try {
    projects = JSON.parse(localStorage.getItem('projects')) || [];
  } catch (e) {
    projects = [];
  }
}

function saveProjects() {
  localStorage.setItem('projects', JSON.stringify(projects));
}

function loadCustomDsrCatalog() {
  try {
    customDsrCatalog = JSON.parse(localStorage.getItem('customDsrCatalog')) || [];
  } catch (e) {
    customDsrCatalog = [];
  }
}

function saveCustomDsrCatalog() {
  localStorage.setItem('customDsrCatalog', JSON.stringify(customDsrCatalog));
}

// Project Dashboard View
function setupDashboard() {
  const createBtn = document.getElementById('dash-create-project-btn');
  if (createBtn) {
    createBtn.addEventListener('click', () => initNewProject());
  }
  
  const searchInput = document.getElementById('project-search');
  if (searchInput) {
    searchInput.addEventListener('input', renderProjects);
  }
}

function renderProjects() {
  const searchInput = document.getElementById('project-search');
  const searchQuery = searchInput ? searchInput.value.toLowerCase() : '';
  const tbody = document.getElementById('projects-list-body');
  const emptyState = document.getElementById('projects-empty-state');
  const table = document.getElementById('projects-table');

  const filtered = projects.filter(p => {
    return (p.workName || '').toLowerCase().includes(searchQuery) ||
           (p.location || '').toLowerCase().includes(searchQuery);
  });

  tbody.innerHTML = '';
  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    table.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    table.style.display = 'table';

    filtered.forEach(p => {
      const tr = document.createElement('tr');
      const entriesCount = p.entries ? p.entries.length : 0;
      const totalValuation = p.entries ? p.entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0) : 0;

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; font-size: 0.95rem;">${p.workName || 'Untitled Project'}</div>
        </td>
        <td>
          <div style="color: var(--text-muted); font-size: 0.85rem;">${p.location || 'N/A'}</div>
        </td>
        <td style="text-align: center; font-weight: 500;">${entriesCount}</td>
        <td style="font-weight: bold; color: var(--accent);">Rs. ${formatIndianCurrency(totalValuation)}</td>
        <td>
          <div class="action-btns" onclick="event.stopPropagation();">
            <button class="view-btn" title="View Project Details" data-id="${p.id}"><i data-lucide="eye"></i></button>
            <button class="delete-btn" title="Delete Project" data-id="${p.id}" style="color: var(--danger);"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      `;

      tr.addEventListener('click', () => {
        openProjectDetails(p.id);
      });
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => openProjectDetails(btn.dataset.id));
    });
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteProject(btn.dataset.id));
    });

    lucide.createIcons();
  }

  updateGlobalMetrics();
}

function updateGlobalMetrics() {
  const totalProjects = projects.length;
  let totalOwners = 0;
  let completedOwners = 0;
  let cumulativeValuation = 0;

  projects.forEach(p => {
    if (p.entries) {
      totalOwners += p.entries.length;
      p.entries.forEach(e => {
        if (e.status === 'completed') {
          completedOwners++;
        }
        cumulativeValuation += e.grandTotal || 0;
      });
    }
  });

  const totalProjEl = document.getElementById('metric-total-projects');
  const totalOwnEl = document.getElementById('metric-total-owners');
  const compOwnEl = document.getElementById('metric-completed-owners');
  const cumValEl = document.getElementById('metric-cumulative-valuation');

  if (totalProjEl) totalProjEl.innerText = totalProjects;
  if (totalOwnEl) totalOwnEl.innerText = totalOwners;
  if (compOwnEl) compOwnEl.innerText = completedOwners;
  if (cumValEl) cumValEl.innerText = 'Rs. ' + formatIndianCurrency(cumulativeValuation);
}

function deleteProject(id) {
  if (confirm('Are you sure you want to delete this infrastructure project? This will delete all affected owner entries under it.')) {
    projects = projects.filter(p => p.id !== id);
    saveProjects();
    if (auth.currentUser) {
      deleteUserProject(auth.currentUser.uid, id).catch(err => console.error("Error deleting project from Firestore:", err));
    }
    renderProjects();
  }
}

function openProjectDetails(projectId) {
  const p = projects.find(proj => proj.id === projectId);
  if (!p) return;
  activeProject = p;
  switchView('projectDetails');
}

// Project Details Dashboard View
function setupProjectDetails() {
  document.getElementById('project-back-btn').addEventListener('click', () => {
    switchView('dashboard');
  });

  document.getElementById('project-edit-work-btn').addEventListener('click', () => {
    if (activeProject) {
      editProject(activeProject.id);
    }
  });

  document.getElementById('project-add-owner-btn').addEventListener('click', () => {
    if (activeProject) {
      initNewOwnerEntry();
    }
  });
}

function renderProjectDetails() {
  if (!activeProject) return;

  document.getElementById('project-details-work-title').innerText = activeProject.workName || 'Untitled Project';
  document.getElementById('project-details-location').innerText = activeProject.location || 'N/A';

  const tbody = document.getElementById('owner-entries-list-body');
  const emptyState = document.getElementById('owner-entries-empty-state');
  const table = document.getElementById('owner-entries-table');

  const entries = activeProject.entries || [];

  tbody.innerHTML = '';
  if (entries.length === 0) {
    emptyState.style.display = 'flex';
    table.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    table.style.display = 'table';

    entries.forEach(e => {
      const tr = document.createElement('tr');
      const gpsText = e.gpsLat && e.gpsLon ? `${parseFloat(e.gpsLat).toFixed(4)}, ${parseFloat(e.gpsLon).toFixed(4)}` : 'No GPS';
      
      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; font-size: 0.95rem;">${e.clientName || 'Unnamed Owner'}</div>
        </td>
        <td>${e.location || 'N/A'}</td>
        <td style="font-family: monospace; font-size: 0.85rem;">${gpsText}</td>
        <td style="font-weight: bold; color: var(--accent);">Rs. ${formatIndianCurrency(e.grandTotal || 0)}</td>
        <td><span class="status-badge ${e.status}">${e.status}</span></td>
        <td>
          <div class="action-btns" onclick="event.stopPropagation();">
            <button class="edit-btn" title="Edit Owner Valuation" data-id="${e.id}"><i data-lucide="edit-2"></i></button>
            <button class="pdf-btn" title="Export PDF" data-id="${e.id}"><i data-lucide="file-down"></i></button>
            <button class="delete-btn" title="Delete Owner Entry" data-id="${e.id}" style="color: var(--danger);"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      `;

      tr.addEventListener('click', () => {
        editOwnerEntry(e.id);
      });
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => editOwnerEntry(btn.dataset.id));
    });
    tbody.querySelectorAll('.pdf-btn').forEach(btn => {
      btn.addEventListener('click', () => runPdfExport(btn.dataset.id));
    });
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteOwnerEntry(btn.dataset.id));
    });

    lucide.createIcons();
  }

  updateProjectMetrics();
}

function updateProjectMetrics() {
  if (!activeProject) return;

  const entries = activeProject.entries || [];
  const totalOwners = entries.length;
  const completedOwners = entries.filter(e => e.status === 'completed').length;
  const totalCost = entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0);

  document.getElementById('proj-metric-owners').innerText = totalOwners;
  document.getElementById('proj-metric-completed').innerText = completedOwners;
  document.getElementById('proj-metric-cost').innerText = 'Rs. ' + formatIndianCurrency(totalCost);
}

function deleteOwnerEntry(id) {
  if (confirm('Are you sure you want to delete this owner entry? This cannot be undone.')) {
    activeProject.entries = activeProject.entries.filter(e => e.id !== id);
    saveProjects();
    if (auth.currentUser) {
      saveUserProject(auth.currentUser.uid, activeProject).catch(err => console.error("Error saving project to Firestore:", err));
    }
    renderProjectDetails();
  }
}

// Project Creator/Editor View
function setupProjectEditor() {
  document.getElementById('proj-editor-cancel-btn').addEventListener('click', () => {
    if (activeProject && activeProject.workName) {
      openProjectDetails(activeProject.id);
    } else {
      switchView('dashboard');
    }
  });

  document.getElementById('proj-editor-save-btn').addEventListener('click', saveProject);
}

function initNewProject() {
  activeProject = {
    id: 'PROJ_' + Date.now(),
    workName: '',
    location: '',
    nbNote: DEFAULT_NB_NOTE,
    entries: []
  };
  document.getElementById('proj-editor-title').innerText = 'Create Project';
  document.getElementById('proj-work-name').value = '';
  document.getElementById('proj-location').value = '';
  document.getElementById('proj-nb-note').value = DEFAULT_NB_NOTE;
  switchView('projectEditor');
}

function editProject(id) {
  const p = projects.find(proj => proj.id === id);
  if (!p) return;
  activeProject = p;
  document.getElementById('proj-editor-title').innerText = 'Edit Project Details';
  document.getElementById('proj-work-name').value = activeProject.workName || '';
  document.getElementById('proj-location').value = activeProject.location || '';
  document.getElementById('proj-nb-note').value = activeProject.nbNote || '';
  switchView('projectEditor');
}

function saveProject() {
  const workName = document.getElementById('proj-work-name').value.trim();
  const location = document.getElementById('proj-location').value.trim();
  const nbNote = document.getElementById('proj-nb-note').value.trim();

  if (!workName) {
    alert('Please enter a Project Work Name / Scheme Description.');
    return;
  }

  activeProject.workName = workName;
  activeProject.location = location;
  activeProject.nbNote = nbNote;

  const idx = projects.findIndex(p => p.id === activeProject.id);
  if (idx > -1) {
    projects[idx] = activeProject;
  } else {
    if (!activeProject.entries) activeProject.entries = [];
    projects.push(activeProject);
  }

  saveProjects();
  if (auth.currentUser) {
    saveUserProject(auth.currentUser.uid, activeProject).catch(err => console.error("Error saving project to Firestore:", err));
  }
  openProjectDetails(activeProject.id);
}

// Affected Owner Valuation Editor
function setupEditor() {
  document.getElementById('editor-back-btn').addEventListener('click', () => {
    if (confirmLeaveEditor()) {
      isNewEntryMode = false;
      if (activeProject) {
        openProjectDetails(activeProject.id);
      } else {
        switchView('dashboard');
      }
    }
  });

  document.getElementById('gps-tag-btn').addEventListener('click', captureGPS);

  document.getElementById('add-quantity-item-btn').addEventListener('click', () => addItem('quantity-rate'));
  document.getElementById('add-plinth-item-btn').addEventListener('click', () => addItem('plinth-area'));
  document.getElementById('add-lumpsum-item-btn').addEventListener('click', () => addItem('lump-sum'));

  document.getElementById('editor-save-draft-btn').addEventListener('click', () => {
    saveActiveEntry('draft');
    alert('Draft saved successfully!');
    if (activeProject) openProjectDetails(activeProject.id);
  });

  document.getElementById('editor-modify-btn').addEventListener('click', () => {
    toggleInputsLock(false);
    document.getElementById('editor-modify-btn').style.display = 'none';
    document.getElementById('editor-complete-btn').style.display = 'inline-flex';
    document.getElementById('editor-complete-btn').innerHTML = '<i data-lucide="check-square"></i> Save Modifications';
    document.getElementById('editor-export-pdf-btn').style.display = 'inline-flex';
    document.getElementById('editor-title').innerText = 'Edit Finalized Valuation';
    lucide.createIcons();
  });

  document.getElementById('add-custom-service-btn').addEventListener('click', () => {
    if (!activeEntry.customServices) activeEntry.customServices = [];
    const newCs = {
      id: 'CS_' + Date.now() + Math.random().toString(36).substr(2, 5),
      description: '',
      cost: 0
    };
    activeEntry.customServices.push(newCs);
    renderCustomServiceRow(newCs);
    calculateAndRenderTotals();
  });

  const toggleElec = document.getElementById('toggle-electrification');
  const toggleSani = document.getElementById('toggle-sanitary');
  const inputElec = document.getElementById('electrification-cost');
  const inputSani = document.getElementById('sanitary-cost');

  toggleElec.addEventListener('change', () => {
    inputElec.style.display = toggleElec.checked ? 'block' : 'none';
    calculateAndRenderTotals();
  });
  toggleSani.addEventListener('change', () => {
    inputSani.style.display = toggleSani.checked ? 'block' : 'none';
    calculateAndRenderTotals();
  });

  inputElec.addEventListener('input', calculateAndRenderTotals);
  inputSani.addEventListener('input', calculateAndRenderTotals);

  // Bind live calculations to inputs
  document.getElementById('construction-year').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('construction-year-comment').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('valuation-year').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('depreciation-pct').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('client-name').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('location').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('inspection-date').addEventListener('change', calculateAndRenderTotals);
  document.getElementById('road-width').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('residual-life').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('construction-class').addEventListener('change', calculateAndRenderTotals);

  // Checkboxes
  const infraCheckboxes = ['infra-electricity', 'infra-water', 'infra-sewer', 'infra-drainage', 'infra-lighting'];
  infraCheckboxes.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', calculateAndRenderTotals);
  });

  setupSketcherToolbar();
  setupImageUploader();

  const inputLabel      = document.getElementById('prop-input-label');
  const inputWidth      = document.getElementById('prop-input-width');
  const inputHeight     = document.getElementById('prop-input-height');
  const inputLeft       = document.getElementById('prop-input-left');
  const inputRight      = document.getElementById('prop-input-right');
  const inputStructType = document.getElementById('prop-input-structure-type');
  const inputDimLabel   = document.getElementById('prop-input-dim-label');
  const inputBlockStyle = document.getElementById('prop-input-block-style');

  const updateSelectedShape = () => {
    if (!sketcher || !sketcher.selectedShape) return;
    const s = sketcher.selectedShape;

    // Helper: parse "12.5m", "12.5", "12 m" → 12.5 (metres)
    const parseM = (str) => {
      const n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
      return isFinite(n) && n > 0.05 ? n : null;
    };

    if (s.type === 'building' || s.type === 'polygon-building') {
      s.structureType = inputStructType.value;
      if (s.structureType === 'rcc')           s.label = 'RCC Building';
      else if (s.structureType === 'assam')    s.label = 'Assam Type Building';
      else if (s.structureType === 'temp-building') s.label = 'Temporary Building';
      else if (s.structureType === 'temp-shed') s.label = 'Temp Shed';
      else                                     s.label = inputLabel.value;
      inputLabel.value = s.label;
      // Sync width/height → actual shape size
      const wVal = parseM(inputWidth.value);
      const hVal = parseM(inputHeight.value);
      if (wVal !== null) { s.w = wVal; s.dimW = `${wVal.toFixed(2)}m`; } else { s.dimW = inputWidth.value; }
      if (hVal !== null) { s.h = hVal; s.dimH = `${hVal.toFixed(2)}m`; } else { s.dimH = inputHeight.value; }
    } else if (s.type === 'custom-block') {
      s.blockStyle = inputBlockStyle.value;
      s.label = inputLabel.value;
      const wVal = parseM(inputWidth.value);
      const hVal = parseM(inputHeight.value);
      if (wVal !== null) { s.w = wVal; s.dimW = `${wVal.toFixed(2)}m`; } else { s.dimW = inputWidth.value; }
      if (hVal !== null) { s.h = hVal; s.dimH = `${hVal.toFixed(2)}m`; } else { s.dimH = inputHeight.value; }
    } else if (s.type === 'road') {
      s.label = inputLabel.value;
      s.leftLabel = inputLeft.value;
      s.rightLabel = inputRight.value;
    } else if (s.type === 'text') {
      s.text = inputLabel.value;
    } else if (s.type === 'boundary-wall' || s.type === 'gate' || s.type === 'gate-toran' || s.type === 'wall') {
      s.label = inputLabel.value;
      s.dimLabel = inputDimLabel.value;
    } else if (s.type === 'dimension') {
      s.manualLabel = inputDimLabel.value;
      s.label = s.manualLabel || s.label;
    } else if (s.type === 'room') {
      s.label = inputLabel.value;
      const colorInput = document.getElementById('prop-input-room-color');
      if (colorInput) s.color = colorInput.value;
    } else if (s.type === 'line' || s.type === 'polygon') {
      s.label = inputLabel.value;
    }

    sketcher.draw();
  };


  inputLabel.addEventListener('input', updateSelectedShape);
  inputWidth.addEventListener('input', updateSelectedShape);
  inputHeight.addEventListener('input', updateSelectedShape);
  inputLeft.addEventListener('input', updateSelectedShape);
  inputRight.addEventListener('input', updateSelectedShape);
  inputStructType.addEventListener('change', updateSelectedShape);
  inputDimLabel.addEventListener('input', updateSelectedShape);
  inputBlockStyle.addEventListener('change', updateSelectedShape);
  const roomColorInput = document.getElementById('prop-input-room-color');
  if (roomColorInput) roomColorInput.addEventListener('input', updateSelectedShape);

  const mergeBtn = document.getElementById('prop-btn-merge');
  if (mergeBtn) {
    mergeBtn.addEventListener('click', () => {
      if (sketcher) {
        sketcher.mergeSelectedTouching();
      }
    });
  }
}

function initNewOwnerEntry() {
  if (!activeProject) return;
  isNewEntryMode = true;
  activeEntry = {
    id: 'OWNER_' + Date.now(),
    clientName: '',
    location: '',
    constructionYear: 2010,
    constructionYearComment: '',
    valuationYear: 2025,
    inspectionDate: new Date().toISOString().split('T')[0],
    gpsLat: '',
    gpsLon: '',
    gpsAcc: '',
    roadWidth: '',
    infraElectricity: false,
    infraWater: false,
    infraSewer: false,
    infraDrainage: false,
    infraLighting: false,
    depreciationPct: 2.0,
    residualLife: '',
    constructionClass: 'First Class',
    items: [],
    addElectrification: false,
    electrificationCost: 135000,
    addSanitary: false,
    sanitaryCost: 85000,
    sketcherData: [],
    status: 'draft',
    grandTotal: 0
  };

  gpsTraceNodes = [];
  loadEntryToEditor();
  switchView('editor');
}

function editOwnerEntry(id) {
  if (!activeProject) return;
  isNewEntryMode = false;
  const entry = activeProject.entries.find(e => e.id === id);
  if (!entry) return;
  activeEntry = JSON.parse(JSON.stringify(entry));
  gpsTraceNodes = [];
  loadEntryToEditor();
  switchView('editor');
}

function renderCustomServiceRow(cs) {
  const container = document.getElementById('custom-services-container');
  const div = document.createElement('div');
  div.className = 'custom-service-row';
  div.dataset.id = cs.id;
  div.style.display = 'flex';
  div.style.gap = '0.75rem';
  div.style.alignItems = 'center';
  
  div.innerHTML = `
    <input type="text" class="cs-desc" value="${cs.description || ''}" placeholder="e.g. Add for boundary wall" style="flex-grow: 2; padding: 0.4rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background-color: var(--bg-secondary); color: var(--text-primary);">
    <input type="number" class="cs-cost" value="${cs.cost || 0}" placeholder="Cost" style="width: 150px; padding: 0.4rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background-color: var(--bg-secondary); color: var(--text-primary); text-align: right;">
    <button type="button" class="btn-danger delete-cs-btn" style="padding: 0.35rem 0.65rem; background-color: var(--text-muted);"><i data-lucide="minus" style="width: 14px; height: 14px;"></i></button>
  `;
  
  container.appendChild(div);
  
  // Bind events
  div.querySelector('.cs-desc').addEventListener('input', (e) => {
    cs.description = e.target.value;
  });
  div.querySelector('.cs-cost').addEventListener('input', (e) => {
    cs.cost = parseFloat(e.target.value) || 0;
    calculateAndRenderTotals();
  });
  div.querySelector('.delete-cs-btn').addEventListener('click', () => {
    activeEntry.customServices = activeEntry.customServices.filter(item => item.id !== cs.id);
    div.remove();
    calculateAndRenderTotals();
  });
  
  lucide.createIcons();
}

function loadEntryToEditor() {
  document.getElementById('editor-project-context-title').innerText = activeProject.workName || 'Untitled Project';

  if (activeEntry.status === 'completed') {
    document.getElementById('editor-title').innerText = 'View Owner Valuation (Locked)';
    document.getElementById('editor-modify-btn').style.display = 'inline-flex';
    document.getElementById('editor-complete-btn').style.display = 'none';
    document.getElementById('editor-save-draft-btn').style.display = 'none';
    document.getElementById('editor-export-pdf-btn').style.display = 'inline-flex';
  } else {
    if (isNewEntryMode) {
      document.getElementById('editor-title').innerText = 'Add New Owner Entry';
      document.getElementById('editor-modify-btn').style.display = 'none';
      document.getElementById('editor-complete-btn').style.display = 'inline-flex';
      document.getElementById('editor-complete-btn').innerHTML = '<i data-lucide="check-square"></i> Save & Finalize';
      document.getElementById('editor-save-draft-btn').style.display = 'inline-flex';
      document.getElementById('editor-export-pdf-btn').style.display = 'none';
    } else {
      document.getElementById('editor-title').innerText = 'Edit Owner Valuation';
      document.getElementById('editor-modify-btn').style.display = 'none';
      document.getElementById('editor-complete-btn').style.display = 'inline-flex';
      document.getElementById('editor-complete-btn').innerHTML = '<i data-lucide="check-square"></i> Save & Finalize';
      document.getElementById('editor-save-draft-btn').style.display = 'inline-flex';
      document.getElementById('editor-export-pdf-btn').style.display = 'inline-flex';
    }
    lucide.createIcons();
  }

  document.getElementById('client-name').value = activeEntry.clientName;
  document.getElementById('location').value = activeEntry.location;
  document.getElementById('construction-year').value = activeEntry.constructionYear;
  document.getElementById('construction-year-comment').value = activeEntry.constructionYearComment || '';
  document.getElementById('valuation-year').value = activeEntry.valuationYear;
  document.getElementById('inspection-date').value = activeEntry.inspectionDate;
  
  const gpsDisplay = document.getElementById('gps-display');
  if (activeEntry.gpsLat && activeEntry.gpsLon) {
    gpsDisplay.value = `${parseFloat(activeEntry.gpsLat).toFixed(5)}, ${parseFloat(activeEntry.gpsLon).toFixed(5)}`;
  } else {
    gpsDisplay.value = 'Not tagged';
  }

  document.getElementById('road-width').value = activeEntry.roadWidth;
  
  document.getElementById('infra-electricity').checked = activeEntry.infraElectricity;
  document.getElementById('infra-water').checked = activeEntry.infraWater;
  document.getElementById('infra-sewer').checked = activeEntry.infraSewer;
  document.getElementById('infra-drainage').checked = activeEntry.infraDrainage;
  document.getElementById('infra-lighting').checked = activeEntry.infraLighting;

  document.getElementById('depreciation-pct').value = activeEntry.depreciationPct;
  document.getElementById('residual-life').value = activeEntry.residualLife;
  document.getElementById('construction-class').value = activeEntry.constructionClass;

  document.getElementById('toggle-electrification').checked = activeEntry.addElectrification;
  document.getElementById('toggle-sanitary').checked = activeEntry.addSanitary;
  
  const inputElec = document.getElementById('electrification-cost');
  const inputSani = document.getElementById('sanitary-cost');
  inputElec.value = activeEntry.electrificationCost;
  inputSani.value = activeEntry.sanitaryCost;
  inputElec.style.display = activeEntry.addElectrification ? 'block' : 'none';
  inputSani.style.display = activeEntry.addSanitary ? 'block' : 'none';

  const itemsBody = document.getElementById('estimate-items-body');
  itemsBody.innerHTML = '';
  activeEntry.items.forEach(item => {
    renderItemRow(item);
  });

  if (!activeEntry.customServices) activeEntry.customServices = [];
  const csContainer = document.getElementById('custom-services-container');
  csContainer.innerHTML = '';
  activeEntry.customServices.forEach(cs => {
    renderCustomServiceRow(cs);
  });

  if (!sketcher) {
    sketcher = new SiteSketcher('sketcher-canvas');
    window.sketcher = sketcher;
  }
  
  sketcher.onSelectionChange = (shape) => {
    const panel = document.getElementById('sketcher-properties-panel');
    if (!shape) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'flex';

    // Grab all field containers and inputs
    const fieldLabel      = document.getElementById('prop-field-label');
    const fieldWidth      = document.getElementById('prop-field-width');
    const fieldHeight     = document.getElementById('prop-field-height');
    const fieldRoad       = document.getElementById('prop-field-road');
    const fieldDimLabel   = document.getElementById('prop-field-dim-label');
    const fieldBlockStyle = document.getElementById('prop-field-block-style');
    const fieldStructType = document.getElementById('prop-field-structure-type');

    const inputLabel      = document.getElementById('prop-input-label');
    const inputWidth      = document.getElementById('prop-input-width');
    const inputHeight     = document.getElementById('prop-input-height');
    const inputLeft       = document.getElementById('prop-input-left');
    const inputRight      = document.getElementById('prop-input-right');
    const inputDimLabel   = document.getElementById('prop-input-dim-label');
    const inputBlockStyle = document.getElementById('prop-input-block-style');
    const inputStructType = document.getElementById('prop-input-structure-type');
    const fieldMerge      = document.getElementById('prop-field-merge');

    // Reset all optional fields hidden; label always shown
    [fieldWidth, fieldHeight, fieldRoad, fieldStructType, fieldDimLabel, fieldBlockStyle, fieldMerge].forEach(f => {
      if (f) f.style.display = 'none';
    });
    const fieldRoomColor = document.getElementById('prop-field-room-color');
    if (fieldRoomColor) fieldRoomColor.style.display = 'none';
    fieldLabel.style.display = 'flex';

    if (shape.type === 'building' || shape.type === 'polygon-building') {
      if (fieldMerge) fieldMerge.style.display = 'flex';
      fieldStructType.style.display = 'flex';
      fieldWidth.style.display = 'flex';
      fieldHeight.style.display = 'flex';
      inputStructType.value = shape.structureType || '';
      inputLabel.value = shape.label || '';
      inputWidth.value = shape.dimW || '';
      inputHeight.value = shape.dimH || '';
    } else if (shape.type === 'custom-block') {
      fieldBlockStyle.style.display = 'flex';
      fieldWidth.style.display = 'flex';
      fieldHeight.style.display = 'flex';
      inputBlockStyle.value = shape.blockStyle || 'misc';
      inputLabel.value = shape.label || '';
      inputWidth.value = shape.dimW || '';
      inputHeight.value = shape.dimH || '';
    } else if (shape.type === 'road') {
      fieldRoad.style.display = 'flex';
      inputLabel.value = shape.label || '';
      inputLeft.value = shape.leftLabel || '';
      inputRight.value = shape.rightLabel || '';
    } else if (shape.type === 'text') {
      inputLabel.value = shape.text || '';
    } else if (shape.type === 'boundary-wall' || shape.type === 'gate' || shape.type === 'gate-toran' || shape.type === 'wall') {
      fieldDimLabel.style.display = 'flex';
      inputLabel.value = shape.label || '';
      inputDimLabel.value = shape.dimLabel || '';
    } else if (shape.type === 'dimension') {
      fieldDimLabel.style.display = 'flex';
      inputLabel.value = shape.manualLabel || shape.label || '';
      inputDimLabel.value = shape.manualLabel || shape.label || '';
    } else if (shape.type === 'room') {
      if (fieldRoomColor) {
        fieldRoomColor.style.display = 'flex';
        const colorInput = document.getElementById('prop-input-room-color');
        if (colorInput) colorInput.value = shape.color || '#bfdbfe';
      }
      inputLabel.value = shape.label || '';
    } else if (shape.type === 'line' || shape.type === 'polygon') {
      inputLabel.value = shape.label || '';
    }
  };

  // Wire history change callback for undo/redo button opacity
  sketcher.onHistoryChange = (histLen, futLen) => {
    const undoBtn = document.getElementById('tool-undo');
    const redoBtn = document.getElementById('tool-redo');
    if (undoBtn) undoBtn.style.opacity = histLen > 0 ? '1' : '0.35';
    if (redoBtn) redoBtn.style.opacity = futLen > 0 ? '1' : '0.35';
  };

  sketcher.onPolyNodeAdded = (count) => {
    const closeBtn = document.getElementById('tool-close-poly');
    if (count >= 3) {
      closeBtn.style.display = 'inline-flex';
    } else {
      closeBtn.style.display = 'none';
    }
  };

  sketcher.loadData(activeEntry.sketcherData || []);
  if (activeEntry.mapLat && activeEntry.mapLon) {
    const mapZoom = activeEntry.mapZoom || 17;
    const mapType = activeEntry.mapType || 'satellite';
    document.getElementById('map-search-input').value = `${activeEntry.mapLat}, ${activeEntry.mapLon}`;
    document.getElementById('map-type-select').value = mapType;
    sketcher.loadMapBackground(activeEntry.mapLat, activeEntry.mapLon, mapZoom, mapType);
  } else {
    sketcher.clearMapBackground();
    document.getElementById('map-search-input').value = activeEntry.gpsLat ? `${activeEntry.gpsLat}, ${activeEntry.gpsLon}` : '';
  }

  // Clear any previous modified highlights
  views.editor.querySelectorAll('.field-modified').forEach(el => el.classList.remove('field-modified'));

  // Store original values copy for comparing
  originalEntryCopy = JSON.parse(JSON.stringify(activeEntry));

  // Toggle finalized warning banner
  const warningEl = document.getElementById('editor-completed-warning');
  if (warningEl) {
    warningEl.style.display = activeEntry.status === 'completed' ? 'flex' : 'none';
  }

  renderPhotoGallery();
  if (activeEntry.status === 'completed') {
    toggleInputsLock(true);
  } else {
    toggleInputsLock(false);
  }
  calculateAndRenderTotals();
}

function toggleInputsLock(isLocked) {
  const inputs = views.editor.querySelectorAll('input, textarea, select, button:not(#editor-back-btn):not(#editor-modify-btn)');
  inputs.forEach(el => {
    if (isLocked) {
      el.disabled = true;
      el.style.opacity = '0.75';
    } else {
      el.disabled = false;
      el.style.opacity = '1';
    }
  });
}

// GPS Location
function captureGPS() {
  const btn = document.getElementById('gps-tag-btn');
  const display = document.getElementById('gps-display');
  btn.disabled = true;
  display.value = 'Locating...';

  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    display.value = 'Not supported';
    btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const acc = position.coords.accuracy;

      activeEntry.gpsLat = lat;
      activeEntry.gpsLon = lon;
      activeEntry.gpsAcc = acc;

      display.value = `${lat.toFixed(5)}, ${lon.toFixed(5)} (±${acc.toFixed(1)}m)`;
      btn.disabled = false;
    },
    (error) => {
      console.warn(`Geolocation Error (${error.code}): ${error.message}`);
      alert('Could not tag GPS location. Please check your device location permissions.');
      display.value = 'Tagging failed';
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// Estimate Sub-Table Builder
function addItem(type) {
  let nextNo = 1;
  if (activeEntry.items.length > 0) {
    const numbers = activeEntry.items.map(i => parseInt(i.itemNo)).filter(n => !isNaN(n));
    if (numbers.length > 0) {
      nextNo = Math.max(...numbers) + 1;
    }
  }

  const newItem = {
    id: 'ITEM_' + Date.now() + Math.random().toString(36).substr(2, 5),
    itemNo: nextNo.toString(),
    title: '',
    description: '',
    type: type,
    quantity: 1.0,
    unit: type === 'plinth-area' ? 'sqf' : 'nos',
    rate: 0.0,
    totalCost: 0.0,
    includeInValuation: true,
    excludeFromDepreciation: false,
    l: '',
    b: '',
    h: '',
    deductionPct: 0.0,
    deductionLabel: '',
    deductionAmount: 0
  };

  if (type === 'plinth-area') {
    newItem.title = 'RCC Structure';
    newItem.rooms = [
      { id: Date.now(), name: 'Room 1', l: 4.5, w: 3.3, areaSqm: 14.85 }
    ];
    newItem.totalAreaSqm = 14.85;
    newItem.totalAreaSqft = 159.84;
    newItem.deductionPct = 40.0;
    newItem.deductionLabel = 'non conformity with CPWD norms';
    newItem.deductionAmount = 0;
    newItem.rate = 205.00;
  }

  activeEntry.items.push(newItem);
  renderItemRow(newItem);
  calculateAndRenderTotals();
}

function renderItemRow(item) {
  const tbody = document.getElementById('estimate-items-body');
  const tr = document.createElement('tr');
  tr.dataset.itemId = item.id;

  let detailHtml = '';
  if (item.type === 'lump-sum') {
    detailHtml = `
      <div class="dsr-search-container">
        <input type="text" class="item-title-input bold" placeholder="Title (e.g. Sheds)" value="${item.title}">
      </div>
      <textarea class="item-desc-input" placeholder="Lump sum details description...">${item.description}</textarea>
      
      <div class="item-deduction-container" style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
        <div style="flex-shrink: 0; width: 120px;">
          <label style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); display: block; margin-bottom: 0.2rem;">CPWD Deduction (%)</label>
          <input type="number" class="item-deduct-pct" value="${item.deductionPct || 0}" min="0" max="100" style="padding: 0.35rem 0.5rem; border-radius: 0.4rem; border: 1px solid var(--border-color); background-color: var(--bg-secondary); color: var(--text-primary); font-size: 0.8rem; width: 100%;">
        </div>
        <div style="flex-grow: 1;">
          <label style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); display: block; margin-bottom: 0.2rem;">Deduction Justification</label>
          <input type="text" class="item-deduct-label" value="${item.deductionLabel || ''}" placeholder="e.g. non conformity with CPWD norms" style="padding: 0.35rem 0.5rem; border-radius: 0.4rem; border: 1px solid var(--border-color); background-color: var(--bg-secondary); color: var(--text-primary); font-size: 0.8rem; width: 100%;">
        </div>
      </div>
    `;
  } else if (item.type === 'quantity-rate') {
    detailHtml = `
      <div class="dsr-search-container">
        <input type="text" class="item-title-input bold dsr-search" placeholder="Type to search DSR item..." value="${item.title}">
        <div class="dsr-autocomplete-list" style="display: none;"></div>
      </div>
      <textarea class="item-desc-input" placeholder="Standard quantity description...">${item.description}</textarea>
      
      <div class="item-deduction-container" style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
        <div style="flex-shrink: 0; width: 120px;">
          <label style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); display: block; margin-bottom: 0.2rem;">CPWD Deduction (%)</label>
          <input type="number" class="item-deduct-pct" value="${item.deductionPct || 0}" min="0" max="100" style="padding: 0.35rem 0.5rem; border-radius: 0.4rem; border: 1px solid var(--border-color); background-color: var(--bg-secondary); color: var(--text-primary); font-size: 0.8rem; width: 100%;">
        </div>
        <div style="flex-grow: 1;">
          <label style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); display: block; margin-bottom: 0.2rem;">Deduction Justification</label>
          <input type="text" class="item-deduct-label" value="${item.deductionLabel || ''}" placeholder="e.g. non conformity with CPWD norms" style="padding: 0.35rem 0.5rem; border-radius: 0.4rem; border: 1px solid var(--border-color); background-color: var(--bg-secondary); color: var(--text-primary); font-size: 0.8rem; width: 100%;">
        </div>
      </div>
    `;
  } else if (item.type === 'plinth-area') {
    const predefinedTitles = ["RCC Structure", "Assam Type Building", "Temporary Building", "Temp Shed"];
    const isOther = item.title && !predefinedTitles.includes(item.title);
    const selectedVal = isOther ? "Others" : (item.title || "RCC Structure");

    let optionsHtml = '';
    predefinedTitles.forEach(t => {
      optionsHtml += `<option value="${t}" ${selectedVal === t ? 'selected' : ''}>${t}</option>`;
    });
    optionsHtml += `<option value="Others" ${selectedVal === 'Others' ? 'selected' : ''}>Others</option>`;

    detailHtml = `
      <div class="plinth-title-container" style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.5rem;">
        <select class="item-title-select bold" style="padding: 0.4rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background-color: var(--bg-secondary); color: var(--text-primary); outline: none; width: 100%;">
          ${optionsHtml}
        </select>
        <input type="text" class="item-title-other-input" value="${isOther ? item.title : ''}" placeholder="Enter structure details..." style="display: ${selectedVal === 'Others' ? 'block' : 'none'}; padding: 0.4rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background-color: var(--bg-secondary); color: var(--text-primary); outline: none; width: 100%;">
      </div>
      <textarea class="item-desc-input" placeholder="Plinth area structure description...">${item.description}</textarea>
      
      <div class="plinth-details">
        <div class="bold" style="font-size: 0.8rem; margin-top: 0.5rem; display: flex; justify-content: space-between;">
          <span>Plinth room details (meters):</span>
          <button type="button" class="btn-secondary add-room-btn" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;"><i data-lucide="plus" style="width: 12px; height: 12px;"></i> Add Room</button>
        </div>
        <div class="room-grid">
          <!-- Rooms injected -->
        </div>
        <div class="form-grid" style="margin-top: 0.75rem; gap: 0.75rem;">
          <div class="form-group" style="gap: 0.2rem;">
            <label style="font-size: 0.75rem;">CPWD Non-Conformity Deduction (%)</label>
            <input type="number" class="plinth-deduct-pct" value="${item.deductionPct || 0}">
          </div>
          <div class="form-group" style="gap: 0.2rem; grid-column: span 2;">
            <label style="font-size: 0.75rem;">Deduction Justification</label>
            <input type="text" class="plinth-deduct-label" value="${item.deductionLabel || ''}" placeholder="e.g. non conformity with CPWD norms">
          </div>
        </div>
      </div>
    `;
  }

  const predefinedUnits = [
    { value: 'sqf', label: 'Sqf' },
    { value: 'sqm', label: 'Sqm' },
    { value: 'cum', label: 'cum' },
    { value: 'Rm', label: 'Rm' },
    { value: 'kgs', label: 'Kgs' },
    { value: 'kg', label: 'kg' },
    { value: 'nos', label: 'Nos' },
    { value: 'each', label: 'each' },
    { value: 'l/s', label: 'l/s' },
    { value: 'm', label: 'm' },
    { value: 'tonne', label: 'tonne' },
    { value: 'quintal', label: 'quintal' },
    { value: 'bag', label: 'bag' },
    { value: 'rft', label: 'rft' }
  ];

  let unitOptionsHtml = '';
  let found = false;
  const unitLower = (item.unit || '').toLowerCase();
  predefinedUnits.forEach(u => {
    const isSelected = unitLower === u.value.toLowerCase();
    if (isSelected) found = true;
    unitOptionsHtml += `<option value="${u.value}" ${isSelected ? 'selected' : ''}>${u.label}</option>`;
  });
  if (!found && item.unit) {
    unitOptionsHtml += `<option value="${item.unit}" selected>${item.unit}</option>`;
  }

  const quantityCol = item.type === 'lump-sum' ? 'L/S' : `
    <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: center;">
      <input type="number" class="item-qty-input" value="${item.quantity}" step="0.01" style="width: 70px; text-align: center;">
      <select class="item-unit-select" style="width: 70px; font-size: 0.8rem; border-bottom: 1px solid var(--border-color) !important; background: transparent; color: var(--text-primary); border: none; outline: none; cursor: pointer; padding: 2px 0; text-align-last: center;">
        ${unitOptionsHtml}
      </select>
      ${item.type === 'quantity-rate' ? `
        <div class="item-measurements" style="display: flex; gap: 0.2rem; font-size: 0.7rem; margin-top: 0.25rem; align-items: center; justify-content: center; color: var(--text-muted);">
          <input type="number" class="item-l-input" placeholder="L" value="${item.l !== undefined ? item.l : ''}" style="width: 35px; border: 1px solid var(--border-color) !important; border-radius: 0.25rem; text-align: center; padding: 0.15rem 0.05rem; font-size: 0.75rem; background: var(--bg-secondary); color: var(--text-primary);" title="Length">
          <span>x</span>
          <input type="number" class="item-b-input" placeholder="B" value="${item.b !== undefined ? item.b : ''}" style="width: 35px; border: 1px solid var(--border-color) !important; border-radius: 0.25rem; text-align: center; padding: 0.15rem 0.05rem; font-size: 0.75rem; background: var(--bg-secondary); color: var(--text-primary);" title="Breadth/Width">
          <span>x</span>
          <input type="number" class="item-h-input" placeholder="H" value="${item.h !== undefined ? item.h : ''}" style="width: 35px; border: 1px solid var(--border-color) !important; border-radius: 0.25rem; text-align: center; padding: 0.15rem 0.05rem; font-size: 0.75rem; background: var(--bg-secondary); color: var(--text-primary);" title="Height/Depth">
        </div>
      ` : ''}
    </div>
  `;

  tr.innerHTML = `
    <td>
      <input type="text" class="item-no-input bold" value="${item.itemNo}" style="width: 40px; text-align: center;">
      <label class="check-label" style="font-size: 0.7rem; margin-top: 0.5rem; justify-content: center;" title="Include in Grand Total">
        <input type="checkbox" class="item-include-chk" ${item.includeInValuation ? 'checked' : ''}> Add
      </label>
      <label class="check-label" style="font-size: 0.65rem; margin-top: 0.25rem; justify-content: center; color: var(--text-muted);" title="Exclude from profit/depreciation calculations and add directly to total">
        <input type="checkbox" class="item-exclude-dep-chk" ${item.excludeFromDepreciation ? 'checked' : ''}> Excl. Dep
      </label>
    </td>
    <td>${detailHtml}</td>
    <td class="text-right" style="vertical-align: middle;">${quantityCol}</td>
    <td style="vertical-align: middle;"><input type="number" class="item-rate-input text-right" value="${item.rate}"></td>
    <td style="vertical-align: middle; font-weight: bold; text-align: right; font-size: 0.95rem;" class="item-cost-display">Rs. ${formatIndianCurrency(item.totalCost)}</td>
    <td style="vertical-align: middle; text-align: center;">
      <button type="button" class="btn-danger delete-item-row-btn" style="padding: 0.25rem 0.5rem;"><i data-lucide="x" style="width: 14px; height: 14px;"></i></button>
    </td>
  `;

  tbody.appendChild(tr);

  if (item.type === 'plinth-area') {
    renderPlinthRooms(item, tr);
    tr.querySelector('.add-room-btn').addEventListener('click', () => addPlinthRoom(item, tr));
    tr.querySelector('.plinth-deduct-pct').addEventListener('input', () => updatePlinthCalculations(item, tr));
    tr.querySelector('.plinth-deduct-label').addEventListener('input', (e) => {
      item.deductionLabel = e.target.value;
    });
  }

  tr.querySelector('.item-no-input').addEventListener('input', (e) => {
    item.itemNo = e.target.value;
  });
  tr.querySelector('.item-include-chk').addEventListener('change', (e) => {
    item.includeInValuation = e.target.checked;
    calculateAndRenderTotals();
  });
  tr.querySelector('.item-exclude-dep-chk').addEventListener('change', (e) => {
    item.excludeFromDepreciation = e.target.checked;
    calculateAndRenderTotals();
  });
  const titleInput = tr.querySelector('.item-title-input');
  if (titleInput) {
    titleInput.addEventListener('input', (e) => {
      item.title = e.target.value;
    });
  }

  const titleSelect = tr.querySelector('.item-title-select');
  const titleOtherInput = tr.querySelector('.item-title-other-input');
  if (titleSelect && titleOtherInput) {
    titleSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'Others') {
        titleOtherInput.style.display = 'block';
        item.title = titleOtherInput.value;
      } else {
        titleOtherInput.style.display = 'none';
        item.title = val;
      }
      calculateAndRenderTotals();
    });
    titleOtherInput.addEventListener('input', (e) => {
      item.title = e.target.value;
      calculateAndRenderTotals();
    });
  }
  tr.querySelector('.item-desc-input').addEventListener('input', (e) => {
    item.description = e.target.value;
  });
  tr.querySelector('.item-rate-input').addEventListener('input', (e) => {
    item.rate = parseFloat(e.target.value) || 0;
    updateRowTotal(item, tr);
  });

  if (item.type === 'quantity-rate') {
    tr.querySelector('.item-qty-input').addEventListener('input', (e) => {
      item.quantity = parseFloat(e.target.value) || 0;
      updateRowTotal(item, tr);
    });

    const lInput = tr.querySelector('.item-l-input');
    const bInput = tr.querySelector('.item-b-input');
    const hInput = tr.querySelector('.item-h-input');

    const recalculateMeasurements = () => {
      item.l = lInput.value.trim();
      item.b = bInput.value.trim();
      item.h = hInput.value.trim();

      const lVal = parseFloat(item.l);
      const bVal = parseFloat(item.b);
      const hVal = parseFloat(item.h);

      let qty = 1;
      let hasMeasurement = false;

      if (!isNaN(lVal) && lVal > 0) {
        qty *= lVal;
        hasMeasurement = true;
      }
      if (!isNaN(bVal) && bVal > 0) {
        qty *= bVal;
        hasMeasurement = true;
      }
      if (!isNaN(hVal) && hVal > 0) {
        qty *= hVal;
        hasMeasurement = true;
      }

      if (hasMeasurement) {
        item.quantity = Number(qty.toFixed(3));
        tr.querySelector('.item-qty-input').value = item.quantity;
      }
      updateRowTotal(item, tr);
    };

    lInput.addEventListener('input', recalculateMeasurements);
    bInput.addEventListener('input', recalculateMeasurements);
    hInput.addEventListener('input', recalculateMeasurements);

    setupDsrAutocomplete(tr.querySelector('.dsr-search'), item, tr);
  }

  const selectEl = tr.querySelector('.item-unit-select');
  if (selectEl) {
    selectEl.addEventListener('change', (e) => {
      item.unit = e.target.value;
      if (item.type === 'plinth-area') {
        updatePlinthCalculations(item, tr);
      } else {
        updateRowTotal(item, tr);
      }
    });
  }

  const pctInput = tr.querySelector('.item-deduct-pct');
  const labelInput = tr.querySelector('.item-deduct-label');
  if (pctInput && labelInput) {
    pctInput.addEventListener('input', (e) => {
      item.deductionPct = parseFloat(e.target.value) || 0;
      updateRowTotal(item, tr);
    });
    labelInput.addEventListener('input', (e) => {
      item.deductionLabel = e.target.value;
    });
  }

  tr.querySelector('.delete-item-row-btn').addEventListener('click', () => {
    activeEntry.items = activeEntry.items.filter(i => i.id !== item.id);
    tr.remove();
    calculateAndRenderTotals();
  });

  lucide.createIcons();
}

function updateRowTotal(item, tr) {
  if (item.type === 'plinth-area') {
    const isSqf = (item.unit || '').toLowerCase() === 'sqf';
    const qty = isSqf ? item.totalAreaSqft : item.totalAreaSqm;
    const rawCost = qty * item.rate;
    const pct = parseFloat(item.deductionPct) || 0;
    item.deductionAmount = Math.round(rawCost * (pct / 100));
    item.totalCost = Math.round(rawCost - item.deductionAmount);
  } else if (item.type === 'quantity-rate') {
    const rawCost = item.quantity * item.rate;
    const pct = parseFloat(item.deductionPct) || 0;
    item.deductionAmount = Math.round(rawCost * (pct / 100));
    item.totalCost = Math.round(rawCost - item.deductionAmount);
  } else if (item.type === 'lump-sum') {
    const rawCost = item.rate;
    const pct = parseFloat(item.deductionPct) || 0;
    item.deductionAmount = Math.round(rawCost * (pct / 100));
    item.totalCost = Math.round(rawCost - item.deductionAmount);
  }
  tr.querySelector('.item-cost-display').innerText = 'Rs. ' + formatIndianCurrency(item.totalCost);
  calculateAndRenderTotals();
}

// Plinth Area Rooms
function renderPlinthRooms(item, tr) {
  const container = tr.querySelector('.room-grid');
  container.innerHTML = '';
  
  item.rooms.forEach((room) => {
    const div = document.createElement('div');
    div.className = 'room-row';
    div.innerHTML = `
      <input type="text" class="room-name" value="${room.name}" style="flex-grow: 2;" placeholder="Room name">
      <input type="number" class="room-l" value="${room.l}" style="width: 70px;" placeholder="L (m)" step="0.01">
      <span style="align-self: center; font-size: 0.8rem; color: var(--text-muted);">x</span>
      <input type="number" class="room-w" value="${room.w}" style="width: 70px;" placeholder="W (m)" step="0.01">
      <span style="align-self: center; font-size: 0.85rem; font-weight: 500; width: 80px; text-align: right;" class="room-sqm-display">${room.areaSqm.toFixed(2)} sqm</span>
      <button type="button" class="btn-danger delete-room-btn" style="padding: 0.2rem 0.4rem; background-color: var(--text-muted);"><i data-lucide="minus" style="width: 12px; height: 12px;"></i></button>
    `;

    container.appendChild(div);

    div.querySelector('.room-name').addEventListener('input', (e) => {
      room.name = e.target.value;
    });
    
    const recalculateRoom = () => {
      room.l = parseFloat(div.querySelector('.room-l').value) || 0;
      room.w = parseFloat(div.querySelector('.room-w').value) || 0;
      room.areaSqm = room.l * room.w;
      div.querySelector('.room-sqm-display').innerText = room.areaSqm.toFixed(2) + ' sqm';
      updatePlinthCalculations(item, tr);
    };

    div.querySelector('.room-l').addEventListener('input', recalculateRoom);
    div.querySelector('.room-w').addEventListener('input', recalculateRoom);
    
    div.querySelector('.delete-room-btn').addEventListener('click', () => {
      item.rooms = item.rooms.filter(r => r.id !== room.id);
      div.remove();
      updatePlinthCalculations(item, tr);
    });
  });

  lucide.createIcons();
}

function addPlinthRoom(item, tr) {
  const nextNo = item.rooms.length + 1;
  item.rooms.push({
    id: Date.now() + Math.random(),
    name: 'Room ' + nextNo,
    l: 3.0,
    w: 3.0,
    areaSqm: 9.0
  });
  renderPlinthRooms(item, tr);
  updatePlinthCalculations(item, tr);
}

function updatePlinthCalculations(item, tr) {
  item.totalAreaSqm = item.rooms.reduce((acc, curr) => acc + curr.areaSqm, 0);
  item.totalAreaSqft = item.totalAreaSqm * 10.76391;
  
  const isSqf = (item.unit || '').toLowerCase() === 'sqf';
  const qty = isSqf ? item.totalAreaSqft : item.totalAreaSqm;
  const rawCost = qty * item.rate;
  item.deductionPct = parseFloat(tr.querySelector('.plinth-deduct-pct').value) || 0;
  item.deductionAmount = Math.round(rawCost * (item.deductionPct / 100));
  item.totalCost = Math.round(rawCost - item.deductionAmount);

  tr.querySelector('.item-qty-input').value = qty.toFixed(2);
  tr.querySelector('.item-cost-display').innerText = 'Rs. ' + formatIndianCurrency(item.totalCost);
  calculateAndRenderTotals();
}

// Autocomplete Search
function setupDsrAutocomplete(input, item, tr) {
  const list = tr.querySelector('.dsr-autocomplete-list');
  
  input.addEventListener('focus', () => {
    showMatches(input.value);
  });

  input.addEventListener('input', (e) => {
    showMatches(e.target.value);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = 'none';
    }
  });

  function showMatches(val) {
    const catalog = [...DSR_CURATED, ...customDsrCatalog];
    const query = val.toLowerCase();

    const matched = catalog.filter(dsr => 
      dsr.code.toLowerCase().includes(query) || 
      dsr.description.toLowerCase().includes(query)
    ).slice(0, 10);

    if (matched.length === 0) {
      list.style.display = 'none';
      return;
    }

    list.innerHTML = '';
    matched.forEach(dsr => {
      const div = document.createElement('div');
      div.className = 'dsr-autocomplete-item';
      div.innerHTML = `<span class="code">${dsr.code}</span><span style="font-size:0.8rem;">${dsr.description.substring(0, 70)}...</span>`;
      
      div.addEventListener('click', () => {
        item.title = `DSR Item No ${dsr.code}`;
        item.description = dsr.description;
        item.unit = dsr.unit;
        item.rate = dsr.rate;
        item.l = '';
        item.b = '';
        item.h = '';
        
        input.value = item.title;
        tr.querySelector('.item-desc-input').value = item.description;
        tr.querySelector('.item-qty-input').value = item.quantity;

        const lInput = tr.querySelector('.item-l-input');
        const bInput = tr.querySelector('.item-b-input');
        const hInput = tr.querySelector('.item-h-input');
        if (lInput) lInput.value = '';
        if (bInput) bInput.value = '';
        if (hInput) hInput.value = '';

        const selectEl = tr.querySelector('.item-unit-select');
        if (selectEl) {
          const unitLower = (item.unit || '').toLowerCase();
          let optExists = Array.from(selectEl.options).some(opt => opt.value.toLowerCase() === unitLower);
          if (!optExists && item.unit) {
            const newOpt = document.createElement('option');
            newOpt.value = item.unit;
            newOpt.textContent = item.unit;
            selectEl.add(newOpt);
          }
          selectEl.value = item.unit;
        }
        tr.querySelector('.item-rate-input').value = item.rate;

        updateRowTotal(item, tr);
        list.style.display = 'none';
      });
      list.appendChild(div);
    });

    list.style.display = 'block';
  }
}

function calculateAndRenderTotals() {
  if (!activeEntry) return;

  activeEntry.clientName = document.getElementById('client-name').value;
  activeEntry.location = document.getElementById('location').value;
  
  activeEntry.constructionYear = parseInt(document.getElementById('construction-year').value) || 2010;
  activeEntry.constructionYearComment = document.getElementById('construction-year-comment').value;
  activeEntry.valuationYear = parseInt(document.getElementById('valuation-year').value) || 2025;
  activeEntry.inspectionDate = document.getElementById('inspection-date').value;

  activeEntry.roadWidth = parseFloat(document.getElementById('road-width').value) || '';

  activeEntry.infraElectricity = document.getElementById('infra-electricity').checked;
  activeEntry.infraWater = document.getElementById('infra-water').checked;
  activeEntry.infraSewer = document.getElementById('infra-sewer').checked;
  activeEntry.infraDrainage = document.getElementById('infra-drainage').checked;
  activeEntry.infraLighting = document.getElementById('infra-lighting').checked;

  activeEntry.depreciationPct = parseFloat(document.getElementById('depreciation-pct').value) || 2.0;
  activeEntry.residualLife = parseInt(document.getElementById('residual-life').value) || '';
  activeEntry.constructionClass = document.getElementById('construction-class').value;

  activeEntry.addElectrification = document.getElementById('toggle-electrification').checked;
  activeEntry.electrificationCost = parseFloat(document.getElementById('electrification-cost').value) || 0;
  activeEntry.addSanitary = document.getElementById('toggle-sanitary').checked;
  activeEntry.sanitaryCost = parseFloat(document.getElementById('sanitary-cost').value) || 0;

  const includedItems = activeEntry.items.filter(i => i.includeInValuation);
  const depreciatedItems = includedItems.filter(i => !i.excludeFromDepreciation);
  const excludedItems = includedItems.filter(i => i.excludeFromDepreciation);

  const totalA = Math.round(depreciatedItems.reduce((acc, curr) => acc + curr.totalCost, 0));
  activeEntry.totalA = totalA;

  const contractorDeduction = Math.round(totalA * 0.15);
  activeEntry.contractorDeduction = contractorDeduction;

  const totalB = totalA - contractorDeduction;
  activeEntry.totalB = totalB;

  const age = Math.max(0, activeEntry.valuationYear - activeEntry.constructionYear);
  activeEntry.structureAge = age;
  
  const totalDepPct = activeEntry.depreciationPct * age;
  activeEntry.totalDepreciationPct = totalDepPct;

  const depAmount = Math.round(totalB * (totalDepPct / 100));
  activeEntry.depreciationAmount = depAmount;

  const totalAfterDep = Math.max(0, totalB - depAmount);
  activeEntry.totalAfterDepreciation = totalAfterDep;

  const totalExcludedCost = Math.round(excludedItems.reduce((acc, curr) => acc + curr.totalCost, 0));
  activeEntry.totalExcludedCost = totalExcludedCost;

  const customServicesSum = (activeEntry.customServices || []).reduce((acc, curr) => acc + (curr.cost || 0), 0);
  let grandTotal = totalAfterDep + totalExcludedCost + customServicesSum;
  if (activeEntry.addElectrification) grandTotal += activeEntry.electrificationCost;
  if (activeEntry.addSanitary) grandTotal += activeEntry.sanitaryCost;
  activeEntry.grandTotal = Math.round(grandTotal);

  const table = document.querySelector('.builder-table');
  let tfoot = table.querySelector('tfoot');
  if (!tfoot) {
    tfoot = document.createElement('tfoot');
    table.appendChild(tfoot);
  }
  tfoot.className = 'summary-rows';
  tfoot.innerHTML = `
    <tr>
      <td colspan="4" class="text-right">TOTAL (A) [Subject to Dep.] =</td>
      <td class="text-right bold" id="calc-total-a">Rs. 0.00</td>
      <td></td>
    </tr>
    <tr>
      <td colspan="4" class="text-right">Deduct 15% for Contractor's Profit =</td>
      <td class="text-right" id="calc-deduct-profit" style="color: #b91c1c;">Rs. -0.00</td>
      <td></td>
    </tr>
    <tr>
      <td colspan="4" class="text-right">TOTAL (B) =</td>
      <td class="text-right bold" id="calc-total-b">Rs. 0.00</td>
      <td></td>
    </tr>
    <tr>
      <td colspan="4" class="text-right" id="calc-dep-label">Depreciation @ 2% per year =</td>
      <td class="text-right" id="calc-dep-amount" style="color: #b91c1c;">Rs. -0.00</td>
      <td></td>
    </tr>
    <tr>
      <td colspan="4" class="text-right">TOTAL AFTER DEPRECIATION =</td>
      <td class="text-right bold" id="calc-after-dep">Rs. 0.00</td>
      <td></td>
    </tr>
    ${totalExcludedCost > 0 ? `
    <tr>
      <td colspan="4" class="text-right">TOTAL EXCLUDED ITEMS (Direct Add) =</td>
      <td class="text-right bold" id="calc-total-excluded">Rs. 0.00</td>
      <td></td>
    </tr>
    ` : ''}
    <tr class="grand-total-row" style="background-color: var(--accent-light);">
      <td colspan="4" class="text-right" style="font-size: 1rem; color: var(--accent);">GRAND TOTAL =</td>
      <td class="text-right bold" id="calc-grand-total" style="font-size: 1rem; color: var(--accent);">Rs. 0.00</td>
      <td></td>
    </tr>
  `;

  document.getElementById('calc-total-a').innerText = 'Rs. ' + formatIndianCurrency(activeEntry.totalA);
  document.getElementById('calc-deduct-profit').innerText = 'Rs. -' + formatIndianCurrency(activeEntry.contractorDeduction);
  document.getElementById('calc-total-b').innerText = 'Rs. ' + formatIndianCurrency(activeEntry.totalB);
  
  document.getElementById('calc-dep-label').innerHTML = `Depreciation @ ${activeEntry.depreciationPct}% per year for ${age} years (${activeEntry.totalDepreciationPct}%) =`;
  document.getElementById('calc-dep-amount').innerText = 'Rs. -' + formatIndianCurrency(activeEntry.depreciationAmount);
  document.getElementById('calc-after-dep').innerText = 'Rs. ' + formatIndianCurrency(activeEntry.totalAfterDepreciation);
  if (totalExcludedCost > 0) {
    document.getElementById('calc-total-excluded').innerText = 'Rs. ' + formatIndianCurrency(activeEntry.totalExcludedCost);
  }
  document.getElementById('calc-grand-total').innerText = 'Rs. ' + formatIndianCurrency(activeEntry.grandTotal);

  // Check for modifications to highlight
  checkForModifiedFields();
}

function checkForModifiedFields() {
  if (!activeEntry || !originalEntryCopy || originalEntryCopy.status !== 'completed') {
    return;
  }

  const compareField = (elementId, originalVal, isCheckbox = false) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    let currentVal;
    if (isCheckbox) {
      currentVal = el.checked;
    } else {
      currentVal = el.value;
      if (typeof originalVal === 'number') {
        currentVal = parseFloat(currentVal) || 0;
      }
    }

    if (currentVal !== originalVal) {
      el.classList.add('field-modified');
    } else {
      el.classList.remove('field-modified');
    }
  };

  compareField('client-name', originalEntryCopy.clientName);
  compareField('location', originalEntryCopy.location);
  compareField('construction-year', originalEntryCopy.constructionYear);
  compareField('construction-year-comment', originalEntryCopy.constructionYearComment);
  compareField('valuation-year', originalEntryCopy.valuationYear);
  compareField('inspection-date', originalEntryCopy.inspectionDate);
  compareField('road-width', originalEntryCopy.roadWidth);
  compareField('depreciation-pct', originalEntryCopy.depreciationPct);
  compareField('residual-life', originalEntryCopy.residualLife);
  compareField('construction-class', originalEntryCopy.constructionClass);

  compareField('infra-electricity', originalEntryCopy.infraElectricity, true);
  compareField('infra-water', originalEntryCopy.infraWater, true);
  compareField('infra-sewer', originalEntryCopy.infraSewer, true);
  compareField('infra-drainage', originalEntryCopy.infraDrainage, true);
  compareField('infra-lighting', originalEntryCopy.infraLighting, true);

  compareField('toggle-electrification', originalEntryCopy.addElectrification, true);
  compareField('electrification-cost', originalEntryCopy.electrificationCost);
  compareField('toggle-sanitary', originalEntryCopy.addSanitary, true);
  compareField('sanitary-cost', originalEntryCopy.sanitaryCost);

  // GPS check
  const gpsDisplay = document.getElementById('gps-display');
  if (gpsDisplay) {
    const curGpsLat = parseFloat(activeEntry.gpsLat);
    const curGpsLon = parseFloat(activeEntry.gpsLon);
    const origGpsLat = parseFloat(originalEntryCopy.gpsLat);
    const origGpsLon = parseFloat(originalEntryCopy.gpsLon);
    
    if (curGpsLat !== origGpsLat || curGpsLon !== origGpsLon) {
      gpsDisplay.classList.add('field-modified');
    } else {
      gpsDisplay.classList.remove('field-modified');
    }
  }

  // Compare custom services
  const origCustomServices = originalEntryCopy.customServices || [];
  const curCustomServices = activeEntry.customServices || [];
  
  // Clear highlights in custom services first
  views.editor.querySelectorAll('.custom-service-row input').forEach(el => el.classList.remove('field-modified'));
  
  curCustomServices.forEach(cs => {
    const orig = origCustomServices.find(o => o.id === cs.id);
    if (!orig || orig.description !== cs.description || orig.cost !== cs.cost) {
      const row = views.editor.querySelector(`.custom-service-row[data-id="${cs.id}"]`);
      if (row) {
        row.querySelectorAll('input').forEach(input => input.classList.add('field-modified'));
      }
    }
  });
}

function validateEditorForm() {
  const clientName = document.getElementById('client-name').value.trim();
  const location = document.getElementById('location').value.trim();

  if (!clientName) {
    alert('Please enter the Name of Occupant / Owner.');
    return false;
  }
  if (!location) {
    alert('Please enter the Location / Village / Gaon.');
    return false;
  }
  if (activeEntry.items.length === 0) {
    alert('Please add at least one valuation item to the estimate.');
    return false;
  }
  return true;
}

function saveActiveEntry(status = 'draft') {
  if (!activeEntry || !activeProject) return;
  calculateAndRenderTotals();

  activeEntry.status = status;
  if (sketcher) {
    activeEntry.sketcherData = sketcher.exportData();
    activeEntry.sketcherImage = sketcher.exportImage();
    if (sketcher.mapBgImageLoaded) {
      activeEntry.mapLat = sketcher.mapLat;
      activeEntry.mapLon = sketcher.mapLon;
      activeEntry.mapZoom = sketcher.mapZoom;
      activeEntry.mapType = sketcher.mapType;
    } else {
      activeEntry.mapLat = null;
      activeEntry.mapLon = null;
      activeEntry.mapZoom = null;
      activeEntry.mapType = null;
    }
  }

  if (!activeProject.entries) activeProject.entries = [];
  const idx = activeProject.entries.findIndex(e => e.id === activeEntry.id);
  if (idx > -1) {
    activeProject.entries[idx] = activeEntry;
  } else {
    activeProject.entries.push(activeEntry);
  }

  saveProjects();
  if (auth.currentUser) {
    saveUserProject(auth.currentUser.uid, activeProject).catch(err => console.error("Error saving project to Firestore:", err));
  }
  renderProjectDetails();
}

// Site Evidence Image Upload
function setupImageUploader() {
  const dropzone = document.getElementById('photo-dropzone');
  const fileInput = document.getElementById('camera-file-input');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--accent)';
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--border-color)';
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-color)';
    if (e.dataTransfer.files.length > 0) {
      processImageFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      processImageFiles(e.target.files);
    }
  });
}

async function uploadToCloudinary(base64Data) {
  const url = `https://api.cloudinary.com/v1_1/dgauiflhx/image/upload`;
  const formData = new FormData();
  formData.append('file', base64Data);
  formData.append('upload_preset', 'SakoriCloud');

  const res = await fetch(url, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.error?.message || 'Cloudinary upload failed');
  }

  const data = await res.json();
  return data.secure_url;
}

function processImageFiles(files) {
  if (!activeEntry.photos) activeEntry.photos = [];
  
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) {
      alert('Only image files are supported.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1024;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        
        const photoId = 'PHOTO_' + Date.now() + Math.random().toString(36).substr(2, 5);
        const photoItem = {
          id: photoId,
          data: compressedBase64,
          caption: file.name.substring(0, 15) || 'Site View',
          uploading: true
        };
        activeEntry.photos.push(photoItem);
        renderPhotoGallery();

        // Trigger Cloudinary upload asynchronously
        uploadToCloudinary(compressedBase64)
          .then(secureUrl => {
            photoItem.data = secureUrl;
            delete photoItem.uploading;
            renderPhotoGallery();
            
            // Auto-save the entry so Firestore gets the final Cloudinary URL
            saveActiveEntry_noExport();
          })
          .catch(err => {
            console.error("Cloudinary upload error:", err);
            alert(`Failed to upload photo "${file.name}": ${err.message}`);
            // Remove placeholder on failure
            activeEntry.photos = activeEntry.photos.filter(p => p.id !== photoId);
            renderPhotoGallery();
          });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoGallery() {
  const container = document.getElementById('photo-gallery-grid');
  container.innerHTML = '';

  if (!activeEntry.photos) activeEntry.photos = [];

  activeEntry.photos.forEach(ph => {
    const card = document.createElement('div');
    card.className = 'photo-thumb-card';
    card.style.position = 'relative';

    let spinnerHtml = '';
    if (ph.uploading) {
      spinnerHtml = `
        <div style="position: absolute; inset: 0; background: rgba(15, 23, 42, 0.6); display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 0.5rem; color: #ffffff; z-index: 2; gap: 0.25rem;">
          <div style="width: 1.5rem; height: 1.5rem; border: 2.5px solid rgba(255, 255, 255, 0.3); border-top-color: #ffffff; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span style="font-size: 0.7rem; font-weight: 500; letter-spacing: 0.5px;">Uploading...</span>
        </div>
      `;
    }

    card.innerHTML = `
      ${spinnerHtml}
      <img src="${ph.data}" alt="evidence" style="opacity: ${ph.uploading ? 0.5 : 1}; transition: opacity 0.2s;">
      <input type="text" class="photo-caption-input" value="${ph.caption}" placeholder="Add caption..." ${ph.uploading ? 'disabled' : ''}>
      <button type="button" class="delete-thumb-btn" title="Delete Photo" ${ph.uploading ? 'disabled' : ''}>x</button>
    `;
    container.appendChild(card);

    if (!ph.uploading) {
      card.querySelector('.photo-caption-input').addEventListener('input', (e) => {
        ph.caption = e.target.value;
        saveActiveEntry_noExport(); // Auto-save caption edit
      });

      card.querySelector('.delete-thumb-btn').addEventListener('click', () => {
        activeEntry.photos = activeEntry.photos.filter(p => p.id !== ph.id);
        card.remove();
        saveActiveEntry_noExport(); // Auto-save removal
      });
    }
  });
}

window.getActiveProjectRoute = () => {
  if (!activeProject) return null;
  
  let left = 'KALIABAR';
  let right = 'NUMALIGARH';
  let road = 'NH-37';
  
  const loc = activeProject.location || '';
  const work = activeProject.workName || '';
  
  // Try to parse "A to B" or "A - B"
  const toMatch = loc.match(/(.+?)\s+to\s+(.+?)(?:\s+stretch|\s+segment|$)/i) || loc.match(/(.+?)\s*-\s*(.+)/i);
  if (toMatch) {
    left = toMatch[1].trim();
    right = toMatch[2].trim();
    
    // Clean up "Numaligarh stretch of NH-37"
    const stretchMatch = right.match(/(.+?)\s+stretch\s+of\s+(.+)/i) || right.match(/(.+?)\s+of\s+(.+)/i);
    if (stretchMatch) {
      right = stretchMatch[1].trim();
      road = stretchMatch[2].trim();
    }
  }
  
  // Parse NH-XX from location or work name
  const nhMatch = loc.match(/(NH[- ]\d+)/i) || work.match(/(NH[- ]\d+)/i);
  if (nhMatch) {
    road = nhMatch[1].trim().toUpperCase();
  }
  
  return {
    left: left.toUpperCase(),
    right: right.toUpperCase(),
    road: road.toUpperCase()
  };
};

// Line Sketcher Toolbar Setup
function setupSketcherToolbar() {
  const tools = ['select', 'building', 'polybuilding', 'room', 'road', 'text', 'line', 'wall', 'boundary-wall', 'gate', 'gate-toran', 'custom-block', 'dimension', 'freehand', 'erase'];
  
  tools.forEach(t => {
    const btn = document.getElementById(`tool-${t}`);
    if (btn) {
      btn.addEventListener('click', () => {
        tools.forEach(x => {
          const b = document.getElementById(`tool-${x}`);
          if (b) b.classList.remove('active');
        });
        btn.classList.add('active');
        
        if (sketcher) {
          sketcher.mode = t;
          sketcher.currentPath = [];
          sketcher.hoverPos = null;
          document.getElementById('tool-close-poly').style.display = 'none';
        }
      });
    }
  });

  document.getElementById('tool-close-poly').addEventListener('click', () => {
    if (sketcher) {
      sketcher.closePolygonBuilding();
      document.getElementById('tool-close-poly').style.display = 'none';
      
      tools.forEach(x => {
        const b = document.getElementById(`tool-${x}`);
        if (b) b.classList.remove('active');
      });
      document.getElementById('tool-select').classList.add('active');
    }
  });

  document.getElementById('tool-clear').addEventListener('click', () => {
    if (sketcher && confirm('Are you sure you want to clear the entire site layout?')) {
      sketcher.loadData([]);
      document.getElementById('sketcher-properties-panel').style.display = 'none';
    }
  });

  const undoBtn = document.getElementById('tool-undo');
  const redoBtn = document.getElementById('tool-redo');

  if (undoBtn) undoBtn.addEventListener('click', () => { if (sketcher) sketcher.undo(); });
  if (redoBtn) redoBtn.addEventListener('click', () => { if (sketcher) sketcher.redo(); });

  // Initial opacity (no history yet)
  if (undoBtn) undoBtn.style.opacity = '0.35';
  if (redoBtn) redoBtn.style.opacity = '0.35';

  // ── Scale Selector ──
  const scaleSelect = document.getElementById('sketcher-scale-select');
  if (scaleSelect && sketcher) {
    scaleSelect.value = '100';
    sketcher.setScale(100);
    scaleSelect.addEventListener('change', () => {
      if (sketcher) sketcher.setScale(parseInt(scaleSelect.value));
    });
  }

  // ── Zoom buttons ──
  const zoomLabel = document.getElementById('sketcher-zoom-label');
  const updateZoomLabel = (z) => { if (zoomLabel) zoomLabel.textContent = `Zoom: ${Math.round(z*100)}%`; };
  if (sketcher) { sketcher.onZoomChange = updateZoomLabel; updateZoomLabel(sketcher.zoom); }

  const skZoomIn  = document.getElementById('sketch-zoom-in-btn');
  const skZoomOut = document.getElementById('sketch-zoom-out-btn');
  const skZoomFit = document.getElementById('sketch-zoom-fit-btn');
  const skZoomRst = document.getElementById('sketch-zoom-reset-btn');
  if (skZoomIn)  skZoomIn.addEventListener('click',  () => { if (sketcher) sketcher.zoomTo(1.25); });
  if (skZoomOut) skZoomOut.addEventListener('click', () => { if (sketcher) sketcher.zoomTo(0.8); });
  if (skZoomFit) skZoomFit.addEventListener('click', () => { if (sketcher) sketcher.fitToContent(); });
  if (skZoomRst) skZoomRst.addEventListener('click', () => { if (sketcher) sketcher.resetView(); });

  const skPanLeft = document.getElementById('sketch-pan-left-btn');
  const skPanRight = document.getElementById('sketch-pan-right-btn');
  const skPanUp = document.getElementById('sketch-pan-up-btn');
  const skPanDown = document.getElementById('sketch-pan-down-btn');
  if (skPanLeft)  skPanLeft.addEventListener('click',  () => { if (sketcher) sketcher.panCanvas(40, 0); });
  if (skPanRight) skPanRight.addEventListener('click', () => { if (sketcher) sketcher.panCanvas(-40, 0); });
  if (skPanUp)    skPanUp.addEventListener('click',    () => { if (sketcher) sketcher.panCanvas(0, 40); });
  if (skPanDown)  skPanDown.addEventListener('click',  () => { if (sketcher) sketcher.panCanvas(0, -40); });

  const a4FrameBtn = document.getElementById('sketch-a4-frame-btn');
  if (a4FrameBtn) {
    const updateA4Btn = () => {
      if (!sketcher) return;
      a4FrameBtn.innerHTML = sketcher.showA4Frame 
        ? '<i data-lucide="file-text" style="width:13px;height:13px;"></i> A4 FRAME ON' 
        : '<i data-lucide="file-text" style="width:13px;height:13px;"></i> A4 FRAME OFF';
      a4FrameBtn.style.color = sketcher.showA4Frame ? '#3b82f6' : '#94a3b8';
      a4FrameBtn.style.borderColor = sketcher.showA4Frame ? '#3b82f6' : '#94a3b8';
      lucide.createIcons();
    };
    a4FrameBtn.addEventListener('click', () => {
      if (sketcher) {
        sketcher.showA4Frame = !sketcher.showA4Frame;
        sketcher.draw();
        updateA4Btn();
      }
    });
  }

  // ── Snap toggle ──
  const snapBtn = document.getElementById('sketch-snap-toggle');
  if (snapBtn && sketcher) {
    const updateSnapBtn = () => {
      snapBtn.textContent = sketcher.snapGrid ? '⊞ SNAP ON' : '⊡ SNAP OFF';
      snapBtn.style.color = sketcher.snapGrid ? '#22c55e' : '#94a3b8';
      snapBtn.style.borderColor = sketcher.snapGrid ? '#22c55e' : '#94a3b8';
    };
    snapBtn.addEventListener('click', () => { if (sketcher) { sketcher.snapGrid = !sketcher.snapGrid; sketcher.draw(); updateSnapBtn(); } });
    updateSnapBtn();
  }

  // ── Grid size ──
  const gridSel = document.getElementById('sketch-grid-size');
  if (gridSel && sketcher) {
    gridSel.addEventListener('change', () => { if (sketcher) { sketcher.gridSize = parseFloat(gridSel.value); sketcher.draw(); } });
  }



  // Map Background Controls
  const mapSearchInput = document.getElementById('map-search-input');
  const mapTypeSelect = document.getElementById('map-type-select');
  const mapLoadBtn = document.getElementById('map-load-btn');
  const mapClearBtn = document.getElementById('map-clear-btn');
  const mapZoomInBtn = document.getElementById('map-zoom-in-btn');
  const mapZoomOutBtn = document.getElementById('map-zoom-out-btn');

  mapLoadBtn.addEventListener('click', async () => {
    const query = mapSearchInput.value.trim();
    if (!query) {
      alert('Please enter an address or GPS coordinates.');
      return;
    }

    mapLoadBtn.disabled = true;
    mapLoadBtn.innerText = 'Loading...';

    try {
      let lat, lon;
      const coordMatch = query.match(/([-+]?\d+\.\d+)\s*,\s*([-+]?\d+\.\d+)/);
      if (coordMatch) {
        lat = parseFloat(coordMatch[1]);
        lon = parseFloat(coordMatch[2]);
      } else {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
        const res = await fetch(url, { headers: { 'User-Agent': 'ValuRoad-App' } });
        const data = await res.json();
        if (data && data.length > 0) {
          lat = parseFloat(data[0].lat);
          lon = parseFloat(data[0].lon);
          mapSearchInput.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        } else {
          alert('Could not find location. Please check the address or enter Lat,Lon coordinates.');
          mapLoadBtn.disabled = false;
          mapLoadBtn.innerText = 'Load Map';
          return;
        }
      }

      const zoom = sketcher ? sketcher.mapZoom : 17;
      const type = mapTypeSelect.value;

      if (sketcher) {
        sketcher.loadMapBackground(lat, lon, zoom, type);
        activeEntry.mapLat = lat;
        activeEntry.mapLon = lon;
        activeEntry.mapZoom = zoom;
        activeEntry.mapType = type;
      }
    } catch (err) {
      console.error(err);
      alert('Error loading map background.');
    } finally {
      mapLoadBtn.disabled = false;
      mapLoadBtn.innerText = 'Load Map';
    }
  });

  mapClearBtn.addEventListener('click', () => {
    if (sketcher) {
      sketcher.clearMapBackground();
      activeEntry.mapLat = null;
      activeEntry.mapLon = null;
      activeEntry.mapZoom = null;
      activeEntry.mapType = null;
    }
  });

  mapZoomInBtn.addEventListener('click', () => {
    if (sketcher && sketcher.mapBgImageLoaded) {
      if (sketcher.mapZoom < 20) {
        sketcher.mapZoom++;
        sketcher.loadMapBackground(sketcher.mapLat, sketcher.mapLon, sketcher.mapZoom, sketcher.mapType);
        activeEntry.mapZoom = sketcher.mapZoom;
      }
    }
  });

  mapZoomOutBtn.addEventListener('click', () => {
    if (sketcher && sketcher.mapBgImageLoaded) {
      if (sketcher.mapZoom > 5) {
        sketcher.mapZoom--;
        sketcher.loadMapBackground(sketcher.mapLat, sketcher.mapLon, sketcher.mapZoom, sketcher.mapType);
        activeEntry.mapZoom = sketcher.mapZoom;
      }
    }
  });

  document.getElementById('map-pan-left-btn').addEventListener('click', () => {
    if (sketcher) sketcher.panMap(-80, 0);
  });
  document.getElementById('map-pan-right-btn').addEventListener('click', () => {
    if (sketcher) sketcher.panMap(80, 0);
  });
  document.getElementById('map-pan-up-btn').addEventListener('click', () => {
    if (sketcher) sketcher.panMap(0, -60);
  });
  document.getElementById('map-pan-down-btn').addEventListener('click', () => {
    if (sketcher) sketcher.panMap(0, 60);
  });
}

// GPS Perimeter Tracing Wizard Modal
function setupGpsTracingModal() {
  const modal = document.getElementById('gps-tracing-modal');
  const triggerBtn = document.getElementById('sketcher-gps-trace-btn');
  const closeBtn = document.getElementById('gps-modal-close-btn');
  const cancelBtn = document.getElementById('gps-modal-cancel-btn');
  const importBtn = document.getElementById('gps-modal-import-btn');
  const recordBtn = document.getElementById('gps-record-node-btn');
  const resetBtn = document.getElementById('gps-clear-nodes-btn');
  const mockBtn = document.getElementById('gps-mock-trace-btn');
  const geImportBtn = document.getElementById('gps-ge-import-btn');

  triggerBtn.addEventListener('click', () => {
    gpsTraceNodes = [];
    renderGpsNodesTable();
    modal.classList.add('active');
  });

  const closeModal = () => modal.classList.remove('active');
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  resetBtn.addEventListener('click', () => {
    gpsTraceNodes = [];
    renderGpsNodesTable();
  });

  recordBtn.addEventListener('click', () => {
    recordBtn.disabled = true;
    
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      recordBtn.disabled = false;
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        gpsTraceNodes.push({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          acc: position.coords.accuracy
        });
        renderGpsNodesTable();
        recordBtn.disabled = false;
      },
      () => {
        alert('Could not capture GPS node coordinate. Check permissions.');
        recordBtn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  mockBtn.addEventListener('click', () => {
    const latRef = 26.589100;
    const lonRef = 93.125600;

    const mToLat = 1 / 110574;
    const mToLon = 1 / (111320 * Math.cos(latRef * Math.PI / 180));

    gpsTraceNodes = [
      { lat: latRef, lon: lonRef, acc: 2.1 },
      { lat: latRef, lon: lonRef + (10 * mToLon), acc: 1.8 },
      { lat: latRef + (15 * mToLat), lon: lonRef + (10 * mToLon), acc: 2.2 },
      { lat: latRef + (15 * mToLat), lon: lonRef, acc: 2.0 }
    ];

    renderGpsNodesTable();
  });

  geImportBtn.addEventListener('click', () => {
    const text = document.getElementById('gps-ge-import-text').value;
    if (!text.trim()) {
      alert('Please paste Google Earth coordinates or KML code first.');
      return;
    }

    const points = parseGoogleEarthCoordinates(text);
    if (points.length < 3) {
      alert('Failed to parse coordinates. Make sure you have at least 3 coordinates list, formatted as "Latitude, Longitude" pairs.');
      return;
    }

    gpsTraceNodes = points;
    renderGpsNodesTable();
    alert(`Successfully loaded ${points.length} boundary coordinates from Google Earth!`);
    document.getElementById('gps-ge-import-text').value = '';
  });

  importBtn.addEventListener('click', () => {
    if (sketcher) {
      const success = sketcher.importGpsTrace(gpsTraceNodes);
      if (success) {
        alert('Perimeter boundary polygon imported to sketcher successfully!');
        closeModal();
      } else {
        alert('Could not trace polygon. Make sure you have at least 3 points.');
      }
    }
  });
}

function parseGoogleEarthCoordinates(text) {
  const points = [];
  const kmlMatch = text.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
  const coordString = kmlMatch ? kmlMatch[1] : text;

  const regex = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/g;
  let match;
  
  if (kmlMatch) {
    while ((match = regex.exec(coordString)) !== null) {
      const lon = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      points.push({ lat, lon, acc: 1.0 });
    }
  } else {
    while ((match = regex.exec(coordString)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      points.push({ lat, lon, acc: 1.0 });
    }
  }
  
  if (points.length === 0) {
    const lines = coordString.split(/\r?\n/);
    lines.forEach(line => {
      const parts = line.trim().split(/[\s,]+/);
      if (parts.length >= 2) {
        const val1 = parseFloat(parts[0]);
        const val2 = parseFloat(parts[1]);
        if (!isNaN(val1) && !isNaN(val2)) {
          points.push({ lat: val1, lon: val2, acc: 1.0 });
        }
      }
    });
  }

  return points;
}

function renderGpsNodesTable() {
  const tbody = document.getElementById('gps-recorded-nodes-body');
  const importBtn = document.getElementById('gps-modal-import-btn');
  const resultsDiv = document.getElementById('gps-tracing-results');

  tbody.innerHTML = '';
  if (gpsTraceNodes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-muted" style="text-align: center; padding: 1rem;">No points recorded yet.</td></tr>`;
    importBtn.disabled = true;
    resultsDiv.style.display = 'none';
    return;
  }

  gpsTraceNodes.forEach((node, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Corner ${idx + 1}</td>
      <td style="font-family: monospace;">${node.lat.toFixed(6)}°</td>
      <td style="font-family: monospace;">${node.lon.toFixed(6)}°</td>
    `;
    tbody.appendChild(tr);
  });

  if (gpsTraceNodes.length >= 3) {
    importBtn.disabled = false;
    resultsDiv.style.display = 'block';

    const ref = gpsTraceNodes[0];
    const rawNodes = gpsTraceNodes.map(p => {
      const dy = (p.lat - ref.lat) * 110574;
      const dx = (p.lon - ref.lon) * 111320 * Math.cos(ref.lat * Math.PI / 180);
      return { dx, dy };
    });

    let areaSum = 0;
    for (let i = 0; i < rawNodes.length; i++) {
      const j = (i + 1) % rawNodes.length;
      areaSum += rawNodes[i].dx * rawNodes[j].dy;
      areaSum -= rawNodes[j].dx * rawNodes[i].dy;
    }
    const areaSqm = Math.abs(areaSum) / 2;
    const areaSqft = areaSqm * 10.76391;

    document.getElementById('gps-results-area').innerText = `${areaSqm.toFixed(1)} sqm (${areaSqft.toFixed(1)} sqf)`;
    document.getElementById('gps-results-sides').innerText = `${gpsTraceNodes.length} sides`;
  } else {
    importBtn.disabled = true;
    resultsDiv.style.display = 'none';
  }
}

// DSR OCR Scanning settings
let parsedOcrItems = [];
function setupDsrSettings() {
  const parseBtn = document.getElementById('ocr-parse-btn');
  const saveBtn = document.getElementById('ocr-save-catalog-btn');
  const textInput = document.getElementById('ocr-pasted-text');
  const previewPanel = document.getElementById('ocr-preview-panel');

  const ocrUploader = document.getElementById('ocr-file-uploader');
  const ocrFileInput = document.getElementById('ocr-file-input');
  const ocrProgressContainer = document.getElementById('ocr-progress-container');
  const ocrProgressStatus = document.getElementById('ocr-progress-status');
  const ocrProgressPercent = document.getElementById('ocr-progress-percent');
  const ocrProgressBar = document.getElementById('ocr-progress-bar');

  if (ocrUploader && ocrFileInput) {
    ocrUploader.addEventListener('click', () => ocrFileInput.click());

    ocrFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          handleDsrPdfFile(file);
        } else if (file.type.startsWith('image/')) {
          handleOcrImageFile(file);
        } else {
          alert('Please upload a PDF or an image file.');
        }
      }
    });

    ocrUploader.addEventListener('dragover', (e) => {
      e.preventDefault();
      ocrUploader.classList.add('drag-over');
    });

    ocrUploader.addEventListener('dragleave', () => {
      ocrUploader.classList.remove('drag-over');
    });

    ocrUploader.addEventListener('drop', (e) => {
      e.preventDefault();
      ocrUploader.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          handleDsrPdfFile(file);
        } else if (file.type.startsWith('image/')) {
          handleOcrImageFile(file);
        } else {
          alert('Please drop a PDF or an image file.');
        }
      }
    });
  }

  async function handleDsrPdfFile(file) {
    if (!ocrProgressContainer || !ocrProgressStatus || !ocrProgressPercent || !ocrProgressBar) return;
    
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    } else {
      alert('PDF.js library is not loaded yet. Please check your internet connection.');
      return;
    }

    ocrProgressContainer.style.display = 'block';
    ocrProgressStatus.innerText = 'Loading DSR PDF...';
    ocrProgressPercent.innerText = '0%';
    ocrProgressBar.style.width = '0%';

    try {
      console.log('Reading DSR PDF file:', file.name);
      
      const fileReader = new FileReader();
      const loadPromise = new Promise((resolve, reject) => {
        fileReader.onload = function() { resolve(new Uint8Array(this.result)); };
        fileReader.onerror = function(e) { reject(e); };
      });
      fileReader.readAsArrayBuffer(file);
      const typedarray = await loadPromise;

      const pdf = await pdfjsLib.getDocument(typedarray).promise;
      console.log('PDF document loaded. Total pages:', pdf.numPages);

      const startPageInput = document.getElementById('ocr-pdf-start-page');
      const endPageInput = document.getElementById('ocr-pdf-end-page');
      
      let startPage = parseInt(startPageInput?.value) || 1;
      let endPage = parseInt(endPageInput?.value) || pdf.numPages;

      startPage = Math.max(1, Math.min(pdf.numPages, startPage));
      endPage = Math.max(startPage, Math.min(pdf.numPages, endPage));

      console.log(`Extracting pages ${startPage} to ${endPage}...`);
      
      let fullText = '';
      const totalPagesToParse = (endPage - startPage) + 1;
      
      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        const pageIndex = (pageNum - startPage) + 1;
        const progressPct = Math.round(((pageIndex - 1) / totalPagesToParse) * 100);
        
        ocrProgressStatus.innerText = `Extracting PDF Page ${pageNum} of ${endPage}...`;
        ocrProgressPercent.innerText = `${progressPct}%`;
        ocrProgressBar.style.width = `${progressPct}%`;

        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        const lineMap = {};
        textContent.items.forEach(item => {
          const y = Math.round(item.transform[5] * 10) / 10;
          if (!lineMap[y]) lineMap[y] = [];
          lineMap[y].push(item);
        });

        const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
        const pageText = sortedYs.map(y => {
          const items = lineMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
          return items.map(item => item.str).join(' ');
        }).join('\n');

        fullText += pageText + '\n';
      }

      console.log('PDF Text extraction complete. Total characters:', fullText.length);

      if (textInput) {
        textInput.value = fullText;
        if (parseBtn) parseBtn.click();
      }

      ocrProgressStatus.innerText = 'Success!';
      ocrProgressPercent.innerText = '100%';
      ocrProgressBar.style.width = '100%';

      setTimeout(() => {
        ocrProgressContainer.style.display = 'none';
      }, 1500);

    } catch (err) {
      console.error('PDF Extraction Error:', err);
      ocrProgressStatus.innerText = 'Extraction Error!';
      ocrProgressPercent.innerText = '';
      ocrProgressBar.style.width = '0%';
      alert('Failed to parse DSR PDF: ' + err.message);
    }
  }

  async function handleOcrImageFile(file) {
    if (!ocrProgressContainer || !ocrProgressStatus || !ocrProgressPercent || !ocrProgressBar) return;
    
    ocrProgressContainer.style.display = 'block';
    ocrProgressStatus.innerText = 'Initializing OCR Engine...';
    ocrProgressPercent.innerText = '0%';
    ocrProgressBar.style.width = '0%';

    try {
      console.log('Running client-side OCR on:', file.name);
      
      const { data: { text } } = await Tesseract.recognize(
        file,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              const pct = Math.round(m.progress * 100);
              ocrProgressStatus.innerText = 'Extracting Text (OCR)...';
              ocrProgressPercent.innerText = `${pct}%`;
              ocrProgressBar.style.width = `${pct}%`;
            } else {
              let friendly = m.status.replace(/_/g, ' ');
              friendly = friendly.charAt(0).toUpperCase() + friendly.slice(1);
              ocrProgressStatus.innerText = `${friendly}...`;
            }
          }
        }
      );

      console.log('OCR Extraction complete. Length:', text.length);
      
      if (textInput) {
        textInput.value = text;
        if (parseBtn) parseBtn.click();
      }

      ocrProgressStatus.innerText = 'Success!';
      ocrProgressPercent.innerText = '100%';
      ocrProgressBar.style.width = '100%';
      
      setTimeout(() => {
        ocrProgressContainer.style.display = 'none';
      }, 1500);

    } catch (err) {
      console.error('OCR Error:', err);
      ocrProgressStatus.innerText = 'OCR Error!';
      ocrProgressPercent.innerText = '';
      ocrProgressBar.style.width = '0%';
      alert('Failed to perform OCR on image: ' + err.message);
    }
  }

  if (parseBtn) {
    parseBtn.addEventListener('click', () => {
      const text = textInput.value;
      if (!text.trim()) {
        alert('Please paste some scanned text first.');
        return;
      }

      parsedOcrItems = parseOcrDsrText(text);
      renderOcrPreview();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (parsedOcrItems.length === 0) return;
      
      parsedOcrItems.forEach(item => {
        const existsIdx = customDsrCatalog.findIndex(c => c.code === item.code);
        if (existsIdx > -1) {
          customDsrCatalog[existsIdx] = item;
        } else {
          customDsrCatalog.push(item);
        }
      });

      saveCustomDsrCatalog();
      if (auth.currentUser) {
        saveUserCustomDsr(auth.currentUser.uid, customDsrCatalog).catch(err => console.error("Error saving custom DSR to Firestore:", err));
      }
      alert(`Successfully imported ${parsedOcrItems.length} custom DSR items into search autocompletes!`);
      textInput.value = '';
      previewPanel.style.display = 'none';
      saveBtn.disabled = true;
    });
  }
}

function parseOcrDsrText(text) {
  const items = [];
  const lines = text.split(/\r?\n/);
  let currentItem = null;

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;

    const headerMatch = line.match(/^(?:DSR\s+)?Item(?:\s+No)?\.?\s*[:\-]?\s*([0-9\.]+)/i);

    if (headerMatch) {
      if (currentItem) items.push(currentItem);
      const code = headerMatch[1];
      let rest = line.substring(headerMatch[0].length).trim();
      currentItem = {
        code: code,
        description: rest,
        unit: 'sqm',
        rate: 0
      };
    } else if (currentItem) {
      currentItem.description += ' ' + line;
    }
  });

  if (currentItem) items.push(currentItem);

  items.forEach(item => {
    const rateMatch = item.description.match(/(?:Rate|@|Rs\.?)\s*(?:Rate|@|Rs\.?|:|\s)*\s*([0-9\.,]+)(?:\s*\/([a-z]+|nos))?/i);
    if (rateMatch) {
      item.rate = parseFloat(rateMatch[1].replace(/,/g, '')) || 0;
      if (rateMatch[2]) item.unit = rateMatch[2].toLowerCase();
      item.description = item.description.substring(0, rateMatch.index).trim();
    }

    const unitMatch = item.description.match(/\b(sqm|sqft|sqf|cum|nos|kg|metre|meter|mtr|l\/s|ls)\b/i);
    if (unitMatch) {
      item.unit = unitMatch[1].toLowerCase();
    }

    item.description = item.description.replace(/\s+/g, ' ').trim();
  });

  return items.filter(i => i.code && i.description);
}

function renderOcrPreview() {
  const tbody = document.getElementById('ocr-preview-tbody');
  const countText = document.getElementById('ocr-preview-count');
  const panel = document.getElementById('ocr-preview-panel');
  const saveBtn = document.getElementById('ocr-save-catalog-btn');

  tbody.innerHTML = '';
  if (parsedOcrItems.length === 0) {
    alert('No valid DSR items detected. Please check your text format.');
    panel.style.display = 'none';
    saveBtn.disabled = true;
    return;
  }

  countText.innerText = `${parsedOcrItems.length} items detected. Review details below:`;
  parsedOcrItems.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="bold">${item.code}</td>
      <td style="font-size: 0.8rem;">${item.description.substring(0, 120)}...</td>
      <td>${item.unit}</td>
      <td class="bold">Rs. ${formatIndianCurrency(item.rate)}</td>
    `;
    tbody.appendChild(tr);
  });

  panel.style.display = 'block';
  saveBtn.disabled = false;
}

// PDF Exporter Execution
function runPdfExport(entryId) {
  if (!activeProject) return;
  const entry = activeProject.entries.find(e => e.id === entryId);
  if (!entry) return;

  const pdfData = {
    ...entry,
    workName: activeProject.workName,
    nbNote: activeProject.nbNote
  };

  exportToPDF(pdfData, entry.sketcherImage);
}

function saveActiveEntry_noExport() {
  if (!activeEntry || !activeProject) return;

  let sketcherBase64 = '';
  if (sketcher) {
    sketcherBase64 = sketcher.exportImage();
  }

  activeEntry.sketcherImage = sketcherBase64;
  saveActiveEntry(activeEntry.status);
}

function saveActiveEntryAndExportPDF() {
  saveActiveEntry_noExport();

  const pdfData = {
    ...activeEntry,
    workName: activeProject.workName,
    nbNote: activeProject.nbNote
  };

  exportToPDF(pdfData, activeEntry.sketcherImage);
}

// Save Modifications / Save & Finalize
document.getElementById('editor-complete-btn').addEventListener('click', () => {
  if (validateEditorForm()) {
    const isFinalize = document.getElementById('editor-complete-btn').innerText.includes('Finalize');

    if (isFinalize) {
      if (confirm('Are you sure you want to finalize this valuation entry? (This will mark it as completed and lock it from accidental edits)')) {
        activeEntry.status = 'completed';
        saveActiveEntry_noExport();
        alert('Valuation entry finalized successfully!');
        isNewEntryMode = false;
        if (activeProject) openProjectDetails(activeProject.id);
      }
    } else {
      if (confirm('Save modifications to this valuation report?')) {
        saveActiveEntry_noExport();
        // Show brief confirmation
        const btn = document.getElementById('editor-complete-btn');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="check"></i> Saved!';
        btn.style.background = '#16a34a';
        lucide.createIcons();
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; lucide.createIcons(); }, 2000);

        // Re-lock the inputs if it's completed
        if (activeEntry.status === 'completed') {
          toggleInputsLock(true);
          loadEntryToEditor();
        }
      }
    }
  }
});

// Manual Export PDF button
document.getElementById('editor-export-pdf-btn').addEventListener('click', () => {
  if (!activeEntry || !activeProject) return;
  // Save sketcher image before exporting
  if (sketcher) activeEntry.sketcherImage = sketcher.exportImage();
  const pdfData = {
    ...activeEntry,
    workName: activeProject.workName,
    nbNote: activeProject.nbNote
  };
  exportToPDF(pdfData, activeEntry.sketcherImage);
});

// ── PDF Template Settings ────────────────────────────────────────────────────

const PDF_TEMPLATE_KEY = 'valuroad_pdf_template';

export function getPdfTemplateSettings() {
  try {
    const saved = localStorage.getItem(PDF_TEMPLATE_KEY);
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return {
    basisText: 'D.S.R for CPWD Building for the year 2021',
    orgName: '',
    subtitle: '',
    margin: 8,
    fontSize: 10.5,
    imgQuality: 0.98,
    linePlanHeight: '170mm',
    nbDefault: '',
    depRate: 1,
    contractorPct: 15,
    photosPerRow: 2,
    photoHeight: '60mm'
  };
}

function setupPdfTemplate() {
  const fields = {
    basisText:      document.getElementById('tpl-basis-text'),
    orgName:        document.getElementById('tpl-org-name'),
    subtitle:       document.getElementById('tpl-subtitle'),
    margin:         document.getElementById('tpl-margin'),
    fontSize:       document.getElementById('tpl-font-size'),
    imgQuality:     document.getElementById('tpl-img-quality'),
    linePlanHeight: document.getElementById('tpl-lineplan-height'),
    nbDefault:      document.getElementById('tpl-nb-default'),
    depRate:        document.getElementById('tpl-dep-rate'),
    contractorPct:  document.getElementById('tpl-contractor-pct'),
    photosPerRow:   document.getElementById('tpl-photos-per-row'),
    photoHeight:    document.getElementById('tpl-photo-height')
  };
  const saveBtn  = document.getElementById('pdf-template-save-btn');
  const preview  = document.getElementById('pdf-tpl-preview');

  // Load saved settings into fields
  const settings = getPdfTemplateSettings();
  Object.keys(fields).forEach(key => {
    if (fields[key] && settings[key] !== undefined) {
      fields[key].value = settings[key];
    }
  });

  // Live preview renderer
  function renderPreview() {
    if (!preview) return;
    const org      = fields.orgName?.value.trim()    || '';
    const sub      = fields.subtitle?.value.trim()   || '';
    const basis    = fields.basisText?.value.trim()  || '';
    const fs       = parseFloat(fields.fontSize?.value) || 10.5;
    const depRate  = parseFloat(fields.depRate?.value) || 1;
    const cPct     = parseFloat(fields.contractorPct?.value) || 15;

    preview.style.fontSize = fs + 'pt';
    preview.innerHTML = `
      ${org ? `<div style="text-align:center;font-weight:bold;font-size:${fs+1}pt;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:8px;">${org}</div>` : ''}
      ${sub ? `<div style="text-align:center;font-weight:bold;font-size:${fs}pt;margin-bottom:10px;letter-spacing:0.5px;">${sub}</div>` : ''}
      <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:3px;">
        <div style="width:45mm;font-weight:bold;flex-shrink:0;">Name of Work</div>
        <div style="width:5mm;text-align:center;">:</div>
        <div style="flex-grow:1;font-weight:bold;font-style:italic;">Sample Valuation of Building</div>
      </div>
      <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:3px;">
        <div style="width:45mm;font-weight:bold;flex-shrink:0;">Name of Occupier</div>
        <div style="width:5mm;text-align:center;">:</div>
        <div style="flex-grow:1;">Ram Kumar Das</div>
      </div>
      <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:3px;">
        <div style="width:45mm;font-weight:bold;flex-shrink:0;">Village</div>
        <div style="width:5mm;text-align:center;">:</div>
        <div style="flex-grow:1;">Kaliabor, Nagaon</div>
      </div>
      <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:10px;">
        <div style="width:45mm;font-weight:bold;flex-shrink:0;">Year of Construction</div>
        <div style="width:5mm;text-align:center;">:</div>
        <div style="flex-grow:1;font-weight:bold;">2010</div>
      </div>
      <div style="font-size:${fs}pt;font-weight:500;margin-bottom:10px;">
        This estimate is prepared on the basis of ${basis || '…'}
      </div>
      <div style="border-top:1px solid #999;padding-top:6px;font-size:${fs-1}pt;color:#555;">
        <div style="display:flex;justify-content:space-between;"><span>Item 1 — RCC Structure (Sample)</span><span>Rs. 4,50,000</span></div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;"><span>Item 2 — Brick Masonry (Sample)</span><span>Rs. 1,20,000</span></div>
        <div style="display:flex;justify-content:flex-end;margin-top:6px;font-weight:bold;border-top:1px solid #999;padding-top:4px;"><span>TOTAL (A) = Rs. 5,70,000</span></div>
        <div style="display:flex;justify-content:flex-end;color:#444;"><span>Deduct ${cPct}% Contractor Profit = Rs. -${(5700000*cPct/100/100).toFixed(0)}</span></div>
        <div style="display:flex;justify-content:flex-end;margin-top:4px;font-weight:bold;"><span>GRAND TOTAL = Rs. 4,84,500</span></div>
      </div>
    `;
  }

  // Bind live preview on input
  Object.values(fields).forEach(el => {
    if (el) el.addEventListener('input', renderPreview);
  });
  renderPreview();

  // Save button
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const out = {};
      out.basisText      = fields.basisText?.value.trim()       || 'D.S.R for CPWD Building for the year 2021';
      out.orgName        = fields.orgName?.value.trim()         || '';
      out.subtitle       = fields.subtitle?.value.trim()        || '';
      out.margin         = parseFloat(fields.margin?.value)     || 8;
      out.fontSize       = parseFloat(fields.fontSize?.value)   || 10.5;
      out.imgQuality     = parseFloat(fields.imgQuality?.value) || 0.98;
      out.linePlanHeight = fields.linePlanHeight?.value         || '170mm';
      out.nbDefault      = fields.nbDefault?.value.trim()       || '';
      out.depRate        = parseFloat(fields.depRate?.value)    || 1;
      out.contractorPct  = parseFloat(fields.contractorPct?.value) || 15;
      out.photosPerRow   = parseInt(fields.photosPerRow?.value) || 2;
      out.photoHeight    = fields.photoHeight?.value            || '60mm';

      localStorage.setItem(PDF_TEMPLATE_KEY, JSON.stringify(out));
      if (auth.currentUser) {
        saveUserPdfTemplate(auth.currentUser.uid, out).catch(err => console.error("Error saving PDF template to Firestore:", err));
      }

      // Visual feedback
      saveBtn.textContent = '✓ Saved!';
      saveBtn.style.background = 'var(--success, #16a34a)';
      setTimeout(() => {
        saveBtn.innerHTML = '<i data-lucide="save"></i> Save Template';
        saveBtn.style.background = '';
        lucide.createIcons();
      }, 2000);
    });
  }
}

