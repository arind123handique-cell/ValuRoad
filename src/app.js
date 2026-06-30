import { DSR_CURATED } from './dsr_curated.js';
import { SiteSketcher } from './sketcher.js';
import { exportToPDF, formatIndianCurrency, numberToIndianWords, generateMixedPdf } from './pdf.js';
import { 
  auth, 
  loginUser, 
  registerUser, 
  logoutUser, 
  onAuthStateChanged,
  signInWithGoogle,
  sendPasswordReset,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  fetchUserProjects,
  saveUserProject,
  deleteUserProject,
  fetchUserCustomDsr,
  saveUserCustomDsr,
  fetchGlobalDsrCatalog,
  contributeItemToGlobalDsr,
  fetchUserPdfTemplate,
  saveUserPdfTemplate,
  fetchProjectById,
  saveProjectEntry,
  deleteProjectEntry
} from './firebase.js';
import packageInfo from '../package.json';

const lucide = window.lucide || { createIcons() {} };

// Application State
let projects = [];
let activeProject = null;
let activeEntry = null;
let originalEntryCopy = null;
let customDsrCatalog = [];
 let globalDsrCatalog = [];  // Community-shared items from all users
let gpsTraceNodes = [];
let sketcher = null;
let sketcherToolbarSetupDone = false;
let pdfTemplateSetupDone = false;
let statusBarSetupDone = false;
let isNewEntryMode = false;
let autoSyncInterval = null;

const DEFAULT_NB_NOTE = `This estimate has been prepared as per Addl. District Commissioner cum Competent Authority (LA), Golaghat vide order No. 2/2023/KNP-NK-37/ Dtd. Golaghat the 8th Dec'2025. The area to be acquisitioned for proposed implementation of wildlife-friendly measures proposed on Kaziranga National Park (KNP) stretch of NH-37 from Kaliabor (Ch. 315+315) to Numaligarh (Ch. 402+300) of NH-37 (New NH-715) under Golaghat District was shown by the Revenue & NHAI Officials during the Joint Survey. The above mentioned particulars of Occupier is subjected to be verified by Competent Authority. The application of the valuation estimate is the discretion of the Competent Authority.`;

// DOM Elements
const views = {
  dashboard: document.getElementById('view-dashboard'),
  projectDetails: document.getElementById('view-project-details'),
  projectEditor: document.getElementById('view-project-editor'),
  editor: document.getElementById('view-editor'),
  settings: document.getElementById('view-settings'),
  pdfTemplate: document.getElementById('view-pdf-template'),
  profile: document.getElementById('view-profile'),
  printPreview: document.getElementById('view-print-preview'),
  aiBulkEstimate: document.getElementById('view-ai-bulk-estimate')
};

const navBtns = {
  dashboard: document.getElementById('nav-projects-btn'),
  newProject: document.getElementById('nav-new-project-btn'),
  settings: document.getElementById('nav-settings-btn'),
  profile: document.getElementById('nav-profile-btn'),
  aiBulkEstimate: document.getElementById('nav-ai-bulk-estimate-btn')
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  const versionDisplay = document.getElementById('app-version-display');
  if (versionDisplay && packageInfo && packageInfo.version) {
    versionDisplay.innerText = `v${packageInfo.version} (Projects)`;
  }

  setupAuthUI();
  setupNavigation();
  setupDashboard();
  setupProjectDetails();
  setupProjectEditor();
  setupEditor();
  setupDsrSettings();
  setupAiBulkEstimate();
  setupProfileSettings();
  setupGpsTracingModal();
  setupProjectSharingModal();
  setupTheme();
  initPrintPreviewEvents();
  initParticles(); // start background effect


  // Mobile Navigation toggle
  const openMenuBtn = document.getElementById('mobile-menu-open-btn');
  const closeMenuBtn = document.getElementById('mobile-menu-close-btn');
  const asideElement = document.querySelector('aside');

  // Desktop Sidebar Toggle
  const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
  const sidebarExpandBtn = document.getElementById('sidebar-expand-btn');

  if (sidebarCollapseBtn && asideElement) {
    sidebarCollapseBtn.addEventListener('click', () => {
      asideElement.classList.add('collapsed');
    });
  }
  if (sidebarExpandBtn && asideElement) {
    sidebarExpandBtn.addEventListener('click', () => {
      asideElement.classList.remove('collapsed');
    });
  }

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
        const updatedProjects = await fetchUserProjects(user.uid, user.email);
        updateProjectsList(updatedProjects);
        saveProjects(); // cache locally
        renderProjects();
        updateGlobalMetrics();

        // Fetch custom DSR catalog (private, per-user)
        customDsrCatalog = await fetchUserCustomDsr(user.uid);
        saveCustomDsrCatalog(); // cache locally

        // Fetch global community DSR catalog (shared across all users)
        globalDsrCatalog = await fetchGlobalDsrCatalog();
        console.log(`Loaded ${globalDsrCatalog.length} community DSR items.`);

        // Fetch PDF template settings
        const tplSettings = await fetchUserPdfTemplate(user.uid);
        if (tplSettings) {
          localStorage.setItem(PDF_TEMPLATE_KEY, JSON.stringify(tplSettings));
        }
        setupPdfTemplate(); // redraw template settings fields
        startAutoSync();
        setupStatusBar();
        setupSketcherToolbar();
        startAutoBackup();
        const aiTrigger = document.getElementById('sidebar-ai-chat-trigger');
        if (aiTrigger) aiTrigger.style.display = 'flex';
        setSyncStatus('ok', `Signed in · ${user.email}`);
      } catch (e) {
        setSyncStatus('error', 'Sync error');
        console.error('Sync Error:', e);
      }
    } else {
      // User is logged out
      if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
      }
      if (autoBackupInterval) {
        clearInterval(autoBackupInterval);
        autoBackupInterval = null;
      }
      setSyncStatus('idle', 'Not signed in');
      authOverlay.style.display = 'flex';
      sidebarProfile.style.display = 'none';
      const aiTrigger = document.getElementById('sidebar-ai-chat-trigger');
      if (aiTrigger) aiTrigger.style.display = 'none';
      const chatbox = document.getElementById('estimator-ai-chatbox');
      if (chatbox) chatbox.classList.remove('active');
      
      // Clear app state
      projects = [];
      activeProject = null;
      activeEntry = null;
      customDsrCatalog = [];
      
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

function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-circle';
  if (type === 'info') iconName = 'info';

  toast.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
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
      if (confirmLeaveEditor()) {
        switchView('settings');
        // Refresh the catalog table with latest data every time the view opens
        const tbody = document.getElementById('catalog-table-body');
        const lbl   = document.getElementById('catalog-count-label');
        const srch  = document.getElementById('catalog-search-input');
        if (tbody) {
          const q = srch ? srch.value : '';
          const total = customDsrCatalog.length;
          if (lbl) lbl.textContent = `${total} saved item${total !== 1 ? 's' : ''} in your catalog`;
          if (total === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">Your catalog is empty. Add items above or save an estimate.</td></tr>`;
          } else {
            // Trigger full re-render by dispatching an input event on the search box
            if (srch) srch.dispatchEvent(new Event('input'));
            else tbody.dispatchEvent(new CustomEvent('catalog-refresh'));
          }
        }
      }
    });
  }
  if (navBtns.pdfTemplate) {
    navBtns.pdfTemplate.addEventListener('click', () => {
      if (confirmLeaveEditor()) switchView('pdfTemplate');
    });
  }
  if (navBtns.profile) {
    navBtns.profile.addEventListener('click', () => {
      if (confirmLeaveEditor()) switchView('profile');
    });
  }
  if (navBtns.aiBulkEstimate) {
    navBtns.aiBulkEstimate.addEventListener('click', () => {
      if (confirmLeaveEditor()) {
        switchView('aiBulkEstimate');
        if (typeof refreshBulkProjectSelector === 'function') refreshBulkProjectSelector();
      }
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

  const mainEl = document.querySelector('main');
  if (mainEl) {
    if (viewName === 'pdfTemplate' || viewName === 'printPreview') {
      mainEl.style.display = 'none';
    } else {
      mainEl.style.display = '';
    }
  }

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
let currentAuthTab = 'login'; // 'login', 'signup', 'phone-send', 'phone-verify', or 'forgot-password'

function setupAuthUI() {
  const authTabLogin = document.getElementById('auth-tab-login');
  const authTabSignup = document.getElementById('auth-tab-signup');
  const authTabPhone = document.getElementById('auth-tab-phone');
  const authForm = document.getElementById('auth-form');
  const authEmailInput = document.getElementById('auth-email');
  const authPasswordInput = document.getElementById('auth-password');
  const authRePasswordInput = document.getElementById('auth-re-password');
  const authSubmitBtn = document.getElementById('auth-submit-btn');
  const authErrorMsg = document.getElementById('auth-error-msg');
  const logoutBtn = document.getElementById('auth-logout-btn');

  // UI Elements
  const authCardTitle = document.getElementById('auth-card-title');
  const authCardDesc = document.getElementById('auth-card-desc');
  const authTabsContainer = document.getElementById('auth-tabs-container');
  const authEmailGroup = document.getElementById('auth-email-group');
  const authPasswordGroup = document.getElementById('auth-password-group');
  const signupConfirmGroup = document.getElementById('signup-confirm-password-group');
  const authPhoneGroup = document.getElementById('auth-phone-group');
  const authOtpGroup = document.getElementById('auth-otp-group');
  const recaptchaContainer = document.getElementById('recaptcha-container');
  const forgotPasswordLink = document.getElementById('forgot-password-link');
  const googleSigninBtn = document.getElementById('google-signin-btn');
  const authDivider = document.getElementById('auth-divider');
  const backToLoginContainer = document.getElementById('back-to-login-container');
  const backToLoginLink = document.getElementById('back-to-login-link');

  let confirmationResult = null;
  let recaptchaVerifier = null;

  const resetRecaptcha = () => {
    if (recaptchaVerifier) {
      try {
        recaptchaVerifier.clear();
      } catch (e) {
        console.warn("Recaptcha clear error:", e);
      }
      recaptchaVerifier = null;
      if (recaptchaContainer) recaptchaContainer.innerHTML = '';
    }
  };

  const switchToLogin = () => {
    currentAuthTab = 'login';
    resetRecaptcha();
    if (authTabLogin) authTabLogin.classList.add('active');
    if (authTabSignup) authTabSignup.classList.remove('active');
    if (authTabPhone) authTabPhone.classList.remove('active');
    if (authCardTitle) authCardTitle.innerText = 'Welcome back';
    if (authCardDesc) authCardDesc.innerText = 'Please enter your details to sign in.';
    if (authTabsContainer) authTabsContainer.style.display = 'flex';
    if (authEmailGroup) authEmailGroup.style.display = 'block';
    if (authPasswordGroup) authPasswordGroup.style.display = 'block';
    if (signupConfirmGroup) signupConfirmGroup.style.display = 'none';
    if (authPhoneGroup) authPhoneGroup.style.display = 'none';
    if (authOtpGroup) authOtpGroup.style.display = 'none';
    if (authEmailInput) authEmailInput.required = true;
    if (authPasswordInput) authPasswordInput.required = true;
    if (authRePasswordInput) authRePasswordInput.required = false;
    const phoneInput = document.getElementById('auth-phone');
    const otpInput = document.getElementById('auth-otp');
    if (phoneInput) phoneInput.required = false;
    if (otpInput) otpInput.required = false;
    if (forgotPasswordLink) forgotPasswordLink.style.display = 'inline-block';
    if (authDivider) authDivider.style.display = 'flex';
    if (googleSigninBtn) googleSigninBtn.style.display = 'flex';
    if (backToLoginContainer) backToLoginContainer.style.display = 'none';
    authSubmitBtn.innerHTML = 'Log In <i data-lucide="arrow-right" style="width:16px;height:16px;margin-left:0.5rem;"></i>';
    if (window.lucide) lucide.createIcons();
    authErrorMsg.style.display = 'none';
  };

  const switchToSignup = () => {
    currentAuthTab = 'signup';
    resetRecaptcha();
    if (authTabSignup) authTabSignup.classList.add('active');
    if (authTabLogin) authTabLogin.classList.remove('active');
    if (authTabPhone) authTabPhone.classList.remove('active');
    if (authCardTitle) authCardTitle.innerText = 'Create an account';
    if (authCardDesc) authCardDesc.innerText = 'Fill in the form to get started.';
    if (authTabsContainer) authTabsContainer.style.display = 'flex';
    if (authEmailGroup) authEmailGroup.style.display = 'block';
    if (authPasswordGroup) authPasswordGroup.style.display = 'block';
    if (signupConfirmGroup) signupConfirmGroup.style.display = 'block';
    if (authPhoneGroup) authPhoneGroup.style.display = 'none';
    if (authOtpGroup) authOtpGroup.style.display = 'none';
    if (authEmailInput) authEmailInput.required = true;
    if (authPasswordInput) authPasswordInput.required = true;
    if (authRePasswordInput) authRePasswordInput.required = true;
    const phoneInput = document.getElementById('auth-phone');
    const otpInput = document.getElementById('auth-otp');
    if (phoneInput) phoneInput.required = false;
    if (otpInput) otpInput.required = false;
    if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
    if (authDivider) authDivider.style.display = 'flex';
    if (googleSigninBtn) googleSigninBtn.style.display = 'flex';
    if (backToLoginContainer) backToLoginContainer.style.display = 'none';
    authSubmitBtn.innerHTML = 'Create Account <i data-lucide="arrow-right" style="width:16px;height:16px;margin-left:0.5rem;"></i>';
    if (window.lucide) lucide.createIcons();
    authErrorMsg.style.display = 'none';
  };

  const switchToPhone = () => {
    currentAuthTab = 'phone-send';
    confirmationResult = null;
    resetRecaptcha();
    if (authTabPhone) authTabPhone.classList.add('active');
    if (authTabLogin) authTabLogin.classList.remove('active');
    if (authTabSignup) authTabSignup.classList.remove('active');
    if (authCardTitle) authCardTitle.innerText = 'Phone Login';
    if (authCardDesc) authCardDesc.innerText = 'Enter your phone number to receive an OTP.';
    if (authTabsContainer) authTabsContainer.style.display = 'flex';
    if (authEmailGroup) authEmailGroup.style.display = 'none';
    if (authPasswordGroup) authPasswordGroup.style.display = 'none';
    if (signupConfirmGroup) signupConfirmGroup.style.display = 'none';
    if (authPhoneGroup) authPhoneGroup.style.display = 'block';
    if (authOtpGroup) authOtpGroup.style.display = 'none';
    if (authEmailInput) authEmailInput.required = false;
    if (authPasswordInput) authPasswordInput.required = false;
    if (authRePasswordInput) authRePasswordInput.required = false;
    const phoneInput = document.getElementById('auth-phone');
    const otpInput = document.getElementById('auth-otp');
    if (phoneInput) { phoneInput.required = true; phoneInput.value = ''; }
    if (otpInput) { otpInput.required = false; otpInput.value = ''; }
    if (authDivider) authDivider.style.display = 'flex';
    if (googleSigninBtn) googleSigninBtn.style.display = 'flex';
    if (backToLoginContainer) backToLoginContainer.style.display = 'none';
    authSubmitBtn.innerHTML = 'Send OTP <i data-lucide="message-square" style="width:16px;height:16px;margin-left:0.5rem;"></i>';
    if (window.lucide) lucide.createIcons();
    authErrorMsg.style.display = 'none';
  };

  const switchToForgotPassword = () => {
    currentAuthTab = 'forgot-password';
    resetRecaptcha();
    if (authCardTitle) authCardTitle.innerText = 'Reset Password';
    if (authCardDesc) authCardDesc.innerText = 'Enter your email to receive a password reset link.';
    if (authTabsContainer) authTabsContainer.style.display = 'none';
    if (authEmailGroup) authEmailGroup.style.display = 'block';
    if (authPasswordGroup) authPasswordGroup.style.display = 'none';
    if (signupConfirmGroup) signupConfirmGroup.style.display = 'none';
    if (authPhoneGroup) authPhoneGroup.style.display = 'none';
    if (authOtpGroup) authOtpGroup.style.display = 'none';
    if (authEmailInput) authEmailInput.required = true;
    if (authPasswordInput) authPasswordInput.required = false;
    if (authRePasswordInput) authRePasswordInput.required = false;
    const phoneInput = document.getElementById('auth-phone');
    const otpInput = document.getElementById('auth-otp');
    if (phoneInput) phoneInput.required = false;
    if (otpInput) otpInput.required = false;
    if (authDivider) authDivider.style.display = 'none';
    if (googleSigninBtn) googleSigninBtn.style.display = 'none';
    if (backToLoginContainer) backToLoginContainer.style.display = 'block';
    authSubmitBtn.innerHTML = 'Send Reset Link <i data-lucide="mail" style="width:16px;height:16px;margin-left:0.5rem;"></i>';
    if (window.lucide) lucide.createIcons();
    authErrorMsg.style.display = 'none';
  };

  if (authTabLogin) {
    authTabLogin.addEventListener('click', switchToLogin);
  }

  if (authTabSignup) {
    authTabSignup.addEventListener('click', switchToSignup);
  }

  if (authTabPhone) {
    authTabPhone.addEventListener('click', switchToPhone);
  }

  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', switchToForgotPassword);
  }

  if (backToLoginLink) {
    backToLoginLink.addEventListener('click', switchToLogin);
  }

  if (googleSigninBtn) {
    googleSigninBtn.addEventListener('click', async () => {
      authErrorMsg.style.display = 'none';
      const origText = googleSigninBtn.innerHTML;
      googleSigninBtn.disabled = true;
      googleSigninBtn.innerHTML = 'Signing in...';
      try {
        await signInWithGoogle();
      } catch (err) {
        console.error(err);
        authErrorMsg.textContent = formatAuthError(err.code || err.message);
        authErrorMsg.style.display = 'block';
        googleSigninBtn.disabled = false;
        googleSigninBtn.innerHTML = origText;
      }
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      authErrorMsg.style.display = 'none';

      const email = authEmailInput ? authEmailInput.value.trim() : '';
      const password = authPasswordInput ? authPasswordInput.value : '';

      // Signup Validation
      if (currentAuthTab === 'signup') {
        const rePassword = authRePasswordInput.value;
        if (password !== rePassword) {
          authErrorMsg.textContent = 'Passwords do not match.';
          authErrorMsg.style.display = 'block';
          return;
        }
      }

      authSubmitBtn.disabled = true;
      const origText = authSubmitBtn.innerHTML;
      authSubmitBtn.textContent = 'Please wait...';

      try {
        if (currentAuthTab === 'login') {
          await loginUser(email, password);
        } else if (currentAuthTab === 'signup') {
          await registerUser(email, password);
        } else if (currentAuthTab === 'forgot-password') {
          await sendPasswordReset(email);
          alert('Password reset email sent! Please check your inbox.');
          switchToLogin();
        } else if (currentAuthTab === 'phone-send') {
          const phoneNumber = document.getElementById('auth-phone').value.trim();
          if (!phoneNumber) {
            throw new Error('Please enter a valid phone number.');
          }

          if (!recaptchaVerifier) {
            recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
              'size': 'invisible',
              'callback': (response) => {
                // reCAPTCHA solved
              }
            });
          }

          confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
          
          currentAuthTab = 'phone-verify';
          if (authCardDesc) authCardDesc.innerText = 'Enter the 6-digit OTP code sent to your phone.';
          if (authPhoneGroup) authPhoneGroup.style.display = 'none';
          if (authOtpGroup) authOtpGroup.style.display = 'block';
          const phoneInput = document.getElementById('auth-phone');
          const otpInput = document.getElementById('auth-otp');
          if (phoneInput) phoneInput.required = false;
          if (otpInput) { otpInput.required = true; otpInput.value = ''; }
          authSubmitBtn.innerHTML = 'Verify OTP <i data-lucide="check" style="width:16px;height:16px;margin-left:0.5rem;"></i>';
          if (window.lucide) lucide.createIcons();
          authSubmitBtn.disabled = false;
        } else if (currentAuthTab === 'phone-verify') {
          const code = document.getElementById('auth-otp').value.trim();
          if (!code) {
            throw new Error('Please enter verification code.');
          }
          await confirmationResult.confirm(code);
          // Signs in automatically
        }
      } catch (err) {
        console.error(err);
        authErrorMsg.textContent = formatAuthError(err.code || err.message);
        authErrorMsg.style.display = 'block';
        authSubmitBtn.disabled = false;
        authSubmitBtn.innerHTML = origText;
        if (window.lucide) lucide.createIcons();
        resetRecaptcha();
        if (currentAuthTab === 'phone-verify') {
          switchToPhone();
        }
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
  // Bypassed localStorage to avoid multi-device conflicts, loading directly from Firestore
  projects = [];
}

function saveProjects() {
  // Silent local backup trigger for active project.
  // Cloud sync happens via saveUserProject/saveProjectEntry.
  if (activeProject) {
    triggerLocalBackup(activeProject);
  }
}

function updateProjectsList(updatedProjects) {
  // Merge updatedProjects with existing projects to preserve entries lists in memory
  projects = updatedProjects.map(up => {
    const existing = projects.find(p => p.id === up.id);
    if (existing && existing.entries) {
      return { ...up, entries: existing.entries };
    }
    return up;
  });
}

function loadCustomDsrCatalog() {
  try {
    customDsrCatalog = JSON.parse(localStorage.getItem('customDsrCatalog')) || [];
  } catch (e) {
    customDsrCatalog = [];
  }
}

function saveCustomDsrCatalog() {
  try {
    localStorage.setItem('customDsrCatalog', JSON.stringify(customDsrCatalog));
  } catch (e) {
    console.warn('LocalStorage quota exceeded for DSR Catalog:', e);
  }
}

// Project Dashboard View
function setupDashboard() {
  const createBtn = document.getElementById('dash-create-project-btn');
  if (createBtn) {
    createBtn.addEventListener('click', () => initNewProject());
  }

  const refreshBtn = document.getElementById('dash-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      const originalHtml = refreshBtn.innerHTML;
      refreshBtn.innerHTML = '<i data-lucide="refresh-cw" class="spin" style="width: 15px; height: 15px; display: inline-block; vertical-align: middle;"></i> Syncing...';
      lucide.createIcons();
      
      if (auth.currentUser) {
        try {
          const updatedProjects = await fetchUserProjects(auth.currentUser.uid, auth.currentUser.email);
          updateProjectsList(updatedProjects);
          saveProjects();
          renderProjects();
        } catch (err) {
          console.error("Failed to sync projects:", err);
          alert("Failed to sync from database. Please check connection.");
        }
      }

      refreshBtn.innerHTML = originalHtml;
      refreshBtn.disabled = false;
      lucide.createIcons();
    });
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
      const entriesCount = p.entries ? p.entries.length : (p.entriesCount || 0);
      const totalValuation = p.entries ? p.entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0) : (p.totalValuation || 0);

      // Determine ownership and sharing status
      const isOwner = !p.ownerId || (auth.currentUser && p.ownerId === auth.currentUser.uid);
      let shareBadge = '';
      if (!isOwner) {
        shareBadge = `<span class="project-share-badge shared-in" style="background-color: var(--accent-light); color: var(--accent); font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: 0.25rem; display: inline-block; margin-top: 0.25rem; font-weight: 500;">Shared by ${p.ownerEmail || 'another user'}</span>`;
      } else if (p.sharedWith && p.sharedWith.length > 0) {
        shareBadge = `<span class="project-share-badge shared-out" style="background-color: #f0fdf4; color: #15803d; font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: 0.25rem; display: inline-block; margin-top: 0.25rem; font-weight: 500;">Shared with ${p.sharedWith.length} user${p.sharedWith.length > 1 ? 's' : ''}</span>`;
      }

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; font-size: 0.95rem;">${p.workName || 'Untitled Project'}</div>
          ${shareBadge}
        </td>
        <td>
          <div style="color: var(--text-muted); font-size: 0.85rem;">${p.location || 'N/A'}</div>
        </td>
        <td style="text-align: center; font-weight: 500;">${entriesCount}</td>
        <td style="font-weight: bold; color: var(--accent);">Rs. ${formatIndianCurrency(totalValuation)}</td>
        <td>
          <div class="action-btns" onclick="event.stopPropagation();">
            <button class="view-btn" title="View Project Details" data-id="${p.id}"><i data-lucide="eye"></i></button>
            <button class="share-btn" title="${isOwner ? 'Share Project' : 'View Collaborators'}" data-id="${p.id}" style="color: var(--accent);"><i data-lucide="share-2"></i></button>
            ${isOwner ? `<button class="delete-btn" title="Delete Project" data-id="${p.id}" style="color: var(--danger);"><i data-lucide="trash-2"></i></button>` : ''}
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
    tbody.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', () => openShareModal(btn.dataset.id));
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
  const p = projects.find(proj => proj.id === id);
  if (!p) return;

  const isOwner = !p.ownerId || (auth.currentUser && p.ownerId === auth.currentUser.uid);
  if (!isOwner) {
    alert("You do not have permission to delete this project. Only the project creator can delete it.");
    return;
  }

  const msg = 'Are you sure you want to delete this infrastructure project? This will delete all affected owner entries under it.';

  if (confirm(msg)) {
    projects = projects.filter(p => p.id !== id);
    saveProjects();
    if (auth.currentUser) {
      deleteUserProject(auth.currentUser.uid, id).catch(err => console.error("Error deleting project from Firestore:", err));
    }
    renderProjects();
  }
}

async function openProjectDetails(projectId) {
  // Fetch latest project details first on open to prevent stale data
  if (auth.currentUser) {
    try {
      const updated = await fetchProjectById(projectId);
      if (updated) {
        const idx = projects.findIndex(p => p.id === projectId);
        if (idx !== -1) {
          projects[idx] = updated;
        } else {
          projects.push(updated);
        }
        saveProjects();
      }
    } catch (err) {
      console.warn("Failed to fetch project update on load:", err);
    }
  }

  const p = projects.find(proj => proj.id === projectId);
  if (!p) return;
  activeProject = p;
  switchView('projectDetails');
}

function setupProjectDetails() {
  document.getElementById('project-back-btn').addEventListener('click', () => {
    switchView('dashboard');
  });

  const refreshBtn = document.getElementById('project-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (!activeProject) return;
      refreshBtn.disabled = true;
      const originalHtml = refreshBtn.innerHTML;
      refreshBtn.innerHTML = '<i data-lucide="refresh-cw" class="spin" style="width: 15px; height: 15px; display: inline-block; vertical-align: middle;"></i> Syncing...';
      lucide.createIcons();

      if (auth.currentUser) {
        try {
          const updated = await fetchProjectById(activeProject.id);
          if (updated) {
            const idx = projects.findIndex(p => p.id === activeProject.id);
            if (idx !== -1) {
              projects[idx] = updated;
            }
            activeProject = updated;
            saveProjects();
            renderProjectDetails();
          }
        } catch (err) {
          console.error("Failed to sync project details:", err);
          alert("Failed to sync from database.");
        }
      }

      refreshBtn.innerHTML = originalHtml;
      refreshBtn.disabled = false;
      lucide.createIcons();
    });
  }

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

  document.getElementById('proj-export-excel-btn').addEventListener('click', () => {
    if (activeProject) exportProjectToExcel();
  });

  document.getElementById('proj-export-word-btn').addEventListener('click', () => {
    if (activeProject) exportProjectToWord();
  });

  document.getElementById('proj-print-btn').addEventListener('click', () => {
    if (activeProject) printProjectOwnerList();
  });

  const projShowJms = document.getElementById('project-show-jms-sl');
  if (projShowJms) {
    projShowJms.addEventListener('change', (e) => {
      const settings = getPdfTemplateSettings();
      settings.showJmsSlNo = e.target.checked;
      localStorage.setItem(PDF_TEMPLATE_KEY, JSON.stringify(settings));
      if (auth.currentUser) {
        saveUserPdfTemplate(auth.currentUser.uid, settings).catch(err => {});
      }
    });
  }

  const searchInput = document.getElementById('owner-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', renderProjectDetails);
  }

  const filterStatus = document.getElementById('owner-filter-status');
  if (filterStatus) {
    filterStatus.addEventListener('change', renderProjectDetails);
  }
}

function exportProjectToExcel() {
  if (!activeProject || !activeProject.entries || activeProject.entries.length === 0) {
    alert("No owner entries available to export.");
    return;
  }

  const headers = [
    "Sl. No.",
    "JMS Sl. No.",
    "Owner / Occupant",
    "Village / Location",
    "GPS Latitude",
    "GPS Longitude",
    "Status",
    "Total A (Structure Value)",
    "Contractor Deduction (15%)",
    "Total B (Net Structure Value)",
    "Structure Age (Years)",
    "Depreciation Rate (%)",
    "Total Depreciation (%)",
    "Depreciation Amount",
    "Value After Depreciation",
    "Electrification Cost",
    "Sanitation Cost",
    "Grand Total Valuation (Rs.)"
  ];

  const rows = activeProject.entries.map((e, idx) => [
    idx + 1,
    e.jmsSlNo || "",
    e.clientName || "Unnamed Owner",
    e.location || "N/A",
    e.gpsLat || "",
    e.gpsLon || "",
    e.status || "draft",
    e.totalA || 0,
    e.contractorDeduction || 0,
    e.totalB || 0,
    e.structureAge || 0,
    e.depreciationPct || 0,
    e.totalDepreciationPct || 0,
    e.depreciationAmount || 0,
    e.totalAfterDepreciation || 0,
    e.electrificationCost || 0,
    e.sanitaryCost || 0,
    e.grandTotal || 0
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(val => {
      let cell = String(val === null || val === undefined ? '' : val);
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        cell = '"' + cell.replace(/"/g, '""') + '"';
      }
      return cell;
    }).join(","))
  ].join("\r\n");

  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  // Truncate filename to 50 characters max
  const cleanName = activeProject.workName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  const namePart = cleanName.substring(0, 35).replace(/_$/, '');
  const filename = `${namePart}_owner_list.csv`;
  
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportSingleEstimateToExcel(entryId) {
  if (!activeProject) return;
  const rawEntry = activeProject.entries.find(e => e.id === entryId);
  if (!rawEntry) return;
  const entry = {
    ...rawEntry,
    workName: activeProject.workName,
    nbNote: activeProject.nbNote
  };

  const tpl = getPdfTemplateSettings();
  const includedItems = (entry.items || []).filter(item => item.includeInValuation);
  const depreciatedItems = includedItems.filter(item => !item.excludeFromDepreciation);
  const excludedItems = includedItems.filter(item => item.excludeFromDepreciation);

  let htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<!--[if gte mso 9]>
<xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>Valuation Estimate</x:Name>
    <x:WorksheetOptions>
     <x:DisplayGridlines/>
    </x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
  body { font-family: Arial, sans-serif; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 0.5pt solid #cbd5e1; padding: 6px; vertical-align: middle; font-family: Arial, sans-serif; }
  .title-header { text-align: center; font-size: 14pt; font-weight: bold; background-color: #f8fafc; }
  .subtitle-header { text-align: center; font-size: 11pt; font-weight: bold; }
  .meta-label { font-weight: bold; background-color: #f1f5f9; width: 180px; }
  .section-header { font-weight: bold; background-color: #cbd5e1; font-size: 11pt; text-align: left; }
  .item-title-row td { font-weight: bold; background-color: #f8fafc; border-top: 1px solid #94a3b8; }
  .m-header td { font-weight: bold; color: #475569; background-color: #f1f5f9; font-size: 9pt; }
  .m-total-row td { font-weight: bold; background-color: #f8fafc; border-top: 0.5pt solid #cbd5e1; }
  .bold-right { font-weight: bold; text-align: right; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .grand-total-row td { font-weight: bold; font-size: 12pt; background-color: #cbd5e1; border-top: 2px solid #000; border-bottom: 2px solid #000; }
  .service-item-row td { background-color: #fafafa; }
</style>
</head>
<body>
<table>
  <!-- Organization & Subtitle -->
  ${tpl.orgName ? `<tr><td colspan="6" class="title-header">${tpl.orgName}</td></tr>` : ''}
  ${tpl.subtitle ? `<tr><td colspan="6" class="subtitle-header">${tpl.subtitle}</td></tr>` : ''}
  
  <!-- Empty row -->
  <tr><td colspan="6" style="border:none; height:10px;"></td></tr>

  <!-- Metadata Header -->
  <tr>
    <td class="meta-label">Name of Work:</td>
    <td colspan="5" style="font-weight: bold;">${entry.workName || 'N/A'}</td>
  </tr>
  <tr>
    <td class="meta-label">Name of Occupier:</td>
    <td colspan="5">${entry.clientName || 'N/A'}</td>
  </tr>
  <tr>
    <td class="meta-label">Village/Location:</td>
    <td colspan="5">${entry.location || 'N/A'}</td>
  </tr>
  ${entry.jmsSlNo ? `
  <tr>
    <td class="meta-label">As per JMS report Sl NO:</td>
    <td colspan="5">${entry.jmsSlNo}</td>
  </tr>
  ` : ''}
  ${entry.enableDepreciation !== false ? `
  <tr>
    <td class="meta-label">Year of Construction:</td>
    <td colspan="5">${entry.constructionYear || 'N/A'} ${entry.constructionYearComment ? `(${entry.constructionYearComment})` : ''}</td>
  </tr>
  ` : ''}
  <tr>
    <td class="meta-label">Basis:</td>
    <td colspan="5">This estimate is prepared on the basis of ${tpl.basisText}</td>
  </tr>
  
  <!-- Empty row -->
  <tr><td colspan="6" style="border:none; height:15px;"></td></tr>

  <!-- Section: Items Subject to Depreciation -->
  <tr><td colspan="6" class="section-header">A. ITEMS SUBJECT TO DEPRECIATION</td></tr>
  `;

  function appendItems(itemList) {
    itemList.forEach(item => {
      let itemNoText = item.itemNo;
      if (!/item/i.test(itemNoText)) {
        itemNoText = 'Item No. ' + itemNoText;
      }
      let depInfo = '';
      if (item.customDepreciation) {
        const totalPct = (item.customDepreciationPct || 0) * (item.customDepreciationAge || 0);
        depInfo = ` (Depreciation: ${item.customDepreciationPct}%/yr for ${item.customDepreciationAge} yrs = ${totalPct}%)`;
      }

      htmlContent += `
        <tr class="item-title-row">
          <td colspan="5">${itemNoText}: ${item.title}${depInfo}</td>
          <td class="text-right">Rs. ${formatIndianCurrency(item.totalCost)}</td>
        </tr>
      `;

      if (item.description) {
        htmlContent += `
          <tr>
            <td colspan="6" style="font-style: italic; color: #475569; font-size: 9.5pt; padding-left: 15px;">${item.description}</td>
          </tr>
        `;
      }

      if (item.type === 'quantity-rate') {
        const measurements = item.measurements || [];
        if (measurements.length > 0) {
          htmlContent += `
            <tr class="m-header">
              <td style="padding-left:15px;">Description</td>
              <td class="text-center">Nos</td>
              <td colspan="2">L x B x H</td>
              <td class="text-right">Qty</td>
              <td>Unit</td>
            </tr>
          `;
          measurements.forEach(m => {
            const nos = parseFloat(m.nos) || 0;
            const l = parseFloat(m.l);
            const b = parseFloat(m.b);
            const h = parseFloat(m.h);
            const hasL = !isNaN(l) && m.l !== '';
            const hasB = !isNaN(b) && m.b !== '';
            const hasH = !isNaN(h) && m.h !== '';
            const hasDims = hasL || hasB || hasH;
            let dimStr = '';
            if (hasDims) {
              const parts = [];
              if (hasL) parts.push(l.toFixed(3) + 'm');
              if (hasB) parts.push(b.toFixed(3) + 'm');
              if (hasH) parts.push(h.toFixed(3) + 'm');
              dimStr = parts.join(' x ');
            }
            const subQty = parseFloat(m.subQty) || 0;
            htmlContent += `
              <tr>
                <td style="padding-left:15px;">${m.description || ''}</td>
                <td class="text-center">${nos}</td>
                <td colspan="2">${dimStr}</td>
                <td class="text-right">${subQty.toFixed(3)}</td>
                <td>${item.unit}</td>
              </tr>
            `;
          });
          htmlContent += `
            <tr class="m-total-row">
              <td colspan="4" class="text-right">Total Quantity</td>
              <td class="text-right">${item.quantity.toFixed(3)}</td>
              <td>${item.unit}</td>
            </tr>
          `;
        } else {
          htmlContent += `
            <tr>
              <td style="padding-left:15px;" colspan="4">Quantity</td>
              <td class="text-right">${item.quantity.toFixed(2)}</td>
              <td>${item.unit}</td>
            </tr>
          `;
        }
      } else if (item.type === 'plinth-area') {
        const rooms = item.rooms || [];
        if (rooms.length > 0) {
          htmlContent += `
            <tr class="m-header">
              <td style="padding-left:15px;">Room Details</td>
              <td colspan="3">Dimensions (L x W)</td>
              <td class="text-right">Area</td>
              <td>Unit</td>
            </tr>
          `;
          rooms.forEach(r => {
            htmlContent += `
              <tr>
                <td style="padding-left:15px;">${r.name || 'Room'}</td>
                <td colspan="3">${parseFloat(r.l).toFixed(2)} m x ${parseFloat(r.w).toFixed(2)} m</td>
                <td class="text-right">${parseFloat(r.areaSqm).toFixed(2)}</td>
                <td>sqm</td>
              </tr>
            `;
          });
          htmlContent += `
            <tr class="m-total-row">
              <td colspan="4" class="text-right">Total Plinth Area</td>
              <td class="text-right">${parseFloat(item.totalAreaSqm).toFixed(2)}</td>
              <td>sqm</td>
            </tr>
          `;
          if (item.unit === 'sqf' && parseFloat(item.totalAreaSqft) > 0) {
            htmlContent += `
              <tr class="m-total-row">
                <td colspan="4" class="text-right">Total Plinth Area in sq.foot</td>
                <td class="text-right">${parseFloat(item.totalAreaSqft).toFixed(2)}</td>
                <td>sqf</td>
              </tr>
            `;
          }
        }
      }

      // Rate Line
      const rawCost = (item.type === 'plinth-area')
        ? (item.unit === 'sqf' ? item.totalAreaSqft : item.totalAreaSqm) * item.rate
        : (item.type === 'quantity-rate' ? item.quantity * item.rate : item.rate);

      htmlContent += `
        <tr>
          <td style="padding-left:15px;" colspan="4">@ Rs. ${formatIndianCurrency(item.rate)} / ${item.unit || 'L/S'} (As per approved rate)</td>
          <td>=</td>
          <td class="text-right">Rs. ${formatIndianCurrency(rawCost)}</td>
        </tr>
      `;

      if (item.deductionPct > 0) {
        htmlContent += `
          <tr>
            <td style="padding-left:15px;" colspan="4">Ded. ${item.deductionPct}% for ${item.deductionLabel || 'non conformity'}</td>
            <td>=</td>
            <td class="text-right">Rs. -${formatIndianCurrency(item.deductionAmount)}</td>
          </tr>
          <tr style="font-weight: bold;">
            <td style="padding-left:15px;" colspan="4">Net Amount</td>
            <td>=</td>
            <td class="text-right">Rs. ${formatIndianCurrency(item.totalCost)}</td>
          </tr>
        `;
      }
    });
  }

  appendItems(depreciatedItems);

  // Subtotals
  htmlContent += `
    <!-- Subtotals Section -->
    <tr><td colspan="6" style="border:none; height:10px;"></td></tr>
    <tr style="font-weight: bold; background-color: #f1f5f9;">
      <td colspan="4" class="text-right">TOTAL (A)</td>
      <td>=</td>
      <td class="text-right">Rs. ${formatIndianCurrency(entry.totalA)}</td>
    </tr>
    <tr>
      <td colspan="4" class="text-right">Deduct. 15% for Contractors Profit</td>
      <td>=</td>
      <td class="text-right">Rs. -${formatIndianCurrency(entry.contractorDeduction)}</td>
    </tr>
    <tr style="font-weight: bold; background-color: #e2e8f0;">
      <td colspan="4" class="text-right">TOTAL (B)</td>
      <td>=</td>
      <td class="text-right">Rs. ${formatIndianCurrency(entry.totalB)}</td>
    </tr>
    <tr>
      <td colspan="4" class="text-right">Depreciation @ ${entry.depreciationPct}%/yr for ${entry.structureAge} yrs (${entry.totalDepreciationPct}%)</td>
      <td>=</td>
      <td class="text-right">Rs. -${formatIndianCurrency(entry.depreciationAmount)}</td>
    </tr>
    <tr style="font-weight: bold; background-color: #cbd5e1;">
      <td colspan="4" class="text-right">TOTAL After Depreciation</td>
      <td>=</td>
      <td class="text-right">Rs. ${formatIndianCurrency(entry.totalAfterDepreciation)}</td>
    </tr>
    <tr><td colspan="6" style="border:none; height:15px;"></td></tr>
  `;

  // Section: Items Excluded from Depreciation
  htmlContent += `
    <tr><td colspan="6" class="section-header">B. ITEMS EXCLUDED FROM DEPRECIATION</td></tr>
  `;

  if (excludedItems.length === 0) {
    htmlContent += `<tr><td colspan="6" style="font-style:italic; color:#64748b;">No items excluded from depreciation</td></tr>`;
  } else {
    appendItems(excludedItems);
  }

  // Services
  const hasCustomServices = entry.customServices && entry.customServices.length > 0;
  if (entry.addSanitary || entry.addElectrification || hasCustomServices) {
    htmlContent += `
      <tr><td colspan="6" style="border:none; height:10px;"></td></tr>
      <tr><td colspan="6" class="section-header">SERVICES & OTHER ADDITIONS</td></tr>
    `;
    if (entry.addSanitary) {
      const saniDeductPct = entry.sanitaryDeductPct || 0;
      htmlContent += `
        <tr class="service-item-row">
          <td style="padding-left:15px;" colspan="4">Add for Sanitary & Water Supply Fittings @ ${entry.sanitaryPct || 3}%</td>
          <td>${entry.sanitaryPct || 3}% =</td>
          <td class="text-right">Rs. ${formatIndianCurrency(entry.sanitaryCostGross || entry.sanitaryCost)}</td>
        </tr>
      `;
      if (saniDeductPct > 0) {
        htmlContent += `
          <tr class="service-item-row">
            <td style="padding-left:30px; font-style:italic; color:#64748b;" colspan="4">Less: ${saniDeductPct}% for non-conformity with CPWD norms</td>
            <td></td>
            <td class="text-right" style="color:#b91c1c;">Rs. -${formatIndianCurrency(entry.sanitaryDeductAmt || 0)}</td>
          </tr>
        `;
      }
    }
    if (entry.addElectrification) {
      const elecDeductPct = entry.electrificationDeductPct || 0;
      htmlContent += `
        <tr class="service-item-row">
          <td style="padding-left:15px;" colspan="4">Add for Electrification @ ${entry.electrificationPct || 5}%</td>
          <td>${entry.electrificationPct || 5}% =</td>
          <td class="text-right">Rs. ${formatIndianCurrency(entry.electrificationCostGross || entry.electrificationCost)}</td>
        </tr>
      `;
      if (elecDeductPct > 0) {
        htmlContent += `
          <tr class="service-item-row">
            <td style="padding-left:30px; font-style:italic; color:#64748b;" colspan="4">Less: ${elecDeductPct}% for non-conformity with CPWD norms</td>
            <td></td>
            <td class="text-right" style="color:#b91c1c;">Rs. -${formatIndianCurrency(entry.electrificationDeductAmt || 0)}</td>
          </tr>
        `;
      }
    }
    if (hasCustomServices) {
      entry.customServices.forEach(cs => {
        htmlContent += `
          <tr class="service-item-row">
            <td style="padding-left:15px;" colspan="4">${cs.description || 'Add custom item'}</td>
            <td>L/S =</td>
            <td class="text-right">Rs. ${formatIndianCurrency(cs.cost)}</td>
          </tr>
        `;
      });
    }
  }

  // Grand Total & Words & N.B.
  htmlContent += `
    <tr><td colspan="6" style="border:none; height:15px;"></td></tr>
    <tr class="grand-total-row">
      <td colspan="4" class="text-right">GRAND TOTAL</td>
      <td>=</td>
      <td class="text-right">Rs. ${formatIndianCurrency(entry.grandTotal)}</td>
    </tr>
    <tr style="font-weight: bold; background-color: #fafafa;">
      <td colspan="6" class="text-center" style="padding: 10px;">(${numberToIndianWords(entry.grandTotal)}) only.</td>
    </tr>
  `;

  let cleanNbNote = entry.nbNote || '';
  cleanNbNote = cleanNbNote.replace(/^(N\.B\.-|N\.B\.:-|NB:-|N\.B\. :|NB :|N\.B\.:|N\.B\s*:-|NB\s*:-)\s*/i, '');
  if (cleanNbNote) {
    htmlContent += `
      <tr><td colspan="6" style="border:none; height:15px;"></td></tr>
      <tr>
        <td colspan="6" style="border: 0.5pt solid #cbd5e1; background-color: #fffbeb; font-size: 9.5pt; text-align: justify; padding: 8px;">
          <strong>N.B:-</strong> ${cleanNbNote}
        </td>
      </tr>
    `;
  }

  let excelProfileHtml = '';
  try {
    const savedProf = localStorage.getItem('valuroad_user_profile');
    let useThreeSeals = true;
    let includePdf = true;
    let prof = {};
    let sealsSize = '8.5pt';
    if (savedProf) {
      prof = JSON.parse(savedProf);
      useThreeSeals = prof.useThreeSeals !== false;
      includePdf = prof.includePdf !== false;
      if (prof.sealsFontSize) {
        sealsSize = prof.sealsFontSize;
      }
    }

    if (includePdf) {
      if (useThreeSeals) {
        const jeDesig = (prof.jeDesignation !== undefined ? prof.jeDesignation : 'Junior Engineer, PW(B&NH)D ,').replace(/\n/g, '<br>');
        const jeAddr = (prof.jeAddress !== undefined ? prof.jeAddress : 'Bokakhat & Dergaon Territorial\nBldg Sub-Division, Bokakhat').replace(/\n/g, '<br>');
        
        const aeeDesig = (prof.aeeDesignation !== undefined ? prof.aeeDesignation : 'Asstt. Executive Engineer, PW(B&NH)D ,').replace(/\n/g, '<br>');
        const aeeAddr = (prof.aeeAddress !== undefined ? prof.aeeAddress : 'Bokakhat & Dergaon Territorial\nBldg Sub-Division, Bokakhat').replace(/\n/g, '<br>');
        
        const eeDesig = (prof.eeDesignation !== undefined ? prof.eeDesignation : 'Executive Engineer, PW(B&NH)D ,').replace(/\n/g, '<br>');
        const eeAddr = (prof.eeAddress !== undefined ? prof.eeAddress : 'Golaghat District Territorial\nBldg Division, Golaghat').replace(/\n/g, '<br>');

        excelProfileHtml = `
          <tr><td colspan="6" style="border:none; height:25px;"></td></tr>
          <tr>
            <td colspan="2" style="border:none; text-align:center; font-weight:bold; vertical-align:top; font-size:${sealsSize};">
              <div style="height:35px;"></div>
              <strong>${jeDesig}</strong><br><span style="font-weight:normal; font-size:${sealsSize}; color:#475569;">${jeAddr}</span>
            </td>
            <td colspan="2" style="border:none; text-align:center; font-weight:bold; vertical-align:top; font-size:${sealsSize};">
              <div style="height:35px;"></div>
              <strong>${aeeDesig}</strong><br><span style="font-weight:normal; font-size:${sealsSize}; color:#475569;">${aeeAddr}</span>
            </td>
            <td colspan="2" style="border:none; text-align:center; font-weight:bold; vertical-align:top; font-size:${sealsSize};">
              <div style="height:35px;"></div>
              <strong>${eeDesig}</strong><br><span style="font-weight:normal; font-size:${sealsSize}; color:#475569;">${eeAddr}</span>
            </td>
          </tr>
        `;
      } else if (prof.name || prof.designation) {
        excelProfileHtml = `
          <tr><td colspan="6" style="border:none; height:25px;"></td></tr>
          <tr>
            <td colspan="4" style="border:none;"></td>
            <td colspan="2" style="border:none; text-align:center; font-weight:bold; vertical-align:top; font-size:${sealsSize};">
              <div style="height:35px;"></div>
              <strong>${prof.name || ''}</strong><br><span style="font-weight:normal; font-size:${sealsSize}; color:#475569;">${prof.designation || ''}</span>
            </td>
          </tr>
        `;
      }
    }
  } catch(e) {
    console.error('Error adding profile to Excel', e);
  }

  if (excelProfileHtml) {
    htmlContent += excelProfileHtml;
  }

  htmlContent += `
</table>
</body>
</html>
  `;

  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), htmlContent], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  // Truncate filename to 50 characters max
  const cleanName = (entry.clientName || 'Owner').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  const namePart = cleanName.substring(0, 33).replace(/_$/, '');
  const filename = `${namePart}_valuation_estimate.xls`;

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function runUnifiedPDFPrint(entry, isPrint = false) {
  if (!entry) return Promise.resolve(null);
  currentPreviewEntry = entry;
  renderPreviewPages();
  return exportPreviewedDocument(isPrint);
}

function printSingleEstimate(entryId) {
  if (!activeProject) return;
  const entry = activeProject.entries.find(e => e.id === entryId);
  if (!entry) return;
  runUnifiedPDFPrint(entry, true);
}

function exportProjectToWord() {
  if (!activeProject) return;
  const entries = activeProject.entries || [];

  if (entries.length === 0) {
    alert("No owner entries available to export.");
    return;
  }

  let rowsHtml = '';
  entries.forEach((e, idx) => {
    const gpsText = e.gpsLat && e.gpsLon ? `${parseFloat(e.gpsLat).toFixed(4)}, ${parseFloat(e.gpsLon).toFixed(4)}` : 'No GPS';
    rowsHtml += `
      <tr>
        <td style="border: 1px solid #cccccc; padding: 8px;">${idx + 1}</td>
        <td style="border: 1px solid #cccccc; padding: 8px; text-align: center;">${e.jmsSlNo || '-'}</td>
        <td style="border: 1px solid #cccccc; padding: 8px; font-weight: bold;">${e.clientName || 'Unnamed Owner'}</td>
        <td style="border: 1px solid #cccccc; padding: 8px;">${e.location || 'N/A'}</td>
        <td style="border: 1px solid #cccccc; padding: 8px; font-family: monospace;">${gpsText}</td>
        <td style="border: 1px solid #cccccc; padding: 8px; text-align: right; font-weight: bold; color: #1e3a8a;">Rs. ${formatIndianCurrency(e.grandTotal || 0)}</td>
        <td style="border: 1px solid #cccccc; padding: 8px; text-align: center;"><span style="padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; background-color: ${e.status === 'completed' ? '#d1fae5; color: #065f46;' : '#fef3c7; color: #92400e;'}">${e.status}</span></td>
      </tr>
    `;
  });

  const totalCost = entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0);
  const completedCount = entries.filter(e => e.status === 'completed').length;

  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset="utf-8">
      <title>${activeProject.workName}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.5; color: #333333; }
        h1 { color: #1e3a8a; font-size: 24px; margin-bottom: 5px; }
        h2 { color: #0f172a; font-size: 16px; margin-top: 0; }
        .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        .meta-table td { padding: 6px 0; font-size: 14px; }
        .main-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        .main-table th { background-color: #f1f5f9; border: 1px solid #cccccc; padding: 10px 8px; text-align: left; font-size: 13px; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Valuation Project Report</h1>
      <h2>Project: ${activeProject.workName}</h2>
      <hr style="border: 0; border-top: 1px solid #dddddd; margin-bottom: 20px;">
      
      <table class="meta-table">
        <tr>
          <td style="width: 25%; font-weight: bold;">Location / Section:</td>
          <td>${activeProject.location || 'N/A'}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">Total Affected Owners:</td>
          <td>${entries.length}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">Completed Valuations:</td>
          <td>${completedCount} of ${entries.length}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">Total Cost Estimate:</td>
          <td style="font-weight: bold; color: #1e3a8a; font-size: 16px;">Rs. ${formatIndianCurrency(totalCost)}</td>
        </tr>
      </table>

      <h3>Affected Properties List</h3>
      <table class="main-table">
        <thead>
          <tr>
            <th style="width: 5%;">Sl. No.</th>
            <th style="width: 10%;">JMS Sl. No.</th>
            <th style="width: 25%;">Owner / Occupant</th>
            <th style="width: 20%;">Village / Location</th>
            <th style="width: 20%;">GPS Coordinates</th>
            <th style="width: 12%; text-align: right;">Valuation (Rs.)</th>
            <th style="width: 8%; text-align: center;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([htmlContent], { type: 'application/msword' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  // Truncate filename to 50 characters max
  const cleanName = activeProject.workName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  const namePart = cleanName.substring(0, 29).replace(/_$/, '');
  const filename = `${namePart}_valuation_report.doc`;
  
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function printProjectOwnerList() {
  if (!activeProject) return;
  const entries = activeProject.entries || [];

  if (entries.length === 0) {
    alert("No owner entries available to print.");
    return;
  }

  let rowsHtml = '';
  entries.forEach((e, idx) => {
    const gpsText = e.gpsLat && e.gpsLon ? `${parseFloat(e.gpsLat).toFixed(4)}, ${parseFloat(e.gpsLon).toFixed(4)}` : 'No GPS';
    rowsHtml += `
      <tr>
        <td>${idx + 1}</td>
        <td class="text-center">${e.jmsSlNo || '-'}</td>
        <td class="bold">${e.clientName || 'Unnamed Owner'}</td>
        <td>${e.location || 'N/A'}</td>
        <td class="mono">${gpsText}</td>
        <td class="text-right bold">Rs. ${formatIndianCurrency(e.grandTotal || 0)}</td>
        <td class="text-center status-${e.status}">${e.status}</td>
      </tr>
    `;
  });

  const totalCost = entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0);
  const completedCount = entries.filter(e => e.status === 'completed').length;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
    <head>
      <title>Print - ${activeProject.workName}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; line-height: 1.4; color: #333; }
        .header { margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
        h1 { margin: 0 0 5px 0; font-size: 22px; color: #1e3a8a; }
        .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 20px; font-size: 14px; }
        .meta-item { display: flex; }
        .meta-label { font-weight: bold; width: 180px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f8fafc; font-weight: bold; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .bold { font-weight: bold; }
        .mono { font-family: monospace; }
        .status-completed { color: #065f46; font-weight: bold; }
        .status-draft { color: #92400e; font-style: italic; }
        .no-print { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; background: #f1f5f9; padding: 10px; border-radius: 4px; }
        @media print {
          body { padding: 0; }
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="no-print">
        <span style="font-size: 12px; color: #475569;">Use your browser's Print dialog to print or save as PDF.</span>
        <button onclick="window.print()" style="padding: 6px 12px; font-weight: bold; cursor: pointer; background: #1e3a8a; color: white; border: none; border-radius: 4px;">Print Now</button>
      </div>
      <div class="header">
        <h1>Valuation Project Owner List</h1>
        <div style="font-size: 14px; color: #666; margin-top: 3px;">Project Work: ${activeProject.workName}</div>
      </div>
      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">Location / Section:</span><span>${activeProject.location || 'N/A'}</span></div>
        <div class="meta-item"><span class="meta-label">Total Cost Estimate:</span><span class="bold">Rs. ${formatIndianCurrency(totalCost)}</span></div>
        <div class="meta-item"><span class="meta-label">Total Affected Properties:</span><span>${entries.length}</span></div>
        <div class="meta-item"><span class="meta-label">Completed Valuations:</span><span>${completedCount} of ${entries.length}</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 5%;">Sl. No.</th>
            <th style="width: 10%;">JMS Sl. No.</th>
            <th style="width: 25%;">Owner / Occupant</th>
            <th style="width: 25%;">Village / Location</th>
            <th style="width: 17%;">GPS Coordinates</th>
            <th style="width: 11%; text-align: right;">Valuation</th>
            <th style="width: 7%; text-align: center;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <script>
        window.onload = function() {
          setTimeout(function() { window.print(); }, 500);
        }
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

function renderProjectDetails() {
  if (!activeProject) return;
  document.getElementById('project-details-work-title').innerText = activeProject.workName || 'Untitled Project';
  document.getElementById('project-details-location').innerText = activeProject.location || 'N/A';

  const isProjectOwner = !activeProject.ownerId || (auth.currentUser && activeProject.ownerId === auth.currentUser.uid);

  const projectShowJmsEl = document.getElementById('project-show-jms-sl');
  if (projectShowJmsEl) {
    const settings = getPdfTemplateSettings();
    projectShowJmsEl.checked = settings.showJmsSlNo !== false;
  }

  const tbody = document.getElementById('owner-entries-list-body');
  const emptyState = document.getElementById('owner-entries-empty-state');
  const table = document.getElementById('owner-entries-table');

  const searchInput = document.getElementById('owner-search-input');
  const filterStatus = document.getElementById('owner-filter-status');
  
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const statusFilter = filterStatus ? filterStatus.value : 'all';

  let entries = activeProject.entries || [];

  // Apply filters
  if (query || statusFilter !== 'all') {
    entries = entries.filter(e => {
      const nameMatch = (e.clientName || '').toLowerCase().includes(query);
      const locMatch = (e.location || '').toLowerCase().includes(query);
      const villageMatch = (e.village || '').toLowerCase().includes(query); // Some might use village
      
      const statusMatch = statusFilter === 'all' || e.status === statusFilter;
      
      return (nameMatch || locMatch || villageMatch) && statusMatch;
    });
  }

  tbody.innerHTML = '';
  if (entries.length === 0) {
    if (activeProject.entries && activeProject.entries.length > 0) {
      // Filtered out all items
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">No entries match your search/filter criteria</td></tr>`;
      emptyState.style.display = 'none';
      table.style.display = 'table';
    } else {
      emptyState.style.display = 'flex';
      table.style.display = 'none';
    }
  } else {
    emptyState.style.display = 'none';
    table.style.display = 'table';

    entries.forEach((e, idx) => {
      const tr = document.createElement('tr');
      const gpsText = e.gpsLat && e.gpsLon ? `${parseFloat(e.gpsLat).toFixed(4)}, ${parseFloat(e.gpsLon).toFixed(4)}` : 'No GPS';
      const printedDate = e.printedAt ? new Date(e.printedAt) : null;
      const printedText = printedDate && !Number.isNaN(printedDate.getTime())
        ? `Printed ${printedDate.toLocaleDateString('en-IN')}`
        : 'Not printed';
      const printedTitle = e.printedAt
        ? `Printed ${e.printCount || 1} time${(e.printCount || 1) === 1 ? '' : 's'}`
        : 'This estimate has not been printed/exported as PDF yet';
      
      tr.innerHTML = `
        <td style="text-align: center; font-weight: 500; color: var(--text-muted);">${idx + 1}</td>
        <td style="text-align: center; font-weight: 500; color: var(--text-primary);">${e.jmsSlNo || '-'}</td>
        <td>
          <div style="font-weight: 600; font-size: 0.95rem;">${e.clientName || 'Unnamed Owner'}</div>
        </td>
        <td>${e.location || 'N/A'}</td>
        <td style="font-family: monospace; font-size: 0.85rem;">${gpsText}</td>
        <td style="font-weight: bold; color: var(--accent);">Rs. ${formatIndianCurrency(e.grandTotal || 0)}</td>
        <td><span class="status-badge ${e.status}">${e.status === 'needs-review' ? 'Needs Review' : (e.status ? e.status.charAt(0).toUpperCase() + e.status.slice(1) : 'Draft')}</span></td>
        <td><span class="print-status-badge ${e.printedAt ? 'printed' : 'not-printed'}" title="${printedTitle}">${printedText}</span></td>
        <td>
          <div class="action-btns" onclick="event.stopPropagation();">
            <button class="edit-btn" title="Edit Owner Valuation" data-id="${e.id}"><i data-lucide="edit-2"></i></button>
            <button class="preview-btn" title="Interactive Print Preview" data-id="${e.id}" style="color: #6366f1;"><i data-lucide="eye"></i></button>
            <button class="excel-btn" title="Export to Excel" data-id="${e.id}"><i data-lucide="file-spreadsheet"></i></button>
            <button class="pdf-btn" title="Export PDF" data-id="${e.id}"><i data-lucide="file-down"></i></button>
            <button class="print-btn" title="Print Estimate" data-id="${e.id}"><i data-lucide="printer"></i></button>
            <button class="duplicate-btn" title="Duplicate Owner Entry" data-id="${e.id}" style="color: var(--accent);"><i data-lucide="copy"></i></button>
            ${isProjectOwner ? `<button class="delete-btn" title="Delete Owner Entry" data-id="${e.id}" style="color: var(--danger);"><i data-lucide="trash-2"></i></button>` : ''}
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
    tbody.querySelectorAll('.preview-btn').forEach(btn => {
      btn.addEventListener('click', () => openPrintPreview(btn.dataset.id));
    });
    tbody.querySelectorAll('.excel-btn').forEach(btn => {
      btn.addEventListener('click', () => exportSingleEstimateToExcel(btn.dataset.id));
    });
    tbody.querySelectorAll('.pdf-btn').forEach(btn => {
      btn.addEventListener('click', () => runPdfExport(btn.dataset.id));
    });
    tbody.querySelectorAll('.print-btn').forEach(btn => {
      btn.addEventListener('click', () => printSingleEstimate(btn.dataset.id));
    });
    tbody.querySelectorAll('.duplicate-btn').forEach(btn => {
      btn.addEventListener('click', () => duplicateOwnerEntry(btn.dataset.id));
    });

    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteOwnerEntry(btn.dataset.id));
    });

    lucide.createIcons();
  }

  updateProjectMetrics();
}

async function markEntryPrinted(entryId) {
  if (!activeProject || !entryId) return;

  const entry = activeProject.entries?.find(e => e.id === entryId);
  if (!entry) return;

  entry.printedAt = new Date().toISOString();
  entry.printCount = (parseInt(entry.printCount, 10) || 0) + 1;

  if (activeEntry && activeEntry.id === entryId) {
    activeEntry.printedAt = entry.printedAt;
    activeEntry.printCount = entry.printCount;
  }
  if (currentPreviewEntry && currentPreviewEntry.id === entryId) {
    currentPreviewEntry.printedAt = entry.printedAt;
    currentPreviewEntry.printCount = entry.printCount;
  }

  saveProjects();
  renderProjectDetails();

  if (auth.currentUser) {
    await saveProjectEntry(activeProject.id, entry).catch(err => console.error("Error saving printed status:", err));
    await saveUserProject(auth.currentUser.uid, activeProject).catch(err => console.error("Error saving project printed status:", err));
  }
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

async function deleteOwnerEntry(id) {
  const isProjectOwner = !activeProject.ownerId || (auth.currentUser && activeProject.ownerId === auth.currentUser.uid);
  if (!isProjectOwner) {
    alert('Only the project creator can delete owner entries.');
    return;
  }

  if (confirm('Are you sure you want to delete this owner entry? This cannot be undone.')) {
    activeProject.entries = (activeProject.entries || []).filter(e => e.id !== id);
    activeProject.entriesCount = activeProject.entries.length;
    activeProject.totalValuation = activeProject.entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0);
    
    const pIdx = projects.findIndex(p => p.id === activeProject.id);
    if (pIdx > -1) {
      projects[pIdx] = activeProject;
    }

    saveProjects();
    if (auth.currentUser) {
      await deleteProjectEntry(activeProject.id, id).catch(err => console.error("Error deleting entry from subcollection:", err));
      await saveUserProject(auth.currentUser.uid, activeProject).catch(err => console.error("Error saving project to Firestore:", err));
    }
    renderProjectDetails();
  }
}

async function duplicateOwnerEntry(id) {
  const entry = (activeProject.entries || []).find(e => e.id === id);
  if (!entry) return;

  // Deep clone the entry
  const newEntry = JSON.parse(JSON.stringify(entry));
  newEntry.id = 'OWNER_' + Date.now();
  newEntry.clientName = (newEntry.clientName || 'Owner') + ' (Copy)';
  newEntry.createdAt = new Date().toISOString();
  newEntry.updatedAt = new Date().toISOString();
  
  // Reset fields that shouldn't be copied
  newEntry.printedAt = null;
  newEntry.printCount = 0;
  newEntry.isDraft = true; // Set as draft by default for the copy

  activeProject.entries = activeProject.entries || [];
  activeProject.entries.push(newEntry);
  activeProject.entriesCount = activeProject.entries.length;
  activeProject.totalValuation = activeProject.entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0);

  const pIdx = projects.findIndex(p => p.id === activeProject.id);
  if (pIdx > -1) {
    projects[pIdx] = activeProject;
  }

  saveProjects();
  if (auth.currentUser) {
    await saveProjectEntry(activeProject.id, newEntry).catch(err => console.error("Error saving duplicated entry:", err));
    await saveUserProject(auth.currentUser.uid, activeProject).catch(err => console.error("Error saving project:", err));
  }
  
  renderProjectDetails();
  if (typeof showToast === 'function') {
    showToast('Owner entry duplicated successfully.');
  } else {
    alert('Owner entry duplicated successfully.');
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

async function saveProject() {
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
    await saveUserProject(auth.currentUser.uid, activeProject).catch(err => console.error("Error saving project to Firestore:", err));
  }
  await openProjectDetails(activeProject.id);
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

  setupEditorTabs();



  document.getElementById('gps-tag-btn').addEventListener('click', captureGPS);

  document.getElementById('add-quantity-item-btn').addEventListener('click', () => addItem('quantity-rate'));
  document.getElementById('add-plinth-item-btn').addEventListener('click', () => addItem('plinth-area'));
  document.getElementById('add-lumpsum-item-btn').addEventListener('click', () => addItem('lump-sum'));

  document.getElementById('editor-save-draft-btn').addEventListener('click', async () => {
    const btn = document.getElementById('editor-save-draft-btn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="refresh-cw" class="spin" style="width:16px; height:16px; display:inline-block; vertical-align:middle; margin-right:4px;"></i> Saving...';
    lucide.createIcons();

    try {
      await saveActiveEntry('draft');
      alert('Draft saved successfully!');
      isNewEntryMode = false;
      if (activeProject) await openProjectDetails(activeProject.id);
    } catch (err) {
      console.error("Save draft failed:", err);
      alert('Failed to save draft. Please check your connection and try again.');
    } finally {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
      lucide.createIcons();
    }
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
  const elecControls = document.getElementById('electrification-controls');
  const saniControls = document.getElementById('sanitary-controls');
  const inputElecPct = document.getElementById('electrification-pct');
  const inputSaniPct = document.getElementById('sanitary-pct');

  toggleElec.addEventListener('change', () => {
    elecControls.style.display = toggleElec.checked ? 'flex' : 'none';
    calculateAndRenderTotals();
  });
  toggleSani.addEventListener('change', () => {
    saniControls.style.display = toggleSani.checked ? 'flex' : 'none';
    calculateAndRenderTotals();
  });

  inputElecPct.addEventListener('input', calculateAndRenderTotals);
  inputSaniPct.addEventListener('input', calculateAndRenderTotals);
  document.getElementById('electrification-deduct-pct').addEventListener('input', calculateAndRenderTotals);
  document.getElementById('sanitary-deduct-pct').addEventListener('input', calculateAndRenderTotals);

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
  document.getElementById('enable-depreciation').addEventListener('change', calculateAndRenderTotals);
  const jmsSlNoEl = document.getElementById('jms-sl-no');
  if (jmsSlNoEl) jmsSlNoEl.addEventListener('input', calculateAndRenderTotals);

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
  const inputFontFamily = document.getElementById('prop-input-font-family');
  const inputFloors     = document.getElementById('prop-input-floors');
  const inputWallLenAbove = document.getElementById('prop-input-wall-len-above');
  const inputRoadWidth  = document.getElementById('prop-input-road-width');
   const updateSelectedShape = () => {
    if (!sketcher) return;
    const allSelected = sketcher.selectedShapes || [];
 
    // Helper: parse "12.5m", "12.5", "12 m" → 12.5 (metres)
    const parseM = (str) => {
      const n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
      return isFinite(n) && n > 0.05 ? n : null;
    };
 
    const fontSizeIn = document.getElementById('prop-input-font-size');
    const fontFamilyIn = document.getElementById('prop-input-font-family');

    if (allSelected.length > 1) {
      sketcher.pushHistory();
      allSelected.forEach(s => {
        if (fontSizeIn && fontSizeIn.value) {
          s.fontSize = parseFloat(fontSizeIn.value) || (s.type === 'text' ? 13 : 17);
        }
        if (fontFamilyIn && fontFamilyIn.value) {
          s.fontFamily = fontFamilyIn.value;
        }
      });
      sketcher.draw();
      showToast(`Applied font settings to ${allSelected.length} objects`);
      return;
    }

    if (!sketcher.selectedShape) return;
    const s = sketcher.selectedShape;
    sketcher.pushHistory();
 
    if (s.type === 'building' || s.type === 'polygon-building' || s.type === 'text' || s.type === 'dimension' || s.type === 'boundary-wall' || s.type === 'gate' || s.type === 'gate-toran' || s.type === 'room' || s.type === 'road') {
      if (fontSizeIn) s.fontSize = parseFloat(fontSizeIn.value) || (s.type === 'text' ? 13 : 10);
      if (fontFamilyIn) s.fontFamily = fontFamilyIn.value || 'sans-serif';
    }
 
    if (s.type === 'building' || s.type === 'polygon-building') {
      s.structureType = inputStructType.value;
      s.label = inputLabel.value;
      // Sync width/height → actual shape size
      const wVal = parseM(inputWidth.value);
      const hVal = parseM(inputHeight.value);
      if (wVal !== null) { s.w = wVal; s.dimW = `${wVal.toFixed(2)}m (${(wVal * 3.28084).toFixed(1)}ft)`; } else { s.dimW = inputWidth.value; }
      if (hVal !== null) { s.h = hVal; s.dimH = `${hVal.toFixed(2)}m (${(hVal * 3.28084).toFixed(1)}ft)`; } else { s.dimH = inputHeight.value; }
      s.floors = parseInt(inputFloors.value) || 1;
    } else if (s.type === 'custom-block') {
      s.blockStyle = inputBlockStyle.value;
      s.label = inputLabel.value;
      const wVal = parseM(inputWidth.value);
      const hVal = parseM(inputHeight.value);
      if (wVal !== null) { s.w = wVal; s.dimW = `${wVal.toFixed(2)}m (${(wVal * 3.28084).toFixed(1)}ft)`; } else { s.dimW = inputWidth.value; }
      if (hVal !== null) { s.h = hVal; s.dimH = `${hVal.toFixed(2)}m (${(hVal * 3.28084).toFixed(1)}ft)`; } else { s.dimH = inputHeight.value; }
    } else if (s.type === 'road') {
      s.label = inputLabel.value;
      s.leftLabel = inputLeft.value;
      s.rightLabel = inputRight.value;
      if (inputRoadWidth) {
        const wVal = parseM(inputRoadWidth.value);
        if (wVal !== null) s.h = wVal;
      }
    } else if (s.type === 'text') {
      s.text = inputLabel.value;
      if (fontSizeIn) s.fontSize = parseFloat(fontSizeIn.value) || 13;
      if (fontFamilyIn) s.fontFamily = fontFamilyIn.value || 'sans-serif';
    } else if (s.type === 'boundary-wall' || s.type === 'gate' || s.type === 'gate-toran' || s.type === 'wall') {
      s.label = inputLabel.value;
      s.dimLabel = inputDimLabel.value;
      s.height = parseM(inputHeight.value);
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
    showToast('Changes applied');
  };

  const applyBtn = document.getElementById('prop-btn-apply');
  if (applyBtn) applyBtn.addEventListener('click', updateSelectedShape);

  // Auto-fill label when structure type changes, but allow manual override after
  inputStructType.addEventListener('change', () => {
    if (inputStructType.value === 'rcc')           inputLabel.value = 'RCC Structure';
    else if (inputStructType.value === 'assam')    inputLabel.value = 'Assam Type Building';
    else if (inputStructType.value === 'temp-building') inputLabel.value = 'Temporary Building';
    else if (inputStructType.value === 'temp-shed') inputLabel.value = 'Temp Shed';
  });

  const roomColorInput = document.getElementById('prop-input-room-color');
  if (roomColorInput) roomColorInput.addEventListener('input', () => { if (sketcher && sketcher.selectedShape) { sketcher.selectedShape.color = roomColorInput.value; sketcher.draw(); } });

  const mergeBtn = document.getElementById('prop-btn-merge');
  if (mergeBtn) {
    mergeBtn.addEventListener('click', () => {
      if (sketcher) {
        sketcher.mergeSelectedTouching();
      }
    });
  }

  const pushEstimateBtn = document.getElementById('prop-btn-push-estimate');
  if (pushEstimateBtn) {
    pushEstimateBtn.addEventListener('click', () => {
      if (!sketcher || !sketcher.selectedShape) return;
      const s = sketcher.selectedShape;
      
      const itemsToAdd = [];

      if (s.type === 'room' || s.type === 'polygon' || s.type === 'polygon-building' || s.type === 'building' || s.type === 'custom-block') {
        const floors = parseInt(s.floors) || 1;
        
        for (let i = 0; i < floors; i++) {
          let qty = 0;
          let unit = 'sqm';
          let title = s.label || 'Building Block';
          let rate = 0;
          let description = 'Plinth area for building';
          let l = '';
          let b = '';
          let h = '';

          // Format floor name
          let floorName = "Ground Floor";
          if (i === 1) floorName = "1st Floor";
          else if (i === 2) floorName = "2nd Floor";
          else if (i === 3) floorName = "3rd Floor";
          else if (i > 3) floorName = `${i}th Floor`;

          const fullTitle = `${title} (${floorName})`;

          if (s.type === 'building' || s.type === 'custom-block') {
            qty = (s.w || 0) * (s.h || 0);
            l = s.w;
            b = s.h;
          } else {
            qty = s.areaSqm || 0;
          }

          // Auto-assign rates based on predefined types
          if (title === 'RCC Structure') {
            rate = 20685.00;
          } else if (title === 'Assam Type Building') {
            rate = 15867.00;
          } else if (title === 'Temporary Building' || title === 'Temp Shed') {
            rate = 205.00;
            unit = 'sqf';
            qty = qty * 10.76391;
            if (l) l = l * 3.28084;
            if (b) b = b * 3.28084;
          }

          itemsToAdd.push({
            qty, unit, title: fullTitle, rate, description, l, b, h, nos: 1, 
            measurementDesc: `${title} - ${floorName}`
          });
        }
      } else if (s.type === 'wall' || s.type === 'boundary-wall' || s.type === 'line' || s.type === 'gate') {
        let len = 0;
        if (s.points && s.points.length >= 2) {
          for (let i = 0; i < s.points.length - 1; i++) {
            len += Math.hypot(s.points[i+1].x - s.points[i].x, s.points[i+1].y - s.points[i].y);
          }
        } else if (s.x1 !== undefined && s.x2 !== undefined) {
          len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        }
        
        let h = s.height || 0;
        let l = len;

        // 1. Always add the "Upto Tie Beam" (Running Meter) item
        itemsToAdd.push({
          qty: len, 
          unit: 'Rm', 
          title: s.label || 'Boundary Wall (Upto Tie Beam)', 
          rate: 1850.00, 
          description: 'Length', 
          l: len, b: '', h: '', nos: 1,
          measurementDesc: `${s.label || 'Boundary Wall'} - Upto Tie Beam`
        });

        // 2. If height provided, add the "Above Tie Beam" (sqm) item
        if (h > 0) {
          itemsToAdd.push({
            qty: len * h, 
            unit: 'sqm', 
            title: s.label || 'Boundary Wall (Above Tie Beam)', 
            rate: 1450.00, 
            description: 'Area for sqm', 
            l: len, b: '', h: h, nos: 1,
            measurementDesc: `${s.label || 'Boundary Wall'} - Above Tie Beam`
          });
        }
      }

      if (itemsToAdd.length === 0) {
        alert("Selected shape does not have a measurable area or length.");
        return;
      }

      itemsToAdd.forEach((itemData, index) => {
        const newItem = {
          id: 'ITEM_' + Date.now() + '_' + index,
          itemNo: (activeEntry.items.length + 1).toString(),
          type: 'quantity-rate',
          title: itemData.title,
          description: itemData.description,
          quantity: itemData.qty,
          unit: itemData.unit,
          rate: itemData.rate,
          totalCost: itemData.qty * itemData.rate,
          includeInValuation: true,
          excludeFromDepreciation: false,
          customDepreciation: false,
          customDepreciationPct: 2.0,
          customDepreciationAge: 10,
          deductionPct: 0,
          deductionLabel: '',
          deductionAmount: 0,
          measurements: [{
            id: 'M_' + Date.now() + '_' + index,
            description: itemData.measurementDesc,
            nos: itemData.nos,
            l: itemData.l !== '' ? parseFloat(itemData.l).toFixed(2) : '',
            b: itemData.b !== '' ? parseFloat(itemData.b).toFixed(2) : '',
            h: itemData.h !== '' ? parseFloat(itemData.h).toFixed(2) : '',
            subQty: itemData.qty
          }]
        };

        activeEntry.items.push(newItem);
        renderItemRow(newItem);
      });

      calculateAndRenderTotals();

      const tabBtns = document.querySelectorAll('.tab-btn');
      tabBtns.forEach(b => {
        if (b.dataset.tab === 'tab-estimate') b.click();
      });
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
    enableDepreciation: true,
    items: [],
    addElectrification: false,
    electrificationPct: 5,
    electrificationDeductPct: 0,
    electrificationCost: 0,
    addSanitary: false,
    sanitaryPct: 3,
    sanitaryDeductPct: 0,
    sanitaryCost: 0,
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

function autoGenerateSketcherShapes(entry) {
  const shapes = [];
  if (!entry || !entry.items) return shapes;

  let currentX = 2.0;
  let currentY = 2.0;
  let rowMaxHeight = 0;
  const gap = 2.0; // meters gap
  const maxRowWidth = 22.0; // meters

  // Helper to map title to structureType
  const getStructureType = (title) => {
    const t = (title || '').toLowerCase();
    if (t.includes('rcc')) return 'rcc';
    if (t.includes('assam')) return 'assam';
    if (t.includes('temp shed') || t.includes('temp-shed') || t.includes('shed')) return 'temp-shed';
    if (t.includes('temporary') || t.includes('temp')) return 'temp-building';
    return '';
  };

  entry.items.forEach((item, itemIdx) => {
    if (item.type === 'plinth-area' && item.rooms) {
      item.rooms.forEach((room, roomIdx) => {
        const l = parseFloat(room.l) || 0;
        const w = parseFloat(room.w) || 0;
        if (l <= 0 || w <= 0) return;

        let label = room.name || item.title || 'Building';
        if (item.title && room.name && room.name !== item.title && !room.name.toLowerCase().includes(item.title.toLowerCase())) {
          label = `${item.title}\n(${room.name})`;
        }

        const structType = getStructureType(item.title);

        // Position shape (wrap to next row if it exceeds max width)
        if (currentX + l > maxRowWidth && currentX > 2.0) {
          currentX = 2.0;
          currentY += rowMaxHeight + gap;
          rowMaxHeight = 0;
        }

        shapes.push({
          id: Date.now() + Math.floor(Math.random() * 1000) + (itemIdx * 100) + roomIdx,
          type: 'building',
          x: parseFloat(currentX.toFixed(3)),
          y: parseFloat(currentY.toFixed(3)),
          w: parseFloat(l.toFixed(3)),
          h: parseFloat(w.toFixed(3)),
          label: label,
          structureType: structType,
          dimW: `${l.toFixed(2)}m (${(l * 3.28084).toFixed(1)}ft)`,
          dimH: `${w.toFixed(2)}m (${(w * 3.28084).toFixed(1)}ft)`,
          dimWOffset: -1.5,
          dimHOffset: 1.5
        });

        currentX += l + gap;
        if (w > rowMaxHeight) rowMaxHeight = w;
      });
    } else if (item.type === 'quantity-rate' && item.measurements) {
      // Check if item looks like a building structure
      const titleLower = (item.title || '').toLowerCase();
      const isStructure = ['rcc', 'assam', 'building', 'shed', 'structure', 'temporary', 'room', 'house', 'block'].some(kw => titleLower.includes(kw));
      if (!isStructure) return;

      const isSqft = (item.unit || '').toLowerCase().includes('sqf');
      const conversion = isSqft ? 0.3048 : 1.0;

      item.measurements.forEach((m, mIdx) => {
        const lRaw = parseFloat(m.l) || 0;
        const bRaw = parseFloat(m.b) || 0;
        if (lRaw <= 0 || bRaw <= 0) return;

        const l = lRaw * conversion;
        const w = bRaw * conversion;

        let label = m.description || item.title || 'Building';
        if (item.title && m.description && m.description !== item.title && !m.description.toLowerCase().includes(item.title.toLowerCase())) {
          label = `${item.title}\n(${m.description})`;
        }

        const structType = getStructureType(item.title);

        // Position shape
        if (currentX + l > maxRowWidth && currentX > 2.0) {
          currentX = 2.0;
          currentY += rowMaxHeight + gap;
          rowMaxHeight = 0;
        }

        shapes.push({
          id: Date.now() + Math.floor(Math.random() * 1000) + (itemIdx * 1000) + mIdx,
          type: 'building',
          x: parseFloat(currentX.toFixed(3)),
          y: parseFloat(currentY.toFixed(3)),
          w: parseFloat(l.toFixed(3)),
          h: parseFloat(w.toFixed(3)),
          label: label,
          structureType: structType,
          dimW: `${l.toFixed(2)}m (${(l * 3.28084).toFixed(1)}ft)`,
          dimH: `${w.toFixed(2)}m (${(w * 3.28084).toFixed(1)}ft)`,
          dimWOffset: -1.5,
          dimHOffset: 1.5
        });

        currentX += l + gap;
        if (w > rowMaxHeight) rowMaxHeight = w;
      });
    }
  });

  // Also auto-draw a road if there isn't one already and we have route info or fallbacks
  const hasRoad = shapes.some(s => s.type === 'road');
  if (!hasRoad) {
    let roadLabel = 'NH-37';
    let leftLabel = 'KALIABAR';
    let rightLabel = 'NUMALIGARH';
    
    if (typeof window !== 'undefined' && window.getActiveProjectRoute) {
      const route = window.getActiveProjectRoute();
      if (route && route.road) {
        roadLabel = route.road;
        leftLabel = route.left || '';
        rightLabel = route.right || '';
      }
    }
    
    shapes.push({
      id: Date.now() + Math.floor(Math.random() * 1000) + 9999,
      type: 'road',
      y: parseFloat((currentY + rowMaxHeight + gap + 1.0).toFixed(3)),
      h: 3.0,
      label: roadLabel,
      leftLabel: leftLabel,
      rightLabel: rightLabel
    });
  }

  return shapes;
}

function loadEntryToEditor() {
  if (!activeEntry) return;
  if (!activeEntry.items) activeEntry.items = [];
  if (!activeEntry.customServices) activeEntry.customServices = [];
  if (!activeEntry.status) activeEntry.status = 'draft';

  // Reset tabs to Basic Details
  const tabButtons = document.querySelectorAll('.editor-tabs .tab-btn');
  const tabContents = document.querySelectorAll('.editor-layout .tab-content');
  tabButtons.forEach(btn => {
    if (btn.dataset.tab === 'tab-basic') btn.classList.add('active');
    else btn.classList.remove('active');
  });
  tabContents.forEach(pane => {
    if (pane.id === 'tab-basic') pane.classList.add('active');
    else pane.classList.remove('active');
  });

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
  document.getElementById('enable-depreciation').checked = activeEntry.enableDepreciation !== false;
  const jmsSlNoEl = document.getElementById('jms-sl-no');
  if (jmsSlNoEl) {
    jmsSlNoEl.value = activeEntry.jmsSlNo || '';
  }

  document.getElementById('toggle-electrification').checked = activeEntry.addElectrification;
  document.getElementById('toggle-sanitary').checked = activeEntry.addSanitary;
  
  // Migrate legacy lump-sum entries: if electrificationPct is missing, set default
  if (activeEntry.electrificationPct === undefined) activeEntry.electrificationPct = 5;
  if (activeEntry.sanitaryPct === undefined) activeEntry.sanitaryPct = 3;
  if (activeEntry.electrificationDeductPct === undefined) activeEntry.electrificationDeductPct = 0;
  if (activeEntry.sanitaryDeductPct === undefined) activeEntry.sanitaryDeductPct = 0;

  const inputElecPct = document.getElementById('electrification-pct');
  const inputSaniPct = document.getElementById('sanitary-pct');
  inputElecPct.value = activeEntry.electrificationPct;
  inputSaniPct.value = activeEntry.sanitaryPct;
  document.getElementById('electrification-deduct-pct').value = activeEntry.electrificationDeductPct;
  document.getElementById('sanitary-deduct-pct').value = activeEntry.sanitaryDeductPct;
  document.getElementById('electrification-controls').style.display = activeEntry.addElectrification ? 'flex' : 'none';
  document.getElementById('sanitary-controls').style.display = activeEntry.addSanitary ? 'flex' : 'none';

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

  // Wire up grid/snap toggle callbacks
  sketcher.onGridToggle = () => syncGridAndSnapUI();
  sketcher.onSnapToggle = () => syncGridAndSnapUI();

  // Set zoom change listener
  const zoomLabel = document.getElementById('sketcher-zoom-label');
  const updateZoomLabel = (z) => { if (zoomLabel) zoomLabel.textContent = `${Math.round(z*100)}%`; };
  sketcher.onZoomChange = updateZoomLabel;
  updateZoomLabel(sketcher.zoom);

  // Set scale based on current dropdown value
  const scaleSelect = document.getElementById('sketcher-scale-select');
  if (scaleSelect) {
    const scaleVal = parseInt(scaleSelect.value) || 100;
    sketcher.setScale(scaleVal);
  }

  // Set grid size based on current dropdown value
  const gridSel = document.getElementById('sketch-grid-size');
  if (gridSel) {
    sketcher.gridSize = parseFloat(gridSel.value) || 0.5;
  }

  // Synchronize all other toolbar button states (Lock, A4, Grid, Snap)
  syncSketcherUIState();
  
  sketcher.onSelectionChange = (shape, allSelected) => {
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
    const fieldFloors     = document.getElementById('prop-field-floors');
    const fieldWallLenAbove = document.getElementById('prop-field-wall-len-above');
    const fieldRoadWidth  = document.getElementById('prop-field-road-width');
 
    const inputLabel      = document.getElementById('prop-input-label');
    const inputWidth      = document.getElementById('prop-input-width');
    const inputHeight     = document.getElementById('prop-input-height');
    const inputLeft       = document.getElementById('prop-input-left');
    const inputRight      = document.getElementById('prop-input-right');
    const inputDimLabel   = document.getElementById('prop-input-dim-label');
    const inputBlockStyle = document.getElementById('prop-input-block-style');
    const inputStructType = document.getElementById('prop-input-structure-type');
    const inputFloors     = document.getElementById('prop-input-floors');
    const fieldMerge      = document.getElementById('prop-field-merge');
    const fieldPushEstimate = document.getElementById('prop-field-push-estimate');
    const fieldFont       = document.getElementById('prop-field-font');
    const inputFontSize   = document.getElementById('prop-input-font-size');
    const inputFontFamily = document.getElementById('prop-input-font-family');
    const inputRoadWidth  = document.getElementById('prop-input-road-width');
 
    // Reset all optional fields hidden; label always shown
    [fieldWidth, fieldHeight, fieldRoad, fieldStructType, fieldDimLabel, fieldBlockStyle, fieldMerge, fieldPushEstimate, fieldFloors, fieldFont, fieldRoadWidth].forEach(f => {
      if (f) f.style.display = 'none';
    });
    const fieldRoomColor = document.getElementById('prop-field-room-color');
    if (fieldRoomColor) fieldRoomColor.style.display = 'none';
    fieldLabel.style.display = 'flex';
 
    // Show font settings for most object types
    if (['building', 'polygon-building', 'text', 'dimension', 'boundary-wall', 'gate', 'gate-toran', 'room', 'road'].includes(shape.type)) {
      if (fieldFont) fieldFont.style.display = 'flex';
      const defaultSize = (shape.type === 'text') ? 13 : 17;
      if (inputFontSize) inputFontSize.value = shape.fontSize || defaultSize;
      if (inputFontFamily) inputFontFamily.value = shape.fontFamily || 'sans-serif';
    }
 
    if (shape.type === 'building' || shape.type === 'polygon-building') {
      if (fieldMerge) fieldMerge.style.display = 'flex';
      if (fieldPushEstimate) fieldPushEstimate.style.display = 'flex';
      fieldStructType.style.display = 'flex';
      fieldWidth.style.display = 'flex';
      fieldHeight.style.display = 'flex';
      fieldFloors.style.display = 'flex';
      inputStructType.value = shape.structureType || '';
      inputLabel.value = shape.label || '';
      inputWidth.value = shape.dimW || '';
      inputHeight.value = shape.dimH || '';
      inputFloors.value = shape.floors || 1;
    } else if (shape.type === 'custom-block') {
      if (fieldPushEstimate) fieldPushEstimate.style.display = 'flex';
      fieldBlockStyle.style.display = 'flex';
      fieldWidth.style.display = 'flex';
      fieldHeight.style.display = 'flex';
      inputBlockStyle.value = shape.blockStyle || 'misc';
      inputLabel.value = shape.label || '';
      inputWidth.value = shape.dimW || '';
      inputHeight.value = shape.dimH || '';
    } else if (shape.type === 'road') {
      fieldRoad.style.display = 'flex';
      if (fieldRoadWidth) fieldRoadWidth.style.display = 'flex';
      inputLabel.value = shape.label || '';
      inputLeft.value = shape.leftLabel || '';
      inputRight.value = shape.rightLabel || '';
      if (inputRoadWidth) inputRoadWidth.value = `${(shape.h || 3.0).toFixed(2)}m`;
    } else if (shape.type === 'text') {
      inputLabel.value = shape.text || '';
    } else if (shape.type === 'boundary-wall' || shape.type === 'gate' || shape.type === 'gate-toran' || shape.type === 'wall') {
      if (fieldPushEstimate) fieldPushEstimate.style.display = 'flex';
      fieldDimLabel.style.display = 'flex';
      fieldHeight.style.display = 'flex';
      if (shape.type === 'boundary-wall' && fieldWallLenAbove) fieldWallLenAbove.style.display = 'flex';
      inputLabel.value = shape.label || '';
      inputDimLabel.value = shape.dimLabel || '';
      inputHeight.value = shape.height || '';
      if (shape.type === 'boundary-wall' && inputWallLenAbove) inputWallLenAbove.value = shape.wallLenAbove || '';
    } else if (shape.type === 'dimension') {
      fieldDimLabel.style.display = 'flex';
      inputLabel.value = shape.manualLabel || shape.label || '';
      inputDimLabel.value = shape.manualLabel || shape.label || '';
    } else if (shape.type === 'room') {
      if (fieldPushEstimate) fieldPushEstimate.style.display = 'flex';
      if (fieldRoomColor) {
        fieldRoomColor.style.display = 'flex';
        const colorInput = document.getElementById('prop-input-room-color');
        if (colorInput) colorInput.value = shape.color || '#bfdbfe';
      }
      inputLabel.value = shape.label || '';
    } else if (shape.type === 'line' || shape.type === 'polygon') {
      if (fieldPushEstimate) fieldPushEstimate.style.display = 'flex';
      inputLabel.value = shape.label || '';
    }
 
    if (allSelected && allSelected.length > 1) {
      // Hide properties for multi-select, but keep Font settings and Push to Estimate
      const allFields = [
        'prop-field-label', 'prop-field-width', 'prop-field-height', 'prop-field-road',
        'prop-field-structure-type', 'prop-field-dim-label', 'prop-field-block-style',
        'prop-field-merge', 'prop-field-room-color', 'prop-field-floors', 'prop-field-wall-len-above',
        'prop-field-road-width'
      ];
      allFields.forEach(id => {
        const f = document.getElementById(id);
        if (f) f.style.display = 'none';
      });
      if (fieldFont) {
        fieldFont.style.display = 'flex';
        const defaultSize = (shape.type === 'text') ? 13 : 10;
        if (inputFontSize) inputFontSize.value = shape.fontSize || defaultSize;
        if (inputFontFamily) inputFontFamily.value = shape.fontFamily || 'sans-serif';
      }
      if (fieldPushEstimate) fieldPushEstimate.style.display = 'flex';
      if (pushEstimateBtn) pushEstimateBtn.innerText = `Add ${allSelected.length} to Estimate`;
    } else {
      if (pushEstimateBtn) pushEstimateBtn.innerText = 'Add to Estimate';
    }
  };

  // Keyboard shortcuts for tools
  window.addEventListener('keydown', async (e) => {
    if (!sketcher || sketcher.isLocked) return;
    if (e.target?.tagName==='INPUT'||e.target?.tagName==='TEXTAREA') return;
    
    // Quick save shortcut
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (activeEntry) {
        showToast('Syncing to cloud...', 'info');
        try {
          await saveActiveEntry('draft');
          showToast('Sync Successful: Drawing saved');
        } catch (err) {
          showToast('Sync Failed: Check connection', 'error');
        }
      }
      return;
    }

    const key = e.key.toLowerCase();
    const tools = {
      's': 'vtool-select',
      'h': 'vtool-pan',
      'z': 'vtool-zoom',
      'w': 'vtool-wall',

      'l': 'tool-line',
      'b': 'tool-building',
      'r': 'tool-room',
      't': 'tool-text',
      'p': 'tool-polybuilding',
      'd': 'tool-dimension',
      'e': 'tool-erase'
    };

    if (tools[key]) {
      const btn = document.getElementById(tools[key]);
      if (btn) btn.click();
    }
  });

  const pushEstimateBtn = document.getElementById('prop-btn-push-estimate');
  if (pushEstimateBtn) {
    const newBtn = pushEstimateBtn.cloneNode(true);
    pushEstimateBtn.parentNode.replaceChild(newBtn, pushEstimateBtn);
    newBtn.addEventListener('click', () => {
      const selectedShapes = (sketcher.selectedShapes && sketcher.selectedShapes.length > 0) ? sketcher.selectedShapes : [sketcher.selectedShape];
      
      selectedShapes.forEach(s => {
        if (!s) return;
        
        const title = s.label || 'Building Block';
        
        // Handle predefined building types as Plinth Area Rooms
        const predefinedTypes = ['RCC Structure', 'Assam Type Building', 'Temporary Building', 'Temp Shed'];
        if ((s.type === 'building' || s.type === 'custom-block' || s.type === 'room') && 
            predefinedTypes.includes(title)) {
          
          let plinthItem = activeEntry.items.find(it => it.type === 'plinth-area' && it.title === title);
          if (!plinthItem) {
            addItem('plinth-area');
            plinthItem = activeEntry.items[activeEntry.items.length - 1];
            plinthItem.title = title;
            plinthItem.rooms = []; // Clear default room
            
            // Set correct rates/units for the new plinth section
            if (title === 'RCC Structure') {
              plinthItem.rate = 20685.00;
              plinthItem.unit = 'sqm';
            } else if (title === 'Assam Type Building') {
              plinthItem.rate = 15867.00;
              plinthItem.unit = 'sqm';
            } else if (title === 'Temporary Building' || title === 'Temp Shed') {
              plinthItem.rate = 205.00;
              plinthItem.unit = 'sqf';
            }
          }

          const floors = parseInt(s.floors) || 1;
          for (let i = 0; i < floors; i++) {
            let floorName = "Ground Floor";
            if (i === 1) floorName = "1st Floor";
            else if (i === 2) floorName = "2nd Floor";
            else if (i === 3) floorName = "3rd Floor";
            else if (i > 3) floorName = `${i}th Floor`;

            const roomName = floors > 1 ? `${title} (${floorName})` : title;
            let l = 0, w = 0, area = 0;

            if (s.type === 'building' || s.type === 'custom-block') {
              l = s.w || 0;
              w = s.h || 0;
              area = l * w;
            } else {
              area = s.areaSqm || 0;
              l = Math.sqrt(area);
              w = l;
            }

            plinthItem.rooms.push({
              id: Date.now() + Math.random(),
              name: roomName,
              l: parseFloat(l.toFixed(2)),
              w: parseFloat(w.toFixed(2)),
              areaSqm: parseFloat(area.toFixed(2))
            });
          }

          loadEntryToEditor();
          showToast(`Added ${title} to Plinth Area`);
          
          // Switch to estimate tab
          const tabBtns = document.querySelectorAll('.tab-btn');
          tabBtns.forEach(b => { if (b.dataset.tab === 'tab-estimate') b.click(); });
          
          return;
        }

        const itemsToAdd = [];

        if (s.type === 'room' || s.type === 'polygon' || s.type === 'polygon-building' || s.type === 'building' || s.type === 'custom-block') {
          const floors = parseInt(s.floors) || 1;
          
          for (let i = 0; i < floors; i++) {
            let qty = 0, unit = 'sqm', title = s.label || 'Building Block', rate = 0, description = 'Plinth area for building', l = '', b = '', h = '';

            let floorName = "Ground Floor";
            if (i === 1) floorName = "1st Floor";
            else if (i === 2) floorName = "2nd Floor";
            else if (i === 3) floorName = "3rd Floor";
            else if (i > 3) floorName = `${i}th Floor`;

            const fullTitle = `${title} (${floorName})`;
            if (s.type === 'building' || s.type === 'custom-block') { qty = (s.w || 0) * (s.h || 0); l = s.w; b = s.h; }
            else { qty = s.areaSqm || 0; }

            if (title === 'RCC Structure') rate = 20685.00;
            else if (title === 'Assam Type Building') rate = 15867.00;
            else if (title === 'Temporary Building' || title === 'Temp Shed') { rate = 205.00; unit = 'sqf'; qty *= 10.76391; if (l) l *= 3.28084; if (b) b *= 3.28084; }

            itemsToAdd.push({ qty, unit, title: fullTitle, rate, description, l, b, h, nos: 1, measurementDesc: `${title} - ${floorName}` });
          }
        } else if (s.type === 'wall' || s.type === 'boundary-wall' || s.type === 'line' || s.type === 'gate') {
          let len = 0;
          if (s.points && s.points.length >= 2) { for (let i = 0; i < s.points.length - 1; i++) len += Math.hypot(s.points[i+1].x - s.points[i].x, s.points[i+1].y - s.points[i].y); }
          else if (s.x1 !== undefined && s.x2 !== undefined) len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
          
          let h = s.height || 0, l = len;
          itemsToAdd.push({ qty: len, unit: 'Rm', title: s.label || 'Boundary Wall (Upto Tie Beam)', rate: 1850.00, description: 'Length', l: len, b: '', h: '', nos: 1, measurementDesc: `${s.label || 'Boundary Wall'} - Upto Tie Beam` });
          if (h > 0) itemsToAdd.push({ qty: len * h, unit: 'sqm', title: s.label || 'Boundary Wall (Above Tie Beam)', rate: 1450.00, description: 'Area for sqm', l: len, b: '', h: h, nos: 1, measurementDesc: `${s.label || 'Boundary Wall'} - Above Tie Beam` });
        }

        itemsToAdd.forEach((itemData, index) => {
          const newItem = {
            id: 'ITEM_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substr(2, 5),
            itemNo: (activeEntry.items.length + 1).toString(),
            type: 'quantity-rate',
            title: itemData.title,
            description: itemData.description,
            quantity: itemData.qty,
            unit: itemData.unit,
            rate: itemData.rate,
            totalCost: itemData.qty * itemData.rate,
            includeInValuation: true,
            excludeFromDepreciation: false,
            customDepreciation: false,
            customDepreciationPct: 2.0,
            customDepreciationAge: 10,
            deductionPct: 0,
            deductionLabel: '',
            deductionAmount: 0,
            measurements: [{
              id: 'M_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substr(2, 5),
              description: itemData.measurementDesc,
              nos: itemData.nos,
              l: itemData.l !== '' ? parseFloat(itemData.l).toFixed(2) : '',
              b: itemData.b !== '' ? parseFloat(itemData.b).toFixed(2) : '',
              h: itemData.h !== '' ? parseFloat(itemData.h).toFixed(2) : '',
              subQty: itemData.qty
            }]
          };
          activeEntry.items.push(newItem);
          renderItemRow(newItem);
        });
      });
      calculateAndRenderTotals();
      newBtn.innerText = 'Add to Estimate';
      const tabBtns = document.querySelectorAll('.tab-btn');
      tabBtns.forEach(b => { if (b.dataset.tab === 'tab-estimate') b.click(); });
    });
  }

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

  if (activeEntry.sketcherFontSize) {
    sketcher.globalFontSizeBase = activeEntry.sketcherFontSize;
  } else {
    sketcher.globalFontSizeBase = 17;
  }
  if (activeEntry.sketcherFontFamily) {
    sketcher.globalFontFamily = activeEntry.sketcherFontFamily;
  } else {
    sketcher.globalFontFamily = 'sans-serif';
  }
  const sketchFontFamilyEl = document.getElementById('sketch-font-family');
  if (sketchFontFamilyEl) sketchFontFamilyEl.value = sketcher.globalFontFamily;
  const sketchFontSizeValEl = document.getElementById('sketch-font-size-val');
  if (sketchFontSizeValEl) sketchFontSizeValEl.innerText = sketcher.globalFontSizeBase + 'px';

  // Auto-generate sketcher shapes if the layout is empty but measurements are present
  if (!activeEntry.sketcherData || activeEntry.sketcherData.length === 0) {
    const autoShapes = autoGenerateSketcherShapes(activeEntry);
    if (autoShapes.length > 0) {
      activeEntry.sketcherData = autoShapes;
      sketcher.loadData(autoShapes);
      sketcher.fitToContent();
      activeEntry.sketcherImage = sketcher.exportImage();
    } else {
      sketcher.loadData([]);
    }
  } else {
    sketcher.loadData(activeEntry.sketcherData);
    sketcher.fitToContent();
  }
  if (activeEntry.mapLat && activeEntry.mapLon) {
    const mapZoom = activeEntry.mapZoom || 17;
    const mapType = activeEntry.mapType || 'satellite';
    const mapSearchInput = document.getElementById('map-search-input');
    const mapTypeSelect = document.getElementById('map-type-select');
    if (mapSearchInput) mapSearchInput.value = `${activeEntry.mapLat}, ${activeEntry.mapLon}`;
    if (mapTypeSelect) mapTypeSelect.value = mapType;
    sketcher.loadMapBackground(activeEntry.mapLat, activeEntry.mapLon, mapZoom, mapType);
  } else {
    sketcher.clearMapBackground();
    const mapSearchInput = document.getElementById('map-search-input');
    if (mapSearchInput) mapSearchInput.value = activeEntry.gpsLat ? `${activeEntry.gpsLat}, ${activeEntry.gpsLon}` : '';
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

  // Load sketcher lock state
  if (sketcher) {
    sketcher.setLocked(activeEntry.sketcherLocked || false);
    updateSketcherLockUI();
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
    unit: type === 'plinth-area' ? 'sqm' : 'nos',
    rate: 0.0,
    totalCost: 0.0,
    includeInValuation: true,
    excludeFromDepreciation: false,
    customDepreciation: false,
    customDepreciationPct: 2.0,
    customDepreciationAge: 10,
    measurements: type === 'quantity-rate' ? [{ id: 'M_' + Date.now(), description: '', nos: 1, l: '', b: '', h: '', subQty: 1 }] : [],
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
    newItem.rate = 20685.00;
    newItem.unit = 'sqm';
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
    // Migrate old single l/b/h to measurements array for backward compatibility
    if (!item.measurements || !Array.isArray(item.measurements)) {
      const legacyMeas = { id: 'M_' + Date.now(), description: '', nos: 1, l: item.l || '', b: item.b || '', h: item.h || '', subQty: item.quantity || 1 };
      item.measurements = [legacyMeas];
      delete item.l; delete item.b; delete item.h;
    }

    detailHtml = `
      <div class="dsr-search-container">
        <input type="text" class="item-title-input bold dsr-search" placeholder="Type to search DSR item..." value="${item.title}">
        <div class="dsr-autocomplete-list" style="display: none;"></div>
      </div>
      <div class="dsr-rate-hint" style="display:none;"></div>
      <textarea class="item-desc-input" placeholder="Standard quantity description...">${item.description}</textarea>

      <!-- Measurement Book Table -->
      <div class="mbook-container" style="margin-top: 0.5rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.3rem;">
          <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em;">Measurements</span>
          <button type="button" class="btn-secondary add-mrow-btn" style="padding: 0.15rem 0.45rem; font-size: 0.7rem; display: flex; align-items: center; gap: 0.2rem;"><i data-lucide="plus" style="width: 11px; height: 11px;"></i> Add Row</button>
        </div>
        <table class="mbook-table" style="width: 100%; border-collapse: collapse; font-size: 0.72rem;">
          <thead>
            <tr style="color: var(--text-muted);">
              <th style="text-align: left; padding: 0.15rem 0.2rem; font-weight: 600; border-bottom: 1px solid var(--border-color);">Description</th>
              <th style="text-align: center; padding: 0.15rem 0.2rem; font-weight: 600; border-bottom: 1px solid var(--border-color); width: 36px;">Nos</th>
              <th style="text-align: center; padding: 0.15rem 0.2rem; font-weight: 600; border-bottom: 1px solid var(--border-color); width: 46px;">L</th>
              <th style="text-align: center; padding: 0.15rem 0.2rem; font-weight: 600; border-bottom: 1px solid var(--border-color); width: 46px;">B</th>
              <th style="text-align: center; padding: 0.15rem 0.2rem; font-weight: 600; border-bottom: 1px solid var(--border-color); width: 46px;">H</th>
              <th style="text-align: right; padding: 0.15rem 0.2rem; font-weight: 600; border-bottom: 1px solid var(--border-color); width: 52px;">Qty</th>
              <th style="width: 20px; border-bottom: 1px solid var(--border-color);"></th>
            </tr>
          </thead>
          <tbody class="mbook-tbody">
            <!-- Rows injected by JS -->
          </tbody>
          <tfoot>
            <tr style="font-weight: 700; border-top: 1px solid var(--border-color);">
              <td colspan="5" style="padding: 0.2rem 0.2rem; text-align: right; font-size: 0.72rem;">Total Qty:</td>
              <td style="text-align: right; padding: 0.2rem 0.2rem; color: var(--accent);" class="mbook-total-cell">-</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      
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
      
      <!-- Custom Depreciation Settings for this specific Item -->
      <div class="item-custom-dep-container" style="background: var(--bg-secondary); border: 1px dashed var(--border-color); border-radius: 0.5rem; padding: 0.5rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
        <label class="check-label" style="font-size: 0.75rem; justify-content: flex-start; cursor: pointer; user-select: none;">
          <input type="checkbox" class="item-custom-dep-chk" ${item.customDepreciation ? 'checked' : ''}>
          <span style="font-weight: 600; color: var(--text-primary);">Apply separate/custom depreciation for this item</span>
        </label>
        <div class="item-custom-dep-inputs" style="display: ${item.customDepreciation ? 'flex' : 'none'}; gap: 0.5rem; align-items: center;">
          <div style="flex: 1;">
            <label style="font-size: 0.68rem; color: var(--text-muted); display: block; margin-bottom: 0.1rem;">Age of Item (Years)</label>
            <input type="number" class="item-custom-dep-age" value="${item.customDepreciationAge !== undefined ? item.customDepreciationAge : 10}" min="0" style="padding: 0.25rem 0.4rem; border-radius: 0.3rem; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-size: 0.75rem; width: 100%;">
          </div>
          <div style="flex: 1;">
            <label style="font-size: 0.68rem; color: var(--text-muted); display: block; margin-bottom: 0.1rem;">Depreciation Rate (%)</label>
            <input type="number" step="0.1" class="item-custom-dep-rate" value="${item.customDepreciationPct !== undefined ? item.customDepreciationPct : 2.0}" min="0" max="100" style="padding: 0.25rem 0.4rem; border-radius: 0.3rem; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-size: 0.75rem; width: 100%;">
          </div>
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
      
      <!-- Custom Depreciation Settings for this specific Plinth Structure -->
      <div class="item-custom-dep-container" style="background: var(--bg-secondary); border: 1px dashed var(--border-color); border-radius: 0.5rem; padding: 0.5rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
        <label class="check-label" style="font-size: 0.75rem; justify-content: flex-start; cursor: pointer; user-select: none;">
          <input type="checkbox" class="item-custom-dep-chk" ${item.customDepreciation ? 'checked' : ''}>
          <span style="font-weight: 600; color: var(--text-primary);">Apply separate/custom depreciation for this structure</span>
        </label>
        <div class="item-custom-dep-inputs" style="display: ${item.customDepreciation ? 'flex' : 'none'}; gap: 0.5rem; align-items: center;">
          <div style="flex: 1;">
            <label style="font-size: 0.68rem; color: var(--text-muted); display: block; margin-bottom: 0.1rem;">Age of Structure (Years)</label>
            <input type="number" class="item-custom-dep-age" value="${item.customDepreciationAge !== undefined ? item.customDepreciationAge : 10}" min="0" style="padding: 0.25rem 0.4rem; border-radius: 0.3rem; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-size: 0.75rem; width: 100%;">
          </div>
          <div style="flex: 1;">
            <label style="font-size: 0.68rem; color: var(--text-muted); display: block; margin-bottom: 0.1rem;">Depreciation Rate (%)</label>
            <input type="number" step="0.1" class="item-custom-dep-rate" value="${item.customDepreciationPct !== undefined ? item.customDepreciationPct : 2.0}" min="0" max="100" style="padding: 0.25rem 0.4rem; border-radius: 0.3rem; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-size: 0.75rem; width: 100%;">
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
        <div class="item-mbook-total" style="margin-top: 0.35rem; font-size: 0.75rem; color: var(--accent); font-weight: 600; text-align: center;">
          Total: <span class="mbook-total-qty">${item.quantity.toFixed(3)}</span>
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
      <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: center;">
        <button type="button" class="btn-secondary copy-item-row-btn" style="padding: 0.25rem 0.5rem; background: var(--bg-secondary); border-color: var(--border-color); color: var(--text-primary);" title="Duplicate Item"><i data-lucide="copy" style="width: 14px; height: 14px;"></i></button>
        <button type="button" class="btn-danger delete-item-row-btn" style="padding: 0.25rem 0.5rem;" title="Delete Item"><i data-lucide="x" style="width: 14px; height: 14px;"></i></button>
      </div>
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

        // Auto-assign rates and units based on building structure type
        const rateInput = tr.querySelector('.item-rate-input');
        const unitSelect = tr.querySelector('.item-unit-select');

        if (val === 'RCC Structure') {
          item.rate = 20685.00;
          item.unit = 'sqm';
        } else if (val === 'Assam Type Building') {
          item.rate = 15867.00;
          item.unit = 'sqm';
        } else if (val === 'Temporary Building') {
          item.rate = 205.00;
          item.unit = 'sqf';
        } else if (val === 'Temp Shed') {
          item.rate = 205.00;
          item.unit = 'sqf';
        }

        if (rateInput) rateInput.value = item.rate;
        if (unitSelect) unitSelect.value = item.unit;
      }
      updateRowTotal(item, tr);
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

  // Custom Depreciation Event Bindings
  const customDepChk = tr.querySelector('.item-custom-dep-chk');
  const customDepInputs = tr.querySelector('.item-custom-dep-inputs');
  const customDepAge = tr.querySelector('.item-custom-dep-age');
  const customDepRate = tr.querySelector('.item-custom-dep-rate');

  if (customDepChk && customDepInputs) {
    customDepChk.addEventListener('change', (e) => {
      item.customDepreciation = e.target.checked;
      customDepInputs.style.display = item.customDepreciation ? 'flex' : 'none';
      calculateAndRenderTotals();
    });
  }
  if (customDepAge) {
    customDepAge.addEventListener('input', (e) => {
      item.customDepreciationAge = parseInt(e.target.value) || 0;
      calculateAndRenderTotals();
    });
  }
  if (customDepRate) {
    customDepRate.addEventListener('input', (e) => {
      item.customDepreciationPct = parseFloat(e.target.value) || 0.0;
      calculateAndRenderTotals();
    });
  }

  tr.querySelector('.item-rate-input').addEventListener('input', (e) => {
    item.rate = parseFloat(e.target.value) || 0;
    updateRowTotal(item, tr);
  });

  if (item.type === 'quantity-rate') {
    tr.querySelector('.item-qty-input').addEventListener('input', (e) => {
      item.quantity = parseFloat(e.target.value) || 0;
      updateRowTotal(item, tr);
    });

    setupDsrAutocomplete(tr.querySelector('.dsr-search'), item, tr);

    // Show rate hint from learned catalog if item title matches
    const rateHintEl = tr.querySelector('.dsr-rate-hint');
    const showDsrRateHint = (title) => {
      if (!rateHintEl) return;
      const codeMatch = (title || '').match(/DSR\s+(?:Item\s*No\.?\s*)?([0-9]+(?:\.[0-9]+)*)/i);
      if (!codeMatch) { rateHintEl.style.display = 'none'; return; }
      const code = codeMatch[1];
      const learned = customDsrCatalog.find(d => d.code === code);
      if (learned) {
        rateHintEl.innerHTML = `⭐ Learned — last rate: <strong>Rs. ${formatIndianCurrency(learned.rate)} / ${learned.unit}</strong>
          <span style="color:var(--text-muted); font-size:0.68rem; margin-left:0.35rem;">used ${learned.usageCount || 1}×</span>`;
        rateHintEl.style.display = 'block';
      } else {
        rateHintEl.style.display = 'none';
      }
    };
    showDsrRateHint(item.title);
    tr.querySelector('.dsr-search').addEventListener('input', (e) => showDsrRateHint(e.target.value));

    // Render measurement book rows and wire add-row button
    renderMeasurementBook(item, tr);
    tr.querySelector('.add-mrow-btn').addEventListener('click', () => {
      addMeasurementRow(item, tr);
    });
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

  const copyBtn = tr.querySelector('.copy-item-row-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const clonedItem = JSON.parse(JSON.stringify(item));
      clonedItem.id = 'ITEM_' + Date.now() + Math.floor(Math.random()*1000);
      const idx = activeEntry.items.findIndex(i => i.id === item.id);
      if (idx !== -1) {
        activeEntry.items.splice(idx + 1, 0, clonedItem);
      } else {
        activeEntry.items.push(clonedItem);
      }

      // Re-index all item serial numbers sequentially
      activeEntry.items.forEach((it, index) => {
        it.itemNo = (index + 1).toString();
      });
      
      const tbodyNode = document.getElementById('estimate-items-body');
      tbodyNode.innerHTML = '';
      activeEntry.items.forEach(i => renderItemRow(i));
      calculateAndRenderTotals();
    });
  }

  tr.querySelector('.delete-item-row-btn').addEventListener('click', () => {
    activeEntry.items = activeEntry.items.filter(i => i.id !== item.id);
    
    // Automatically renew Sl No sequentially (1, 2, 3...)
    activeEntry.items.forEach((it, index) => {
      it.itemNo = (index + 1).toString();
    });

    // Re-render list to show updated sequential serial numbers
    const tbodyNode = document.getElementById('estimate-items-body');
    tbodyNode.innerHTML = '';
    activeEntry.items.forEach(i => renderItemRow(i));

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
    // Sum all measurement rows
    if (item.measurements && item.measurements.length > 0) {
      const totalQty = item.measurements.reduce((sum, m) => sum + (parseFloat(m.subQty) || 0), 0);
      item.quantity = Number(totalQty.toFixed(3));
      if (tr) {
        const qtyInput = tr.querySelector('.item-qty-input');
        const totalCell = tr.querySelector('.mbook-total-cell');
        const totalQtySpan = tr.querySelector('.mbook-total-qty');
        if (qtyInput) qtyInput.value = item.quantity;
        if (totalCell) totalCell.textContent = item.quantity.toFixed(3) + ' ' + (item.unit || '');
        if (totalQtySpan) totalQtySpan.textContent = item.quantity.toFixed(3);
      }
    }
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

// Measurement Book (Multi-row for quantity-rate items)
function calcMeasurementSubQty(m) {
  const nos = parseFloat(m.nos) || 0;
  const l   = parseFloat(m.l)   || 0;
  const b   = parseFloat(m.b)   || 0;
  const h   = parseFloat(m.h)   || 0;

  // If all dimension fields empty, treat as direct entry = nos value
  if (m.l === '' && m.b === '' && m.h === '') {
    return nos;
  }
  let dims = 1;
  if (l > 0) dims *= l;
  if (b > 0) dims *= b;
  if (h > 0) dims *= h;
  return Number((nos * dims).toFixed(3));
}

function renderMeasurementBook(item, tr) {
  if (!item.measurements) item.measurements = [];
  const tbody = tr.querySelector('.mbook-tbody');
  tbody.innerHTML = '';
  item.measurements.forEach(m => renderMeasurementRow(m, item, tr, tbody));
  refreshMeasurementTotal(item, tr);
}

function updateDualDimensions(m, item, mtr) {
  const lEl = mtr.querySelector('.m-l-dual');
  const bEl = mtr.querySelector('.m-b-dual');
  const hEl = mtr.querySelector('.m-h-dual');
  const qEl = mtr.querySelector('.m-subqty-dual');
  if (!lEl || !bEl || !hEl || !qEl) return;

  const unit = (item.unit || '').toLowerCase();
  const isFeet = ['sqf', 'sqft', 'ft', 'rft'].some(u => unit.includes(u));
  const isMetric = ['sqm', 'cum', 'm', 'rm'].some(u => unit.includes(u));

  if (!isFeet && !isMetric) {
    lEl.innerText = '';
    bEl.innerText = '';
    hEl.innerText = '';
    qEl.innerText = '';
    return;
  }

  const formatDual = (val, toMetric) => {
    const v = parseFloat(val);
    if (isNaN(v) || v <= 0) return '-';
    if (toMetric) {
      return `${(v * 0.3048).toFixed(2)}m`;
    } else {
      return `${(v * 3.28084).toFixed(1)}ft`;
    }
  };

  lEl.innerText = formatDual(m.l, isFeet);
  bEl.innerText = formatDual(m.b, isFeet);
  hEl.innerText = formatDual(m.h, isFeet);

  const subQty = parseFloat(m.subQty);
  if (!isNaN(subQty) && subQty > 0) {
    if (isFeet) {
      let convertedQty = subQty;
      let dualUnit = '';
      if (unit.includes('sqf')) {
        convertedQty = subQty * 0.092903;
        dualUnit = 'sqm';
      } else if (unit.includes('cum')) {
        convertedQty = subQty;
      } else {
        convertedQty = subQty * 0.3048;
        dualUnit = 'm';
      }
      qEl.innerText = `${convertedQty.toFixed(2)} ${dualUnit}`;
    } else {
      let convertedQty = subQty;
      let dualUnit = '';
      if (unit.includes('sqm')) {
        convertedQty = subQty * 10.76391;
        dualUnit = 'sqft';
      } else if (unit.includes('cum')) {
        convertedQty = subQty * 35.3147;
        dualUnit = 'cft';
      } else {
        convertedQty = subQty * 3.28084;
        dualUnit = 'ft';
      }
      qEl.innerText = `${convertedQty.toFixed(2)} ${dualUnit}`;
    }
  } else {
    qEl.innerText = '-';
  }
}

function renderMeasurementRow(m, item, tr, tbody) {
  const mtr = document.createElement('tr');
  mtr.dataset.mId = m.id;
  mtr.className = 'mbook-row';

  const inputStyle = `width:100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem; text-align: center; padding: 0.1rem 0; outline: none;`;
  const descStyle  = `width:100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem; text-align: left; padding: 0.1rem 0; outline: none;`;

  mtr.innerHTML = `
    <td style="padding: 0.12rem 0.15rem;">
      <input type="text" class="m-desc" value="${m.description || ''}" placeholder="e.g. Room 1" style="${descStyle}">
    </td>
    <td style="padding: 0.12rem 0.1rem;">
      <input type="number" class="m-nos" value="${m.nos !== undefined ? m.nos : 1}" step="1" min="0" style="${inputStyle}">
    </td>
    <td style="padding: 0.12rem 0.1rem;">
      <input type="number" class="m-l" value="${m.l !== undefined ? m.l : ''}" placeholder="L" step="0.001" style="${inputStyle}">
      <div class="m-l-dual" style="font-size: 0.62rem; color: var(--text-muted); text-align: center; margin-top: 1px; line-height: 1.1;">-</div>
    </td>
    <td style="padding: 0.12rem 0.1rem;">
      <input type="number" class="m-b" value="${m.b !== undefined ? m.b : ''}" placeholder="B" step="0.001" style="${inputStyle}">
      <div class="m-b-dual" style="font-size: 0.62rem; color: var(--text-muted); text-align: center; margin-top: 1px; line-height: 1.1;">-</div>
    </td>
    <td style="padding: 0.12rem 0.1rem;">
      <input type="number" class="m-h" value="${m.h !== undefined ? m.h : ''}" placeholder="H" step="0.001" style="${inputStyle}">
      <div class="m-h-dual" style="font-size: 0.62rem; color: var(--text-muted); text-align: center; margin-top: 1px; line-height: 1.1;">-</div>
    </td>
    <td style="padding: 0.12rem 0.1rem; text-align: right; font-weight: 600; color: var(--accent); white-space: nowrap;">
      <span class="m-subqty-display">${(m.subQty || 0).toFixed(3)}</span>
      <div class="m-subqty-dual" style="font-size: 0.62rem; color: var(--text-muted); text-align: right; margin-top: 1px; font-weight: normal; line-height: 1.1;">-</div>
    </td>
    <td style="padding: 0.12rem 0.1rem; text-align: center;">
      <button type="button" class="delete-mrow-btn" style="background: none; border: none; cursor: pointer; color: var(--danger); padding: 0; line-height: 1; font-size: 0.8rem;" title="Remove row">✕</button>
    </td>
  `;

  tbody.appendChild(mtr);
  updateDualDimensions(m, item, mtr);

  const recalc = () => {
    m.description = mtr.querySelector('.m-desc').value;
    m.nos = mtr.querySelector('.m-nos').value.trim();
    m.l   = mtr.querySelector('.m-l').value.trim();
    m.b   = mtr.querySelector('.m-b').value.trim();
    m.h   = mtr.querySelector('.m-h').value.trim();
    m.subQty = calcMeasurementSubQty(m);
    mtr.querySelector('.m-subqty-display').textContent = m.subQty.toFixed(3);
    updateDualDimensions(m, item, mtr);
    refreshMeasurementTotal(item, tr);
    updateRowTotal(item, tr);
  };

  mtr.querySelector('.m-desc').addEventListener('input', recalc);
  mtr.querySelector('.m-nos').addEventListener('input', recalc);
  mtr.querySelector('.m-l').addEventListener('input', recalc);
  mtr.querySelector('.m-b').addEventListener('input', recalc);
  mtr.querySelector('.m-h').addEventListener('input', recalc);

  mtr.querySelector('.delete-mrow-btn').addEventListener('click', () => {
    item.measurements = item.measurements.filter(x => x.id !== m.id);
    mtr.remove();
    refreshMeasurementTotal(item, tr);
    updateRowTotal(item, tr);
  });
}

function addMeasurementRow(item, tr) {
  if (!item.measurements) item.measurements = [];
  const m = { id: 'M_' + Date.now() + Math.random().toString(36).substr(2, 4), description: '', nos: 1, l: '', b: '', h: '', subQty: 1 };
  item.measurements.push(m);
  const tbody = tr.querySelector('.mbook-tbody');
  renderMeasurementRow(m, item, tr, tbody);
  refreshMeasurementTotal(item, tr);
  updateRowTotal(item, tr);
}

function refreshMeasurementTotal(item, tr) {
  const total = (item.measurements || []).reduce((s, m) => s + (parseFloat(m.subQty) || 0), 0);
  item.quantity = Number(total.toFixed(3));
  const qtyInput  = tr.querySelector('.item-qty-input');
  const totalCell = tr.querySelector('.mbook-total-cell');
  const totalQtySpan = tr.querySelector('.mbook-total-qty');
  if (qtyInput) qtyInput.value = item.quantity;
  if (totalCell) totalCell.textContent = item.quantity.toFixed(3) + ' ' + (item.unit || '');
  if (totalQtySpan) totalQtySpan.textContent = item.quantity.toFixed(3);
}

// Plinth Area Rooms
function renderPlinthRooms(item, tr) {
  const container = tr.querySelector('.room-grid');
  container.innerHTML = '';
  
  item.rooms.forEach((room) => {
    const div = document.createElement('div');
    div.className = 'room-row';
    const l_ft = (room.l * 3.28084).toFixed(1);
    const w_ft = (room.w * 3.28084).toFixed(1);
    const areaSqft = (room.areaSqm * 10.76391).toFixed(2);

    div.innerHTML = `
      <input type="text" class="room-name" value="${room.name}" style="flex-grow: 2;" placeholder="Room name">
      <input type="number" class="room-l" value="${room.l}" style="width: 70px;" placeholder="L (m)" step="0.01">
      <span style="align-self: center; font-size: 0.8rem; color: var(--text-muted);">x</span>
      <input type="number" class="room-w" value="${room.w}" style="width: 70px;" placeholder="W (m)" step="0.01">
      <span style="align-self: center; font-size: 0.72rem; color: var(--text-muted); width: 100px; text-align: center;" class="room-feet-display">(${l_ft}' x ${w_ft}')</span>
      <span style="align-self: center; font-size: 0.85rem; font-weight: 500; width: 130px; text-align: right;" class="room-sqm-display">${room.areaSqm.toFixed(2)} sqm<br><span style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">${areaSqft} sqft</span></span>
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
      
      const lf = (room.l * 3.28084).toFixed(1);
      const wf = (room.w * 3.28084).toFixed(1);
      const asf = (room.areaSqm * 10.76391).toFixed(2);
      
      div.querySelector('.room-feet-display').innerText = `(${lf}' x ${wf}')`;
      div.querySelector('.room-sqm-display').innerHTML = `${room.areaSqm.toFixed(2)} sqm<br><span style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">${asf} sqft</span>`;
      
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

  function applyDsrItem(dsr) {
    // For DSR-coded items use "DSR X.Y" as title, for custom use the original title
    item.title = dsr.category === 'custom' ? dsr.title : `DSR ${dsr.code}`;
    item.description = dsr.description || '';
    item.unit = dsr.unit || '';
    item.rate = dsr.rate;
    
    // Preserve existing measurements but recalculate total quantity
    if (!item.measurements || item.measurements.length === 0) {
      item.measurements = [{ id: 'M_' + Date.now(), description: '', nos: 1, l: '', b: '', h: '', subQty: 1 }];
      item.quantity = 1;
    } else {
      // Recalculate quantity based on preserved measurements
      let total = 0;
      item.measurements.forEach(m => {
        total += (parseFloat(m.subQty) || 0);
      });
      item.quantity = total;
    }
    
    input.value = item.title;
    tr.querySelector('.item-desc-input').value = item.description;
    tr.querySelector('.item-qty-input').value = item.quantity;
    renderMeasurementBook(item, tr);

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
  }

  function renderItem(dsr, badgeType) {
    // badgeType: 'learned' | 'custom' | 'standard' | 'community'
    const div = document.createElement('div');
    const isLearned = badgeType === 'learned' || badgeType === 'custom';
    div.className = 'dsr-autocomplete-item' + (isLearned ? ' dsr-learned' : '') + (badgeType === 'community' ? ' dsr-community' : '');

    const displayTitle = (dsr.category === 'custom' || badgeType === 'community')
      ? (dsr.title || dsr.code)
      : `DSR ${dsr.code}`;

    const shortDesc = (dsr.description || '').length > 80
      ? dsr.description.substring(0, 80) + '…'
      : (dsr.description || '');

    let badge;
    if (badgeType === 'custom') {
      badge = `<span class="dsr-learned-badge" style="background:#0d9488;">💾 My Item</span>
               ${dsr.usageCount ? `<span class="dsr-usage-count">${dsr.usageCount}×</span>` : ''}
               ${dsr.lastUsedDate ? `<span class="dsr-last-used">${new Date(dsr.lastUsedDate).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'2-digit'})}</span>` : ''}`;
    } else if (badgeType === 'learned') {
      badge = `<span class="dsr-learned-badge">⭐ Learned</span>
               ${dsr.usageCount ? `<span class="dsr-usage-count">${dsr.usageCount}×</span>` : ''}
               ${dsr.lastUsedDate ? `<span class="dsr-last-used">${new Date(dsr.lastUsedDate).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'2-digit'})}</span>` : ''}`;
    } else if (badgeType === 'community') {
      badge = `<span class="dsr-learned-badge" style="background:#2563eb;">🌐 Community</span>
               ${dsr.contributorCount ? `<span class="dsr-usage-count">${dsr.contributorCount} contributor${dsr.contributorCount > 1 ? 's' : ''}</span>` : ''}`;
    } else {
      badge = `<span class="dsr-std-badge">Standard</span>`;
    }

    div.innerHTML = `
      <div class="dsr-item-top">
        <span class="code">${displayTitle}</span>
        <div class="dsr-item-meta">${badge}</div>
        <span class="dsr-rate-badge">Rs. ${formatIndianCurrency(dsr.rate)} / ${dsr.unit}</span>
      </div>
      <div class="dsr-item-desc">${shortDesc}</div>
    `;

    div.addEventListener('click', () => applyDsrItem(dsr));
    return div;
  }

  function showMatches(val) {
    const query = (val || '').toLowerCase().trim();

    // ── 1. Custom free-text items (category==='custom') ──
    const customItems = customDsrCatalog.filter(dsr =>
      dsr.category === 'custom' && (
        !query ||
        (dsr.title || '').toLowerCase().includes(query) ||
        (dsr.description || '').toLowerCase().includes(query)
      )
    ).sort((a, b) => {
      const usageDiff = (b.usageCount || 0) - (a.usageCount || 0);
      if (usageDiff !== 0) return usageDiff;
      return (b.lastUsedDate || 0) - (a.lastUsedDate || 0);
    }).slice(0, 5);

    // ── 2. DSR-coded learned items (category==='learned') ──
    const learnedItems = customDsrCatalog.filter(dsr =>
      dsr.category !== 'custom' && (
        !query ||
        dsr.code.toLowerCase().includes(query) ||
        (dsr.description || '').toLowerCase().includes(query) ||
        (`dsr ${dsr.code}`).includes(query)
      )
    ).sort((a, b) => {
      const usageDiff = (b.usageCount || 0) - (a.usageCount || 0);
      if (usageDiff !== 0) return usageDiff;
      return (b.lastUsedDate || 0) - (a.lastUsedDate || 0);
    }).slice(0, 5);

    // ── 3. Standard curated items not already in learned ──
    const learnedCodes = new Set(learnedItems.map(d => d.code));
    const standardItems = DSR_CURATED.filter(dsr =>
      !learnedCodes.has(dsr.code) && (
        !query ||
        dsr.code.toLowerCase().includes(query) ||
        (dsr.description || '').toLowerCase().includes(query)
      )
    ).slice(0, 6);

    // ── 4. Community items (from all users, deduped against above) ──
    const shownCodes = new Set([
      ...customItems.map(d => d.code),
      ...learnedItems.map(d => d.code),
      ...standardItems.map(d => d.code)
    ]);
    const communityItems = globalDsrCatalog.filter(dsr =>
      !shownCodes.has(dsr.code) && (
        !query ||
        (dsr.title || dsr.code || '').toLowerCase().includes(query) ||
        (dsr.description || '').toLowerCase().includes(query)
      )
    ).sort((a, b) => (b.contributorCount || 0) - (a.contributorCount || 0))
     .slice(0, 5);

    if (customItems.length === 0 && learnedItems.length === 0 && standardItems.length === 0 && communityItems.length === 0) {
      list.innerHTML = `
        <div class="dsr-no-results">
          <span style="color:var(--text-muted); font-size:0.8rem;">No match found for "<strong>${val}</strong>"</span>
          <br><span style="font-size:0.75rem; color:var(--accent);">💡 Fill in the description and rate manually — this item will be auto-saved after pressing Save.</span>
        </div>`;
      list.style.display = 'block';
      return;
    }

    list.innerHTML = '';

    if (customItems.length > 0) {
      const header = document.createElement('div');
      header.className = 'dsr-section-header';
      header.textContent = '💾 My Items';
      list.appendChild(header);
      customItems.forEach(dsr => list.appendChild(renderItem(dsr, 'custom')));
    }

    if (learnedItems.length > 0) {
      const header = document.createElement('div');
      header.className = 'dsr-section-header';
      header.textContent = '⭐ Previously Used DSR';
      list.appendChild(header);
      learnedItems.forEach(dsr => list.appendChild(renderItem(dsr, 'learned')));
    }

    if (standardItems.length > 0) {
      const header = document.createElement('div');
      header.className = 'dsr-section-header';
      header.textContent = '📋 Standard DSR';
      list.appendChild(header);
      standardItems.forEach(dsr => list.appendChild(renderItem(dsr, 'standard')));
    }

    if (communityItems.length > 0) {
      const header = document.createElement('div');
      header.className = 'dsr-section-header';
      header.textContent = '🌐 Community';
      list.appendChild(header);
      communityItems.forEach(dsr => list.appendChild(renderItem(dsr, 'community')));
    }

    list.style.display = 'block';
  }
}


// ── DSR Rate Learning Engine ──────────────────────────────────────────────
// Called after every save. Learns ALL quantity-rate items:
//   - DSR-coded items (title contains "DSR X.Y") → stored by numeric code
//   - Free-text items (any other title + rate > 0) → stored with category='custom'
function learnDsrRatesFromEntry(entry) {
  if (!entry || !entry.items) return;
  let changed = false;
  const now = Date.now();

  entry.items.forEach(item => {
    if (item.type !== 'quantity-rate' || !item.title || !item.rate) return;
    const rate = parseFloat(item.rate) || 0;
    if (rate === 0) return;

    const description = (item.description || '').trim();
    const unit = item.unit || '';
    const title = item.title.trim();

    // ── Check if it's a DSR-coded item ──
    const codeMatch = title.match(/DSR\s+(?:Item\s*No\.?\s*)?([0-9]+(?:\.[0-9]+)*)/i);

    if (codeMatch) {
      // DSR-coded item: learn by numeric code
      const code = codeMatch[1];
      const existsIdx = customDsrCatalog.findIndex(c => c.code === code && c.category !== 'custom');
      if (existsIdx > -1) {
        const existing = customDsrCatalog[existsIdx];
        existing.rate = rate;
        existing.usageCount = (existing.usageCount || 0) + 1;
        existing.lastUsedDate = now;
        if (description && description.length > (existing.description || '').length) {
          existing.description = description;
        }
        if (unit) existing.unit = unit;
      } else {
        customDsrCatalog.push({
          code,
          title: `DSR ${code}`,
          description,
          unit,
          rate,
          category: 'learned',
          usageCount: 1,
          lastUsedDate: now
        });
      }
      changed = true;

    } else {
      // ── Free-text item: learn by title slug ──
      // Only learn if there's a meaningful title (at least 3 chars) and rate > 0
      if (title.length < 3) return;

      // Create a stable slug key from the title
      const slug = 'custom_' + title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);

      const existsIdx = customDsrCatalog.findIndex(c => c.code === slug);
      if (existsIdx > -1) {
        const existing = customDsrCatalog[existsIdx];
        existing.rate = rate;
        existing.usageCount = (existing.usageCount || 0) + 1;
        existing.lastUsedDate = now;
        // Update description if new one is more complete
        if (description && description.length > (existing.description || '').length) {
          existing.description = description;
        }
        if (unit) existing.unit = unit;
        if (title) existing.title = title;
      } else {
        customDsrCatalog.push({
          code: slug,
          title: title,
          description: description || title,
          unit,
          rate,
          category: 'custom',
          usageCount: 1,
          lastUsedDate: now
        });
      }
      changed = true;
    }
  });

  if (changed) {
    saveCustomDsrCatalog();
    if (auth.currentUser) {
      saveUserCustomDsr(auth.currentUser.uid, customDsrCatalog)
        .catch(err => console.error('Error syncing learned DSR to Firestore:', err));
    }
  }
}


function calculateAndRenderTotals() {
  if (!activeEntry) return;
  if (!activeEntry.items) activeEntry.items = [];
  if (!activeEntry.customServices) activeEntry.customServices = [];

  activeEntry.clientName = document.getElementById('client-name').value;
  activeEntry.location = document.getElementById('location').value;
  const jmsSlNoEl = document.getElementById('jms-sl-no');
  if (jmsSlNoEl) {
    activeEntry.jmsSlNo = jmsSlNoEl.value.trim();
  }
  
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
  activeEntry.enableDepreciation = document.getElementById('enable-depreciation').checked;

  activeEntry.addElectrification = document.getElementById('toggle-electrification').checked;
  activeEntry.electrificationPct = parseFloat(document.getElementById('electrification-pct').value) || 0;
  activeEntry.electrificationDeductPct = parseFloat(document.getElementById('electrification-deduct-pct').value) || 0;
  activeEntry.addSanitary = document.getElementById('toggle-sanitary').checked;
  activeEntry.sanitaryPct = parseFloat(document.getElementById('sanitary-pct').value) || 0;
  activeEntry.sanitaryDeductPct = parseFloat(document.getElementById('sanitary-deduct-pct').value) || 0;

  const includedItems = activeEntry.items.filter(i => i.includeInValuation);
  
  // Categorize items
  const mainDepreciatedItems = includedItems.filter(i => !i.excludeFromDepreciation && !i.customDepreciation);
  const customDepreciatedItems = includedItems.filter(i => !i.excludeFromDepreciation && i.customDepreciation);
  const excludedItems = includedItems.filter(i => i.excludeFromDepreciation);

  // 1. Calculate Main Depreciated totals
  const totalA = Math.round(mainDepreciatedItems.reduce((acc, curr) => acc + curr.totalCost, 0));
  activeEntry.totalA = totalA;

  const tplSettings = getPdfTemplateSettings();
  const contractorPct = activeEntry.contractorPct !== undefined ? activeEntry.contractorPct : (tplSettings.contractorPct !== undefined ? tplSettings.contractorPct : 15);
  const contractorDeduction = Math.round(totalA * (contractorPct / 100));
  activeEntry.contractorDeduction = contractorDeduction;

  const totalB = totalA - contractorDeduction;
  activeEntry.totalB = totalB;

  const age = Math.max(0, activeEntry.valuationYear - activeEntry.constructionYear);
  activeEntry.structureAge = age;
  
  const totalDepPct = activeEntry.enableDepreciation ? (activeEntry.depreciationPct * age) : 0;
  activeEntry.totalDepreciationPct = totalDepPct;

  const depAmount = activeEntry.enableDepreciation ? Math.round(totalB * (totalDepPct / 100)) : 0;
  activeEntry.depreciationAmount = depAmount;

  const mainAfterDep = Math.max(0, totalB - depAmount);

  // 2. Calculate Custom Depreciated totals (each depreciated separately using its own age/rate)
  let totalCustomCostBeforeDep = 0;
  let totalCustomDepAmount = 0;
  
  customDepreciatedItems.forEach(item => {
    const rawCost = item.totalCost;
    // Deduct contractor profit if applicable (to match main building standard rules)
    const costAfterProfit = Math.round(rawCost * (1 - (contractorPct / 100))); 
    const itemDepPct = activeEntry.enableDepreciation ? ((item.customDepreciationPct || 0) * (item.customDepreciationAge || 0)) : 0;
    const itemDepAmount = Math.round(costAfterProfit * (itemDepPct / 100));
    
    totalCustomCostBeforeDep += costAfterProfit;
    totalCustomDepAmount += itemDepAmount;
  });

  activeEntry.totalAfterDepreciation = mainAfterDep + Math.max(0, totalCustomCostBeforeDep - totalCustomDepAmount);

  // Adjust global activeEntry parameters to correctly represent consolidated totals in PDF reports
  activeEntry.depreciationAmount = depAmount + totalCustomDepAmount;

  const totalExcludedCost = Math.round(excludedItems.reduce((acc, curr) => acc + curr.totalCost, 0));
  activeEntry.totalExcludedCost = totalExcludedCost;

  // Calculate building base for electrification/sanitary percentage
  // Sum totalCost of all included plinth-area items whose title is a building type (not "Others")
  const buildingTitles = ["RCC Structure", "Assam Type Building", "Temporary Building", "Temp Shed"];
  const buildingBase = Math.round(includedItems
    .filter(i => i.type === 'plinth-area' && buildingTitles.includes(i.title))
    .reduce((acc, curr) => acc + curr.totalCost, 0));
  activeEntry.buildingBase = buildingBase;

  // Calculate electrification and sanitary costs as percentage of building base, then apply non-conformity deduction
  if (activeEntry.addElectrification) {
    const elecGross = Math.round(buildingBase * (activeEntry.electrificationPct / 100));
    const elecDeduct = Math.round(elecGross * (activeEntry.electrificationDeductPct / 100));
    activeEntry.electrificationCostGross = elecGross;
    activeEntry.electrificationDeductAmt = elecDeduct;
    activeEntry.electrificationCost = elecGross - elecDeduct;
  } else {
    activeEntry.electrificationCostGross = 0;
    activeEntry.electrificationDeductAmt = 0;
    activeEntry.electrificationCost = 0;
  }
  if (activeEntry.addSanitary) {
    const saniGross = Math.round(buildingBase * (activeEntry.sanitaryPct / 100));
    const saniDeduct = Math.round(saniGross * (activeEntry.sanitaryDeductPct / 100));
    activeEntry.sanitaryCostGross = saniGross;
    activeEntry.sanitaryDeductAmt = saniDeduct;
    activeEntry.sanitaryCost = saniGross - saniDeduct;
  } else {
    activeEntry.sanitaryCostGross = 0;
    activeEntry.sanitaryDeductAmt = 0;
    activeEntry.sanitaryCost = 0;
  }

  // Update the cost display next to percentage inputs
  const elecCostDisplay = document.getElementById('electrification-cost-display');
  const saniCostDisplay = document.getElementById('sanitary-cost-display');
  if (elecCostDisplay) {
    if (activeEntry.addElectrification) {
      let txt = '= Rs. ' + formatIndianCurrency(activeEntry.electrificationCostGross);
      if (activeEntry.electrificationDeductPct > 0) txt += ' − ' + activeEntry.electrificationDeductPct + '% = Rs. ' + formatIndianCurrency(activeEntry.electrificationCost);
      elecCostDisplay.textContent = txt;
    } else elecCostDisplay.textContent = '';
  }
  if (saniCostDisplay) {
    if (activeEntry.addSanitary) {
      let txt = '= Rs. ' + formatIndianCurrency(activeEntry.sanitaryCostGross);
      if (activeEntry.sanitaryDeductPct > 0) txt += ' − ' + activeEntry.sanitaryDeductPct + '% = Rs. ' + formatIndianCurrency(activeEntry.sanitaryCost);
      saniCostDisplay.textContent = txt;
    } else saniCostDisplay.textContent = '';
  }

  const customServicesSum = (activeEntry.customServices || []).reduce((acc, curr) => acc + (curr.cost || 0), 0);
  let grandTotal = activeEntry.totalAfterDepreciation + totalExcludedCost + customServicesSum;
  if (activeEntry.addElectrification) grandTotal += activeEntry.electrificationCost;
  if (activeEntry.addSanitary) grandTotal += activeEntry.sanitaryCost;
  activeEntry.grandTotal = Math.round(grandTotal);

  const table = document.querySelector('.builder-table');
  if (!table) {
    checkForModifiedFields();
    return;
  }
  // Use native tFoot property (direct child only) to avoid matching nested mbook-table tfoot elements
  let tfoot = table.tFoot;
  if (!tfoot) {
    tfoot = table.createTFoot();
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
    ${activeEntry.enableDepreciation !== false ? `
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
    ` : ''}
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
  
  if (activeEntry.enableDepreciation !== false) {
    document.getElementById('calc-dep-label').innerHTML = `Depreciation @ ${activeEntry.depreciationPct}% per year for ${age} years (${activeEntry.totalDepreciationPct}%) =`;
    document.getElementById('calc-dep-amount').innerText = 'Rs. -' + formatIndianCurrency(activeEntry.depreciationAmount);
    document.getElementById('calc-after-dep').innerText = 'Rs. ' + formatIndianCurrency(activeEntry.totalAfterDepreciation);
  }
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
  compareField('jms-sl-no', originalEntryCopy.jmsSlNo || '');
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
  compareField('electrification-pct', originalEntryCopy.electrificationPct);
  compareField('electrification-deduct-pct', originalEntryCopy.electrificationDeductPct);
  compareField('toggle-sanitary', originalEntryCopy.addSanitary, true);
  compareField('sanitary-pct', originalEntryCopy.sanitaryPct);
  compareField('sanitary-deduct-pct', originalEntryCopy.sanitaryDeductPct);

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

async function saveActiveEntry(status = 'draft') {
  if (!activeEntry || !activeProject) return;
  calculateAndRenderTotals();

  if (status === 'draft') {
    const hasEmptyStructures = activeEntry.items && activeEntry.items.some(item => 
      item.type === 'plinth-area' && item.rooms && (item.rooms.length === 0 || item.rooms.some(r => parseFloat(r.l) <= 0 || parseFloat(r.w) <= 0))
    );
    const hasNoName = !activeEntry.clientName || activeEntry.clientName === 'Unnamed Owner' || activeEntry.clientName.trim() === '';
    const hasNoLocation = !activeEntry.location || activeEntry.location === 'N/A' || activeEntry.location.trim() === '';
    
    if (hasEmptyStructures || hasNoName || hasNoLocation) {
      activeEntry.status = 'needs-review';
    } else {
      activeEntry.status = 'draft';
    }
  } else {
    activeEntry.status = status;
  }
  if (sketcher) {
    activeEntry.sketcherData = sketcher.exportData();
    activeEntry.sketcherImage = sketcher.exportImage();
    activeEntry.sketcherLocked = sketcher.isLocked;
    activeEntry.sketcherFontSize = sketcher.globalFontSizeBase;
    activeEntry.sketcherFontFamily = sketcher.globalFontFamily;
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

  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Cloud timeout')), ms));

  if (!activeProject.entries) activeProject.entries = [];
  const idx = activeProject.entries.findIndex(e => e.id === activeEntry.id);
  if (idx > -1) {
    activeProject.entries[idx] = activeEntry;
  } else {
    activeProject.entries.push(activeEntry);
  }

  // Recalculate summary metrics
  activeProject.entriesCount = activeProject.entries.length;
  activeProject.totalValuation = activeProject.entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0);

  // Update in local projects list
  const pIdx = projects.findIndex(p => p.id === activeProject.id);
  if (pIdx > -1) {
    projects[pIdx] = activeProject;
  }

  saveProjects(); // Local backup

  let isCloudSuccess = false;
  if (auth.currentUser) {
    try {
      // Perform cloud saves with timeout
      await Promise.race([
        Promise.all([
          saveProjectEntry(activeProject.id, activeEntry),
          saveUserProject(auth.currentUser.uid, activeProject)
        ]),
        timeout(10000)
      ]);
      isCloudSuccess = true;
    } catch (err) {
      console.error("Cloud sync failed:", err);
      throw err; // Signal failure to caller
    }
  }

  // Auto-learn DSR rates from this entry's quantity-rate items
  learnDsrRatesFromEntry(activeEntry);
  renderProjectDetails();
  return isCloudSuccess;
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

export function syncSketcherUIState() {
  if (!sketcher) return;
  
  // 1. Vertical Toolbar Grid/Snap Buttons
  const vGrid = document.getElementById('vtool-grid');
  if (vGrid) vGrid.classList.toggle('active', sketcher.showGrid);
  
  const vSnap = document.getElementById('vtool-snap');
  if (vSnap) vSnap.classList.toggle('active', sketcher.snapGrid);
  
  // 2. Bottom Status Bar Buttons Grid/Snap
  const gridBtn = document.getElementById('sketch-grid-toggle');
  if (gridBtn) {
    gridBtn.innerHTML = sketcher.showGrid 
      ? '<i data-lucide="grid" style="width:13px;height:13px;"></i> GRID ON' 
      : '<i data-lucide="grid" style="width:13px;height:13px;"></i> GRID OFF';
    gridBtn.style.color = sketcher.showGrid ? '#22c55e' : '#94a3b8';
    gridBtn.style.borderColor = sketcher.showGrid ? '#22c55e' : '#94a3b8';
  }
  
  const snapBtn = document.getElementById('sketch-snap-toggle');
  if (snapBtn) {
    snapBtn.innerHTML = sketcher.snapGrid 
      ? '<i data-lucide="magnet" style="width:13px;height:13px;"></i> SNAP ON' 
      : '<i data-lucide="magnet" style="width:13px;height:13px;"></i> SNAP OFF';
    snapBtn.style.color = sketcher.snapGrid ? '#22c55e' : '#94a3b8';
    snapBtn.style.borderColor = sketcher.snapGrid ? '#22c55e' : '#94a3b8';
  }

  // 3. Lock button state
  updateSketcherLockUI();

  // 4. A4 Frame button & Orientation & Fit A4 state
  const a4FrameBtn = document.getElementById('sketch-a4-frame-btn');
  const a4Orient   = document.getElementById('sketch-a4-orient');
  const a4FitBtn   = document.getElementById('sketch-fit-a4-btn');
  if (a4FrameBtn) {
    a4FrameBtn.innerHTML = sketcher.showA4Frame 
      ? '<i data-lucide="file-text" style="width:13px;height:13px;"></i> A4 ON' 
      : '<i data-lucide="file-text" style="width:13px;height:13px;"></i> A4 OFF';
    a4FrameBtn.style.color = sketcher.showA4Frame ? '#3b82f6' : '#94a3b8';
    a4FrameBtn.style.borderColor = sketcher.showA4Frame ? '#3b82f6' : '#94a3b8';
    if (a4Orient) {
      a4Orient.style.display = sketcher.showA4Frame ? 'block' : 'none';
      a4Orient.value = sketcher.a4Orientation || 'landscape';
    }
    if (a4FitBtn) {
      a4FitBtn.style.display = sketcher.showA4Frame ? 'inline-flex' : 'none';
    }
  }

  // 5. Zoom label
  const zoomLabel = document.getElementById('sketcher-zoom-label');
  if (zoomLabel) {
    zoomLabel.textContent = `${Math.round(sketcher.zoom * 100)}%`;
  }

  // 6. Scale Selector dropdown
  const scaleSelect = document.getElementById('sketcher-scale-select');
  if (scaleSelect) {
    const ratioN = Math.round(5000 / sketcher.basePPM);
    scaleSelect.value = ratioN.toString();
  }

  // 7. Canvas size selector
  const canvasSizeSel = document.getElementById('sketch-canvas-size');
  if (canvasSizeSel) {
    const val = `${sketcher.W}x${sketcher.H}`;
    if (canvasSizeSel.value !== val) {
      canvasSizeSel.value = val;
    }
  }

  // 7. Grid Size dropdown
  const gridSel = document.getElementById('sketch-grid-size');
  if (gridSel) {
    gridSel.value = sketcher.gridSize.toString();
  }

  if (window.lucide) {
    lucide.createIcons();
  }
}

export function syncGridAndSnapUI() {
  syncSketcherUIState();
}

// Line Sketcher Toolbar Setup
function setupSketcherToolbar() {
  if (sketcherToolbarSetupDone) return;
  sketcherToolbarSetupDone = true;

  const tools = ['select', 'building', 'polybuilding', 'room', 'road', 'text', 'line', 'wall', 'boundary-wall', 'gate', 'gate-toran', 'custom-block', 'dimension', 'freehand', 'erase'];

  // Vertical Toolbar Buttons mapping
  const vToolsMap = {
    'vtool-select': 'select',
    'vtool-pan': 'pan',
    'vtool-zoom': 'zoom',
    'vtool-wall': 'wall',
    'vtool-room': 'room',
    'vtool-building': 'building',
    'vtool-polybuilding': 'polybuilding',
    'vtool-freehand': 'freehand',
    'vtool-line': 'line',
    'vtool-dimension': 'dimension',
    'vtool-boundary': 'boundary-wall',
    'vtool-road': 'road',
    'vtool-text': 'text',
    'vtool-gate': 'gate'
  };

  const syncAllToolbars = (activeMode) => {
    // Sync Vertical
    Object.entries(vToolsMap).forEach(([vId, mode]) => {
      const b = document.getElementById(vId);
      if (b) b.classList.toggle('active', mode === activeMode);
    });
  };

  // Vertical Toolbar Listeners
  Object.entries(vToolsMap).forEach(([vId, mode]) => {
    const btn = document.getElementById(vId);
    if (btn) {
      btn.addEventListener('click', () => {
        if (sketcher) {
          sketcher.mode = mode;
          sketcher.currentPath = [];
          sketcher.hoverPos = null;
          sketcher.wallChain = [];
          sketcher.polyChain = [];
          
          // Update cursor
          sketcher.canvas.className = '';
          if (mode === 'pan' || mode === 'zoom') {
            sketcher.canvas.classList.add(`mode-${mode}`);
          }
          
          document.getElementById('tool-close-poly').style.display = 'none';
          syncAllToolbars(mode);
          sketcher.draw();
        }
      });
    }
  });

  // Vertical Utils
  const vUndo = document.getElementById('vtool-undo');
  const vRedo = document.getElementById('vtool-redo');
  const vSave = document.getElementById('vtool-save');
  const vDel = document.getElementById('vtool-delete');

  if (vSave) vSave.addEventListener('click', async () => {
    if (activeEntry && sketcher) {
      const originalText = vSave.innerHTML;
      vSave.innerHTML = '<i data-lucide="refresh-cw" class="spin"></i>';
      lucide.createIcons();
      try {
        await saveActiveEntry('draft');
        showToast('Sync Successful: Drawing saved to cloud');
      } catch (err) {
        console.error("Save failed:", err);
        showToast('Sync Failed: Check internet connection', 'error');
      } finally {
        vSave.innerHTML = originalText;
        lucide.createIcons();
      }
    }
  });

  if (vUndo) vUndo.addEventListener('click', () => { if (sketcher) sketcher.undo(); });
  if (vRedo) vRedo.addEventListener('click', () => { if (sketcher) sketcher.redo(); });
  if (vDel) vDel.addEventListener('click', () => { if (sketcher) sketcher.deleteSelected(); });

  const vGrid = document.getElementById('vtool-grid');
  const vSnap = document.getElementById('vtool-snap');

  if (vGrid) vGrid.addEventListener('click', () => {
    if (sketcher) sketcher.toggleGrid();
  });

  if (vSnap) vSnap.addEventListener('click', () => {
    if (sketcher) sketcher.toggleSnap();
  });

  // ── Draggable Toolbar Logic ──
  const vToolbar = document.querySelector('.sketcher-vertical-toolbar');
  if (vToolbar) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    vToolbar.addEventListener('mousedown', (e) => {
      // Don't drag if a button inside was clicked
      if (e.target.closest('.vtool-btn')) return;
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      const rect = vToolbar.getBoundingClientRect();
      const parentRect = vToolbar.parentElement.getBoundingClientRect();
      
      initialLeft = rect.left - parentRect.left;
      initialTop = rect.top - parentRect.top;
      
      vToolbar.style.cursor = 'grabbing';
      // Disable translateY if it's being used for centering
      vToolbar.style.transform = 'none';
      vToolbar.style.left = `${initialLeft}px`;
      vToolbar.style.top = `${initialTop}px`;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      vToolbar.style.left = `${initialLeft + dx}px`;
      vToolbar.style.top = `${initialTop + dy}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        vToolbar.style.cursor = 'grab';
      }
    });
  }

  document.getElementById('tool-close-poly').addEventListener('click', () => {
    if (sketcher) {
      sketcher._commitPolyChain();
      document.getElementById('tool-close-poly').style.display = 'none';
      syncAllToolbars('select');
    }
  });

  const autoDrawBtn = document.getElementById('sketch-autodraw-btn');
  if (autoDrawBtn) {
    autoDrawBtn.addEventListener('click', () => {
      if (sketcher) {
        if (sketcher.isLocked) {
          showToast('Unlock sketcher first', 'warning');
          return;
        }
        if (sketcher.shapes && sketcher.shapes.length > 0) {
          if (!confirm('This will replace the current sketch layout. Proceed?')) {
            return;
          }
        }
        const autoShapes = autoGenerateSketcherShapes(activeEntry);
        if (autoShapes.length > 0) {
          sketcher.pushHistory();
          sketcher.loadData(autoShapes);
          sketcher.fitToContent();
          activeEntry.sketcherData = autoShapes;
          activeEntry.sketcherImage = sketcher.exportImage();
          showToast('Auto-drawing generated successfully!');
        } else {
          showToast('No buildings/measurements found to draw.', 'warning');
        }
      }
    });
  }

  document.getElementById('tool-clear').addEventListener('click', () => {
    if (sketcher && confirm('Are you sure you want to clear the entire site layout?')) {
      sketcher.loadData([]);
      document.getElementById('sketcher-properties-panel').style.display = 'none';
    }
  });

  // ── Scale Selector ──
  const scaleSelect = document.getElementById('sketcher-scale-select');
  if (scaleSelect) {
    scaleSelect.addEventListener('change', () => {
      if (sketcher) sketcher.setScale(parseInt(scaleSelect.value));
    });
  }

  // ── Zoom buttons ──
  const skZoomIn  = document.getElementById('sketch-zoom-in-btn');
  const skZoomOut = document.getElementById('sketch-zoom-out-btn');
  const skZoomRst = document.getElementById('sketch-zoom-reset-btn');
  if (skZoomIn)  skZoomIn.addEventListener('click',  () => { if (sketcher) sketcher.zoomTo(1.25); });
  if (skZoomOut) skZoomOut.addEventListener('click', () => { if (sketcher) sketcher.zoomTo(0.8); });
  if (skZoomRst) skZoomRst.addEventListener('click', () => { if (sketcher) sketcher.resetView(); });

  // ── Lock Toggle ──
  const lockBtn = document.getElementById('sketch-lock-btn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      if (sketcher) {
        sketcher.setLocked(!sketcher.isLocked);
        syncSketcherUIState();
      }
    });
  }

  // ── A4 Frame & Orientation & Fit A4 ──
  const a4FrameBtn = document.getElementById('sketch-a4-frame-btn');
  const a4Orient   = document.getElementById('sketch-a4-orient');
  const a4FitBtn   = document.getElementById('sketch-fit-a4-btn');
  if (a4FrameBtn) {
    a4FrameBtn.addEventListener('click', () => {
      if (sketcher) {
        sketcher.showA4Frame = !sketcher.showA4Frame;
        sketcher.draw();
        syncSketcherUIState();
      }
    });
    if (a4Orient) {
      a4Orient.addEventListener('change', () => {
        if (sketcher) {
          sketcher.a4Orientation = a4Orient.value;
          sketcher.draw();
          syncSketcherUIState();
        }
      });
    }
    if (a4FitBtn) {
      a4FitBtn.addEventListener('click', () => {
        if (sketcher) {
          if (!sketcher.showA4Frame) {
            sketcher.showA4Frame = true;
          }
          sketcher.fitToA4();
          syncSketcherUIState();
        }
      });
    }
  }

  // ── Canvas size ──
  const canvasSizeSel = document.getElementById('sketch-canvas-size');
  if (canvasSizeSel) {
    canvasSizeSel.addEventListener('change', () => {
      if (sketcher) {
        const parts = canvasSizeSel.value.split('x');
        const w = parseInt(parts[0]);
        const h = parseInt(parts[1]);
        if (w && h) {
          sketcher.setCanvasSize(w, h);
        }
      }
    });
  }

  // ── Grid toggle ──
  const gridBtn = document.getElementById('sketch-grid-toggle');
  if (gridBtn) {
    gridBtn.addEventListener('click', () => {
      if (sketcher) sketcher.toggleGrid();
    });
  }

  // ── Snap toggle ──
  const snapBtn = document.getElementById('sketch-snap-toggle');
  if (snapBtn) {
    snapBtn.addEventListener('click', () => { 
      if (sketcher) sketcher.toggleSnap();
    });
  }

  // ── Grid size ──
  const gridSel = document.getElementById('sketch-grid-size');
  if (gridSel) {
    gridSel.addEventListener('change', () => {
      if (sketcher) {
        sketcher.gridSize = parseFloat(gridSel.value);
        sketcher.draw();
      }
    });
  }

  // Initial UI sync
  syncSketcherUIState();
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

    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
    if (!apiKey) {
      alert('Estimator AI key is not configured. Please set VITE_OPENROUTER_API_KEY in your .env file and reload.');
      return;
    }

    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    } else {
      alert('PDF.js library is not loaded yet. Please check your internet connection.');
      return;
    }

    ocrProgressContainer.style.display = 'block';
    ocrProgressStatus.innerText = 'Loading PDF...';
    ocrProgressPercent.innerText = '0%';
    ocrProgressBar.style.width = '0%';

    try {
      console.log('[BOQ AI] Reading PDF file:', file.name);

      const fileReader = new FileReader();
      const loadPromise = new Promise((resolve, reject) => {
        fileReader.onload = function() { resolve(new Uint8Array(this.result)); };
        fileReader.onerror = function(e) { reject(e); };
      });
      fileReader.readAsArrayBuffer(file);
      const typedarray = await loadPromise;

      const pdf = await pdfjsLib.getDocument(typedarray).promise;
      console.log('[BOQ AI] PDF loaded. Pages:', pdf.numPages);

      const startPageInput = document.getElementById('ocr-pdf-start-page');
      const endPageInput = document.getElementById('ocr-pdf-end-page');

      let startPage = parseInt(startPageInput?.value) || 1;
      let endPage = parseInt(endPageInput?.value) || pdf.numPages;
      startPage = Math.max(1, Math.min(pdf.numPages, startPage));
      endPage = Math.max(startPage, Math.min(pdf.numPages, endPage));

      const totalPagesToParse = (endPage - startPage) + 1;
      console.log(`[BOQ AI] Rendering pages ${startPage}–${endPage} to canvas images...`);

      let allItems = [];

      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        const pageIndex = (pageNum - startPage) + 1;
        const baseProgress = Math.round(((pageIndex - 1) / totalPagesToParse) * 90);

        ocrProgressStatus.innerText = `Rendering PDF Page ${pageNum} of ${endPage}...`;
        ocrProgressPercent.innerText = `${baseProgress}%`;
        ocrProgressBar.style.width = `${baseProgress}%`;

        // Render page to canvas
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for legibility
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        const base64DataUrl = canvas.toDataURL('image/png');

        ocrProgressStatus.innerText = `AI Analysing Page ${pageNum} of ${endPage}...`;
        const aiProgress = baseProgress + Math.round((1 / totalPagesToParse) * 45);
        ocrProgressPercent.innerText = `${Math.min(aiProgress, 95)}%`;
        ocrProgressBar.style.width = `${Math.min(aiProgress, 95)}%`;

        console.log(`[BOQ AI] Sending page ${pageNum} to AI vision model...`);
        const pageItems = await callAiVisionForBoqImage(base64DataUrl, apiKey);
        console.log(`[BOQ AI] Page ${pageNum}: extracted ${pageItems.length} items`);
        allItems = allItems.concat(pageItems);
      }

      // Deduplicate by code (later pages win)
      const seen = {};
      const deduped = [];
      for (const item of allItems) {
        seen[item.code] = item;
      }
      for (const code of Object.keys(seen)) {
        deduped.push(seen[code]);
      }

      console.log(`[BOQ AI] Total deduplicated items from PDF: ${deduped.length}`);

      if (deduped.length === 0) {
        ocrProgressStatus.innerText = 'No items found!';
        ocrProgressPercent.innerText = '';
        alert('The AI could not extract any BOQ items from this PDF. Try selecting a smaller page range or checking the document quality.');
        return;
      }

      parsedOcrItems = deduped;
      renderOcrPreview();

      ocrProgressStatus.innerText = `✅ Extracted ${deduped.length} items!`;
      ocrProgressPercent.innerText = '100%';
      ocrProgressBar.style.width = '100%';

      setTimeout(() => {
        ocrProgressContainer.style.display = 'none';
      }, 2000);

    } catch (err) {
      console.error('[BOQ AI] PDF Error:', err);
      ocrProgressStatus.innerText = 'AI Extraction Error!';
      ocrProgressPercent.innerText = '';
      ocrProgressBar.style.width = '0%';
      alert('Failed to parse DSR/BOQ PDF with AI: ' + err.message);
    }
  }

  async function handleOcrImageFile(file) {
    if (!ocrProgressContainer || !ocrProgressStatus || !ocrProgressPercent || !ocrProgressBar) return;

    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
    if (!apiKey) {
      alert('Estimator AI key is not configured. Please set VITE_OPENROUTER_API_KEY in your .env file and reload.');
      return;
    }

    ocrProgressContainer.style.display = 'block';
    ocrProgressStatus.innerText = 'Reading image...';
    ocrProgressPercent.innerText = '10%';
    ocrProgressBar.style.width = '10%';

    try {
      console.log('[BOQ AI] Processing image file:', file.name);

      // Convert image file to base64 data URL
      const base64DataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      ocrProgressStatus.innerText = 'Sending image to AI...';
      ocrProgressPercent.innerText = '30%';
      ocrProgressBar.style.width = '30%';

      console.log('[BOQ AI] Sending image to Nvidia Nemotron vision model...');
      const items = await callAiVisionForBoqImage(base64DataUrl, apiKey);
      console.log('[BOQ AI] AI returned', items.length, 'items');

      ocrProgressStatus.innerText = 'Parsing AI response...';
      ocrProgressPercent.innerText = '85%';
      ocrProgressBar.style.width = '85%';

      if (items.length === 0) {
        ocrProgressStatus.innerText = 'No items found!';
        ocrProgressPercent.innerText = '';
        alert('The AI could not extract any BOQ items from this image. Make sure the image is clear and contains a BOQ/DSR table with item numbers and rates.');
        ocrProgressContainer.style.display = 'none';
        return;
      }

      parsedOcrItems = items;
      renderOcrPreview();

      ocrProgressStatus.innerText = `✅ Extracted ${items.length} items!`;
      ocrProgressPercent.innerText = '100%';
      ocrProgressBar.style.width = '100%';

      setTimeout(() => {
        ocrProgressContainer.style.display = 'none';
      }, 2000);

    } catch (err) {
      console.error('[BOQ AI] Image Error:', err);
      ocrProgressStatus.innerText = 'AI Error!';
      ocrProgressPercent.innerText = '';
      ocrProgressBar.style.width = '0%';
      alert('Failed to extract BOQ items from image: ' + err.message);
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

  // Bind Manual DSR item entry form
  const manualAddBtn = document.getElementById('manual-dsr-add-btn');
  if (manualAddBtn) {
    manualAddBtn.addEventListener('click', () => {
      const codeInput = document.getElementById('manual-dsr-code');
      const unitInput = document.getElementById('manual-dsr-unit');
      const rateInput = document.getElementById('manual-dsr-rate');
      const descInput = document.getElementById('manual-dsr-desc');

      if (!codeInput || !unitInput || !rateInput || !descInput) return;

      const code = codeInput.value.trim();
      const unit = unitInput.value.trim();
      const rateVal = parseFloat(rateInput.value);
      const desc = descInput.value.trim();

      if (!code || !desc || isNaN(rateVal) || rateVal <= 0) {
        alert('Please fill out all fields with valid values. Rate must be greater than 0.');
        return;
      }

      const newItem = {
        code: code,
        description: desc,
        unit: unit,
        rate: rateVal
      };

      // Check if duplicate code exists
      const existsIdx = customDsrCatalog.findIndex(c => c.code === code);
      if (existsIdx > -1) {
        if (!confirm(`An item with Code "${code}" already exists. Do you want to overwrite it?`)) {
          return;
        }
        customDsrCatalog[existsIdx] = newItem;
      } else {
        customDsrCatalog.push(newItem);
      }

      saveCustomDsrCatalog();
      if (auth.currentUser) {
        saveUserCustomDsr(auth.currentUser.uid, customDsrCatalog).catch(err => console.error("Error saving manual DSR to Firestore:", err));
      }

      // Re-trigger icon rendering if needed
      if (window.lucide) {
        lucide.createIcons();
      }

      alert(`Successfully added DSR item "${code}" to search autocomplete reference database!`);

      // Reset form fields
      codeInput.value = '';
      rateInput.value = '';
      descInput.value = '';

      // Refresh catalog table
      renderCatalogTable('');
    });
  }

  // ── Saved DSR Catalog Table ──────────────────────────────────────────────
  const catalogTbody    = document.getElementById('catalog-table-body');
  const catalogSearch   = document.getElementById('catalog-search-input');
  const catalogCountLbl = document.getElementById('catalog-count-label');
  const catalogSaveBtn  = document.getElementById('catalog-save-changes-btn');
  const catalogClearBtn = document.getElementById('catalog-delete-all-btn');

  function renderCatalogTable(filterText) {
    if (!catalogTbody) return;
    const q = (filterText || '').toLowerCase().trim();

    const filtered = customDsrCatalog.filter(item => {
      if (!q) return true;
      return (item.title || item.code || '').toLowerCase().includes(q) ||
             (item.description || '').toLowerCase().includes(q) ||
             (item.code || '').toLowerCase().includes(q);
    });

    const total = customDsrCatalog.length;
    const communityCount = globalDsrCatalog.length;
    if (catalogCountLbl) {
      catalogCountLbl.textContent = q
        ? `Showing ${filtered.length} of ${total} saved item${total !== 1 ? 's' : ''}`
        : `${total} private item${total !== 1 ? 's' : ''} · 🌐 ${communityCount} community item${communityCount !== 1 ? 's' : ''} shared by all users`;
    }

    if (filtered.length === 0) {
      catalogTbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:2rem;">
        ${q ? `No items matching "<strong>${filterText}</strong>"` : 'Your catalog is empty. Add items above or save an estimate.'}
      </td></tr>`;
      return;
    }

    catalogTbody.innerHTML = '';
    filtered.forEach(item => {
      const isCustom = item.category === 'custom';
      const isLearned = item.category === 'learned';

      // Badge color & label
      const badgeStyle = isCustom
        ? 'background:#0d9488; color:#fff;'
        : isLearned
          ? 'background:#7c3aed; color:#fff;'
          : 'background:#1e3a5f; color:#fff;';
      const badgeLabel = isCustom ? '💾 My Item' : isLearned ? '⭐ Learned' : '📋 Manual';

      const usageText = item.usageCount
        ? `<span style="font-weight:600;">${item.usageCount}×</span>`
        : '—';

      const displayTitle = isCustom
        ? (item.title || item.code)
        : `DSR ${item.code}`;

      const isShared = globalDsrCatalog.some(g => g.code === item.code || g.id === item.code.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 80));

      const tr = document.createElement('tr');
      tr.dataset.code = item.code;
      tr.innerHTML = `
        <td style="font-weight:600; font-size:0.82rem; color:var(--accent); white-space:nowrap; padding:0.55rem 0.75rem;">${displayTitle}</td>
        <td style="text-align:center; padding:0.55rem 0.5rem;">
          <span style="font-size:0.7rem; padding:0.2rem 0.45rem; border-radius:99px; ${badgeStyle}">${badgeLabel}</span>
        </td>
        <td style="padding:0.45rem 0.6rem;">
          <div class="cat-desc-cell" contenteditable="true"
            style="min-height:1.4em; font-size:0.84rem; color:var(--text-primary); outline:none; border-bottom:1px dashed transparent; cursor:text;"
            data-field="description"
            onFocus="this.style.borderBottomColor='var(--accent)'"
            onBlur="this.style.borderBottomColor='transparent'"
          >${item.description || ''}</div>
        </td>
        <td style="text-align:center; padding:0.45rem 0.5rem;">
          <select class="cat-unit-select" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:0.35rem; padding:0.25rem 0.4rem; font-size:0.82rem; color:var(--text-primary); cursor:pointer;">
            ${['sqm','sqft','sqf','cum','nos','Rm','kg','ls','set','bag','lump'].map(u =>
              `<option value="${u}" ${(item.unit||'').toLowerCase() === u.toLowerCase() ? 'selected' : ''}>${u}</option>`
            ).join('')}
          </select>
        </td>
        <td style="text-align:right; padding:0.45rem 0.6rem;">
          <input type="number" class="cat-rate-input" value="${item.rate || 0}" step="0.01" min="0"
            style="width:90px; text-align:right; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:0.35rem; padding:0.25rem 0.4rem; font-size:0.84rem; color:var(--text-primary); outline:none;">
        </td>
        <td style="text-align:center; padding:0.45rem; color:var(--text-muted); font-size:0.82rem;">${usageText}</td>
        <td style="text-align:center; padding:0.45rem;">
          <button class="cat-share-btn" title="${isShared ? 'Already shared with community' : 'Share this item with all users'}"
            style="background:${isShared ? 'rgba(37,99,235,0.12)' : 'transparent'}; border:1px solid ${isShared ? '#2563eb' : 'var(--border-color)'}; color:${isShared ? '#2563eb' : 'var(--text-muted)'}; cursor:pointer; padding:0.25rem 0.5rem; border-radius:0.35rem; font-size:0.72rem; font-weight:600; line-height:1.5; white-space:nowrap;"
            data-code="${item.code}">${isShared ? '🌐 Shared' : '🌐 Share'}</button>
        </td>
        <td style="text-align:center; padding:0.45rem;">
          <button class="cat-delete-btn" title="Delete this item"
            style="background:transparent; border:none; color:#ef4444; cursor:pointer; padding:0.3rem 0.45rem; border-radius:0.35rem; font-size:1rem; line-height:1;"
            data-code="${item.code}">🗑</button>
        </td>
      `;

      // Share button — contribute to global community catalog
      tr.querySelector('.cat-share-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const alreadyShared = btn.textContent.includes('Shared');
        if (alreadyShared) {
          alert(`"${displayTitle}" is already shared with the community.`);
          return;
        }
        btn.textContent = '⏳ Sharing…';
        btn.disabled = true;
        try {
          await contributeItemToGlobalDsr(item);
          // Update local globalDsrCatalog cache
          const gIdx = globalDsrCatalog.findIndex(g => g.code === item.code);
          if (gIdx === -1) globalDsrCatalog.push({ ...item, category: 'community', contributorCount: 1 });
          btn.textContent = '🌐 Shared';
          btn.style.color = '#2563eb';
          btn.style.border = '1px solid #2563eb';
          btn.style.background = 'rgba(37,99,235,0.12)';
          btn.disabled = false;
          btn.title = 'Already shared with community';
        } catch (err) {
          btn.textContent = '❌ Failed';
          btn.disabled = false;
          console.error('Share to community failed:', err);
          setTimeout(() => { btn.textContent = '🌐 Share'; }, 2000);
        }
      });

      // Delete button
      tr.querySelector('.cat-delete-btn').addEventListener('click', () => {
        if (!confirm(`Delete "${displayTitle}" from your catalog?`)) return;
        const idx = customDsrCatalog.findIndex(c => c.code === item.code);
        if (idx > -1) customDsrCatalog.splice(idx, 1);
        saveCustomDsrCatalog();
        if (auth.currentUser) {
          saveUserCustomDsr(auth.currentUser.uid, customDsrCatalog)
            .catch(e => console.error('Firestore delete error', e));
        }
        renderCatalogTable(catalogSearch ? catalogSearch.value : '');
      });

      catalogTbody.appendChild(tr);
    });
  }

  // Initial render
  renderCatalogTable('');

  // Live search
  if (catalogSearch) {
    catalogSearch.addEventListener('input', () => renderCatalogTable(catalogSearch.value));
  }

  // Save Changes — reads edited values back from DOM into customDsrCatalog
  if (catalogSaveBtn) {
    catalogSaveBtn.addEventListener('click', () => {
      const rows = catalogTbody.querySelectorAll('tr[data-code]');
      let changed = 0;
      rows.forEach(tr => {
        const code = tr.dataset.code;
        const idx = customDsrCatalog.findIndex(c => c.code === code);
        if (idx === -1) return;

        const descEl  = tr.querySelector('.cat-desc-cell');
        const unitEl  = tr.querySelector('.cat-unit-select');
        const rateEl  = tr.querySelector('.cat-rate-input');

        if (descEl)  customDsrCatalog[idx].description = descEl.innerText.trim();
        if (unitEl)  customDsrCatalog[idx].unit = unitEl.value;
        if (rateEl)  customDsrCatalog[idx].rate = parseFloat(rateEl.value) || customDsrCatalog[idx].rate;
        // Also update title for custom items if description changed
        if (customDsrCatalog[idx].category === 'custom' && !customDsrCatalog[idx].title) {
          customDsrCatalog[idx].title = customDsrCatalog[idx].description;
        }
        changed++;
      });

      saveCustomDsrCatalog();
      if (auth.currentUser) {
        saveUserCustomDsr(auth.currentUser.uid, customDsrCatalog)
          .catch(e => console.error('Firestore save error', e));
      }

      // Flash confirmation on button
      catalogSaveBtn.textContent = `✅ Saved ${changed} items`;
      setTimeout(() => {
        catalogSaveBtn.innerHTML = '<i data-lucide="save"></i> Save Changes';
        if (window.lucide) lucide.createIcons();
      }, 2000);

      renderCatalogTable(catalogSearch ? catalogSearch.value : '');
    });
  }

  // Clear All
  if (catalogClearBtn) {
    catalogClearBtn.addEventListener('click', () => {
      if (!confirm(`This will permanently delete ALL ${customDsrCatalog.length} saved items from your catalog. Continue?`)) return;
      customDsrCatalog.length = 0;
      saveCustomDsrCatalog();
      if (auth.currentUser) {
        saveUserCustomDsr(auth.currentUser.uid, customDsrCatalog)
          .catch(e => console.error('Firestore clear error', e));
      }
      renderCatalogTable('');
    });
  }

  // Share All — contribute every private item to the global community catalog
  const shareAllBtn = document.getElementById('catalog-share-all-btn');
  if (shareAllBtn) {
    shareAllBtn.addEventListener('click', async () => {
      if (customDsrCatalog.length === 0) {
        alert('Your catalog is empty. Nothing to share.');
        return;
      }
      if (!confirm(`Share all ${customDsrCatalog.length} items from your catalog with all users? (They will appear in everyone\'s 🌐 Community suggestions.)`)) return;

      shareAllBtn.disabled = true;
      shareAllBtn.textContent = '⏳ Sharing 0…';

      let done = 0;
      const errors = [];
      for (const item of customDsrCatalog) {
        try {
          await contributeItemToGlobalDsr(item);
          // update local cache
          const gIdx = globalDsrCatalog.findIndex(g => g.code === item.code);
          if (gIdx === -1) globalDsrCatalog.push({ ...item, category: 'community', contributorCount: 1 });
          done++;
          shareAllBtn.textContent = `⏳ Sharing ${done}/${customDsrCatalog.length}…`;
        } catch (err) {
          errors.push(item.code);
          console.error('Share error for', item.code, err);
        }
      }

      shareAllBtn.disabled = false;
      shareAllBtn.innerHTML = '<i data-lucide="globe"></i> Share All';
      if (window.lucide) lucide.createIcons();

      if (errors.length === 0) {
        alert(`✅ Successfully shared ${done} items with the community!`);
      } else {
        alert(`Shared ${done} items. ${errors.length} failed (check console).`);
      }

      renderCatalogTable(catalogSearch ? catalogSearch.value : '');
    });
  }
} // end setupDsrSettings

function parseOcrDsrText(text) {
  const items = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const UNITS = ['sqm','sqf','sqft','cum','nos','rm','rmt','rmt.','kg','quintal','litre','ltr','l\/s','ls','each','set','pair','pcs','bag'];
  const unitPat = UNITS.join('|');

  // ── Strategy 1: Structured table rows (code  description  unit  rate)
  // Handles: "12.5  Cement concrete flooring  sqm  512.50"
  const TABLE_ROW = new RegExp(
    `^(\\d{1,3}(?:\\.\\d{1,3}){0,2})\\s{2,}(.{10,})\\s{2,}(${unitPat})\\s{1,}([\\d,]+\\.?\\d*)\\s*$`,
    'i'
  );

  // ── Strategy 2: Item No pattern with embedded rate
  // Handles: "Item No 12.5  Flooring work sqm @ Rs. 512.50"
  const ITEM_HEADER = /^(?:S\.?\s*No\.?|Item\s*No\.?|Sl\.?\s*No\.?)[:\-\s]*([\d]+(?:\.\d+)?(?:\.\d+)?)/i;

  // ── Strategy 3: Numbered list with rate at end (no "Item No" prefix)
  // Handles: "16.1  Precast RCC post nos 3648.00"
  const NUMBERED = new RegExp(
    `^(\\d{1,3}(?:\.\\d{1,3}){1,2})[\\s\.\\-:]+(.+?)(?:[\\s\\-]+(${unitPat}))?[\\s@,]+([\\d,]+\.\\d{2,})\\s*$`,
    'i'
  );

  let currentItem = null;

  const pushCurrent = () => {
    if (currentItem && currentItem.code && currentItem.description.length > 3) {
      // Final clean of description
      currentItem.description = currentItem.description
        .replace(/\bItem\s*No\.?\s*[\d\.]+/gi, '')
        .replace(/Rs\.?\s*[\d,\.]+/gi, '')
        .replace(new RegExp(`\\b(${unitPat})\\b`, 'gi'), '')
        .replace(/[@\s]{2,}/g, ' ')
        .trim();
      if (currentItem.description.length > 3) items.push(currentItem);
    }
    currentItem = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Strategy 1: Full table row on one line
    const t = line.match(TABLE_ROW);
    if (t) {
      pushCurrent();
      const rate = parseFloat(t[4].replace(/,/g, '')) || 0;
      if (rate > 0) {
        items.push({ code: t[1].trim(), description: t[2].trim(), unit: t[3].toLowerCase(), rate });
      }
      continue;
    }

    // Strategy 2: "Item No. X.Y"
    const h = line.match(ITEM_HEADER);
    if (h) {
      pushCurrent();
      const code = h[1];
      const rest = line.substring(h[0].length).trim();
      currentItem = { code, description: rest, unit: 'sqm', rate: 0 };
      continue;
    }

    // Strategy 3: numbered-only (e.g. "16.1  desc  unit  rate")
    const n = line.match(NUMBERED);
    if (n) {
      pushCurrent();
      const rate = parseFloat(n[4].replace(/,/g, '')) || 0;
      const unit = n[3] ? n[3].toLowerCase() : 'sqm';
      if (rate > 0) {
        items.push({ code: n[1].trim(), description: n[2].trim(), unit, rate });
      }
      continue;
    }

    // Continuation line for currentItem
    if (currentItem) {
      // Does this line look like it ends with a rate?
      const rateLineMatch = line.match(/([\d,]+\.\d{2,})\s*$/);
      const unitLineMatch = line.match(new RegExp(`\\b(${unitPat})\\b`, 'i'));
      if (rateLineMatch) {
        const possibleRate = parseFloat(rateLineMatch[1].replace(/,/g, ''));
        if (possibleRate > 0 && currentItem.rate === 0) {
          currentItem.rate = possibleRate;
          const beforeRate = line.substring(0, rateLineMatch.index).trim();
          if (unitLineMatch) currentItem.unit = unitLineMatch[1].toLowerCase();
          if (beforeRate.length > 2) currentItem.description += ' ' + beforeRate;
          continue;
        }
      }
      if (unitLineMatch && currentItem.unit === 'sqm') {
        currentItem.unit = unitLineMatch[1].toLowerCase();
      }
      currentItem.description += ' ' + line;
    }
  }

  pushCurrent();

  // Final pass: extract rate from description if still 0
  items.forEach(item => {
    if (item.rate === 0) {
      const rm = item.description.match(/(?:@|Rs\.?|Rate\s*[:=]?)\s*([\d,]+\.\d{2,})/i);
      if (rm) {
        item.rate = parseFloat(rm[1].replace(/,/g, '')) || 0;
        item.description = item.description.substring(0, rm.index).trim();
      }
    }
    // Final unit check from description
    const um = item.description.match(new RegExp(`\\b(${unitPat})\\b`, 'i'));
    if (um) item.unit = um[1].toLowerCase();
    item.description = item.description.replace(/\s{2,}/g, ' ').trim();
  });


  // Only return items with a valid code and non-zero rate
  return items.filter(i => i.code && i.description && i.rate > 0);
}

// Direct call helper for Google Gemini API (AI Studio / Vertex AI)
async function callGeminiApiDirect(modelName, base64DataUrl, apiKey, systemPrompt, userPrompt) {
  const base64Data = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          { text: systemPrompt }
        ]
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: userPrompt },
            {
              inlineData: {
                mimeType: 'image/png',
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Direct API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return rawContent;
}

// ── AI Vision BOQ Extractor ─────────────────────────────────────────────────
// Sends a base64 image to the Nvidia Nemotron vision model via OpenRouter.
// Returns a structured array of BOQ items: [{ code, description, unit, rate }]
async function callAiVisionForBoqImage(base64DataUrl, apiKey) {
  const systemPrompt = `You are a BOQ/DSR data extraction specialist for Indian construction projects.
You will receive an image of a Bill of Quantities (BOQ) or Schedule of Rates (DSR) document page.
Extract ALL line items from the document and return them as a valid JSON array with this exact format:
[{"code":"...","description":"...","unit":"...","rate":...}]

Rules:
- "code" is the item number (e.g. "12.5", "16.1", "3.2.a", "Sl.No.5"). Use the exact number shown.
- "description" is the full item description text — exclude the code and rate from it.
- "unit" must be one of: sqm, sqft, cum, nos, rm, rmt, kg, ls, lump, set, bag, pair, each, qtr, quintal. Pick the closest match.
- "rate" is a plain number (no Rs., no commas, no symbols). Must be greater than 0.
- Ignore header rows, chapter headings, sub-totals, blank rows, and notes.
- If a description spans multiple lines in the image, merge it into one string.
- Return ONLY the JSON array. No markdown, no explanation, no preamble.`;

  const isGeminiKey = apiKey && apiKey.startsWith('AQ.');
  if (isGeminiKey) {
    let geminiModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
    const selectedModel = document.getElementById('ocr-ai-model-select')?.value || 'auto';
    if (selectedModel && selectedModel.includes('gemini')) {
      const cleanName = selectedModel.replace(':free', '').replace('google/', '');
      geminiModels = [cleanName, ...geminiModels.filter(m => m !== cleanName)];
    }

    let geminiError = null;
    for (const geminiModel of geminiModels) {
      try {
        console.log(`[BOQ AI] Attempting Gemini Direct call with model: ${geminiModel}`);
        const rawContent = await callGeminiApiDirect(geminiModel, base64DataUrl, apiKey, systemPrompt, 'Please extract all BOQ/DSR items from this document image and return them as a JSON array.');
        
        console.log(`[BOQ AI] Raw response from Gemini Direct (${geminiModel}):`, rawContent.substring(0, 500));
        
        let jsonStr = rawContent.trim();
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonStr = arrayMatch[0];
        }

        const parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed)) {
          throw new Error('Response is not a JSON array');
        }

        const valid = parsed
          .filter(item => item && item.code && item.description && item.rate > 0)
          .map(item => ({
            code: String(item.code).trim(),
            description: String(item.description).trim(),
            unit: String(item.unit || 'sqm').toLowerCase().trim(),
            rate: parseFloat(item.rate) || 0
          }))
          .filter(item => item.rate > 0 && item.code.length > 0);

        console.log(`[BOQ AI] Successfully parsed ${valid.length} items from Gemini Direct (${geminiModel}).`);
        return valid;
      } catch (err) {
        console.warn(`[BOQ AI] Gemini Direct model ${geminiModel} failed:`, err.message);
        geminiError = err;
      }
    }
    console.error('[BOQ AI] All Gemini Direct models failed.', geminiError);
    return [];
  }

  const selectedModel = document.getElementById('ocr-ai-model-select')?.value || 'auto';
  let candidateModels = [
    'meta-llama/llama-3.2-11b-vision-instruct:free',
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'openrouter/free'
  ];
  if (selectedModel && selectedModel !== 'auto') {
    candidateModels = [selectedModel, ...candidateModels.filter(m => m !== selectedModel)];
  }

  let lastError = null;

  for (const model of candidateModels) {
    try {
      console.log(`[BOQ AI] Attempting extraction with model: ${model}`);
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://valuroad.app',
          'X-Title': 'ValuRoad BOQ Parser'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Please extract all BOQ/DSR items from this document image and return them as a JSON array.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: base64DataUrl,
                    detail: 'high'
                  }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 4096
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI Vision API Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const rawContent = data?.choices?.[0]?.message?.content || '';

      console.log(`[BOQ AI] Raw AI response from ${model}:`, rawContent.substring(0, 500));

      let jsonStr = rawContent.trim();
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }

      let parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) {
        throw new Error('Response is not a JSON array');
      }

      const valid = parsed
        .filter(item => item && item.code && item.description && item.rate > 0)
        .map(item => ({
          code: String(item.code).trim(),
          description: String(item.description).trim(),
          unit: String(item.unit || 'sqm').toLowerCase().trim(),
          rate: parseFloat(item.rate) || 0
        }))
        .filter(item => item.rate > 0 && item.code.length > 0);

      console.log(`[BOQ AI] Successfully parsed ${valid.length} items from ${model}`);
      return valid;

    } catch (err) {
      console.warn(`[BOQ AI] Model ${model} failed:`, err.message);
      lastError = err;
    }
  }

  console.error('[BOQ AI] All models failed. Returning empty array.', lastError);
  return [];
}

function renderOcrPreview() {

  const tbody = document.getElementById('ocr-preview-tbody');
  const countText = document.getElementById('ocr-preview-count');
  const panel = document.getElementById('ocr-preview-panel');
  const saveBtn = document.getElementById('ocr-save-catalog-btn');

  tbody.innerHTML = '';
  if (parsedOcrItems.length === 0) {
    alert('No valid DSR items detected. Try checking that your text includes item numbers (e.g. "12.5" or "Item No. 16.1") and rates (e.g. "512.50").');
    panel.style.display = 'none';
    saveBtn.disabled = true;
    return;
  }

  countText.innerText = `${parsedOcrItems.length} items detected — review and correct below before importing:`;
  parsedOcrItems.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-size:0.78rem; font-weight:700; color:var(--accent);">${item.code}</td>
      <td style="font-size:0.78rem; max-width:220px;">
        <input type="text" value="${item.description.replace(/"/g,'&quot;')}" 
          style="width:100%; font-size:0.77rem; background:transparent; border:none; border-bottom:1px solid var(--border-color); color:var(--text-primary); outline:none; padding:2px 0;"
          data-idx="${idx}" data-field="description">
      </td>
      <td>
        <select data-idx="${idx}" data-field="unit" style="font-size:0.78rem; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:0.35rem; color:var(--text-primary); padding:2px 4px;">
          ${['sqm','sqft','sqf','cum','nos','Rm','kg','ls','set','bag'].map(u =>
            `<option value="${u}" ${item.unit===u?'selected':''}>${u}</option>`
          ).join('')}
        </select>
      </td>
      <td style="font-weight:700;">
        <input type="number" value="${item.rate}" 
          style="width:80px; font-size:0.78rem; background:transparent; border:none; border-bottom:1px solid var(--border-color); color:var(--accent); font-weight:700; outline:none; padding:2px 0; text-align:right;"
          data-idx="${idx}" data-field="rate">
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Bind live edits back to parsedOcrItems
  tbody.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('change', (e) => {
      const i = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      parsedOcrItems[i][field] = field === 'rate' ? (parseFloat(e.target.value) || 0) : e.target.value;
    });
  });

  panel.style.display = 'block';
  saveBtn.disabled = false;
}

// PDF Exporter Execution
function runPdfExport(entryId) {
  if (!activeProject) return;
  const entry = activeProject.entries.find(e => e.id === entryId);
  if (!entry) return;

  // Initialize sketcher if not already loaded
  if (!sketcher) {
    sketcher = new SiteSketcher('sketcher-canvas');
    window.sketcher = sketcher;
  }

  // Auto-correct tiny/squished drawings on the fly
  if (sketcher && entry.sketcherData && entry.sketcherData.length > 0) {
    sketcher.loadData(entry.sketcherData);
    sketcher.fitToContent();
    entry.sketcherImage = sketcher.exportImage();
    
    // Save corrected image back to project entries (local & cloud storage)
    const projIdx = projects.findIndex(p => p.id === activeProject.id);
    if (projIdx > -1) {
      const entryIdx = projects[projIdx].entries.findIndex(e => e.id === entry.id);
      if (entryIdx > -1) {
        projects[projIdx].entries[entryIdx].sketcherImage = entry.sketcherImage;
        saveProjects();
        if (auth.currentUser) {
          saveProjectEntry(activeProject.id, projects[projIdx].entries[entryIdx]).catch(e => {});
        }
      }
    }
  }

  runUnifiedPDFPrint(entry, false);
}

function saveActiveEntry_noExport() {
  if (!activeEntry || !activeProject) return Promise.resolve(false);

  let sketcherBase64 = '';
  if (sketcher) {
    sketcherBase64 = sketcher.exportImage();
  }

  activeEntry.sketcherImage = sketcherBase64;
  return saveActiveEntry(activeEntry.status);
}

function saveActiveEntryAndExportPDF() {
  saveActiveEntry_noExport();
  runUnifiedPDFPrint(activeEntry, false);
}

// Save Modifications / Save & Finalize
document.getElementById('editor-complete-btn').addEventListener('click', async () => {
  if (validateEditorForm()) {
    const isFinalizing = activeEntry.status !== 'completed';
    const confirmMsg = isFinalizing
      ? 'Are you sure you want to finalize this valuation entry? (This will mark it as completed and lock it from accidental edits)'
      : 'Save modifications to this valuation report?';

    if (confirm(confirmMsg)) {
      const btn = document.getElementById('editor-complete-btn');
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="refresh-cw" class="spin" style="width:16px; height:16px; display:inline-block; vertical-align:middle; margin-right:4px;"></i> Saving...';
      lucide.createIcons();

      try {
        if (isFinalizing) {
          activeEntry.status = 'completed';
        }
        await saveActiveEntry_noExport();
        alert(isFinalizing ? 'Valuation entry finalized successfully!' : 'Valuation report modifications saved successfully!');
        isNewEntryMode = false;
        if (activeProject) await openProjectDetails(activeProject.id);
      } catch (err) {
        console.error("Save entry failed:", err);
        alert('Failed to save. Please check your connection and try again.');
      } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        lucide.createIcons();
      }
    }
  }
});

// Manual Export PDF button
document.getElementById('editor-export-pdf-btn').addEventListener('click', () => {
  if (!activeEntry || !activeProject) return;
  // Save sketcher image before exporting
  if (sketcher) activeEntry.sketcherImage = sketcher.exportImage();
  runUnifiedPDFPrint(activeEntry, false);
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
    margin: 12.7,
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: 10.5,
    imgQuality: 0.98,
    linePlanHeight: '160mm',
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
    fontFamily:     document.getElementById('tpl-font-family'),
    fontSize:       document.getElementById('tpl-font-size'),
    imgQuality:     document.getElementById('tpl-img-quality'),
    linePlanHeight: document.getElementById('tpl-lineplan-height'),
    nbDefault:      document.getElementById('tpl-nb-default'),
    depRate:        document.getElementById('tpl-dep-rate'),
    contractorPct:  document.getElementById('tpl-contractor-pct'),
    photosPerRow:   document.getElementById('tpl-photos-per-row'),
    photoHeight:    document.getElementById('tpl-photo-height'),
    showJmsSlNo:    document.getElementById('tpl-show-jms-sl')
  };
  const saveBtn  = document.getElementById('pdf-template-save-btn');
  const preview  = document.getElementById('pdf-tpl-preview');

  // Load saved settings into fields
  const settings = getPdfTemplateSettings();
  Object.keys(fields).forEach(key => {
    if (fields[key] && settings[key] !== undefined) {
      if (fields[key].isContentEditable) {
        fields[key].innerText = settings[key];
      } else if (fields[key].type === 'checkbox') {
        fields[key].checked = settings[key];
      } else {
        fields[key].value = settings[key];
      }
    }
  });

  // Live CSS Variable Updater for WYSIWYG
  function updatePreviewStyles() {
    if (!preview) return;
    const ff = fields.fontFamily?.value || 'Arial, Helvetica, sans-serif';
    const fs = parseFloat(fields.fontSize?.value) || 10.5;
    const m  = parseFloat(fields.margin?.value) || 8;
    
    preview.style.setProperty('--pdf-font-family', ff);
    preview.style.setProperty('--pdf-font-size', fs + 'pt');
    preview.style.setProperty('--pdf-margin', m + 'mm');

    // Update mock values
    const mockCp = document.getElementById('mock-cp');
    const mockDep = document.getElementById('mock-dep');
    if (mockCp && fields.contractorPct) mockCp.textContent = fields.contractorPct.value;
    if (mockDep && fields.depRate) mockDep.textContent = fields.depRate.value;
  }

  updatePreviewStyles(); // Initial render

  if (pdfTemplateSetupDone) return;
  pdfTemplateSetupDone = true;

  // Bind live preview on input
  Object.values(fields).forEach(el => {
    if (el) el.addEventListener('input', updatePreviewStyles);
    if (el) el.addEventListener('change', updatePreviewStyles);
  });

  // Save button
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const out = {};
      out.basisText      = fields.basisText?.innerText.trim()       || 'D.S.R for CPWD Building for the year 2021';
      out.orgName        = fields.orgName?.innerText.trim()         || '';
      out.subtitle       = fields.subtitle?.innerText.trim()        || '';
      out.margin         = parseFloat(fields.margin?.value)         || 8;
      out.fontFamily     = fields.fontFamily?.value                 || 'Arial, Helvetica, sans-serif';
      out.fontSize       = parseFloat(fields.fontSize?.value)       || 10.5;
      out.imgQuality     = parseFloat(fields.imgQuality?.value)     || 0.98;
      out.linePlanHeight = fields.linePlanHeight?.value             || '160mm';
      out.nbDefault      = fields.nbDefault?.innerText.trim()       || '';
      out.depRate        = parseFloat(fields.depRate?.value)        || 1;
      out.contractorPct  = parseFloat(fields.contractorPct?.value)  || 15;
      out.photosPerRow   = parseInt(fields.photosPerRow?.value)     || 2;
      out.photoHeight    = fields.photoHeight?.value                || '60mm';
      out.showJmsSlNo    = fields.showJmsSlNo ? fields.showJmsSlNo.checked : true;

      localStorage.setItem(PDF_TEMPLATE_KEY, JSON.stringify(out));
      if (auth.currentUser) {
        saveUserPdfTemplate(auth.currentUser.uid, out).catch(err => console.error("Error saving PDF template to Firestore:", err));
      }

      // Visual feedback
      const originalHtml = saveBtn.innerHTML;
      saveBtn.textContent = '✓ Saved!';
      saveBtn.style.background = 'var(--success, #16a34a)';
      setTimeout(() => {
        saveBtn.innerHTML = originalHtml;
        saveBtn.style.background = '';
        lucide.createIcons();
      }, 2000);
    });
  }
}

// Project Sharing Modal
function setupProjectSharingModal() {
  const modal = document.getElementById('share-project-modal');
  const closeBtn = document.getElementById('share-modal-close-btn');
  const doneBtn = document.getElementById('share-modal-done-btn');
  const addBtn = document.getElementById('share-add-btn');
  const emailInput = document.getElementById('share-email-input');
  const errorMsg = document.getElementById('share-error-msg');
  const listContainer = document.getElementById('share-collaborators-list');
  const titleText = document.getElementById('share-project-title');

  let currentSharingProjectId = null;

  const closeModal = () => {
    modal.classList.remove('active');
    currentSharingProjectId = null;
    emailInput.value = '';
    errorMsg.style.display = 'none';
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (doneBtn) doneBtn.addEventListener('click', closeModal);

  window.openShareModal = async (projectId) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    currentSharingProjectId = projectId;
    titleText.innerText = `Project: ${project.workName || 'Untitled Project'}`;
    emailInput.value = '';
    errorMsg.style.display = 'none';

    // Show modal
    modal.classList.add('active');

    renderCollaborators(project);
  };

  function renderCollaborators(project) {
    listContainer.innerHTML = '';
    
    // Check if the current user is the owner
    const isOwner = !project.ownerId || (auth.currentUser && project.ownerId === auth.currentUser.uid);

    // Disable input and add button if not owner
    if (!isOwner) {
      emailInput.disabled = true;
      addBtn.disabled = true;
      emailInput.placeholder = "Only the project owner can share";
    } else {
      emailInput.disabled = false;
      addBtn.disabled = false;
      emailInput.placeholder = "collaborator@example.com";
    }

    // Always show owner first
    const ownerEmail = project.ownerEmail || (isOwner && auth.currentUser ? auth.currentUser.email : 'Unknown Owner');
    const ownerDiv = document.createElement('div');
    ownerDiv.className = 'collaborator-item';
    ownerDiv.style = 'display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border-color); font-size: 0.9rem;';
    ownerDiv.innerHTML = `
      <span style="font-weight: 600;">${ownerEmail} <span style="font-size: 0.75rem; font-weight: normal; color: var(--accent); margin-left: 0.5rem;">(Owner)</span></span>
    `;
    listContainer.appendChild(ownerDiv);

    // Show collaborators
    const sharedWith = project.sharedWith || [];
    if (sharedWith.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style = 'padding: 0.75rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;';
      emptyDiv.innerText = 'No collaborators yet.';
      listContainer.appendChild(emptyDiv);
    } else {
      sharedWith.forEach(email => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'collaborator-item';
        itemDiv.style = 'display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border-color); font-size: 0.9rem;';
        
        const emailSpan = document.createElement('span');
        emailSpan.innerText = email;
        itemDiv.appendChild(emailSpan);

        if (isOwner) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.style = 'background: none; border: none; color: var(--danger); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0.25rem;';
          removeBtn.title = 'Remove collaborator';
          removeBtn.innerHTML = '<i data-lucide="user-minus" style="width: 16px; height: 16px;"></i>';
          removeBtn.addEventListener('click', async () => {
            if (confirm(`Are you sure you want to remove access for ${email}?`)) {
              project.sharedWith = project.sharedWith.filter(e => e !== email);
              
              // Save
              saveProjects();
              if (auth.currentUser) {
                await saveUserProject(auth.currentUser.uid, project);
              }
              renderCollaborators(project);
              renderProjects();
            }
          });
          itemDiv.appendChild(removeBtn);
        }

        listContainer.appendChild(itemDiv);
      });
      lucide.createIcons();
    }
  }

  const handleAddCollaborator = async () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!email) return;

    errorMsg.style.display = 'none';

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorMsg.innerText = "Please enter a valid email address.";
      errorMsg.style.display = 'block';
      return;
    }

    const project = projects.find(p => p.id === currentSharingProjectId);
    if (!project) return;

    if (!project.sharedWith) {
      project.sharedWith = [];
    }

    if (project.sharedWith.includes(email)) {
      errorMsg.innerText = "This project is already shared with this user.";
      errorMsg.style.display = 'block';
      return;
    }

    if (auth.currentUser && email === auth.currentUser.email.toLowerCase()) {
      errorMsg.innerText = "You cannot share the project with yourself.";
      errorMsg.style.display = 'block';
      return;
    }

    project.sharedWith.push(email);
    emailInput.value = '';

    // Save project
    saveProjects();
    if (auth.currentUser) {
      addBtn.disabled = true;
      try {
        await saveUserProject(auth.currentUser.uid, project);
      } catch (err) {
        console.error("Error updating project sharing:", err);
        errorMsg.innerText = "Failed to update sharing settings in Firestore.";
        errorMsg.style.display = 'block';
        project.sharedWith.pop(); // Revert
        saveProjects();
      } finally {
        addBtn.disabled = false;
      }
    }

    renderCollaborators(project);
    renderProjects();
  };

  if (addBtn) addBtn.addEventListener('click', handleAddCollaborator);
  if (emailInput) {
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddCollaborator();
      }
    });
  }
}

// ── Status Bar Helpers ────────────────────────────────────────────────────
function setSyncStatus(state, text) {
  const dot  = document.getElementById('sync-status-dot');
  const label = document.getElementById('sync-status-text');
  if (!dot || !label) return;
  dot.className = `status-dot status-dot--${state}`; // idle | syncing | ok | error
  label.textContent = text;
}

function setLastSync() {
  const el = document.getElementById('last-sync-label');
  if (!el) return;
  const now = new Date();
  el.textContent = `Last sync: ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function setLastBackup() {
  const el = document.getElementById('last-backup-label');
  if (!el) return;
  const now = new Date();
  el.textContent = `Last backup: ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  localStorage.setItem('valuroad_last_backup', now.toISOString());
}

// ── PC Backup: real browser file download ────────────────────────────────
function triggerLocalBackup(project) {
  // Also called from saveProjects — silently export the active project
  // Full backup happens via downloadAllBackup()
  // No-op here to keep save flow clean; full backup is on timer / manual button
}

async function downloadAllBackup(isAutomatic = false) {
  const payload = {
    exportedAt: new Date().toISOString(),
    appVersion: 'Personal-Valuation-App-v2',
    projects: projects,
    customDsrCatalog: customDsrCatalog
  };

  try {
    // 1. Try local dev server API (saves directly to PC Documents/Valuroad)
    const res = await fetch('/api/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      const data = await res.json();
      console.log(`[Backup] Auto-saved silently to: ${data.path}`);
      setLastBackup();
      return;
    }
    throw new Error('API route returned not ok');
  } catch (err) {
    if (isAutomatic) {
      console.log('[Backup] Local API unavailable, skipping automatic browser download.');
      return;
    }
    // 2. Fallback for deployed version: trigger standard browser download
    console.log('[Backup] Local API unavailable, falling back to browser download.');
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);

    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `PVA_Backup_${ts}.json`;

    const anchor = document.getElementById('download-anchor') || document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setLastBackup();
    console.log(`[Backup] Downloaded: ${name}`);
  }
}

// Setup Tab Switching inside Valuation Editor
function setupEditorTabs() {
  const tabButtons = document.querySelectorAll('.editor-tabs .tab-btn');
  const tabContents = document.querySelectorAll('.editor-layout .tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      // Update button active state
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content active state
      tabContents.forEach(pane => {
        if (pane.id === targetTab) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });

      // Redraw sketcher if sketcher tab is clicked
      if (targetTab === 'tab-sketcher' && sketcher) {
        setTimeout(() => {
          sketcher.draw();
        }, 50);
      }
    });
  });
}

// Update the lock sketch button and toolbar disable states
function updateSketcherLockUI() {
  if (!sketcher) return;
  const isLocked = sketcher.isLocked;
  const lockBtn = document.getElementById('sketch-lock-btn');
  if (lockBtn) {
    if (isLocked) {
      lockBtn.innerHTML = '<i data-lucide="lock" style="width:13px;height:13px;"></i> LOCKED';
      lockBtn.style.color = '#ef4444';
      lockBtn.style.borderColor = '#ef4444';
      lockBtn.title = "Unlock Sketch";
    } else {
      lockBtn.innerHTML = '<i data-lucide="unlock" style="width:13px;height:13px;"></i> UNLOCKED';
      lockBtn.style.color = '#22c55e';
      lockBtn.style.borderColor = '#22c55e';
      lockBtn.title = "Lock Sketch";
    }
    lucide.createIcons();
  }

  // Disable drawing tools in the sketcher toolbars when locked
  const toolbarBtns = document.querySelectorAll('.sketcher-toolbar button:not(#sketch-lock-btn), .sketcher-container button:not(#sketch-lock-btn):not(#sketch-zoom-in-btn):not(#sketch-zoom-out-btn):not(#sketch-zoom-fit-btn):not(#sketch-zoom-reset-btn):not(#sketch-pan-left-btn):not(#sketch-pan-right-btn):not(#sketch-pan-up-btn):not(#sketch-pan-down-btn), .sketcher-container select');
  toolbarBtns.forEach(btn => {
    btn.disabled = isLocked;
    btn.style.opacity = isLocked ? '0.5' : '1';
    btn.style.pointerEvents = isLocked ? 'none' : 'auto';
  });
}

// ── 10-Second Auto-Sync ───────────────────────────────────────────────────
function startAutoSync() {
  if (autoSyncInterval) clearInterval(autoSyncInterval);

  autoSyncInterval = setInterval(async () => {
    if (!auth.currentUser) return;
    if (views.editor.classList.contains('active')) return;
    if (document.hidden) return;

    setSyncStatus('syncing', 'Syncing…');
    try {
      if (views.dashboard.classList.contains('active')) {
        const updatedProjects = await fetchUserProjects(auth.currentUser.uid, auth.currentUser.email);
        const currentStr = JSON.stringify(projects);
        updateProjectsList(updatedProjects);
        const updatedStr = JSON.stringify(projects);
        if (currentStr !== updatedStr) {
          renderProjects();
        }
      } else if (views.projectDetails.classList.contains('active') && activeProject) {
        const updated = await fetchProjectById(activeProject.id);
        if (updated) {
          const idx = projects.findIndex(p => p.id === activeProject.id);
          const currentStr = idx !== -1 ? JSON.stringify(projects[idx]) : '';
          const updatedStr = JSON.stringify(updated);
          if (currentStr !== updatedStr) {
            if (idx !== -1) projects[idx] = updated;
            activeProject = updated;
            renderProjectDetails();
          }
        }
      }
      setSyncStatus('ok', `Synced · ${auth.currentUser.email}`);
      setLastSync();
    } catch (err) {
      setSyncStatus('error', 'Sync failed');
      console.warn('Auto-sync interval failed:', err);
    }
  }, 10000);
}

// ── 5-Minute Auto-Backup to PC ────────────────────────────────────────────
let autoBackupInterval = null;
function startAutoBackup() {
  if (autoBackupInterval) clearInterval(autoBackupInterval);
  // Restore last-backup label from localStorage
  const saved = localStorage.getItem('valuroad_last_backup');
  if (saved) {
    const el = document.getElementById('last-backup-label');
    if (el) {
      const d = new Date(saved);
      el.textContent = `Last backup: ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    }
  }

  // Restore toggle state
  const toggle = document.getElementById('autobackup-toggle');
  if (toggle) {
    const pref = localStorage.getItem('valuroad_autobackup_enabled');
    if (pref !== null) {
      toggle.checked = pref === 'true';
    }
  }

  autoBackupInterval = setInterval(() => {
    if (!auth.currentUser) return;
    if (document.hidden) return;
    
    // Check if user disabled auto-backup
    const isEnabled = toggle ? toggle.checked : true;
    if (!isEnabled) return;
    
    downloadAllBackup(true);
  }, 5 * 60 * 1000); // every 5 minutes
}

// Wire the manual Backup Now button and toggle
function setupStatusBar() {
  if (statusBarSetupDone) return;
  statusBarSetupDone = true;

  const backupBtn = document.getElementById('manual-backup-btn');
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      downloadAllBackup();
      backupBtn.textContent = '✅ Saved!';
      setTimeout(() => {
        backupBtn.innerHTML = '<i data-lucide="download" style="width:13px;height:13px;"></i> Backup Now';
        if (window.lucide) lucide.createIcons();
      }, 2000);
    });
  }

  const toggle = document.getElementById('autobackup-toggle');
  if (toggle) {
    toggle.addEventListener('change', (e) => {
      localStorage.setItem('valuroad_autobackup_enabled', e.target.checked);
    });
  }

  if (window.lucide) lucide.createIcons();
}

function setupProfileSettings() {
  const nameInput = document.getElementById('profile-name');
  const desigInput = document.getElementById('profile-designation');
  const sigUpload = document.getElementById('profile-signature-upload');
  const sigPreview = document.getElementById('profile-signature-preview');
  const clearBtn = document.getElementById('profile-clear-signature-btn');
  const includeCheck = document.getElementById('profile-include-pdf');
  const saveBtn = document.getElementById('profile-save-btn');
  
  // 3-column seals elements
  const useThreeSealsCheck = document.getElementById('profile-use-three-seals');
  const threeSealsContainer = document.getElementById('three-seals-inputs-container');
  const jeDesigInput = document.getElementById('profile-je-designation');
  const jeAddrInput = document.getElementById('profile-je-address');
  const aeeDesigInput = document.getElementById('profile-aee-designation');
  const aeeAddrInput = document.getElementById('profile-aee-address');
  const eeDesigInput = document.getElementById('profile-ee-designation');
  const eeAddrInput = document.getElementById('profile-ee-address');
  const sealsFontSizeSelect = document.getElementById('profile-seals-font-size');

  // Site plan seal visibility
  const siteJeCheck = document.getElementById('profile-siteplan-je');
  const siteAeeCheck = document.getElementById('profile-siteplan-aee');
  const siteEeCheck = document.getElementById('profile-siteplan-ee');

  if (!nameInput) return;

  const saved = localStorage.getItem('valuroad_user_profile');
  let profile = {
    name: '',
    designation: '',
    signatureBase64: '',
    includePdf: true,
    useThreeSeals: true,
    sealsFontSize: '8.5pt',
    jeDesignation: 'Junior Engineer, PW(B&NH)D ,',
    jeAddress: 'Bokakhat & Dergaon Territorial\nBldg Sub-Division, Bokakhat',
    aeeDesignation: 'Asstt. Executive Engineer, PW(B&NH)D ,',
    aeeAddress: 'Bokakhat & Dergaon Territorial\nBldg Sub-Division, Bokakhat',
    eeDesignation: 'Executive Engineer, PW(B&NH)D ,',
    eeAddress: 'Golaghat District Territorial\nBldg Division, Golaghat',
    showJeOnSitePlan: true,
    showAeeOnSitePlan: false,
    showEeOnSitePlan: false
  };

  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      profile = { ...profile, ...parsed };
    } catch(e) {}
  }

  nameInput.value = profile.name || '';
  desigInput.value = profile.designation || '';
  includeCheck.checked = profile.includePdf !== false;

  // Set site plan checks
  if (siteJeCheck) siteJeCheck.checked = profile.showJeOnSitePlan !== false;
  if (siteAeeCheck) siteAeeCheck.checked = !!profile.showAeeOnSitePlan;
  if (siteEeCheck) siteEeCheck.checked = !!profile.showEeOnSitePlan;
  
  // Set 3-column seals inputs
  if (useThreeSealsCheck) {
    useThreeSealsCheck.checked = profile.useThreeSeals !== false;
    
    // Toggle container display based on check
    const toggleContainer = () => {
      if (threeSealsContainer) {
        threeSealsContainer.style.display = useThreeSealsCheck.checked ? 'flex' : 'none';
      }
    };
    useThreeSealsCheck.addEventListener('change', toggleContainer);
    toggleContainer();
  }

  if (jeDesigInput) jeDesigInput.value = profile.jeDesignation;
  if (jeAddrInput) jeAddrInput.value = profile.jeAddress;
  if (aeeDesigInput) aeeDesigInput.value = profile.aeeDesignation;
  if (aeeAddrInput) aeeAddrInput.value = profile.aeeAddress;
  if (eeDesigInput) eeDesigInput.value = profile.eeDesignation;
  if (eeAddrInput) eeAddrInput.value = profile.eeAddress;
  if (sealsFontSizeSelect) sealsFontSizeSelect.value = profile.sealsFontSize || '8.5pt';

  if (profile.signatureBase64) {
    sigPreview.innerHTML = `<img src="${profile.signatureBase64}" style="max-height:100%; max-width:100%; object-fit:contain;">`;
    clearBtn.style.display = 'inline-block';
  }

  sigUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > 400) { h *= 400/w; w = 400; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,w,h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        profile.signatureBase64 = dataUrl;
        sigPreview.innerHTML = `<img src="${dataUrl}" style="max-height:100%; max-width:100%; object-fit:contain;">`;
        clearBtn.style.display = 'inline-block';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  clearBtn.addEventListener('click', () => {
    profile.signatureBase64 = '';
    sigPreview.innerHTML = '<span style="color: var(--text-muted); font-size: 0.85rem;">No signature uploaded</span>';
    clearBtn.style.display = 'none';
    sigUpload.value = '';
  });

  saveBtn.addEventListener('click', () => {
    profile.name = nameInput.value;
    profile.designation = desigInput.value;
    profile.includePdf = includeCheck.checked;
    
    // Save 3-column seals inputs
    if (useThreeSealsCheck) profile.useThreeSeals = useThreeSealsCheck.checked;
    if (jeDesigInput) profile.jeDesignation = jeDesigInput.value;
    if (jeAddrInput) profile.jeAddress = jeAddrInput.value;
    if (aeeDesigInput) profile.aeeDesignation = aeeDesigInput.value;
    if (aeeAddrInput) profile.aeeAddress = aeeAddrInput.value;
    if (eeDesigInput) profile.eeDesignation = eeDesigInput.value;
    if (eeAddrInput) profile.eeAddress = eeAddrInput.value;
    if (sealsFontSizeSelect) profile.sealsFontSize = sealsFontSizeSelect.value;

    // Save site plan seal visibility
    if (siteJeCheck) profile.showJeOnSitePlan = siteJeCheck.checked;
    if (siteAeeCheck) profile.showAeeOnSitePlan = siteAeeCheck.checked;
    if (siteEeCheck) profile.showEeOnSitePlan = siteEeCheck.checked;

    localStorage.setItem('valuroad_user_profile', JSON.stringify(profile));
    
    const ogText = saveBtn.innerText;
    saveBtn.innerText = 'Saved Successfully!';
    saveBtn.style.backgroundColor = '#10b981';
    saveBtn.style.borderColor = '#10b981';
    setTimeout(() => {
      saveBtn.innerText = ogText;
      saveBtn.style.backgroundColor = '';
      saveBtn.style.borderColor = '';
    }, 2000);
  });

  setupBackupRestore();
  setupAiChatbox();
}

function setupBackupRestore() {
  const restoreInput = document.getElementById('backup-restore-input');
  const dropzone = document.getElementById('restore-dropzone');
  const statusMsg = document.getElementById('restore-status-message');

  if (!restoreInput || !dropzone) return;

  const showStatus = (text, type) => {
    statusMsg.innerText = text;
    statusMsg.style.display = 'block';
    if (type === 'success') {
      statusMsg.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
      statusMsg.style.color = '#10b981';
      statusMsg.style.border = '1px solid #10b981';
    } else {
      statusMsg.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
      statusMsg.style.color = '#ef4444';
      statusMsg.style.border = '1px solid #ef4444';
    }
  };

  const handleBackupFile = (file) => {
    if (!file) return;
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      showStatus('❌ Invalid file type. Please upload a .json backup file.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        if (!data.projects || !Array.isArray(data.projects)) {
          showStatus('❌ Invalid backup structure: missing projects list.', 'error');
          return;
        }

        const count = data.projects.length;
        const confirmRestore = confirm(`Found ${count} projects in the backup file.\n\nRestoring this backup will replace your current project list. For safety, a backup of your current data will be downloaded first.\n\nDo you want to proceed?`);
        
        if (!confirmRestore) {
          showStatus('ℹ️ Restore cancelled.', 'info');
          return;
        }

        // Trigger safety backup of current data first
        await downloadAllBackup();

        // Overwrite global variables
        projects = data.projects;
        if (data.customDsrCatalog) {
          customDsrCatalog = data.customDsrCatalog;
        }

        // Save to local storage
        localStorage.setItem('valuroad_projects', JSON.stringify(projects));
        if (data.customDsrCatalog) {
          localStorage.setItem('valuroad_custom_dsr', JSON.stringify(customDsrCatalog));
        }

        // Save to Cloud Firestore (if logged in)
        if (auth.currentUser) {
          showStatus('⏳ Syncing restored data to Firestore cloud...', 'success');
          for (const proj of projects) {
            await saveUserProject(auth.currentUser.uid, proj).catch(err => {
              console.error("Error syncing restored project to cloud:", err);
            });
          }
          if (data.customDsrCatalog) {
            await saveUserCustomDsr(auth.currentUser.uid, customDsrCatalog).catch(err => {
              console.error("Error syncing restored DSR to cloud:", err);
            });
          }
        }

        showStatus('✅ Backup restored successfully! Reloading...', 'success');
        
        setTimeout(() => {
          window.location.reload();
        }, 1500);

      } catch (err) {
        console.error(err);
        showStatus('❌ Error parsing backup file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  };

  // Drag and drop handlers
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--accent)';
    dropzone.style.background = 'var(--bg-primary)';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--border-color)';
    dropzone.style.background = 'var(--bg-secondary)';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-color)';
    dropzone.style.background = 'var(--bg-secondary)';
    const file = e.dataTransfer.files[0];
    handleBackupFile(file);
  });

  dropzone.addEventListener('click', (e) => {
    if (e.target.id !== 'backup-restore-input') {
      restoreInput.click();
    }
  });

  restoreInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleBackupFile(file);
  });
}

// ── Print Preview & Page Customizer ──────────────────────────────────────
const SITE_PLAN_MARGIN_MM = 4;
let currentPreviewEntry = null;
let previewStyles = {
  whole: { family: 'Arial, Helvetica, sans-serif', size: '10.5' },
  title: { family: 'Arial, Helvetica, sans-serif', size: '12' },
  meta: { family: 'Arial, Helvetica, sans-serif', size: '10.5' },
  tables: { family: 'Arial, Helvetica, sans-serif', size: '10' },
  seals: { family: 'Arial, Helvetica, sans-serif', size: '8.5' }
};

function openPrintPreview(entryId) {
  if (!activeProject) return;
  const rawEntry = activeProject.entries.find(e => e.id === entryId);
  if (!rawEntry) return;

  // Initialize sketcher if not already loaded
  if (!sketcher) {
    sketcher = new SiteSketcher('sketcher-canvas');
    window.sketcher = sketcher;
  }

  // Auto-correct tiny/squished drawings on the fly
  if (sketcher && rawEntry.sketcherData && rawEntry.sketcherData.length > 0) {
    sketcher.loadData(rawEntry.sketcherData);
    sketcher.fitToContent();
    rawEntry.sketcherImage = sketcher.exportImage();
    
    // Save corrected image back to project entries (local & cloud storage)
    const projIdx = projects.findIndex(p => p.id === activeProject.id);
    if (projIdx > -1) {
      const entryIdx = projects[projIdx].entries.findIndex(e => e.id === rawEntry.id);
      if (entryIdx > -1) {
        projects[projIdx].entries[entryIdx].sketcherImage = rawEntry.sketcherImage;
        saveProjects();
        if (auth.currentUser) {
          saveProjectEntry(activeProject.id, projects[projIdx].entries[entryIdx]).catch(e => {});
        }
      }
    }
  }

  currentPreviewEntry = {
    ...rawEntry,
    workName: activeProject.workName,
    nbNote: activeProject.nbNote
  };
  console.log("DEBUG: currentPreviewEntry in openPrintPreview:", currentPreviewEntry);

  switchView('printPreview');

  const tpl = getPdfTemplateSettings();

  // Reset section typography styles to defaults
  previewStyles = {
    whole: { family: currentPreviewEntry.prevFontFamily || tpl.fontFamily || 'Arial, Helvetica, sans-serif', size: currentPreviewEntry.prevFontSize || tpl.fontSize || '10.5' },
    title: { family: currentPreviewEntry.prevFontFamily || tpl.fontFamily || 'Arial, Helvetica, sans-serif', size: '12' },
    meta: { family: currentPreviewEntry.prevFontFamily || tpl.fontFamily || 'Arial, Helvetica, sans-serif', size: '10.5' },
    tables: { family: currentPreviewEntry.prevFontFamily || tpl.fontFamily || 'Arial, Helvetica, sans-serif', size: '10' },
    seals: { family: currentPreviewEntry.prevFontFamily || tpl.fontFamily || 'Arial, Helvetica, sans-serif', size: '8.5' }
  };

  // Try to load configured seals font size from user profile
  try {
    const savedProf = localStorage.getItem('valuroad_user_profile');
    if (savedProf) {
      const prof = JSON.parse(savedProf);
      if (prof.sealsFontSize) {
        previewStyles.seals.size = prof.sealsFontSize.replace('pt', '');
      }
    }
  } catch(e) {}

  // Setup UI elements
  document.getElementById('prev-page-size').value = currentPreviewEntry.prevPageSize || 'a4';
  document.getElementById('prev-page-orient').value = currentPreviewEntry.prevPageOrient || 'portrait';
  document.getElementById('prev-page-margin').value = currentPreviewEntry.prevPageMargin !== undefined ? currentPreviewEntry.prevPageMargin : parseInt(tpl.margin) || 10;
  
  const prevShowJms = document.getElementById('prev-show-jms-sl');
  if (prevShowJms) {
    prevShowJms.checked = tpl.showJmsSlNo !== false;
  }

  const targetSelect = document.getElementById('prev-style-target');
  if (targetSelect) targetSelect.value = 'whole';
  
  document.getElementById('prev-font-family').value = previewStyles.whole.family;
  document.getElementById('prev-font-size').value = previewStyles.whole.size;

  renderPreviewPages();
}

function updatePreviewStyles() {
  const size = document.getElementById('prev-page-size').value;
  const orient = document.getElementById('prev-page-orient').value;
  const margin = document.getElementById('prev-page-margin').value;
  const zoom = document.getElementById('prev-zoom-slider').value;

  const zoomLabel = document.getElementById('prev-zoom-label');
  if (zoomLabel) zoomLabel.innerText = `${Math.round(zoom * 100)}%`;

  const papers = document.querySelectorAll('#print-preview-pages-canvas .preview-paper');
  papers.forEach(paper => {
    const isLandscapePage = paper.getAttribute('data-landscape') === 'true';
    const isSitePlanPage = paper.getAttribute('data-site-plan') === 'true';
    paper.className = 'preview-paper';
    if (isSitePlanPage) paper.classList.add('site-plan');
    paper.classList.add(`size-${size}`);
    if (orient === 'landscape' || isLandscapePage) {
      paper.classList.add('landscape');
    }
    paper.style.setProperty('--preview-margin', `${isSitePlanPage ? SITE_PLAN_MARGIN_MM : margin}mm`);
    paper.style.setProperty('--preview-zoom', zoom);

    // Apply styles for different parts via CSS variables
    paper.style.setProperty('--preview-whole-font-family', previewStyles.whole.family);
    paper.style.setProperty('--preview-whole-font-size', `${previewStyles.whole.size}pt`);

    paper.style.setProperty('--preview-title-font-family', previewStyles.title.family);
    paper.style.setProperty('--preview-title-font-size', `${previewStyles.title.size}pt`);

    paper.style.setProperty('--preview-meta-font-family', previewStyles.meta.family);
    paper.style.setProperty('--preview-meta-font-size', `${previewStyles.meta.size}pt`);

    paper.style.setProperty('--preview-tables-font-family', previewStyles.tables.family);
    paper.style.setProperty('--preview-tables-font-size', `${previewStyles.tables.size}pt`);

    paper.style.setProperty('--preview-seals-font-family', previewStyles.seals.family);
    paper.style.setProperty('--preview-seals-font-size', `${previewStyles.seals.size}pt`);
  });
  if (typeof window.updatePreviewPageIndicator === 'function') window.updatePreviewPageIndicator();
}

function renderPreviewRuler() {
  // Removed ruler per user request
}

function paginateContent(childrenArray, pageSize, pageOrient, pageMargin, styles) {
  // Create a temporary container to measure heights
  const tempCanvas = document.createElement('div');
  tempCanvas.style.position = 'absolute';
  tempCanvas.style.visibility = 'hidden';
  tempCanvas.style.top = '-9999px';
  tempCanvas.style.left = '-9999px';
  tempCanvas.style.width = '1000px'; // prevent artificial wrapping during measurement
  document.body.appendChild(tempCanvas);

  // Create a temporary paper to get the target page height in pixels
  const tempPaper = document.createElement('div');
  tempPaper.className = `preview-paper size-${pageSize}`;
  if (pageOrient === 'landscape') tempPaper.classList.add('landscape');
  tempPaper.style.setProperty('--preview-margin', `${pageMargin}mm`);
  
  // Apply font styles to the tempPaper
  for (const [key, val] of Object.entries(styles)) {
    tempPaper.style.setProperty(key, val);
  }
  
  tempCanvas.appendChild(tempPaper);

  // Measure the target height of the paper content area
  const style = window.getComputedStyle(tempPaper);
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  
  // Compute height fallback if clientHeight is 0 (due to hidden/no layout state)
  let defaultHeight = 1120; // A4 portrait ~297mm
  if (pageSize === 'letter') defaultHeight = 1054; // Letter portrait ~279mm
  else if (pageSize === 'legal') defaultHeight = 1345; // Legal portrait ~356mm
  else if (pageSize === 'a3') defaultHeight = 1587; // A3 portrait ~420mm

  if (pageOrient === 'landscape') {
    if (pageSize === 'a4') defaultHeight = 794;
    else if (pageSize === 'letter') defaultHeight = 816;
    else if (pageSize === 'legal') defaultHeight = 816;
    else if (pageSize === 'a3') defaultHeight = 1120;
  }

  const targetPageHeight = tempPaper.clientHeight || defaultHeight;
  const maxContentHeight = targetPageHeight - paddingTop - paddingBottom - 10; // Usable content height

  console.log('Pagination limits:', { targetPageHeight, paddingTop, paddingBottom, maxContentHeight });

  // Create a wrapper div inside tempPaper that holds the content being measured
  const contentWrapper = document.createElement('div');
  contentWrapper.style.width = '100%';
  tempPaper.appendChild(contentWrapper);

  const pagesData = [];
  let currentPageHtml = '';

  // We loop through the child nodes of the estimate container
  for (let i = 0; i < childrenArray.length; i++) {
    const child = childrenArray[i];
    
    // Skip comments or empty text nodes
    if (child.nodeType === Node.COMMENT_NODE) {
      continue;
    }
    if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) {
      continue;
    }

    // Append child clone to contentWrapper to measure its height
    const clone = child.cloneNode(true);
    contentWrapper.appendChild(clone);
    
    const currentContentHeight = contentWrapper.offsetHeight;
    const isManualPageBreak = clone.classList && (clone.classList.contains('preview-page-break') || clone.querySelector('.preview-page-break'));

    if (currentContentHeight > maxContentHeight || isManualPageBreak) {
      if (currentPageHtml !== '') {
        pagesData.push(currentPageHtml);
        currentPageHtml = '';
        contentWrapper.innerHTML = '';
        
        // Re-append the clone to the new empty page wrapper
        contentWrapper.appendChild(clone);
      }
    }

    currentPageHtml += child.outerHTML || child.textContent;
  }

  if (currentPageHtml.trim() !== '') {
    pagesData.push(currentPageHtml);
  }

  // Clean up
  document.body.removeChild(tempCanvas);

  return pagesData;
}

function renderPreviewPages() {
  const canvas = document.getElementById('print-preview-pages-canvas');
  if (!canvas || !currentPreviewEntry) return;
  canvas.innerHTML = '<div style="color:#ffffff; font-weight:600; text-align:center; padding-top:2rem;">Generating interactive preview pages...</div>';

  // Reset tab to interactive layout editor
  const btnTabInteractive = document.getElementById('btn-tab-interactive');
  if (btnTabInteractive) {
    // We update style state directly to prevent recursion if click is triggered
    const canvasContainer = document.getElementById('print-preview-pages-canvas');
    const iframeContainer = document.getElementById('pdf-iframe-container');
    if (canvasContainer && iframeContainer) {
      canvasContainer.style.removeProperty('position');
      canvasContainer.style.removeProperty('height');
      canvasContainer.style.removeProperty('overflow');
      canvasContainer.style.removeProperty('visibility');
      iframeContainer.style.display = 'none';
      
      btnTabInteractive.classList.add('active');
      btnTabInteractive.style.background = '#ffffff';
      btnTabInteractive.style.border = '1px solid #cbd5e1';
      btnTabInteractive.style.borderBottom = 'none';
      btnTabInteractive.style.color = 'var(--accent)';
      btnTabInteractive.style.fontWeight = '700';
      btnTabInteractive.style.zIndex = '2';

      const btnTabPdfPreview = document.getElementById('btn-tab-pdf-preview');
      if (btnTabPdfPreview) {
        btnTabPdfPreview.classList.remove('active');
        btnTabPdfPreview.style.background = 'transparent';
        btnTabPdfPreview.style.border = '1px solid transparent';
        btnTabPdfPreview.style.color = 'var(--text-secondary)';
        btnTabPdfPreview.style.fontWeight = '600';
        btnTabPdfPreview.style.zIndex = '1';
      }
    }
  }

  // Generate compiled HTML from the pdf.js template engine
  const rawHtml = exportToPDF(currentPreviewEntry, currentPreviewEntry.sketcherImage, 'preview');

  canvas.innerHTML = '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  const pages = doc.querySelectorAll('.pdf-page');

  if (pages.length === 0) {
    canvas.innerHTML = '<div style="color:#ffffff;">Failed to render preview.</div>';
    return;
  }

  // Get options for pagination
  const sizeEl = document.getElementById('prev-page-size');
  const pageSize = sizeEl ? sizeEl.value : 'a4';

  const orientEl = document.getElementById('prev-page-orient');
  const pageOrient = orientEl ? orientEl.value : 'portrait';

  const marginEl = document.getElementById('prev-page-margin');
  const pageMargin = marginEl ? parseFloat(marginEl.value) || 10 : 10;

  const styles = {
    '--preview-whole-font-family': previewStyles.whole.family,
    '--preview-whole-font-size': `${previewStyles.whole.size}pt`,
    '--preview-title-font-family': previewStyles.title.family,
    '--preview-title-font-size': `${previewStyles.title.size}pt`,
    '--preview-meta-font-family': previewStyles.meta.family,
    '--preview-meta-font-size': `${previewStyles.meta.size}pt`,
    '--preview-tables-font-family': previewStyles.tables.family,
    '--preview-tables-font-size': `${previewStyles.tables.size}pt`,
    '--preview-seals-font-family': previewStyles.seals.family,
    '--preview-seals-font-size': `${previewStyles.seals.size}pt`
  };

  // The first page contains the estimate blocks, which we paginate dynamically
  const estimatePage = pages[0];
  const childrenArray = Array.from(estimatePage.childNodes);
  const paginatedEstimateHtmls = paginateContent(childrenArray, pageSize, pageOrient, pageMargin, styles);

  // Now append all pages (paginated estimate pages, followed by other pages like Line Plan and Photos)
  const allPagesList = [];
  paginatedEstimateHtmls.forEach(html => {
    allPagesList.push({ html: html, isLandscape: false });
  });
  for (let i = 1; i < pages.length; i++) {
    allPagesList.push({
      html: pages[i].innerHTML,
      isLandscape: pages[i].classList.contains('pdf-landscape') || pages[i].classList.contains('landscape'),
      isSitePlan: pages[i].classList.contains('pdf-site-plan-page')
    });
  }

  allPagesList.forEach((pageObj, idx) => {
    const paper = document.createElement('div');
    paper.className = 'preview-paper';
    paper.setAttribute('contenteditable', 'true');
    paper.setAttribute('spellcheck', 'false');
    if (pageObj.isLandscape) {
      paper.setAttribute('data-landscape', 'true');
      paper.classList.add('landscape');
    }
    if (pageObj.isSitePlan) {
      paper.setAttribute('data-site-plan', 'true');
      paper.classList.add('site-plan');
    }
    
    // Inject the raw page inner contents
    paper.innerHTML = pageObj.html;
    
    canvas.appendChild(paper);
  });

  // Attach click-to-delete listeners to any page breaks already present
  canvas.querySelectorAll('.preview-page-break').forEach(pb => {
    pb.setAttribute('contenteditable', 'false');
    pb.addEventListener('click', () => {
      pb.remove();
      refreshPreviewFromDOM();
    });
  });

  // Re-bind Lucide icons inside preview pages
  if (window.lucide) {
    lucide.createIcons();
  }

  updatePreviewStyles();
}

function refreshPreviewFromDOM() {
  const canvas = document.getElementById('print-preview-pages-canvas');
  if (!canvas || !currentPreviewEntry) return;

  const papers = Array.from(canvas.querySelectorAll('.preview-paper'));

  // Find estimate papers (which are not landscape and do not contain photo evidence grid)
  const estimatePapers = papers.filter(paper => {
    const isLandscape = paper.getAttribute('data-landscape') === 'true';
    const hasPhotos = paper.querySelector('.pdf-photo-grid') !== null;
    return !isLandscape && !hasPhotos;
  });

  // Collect all child nodes from estimate papers to re-paginate
  const childrenArray = [];
  estimatePapers.forEach(paper => {
    Array.from(paper.childNodes).forEach(node => {
      // Avoid empty text nodes
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) return;
      childrenArray.push(node.cloneNode(true));
    });
  });

  // Get options for pagination
  const size = document.getElementById('prev-page-size').value;
  const orient = document.getElementById('prev-page-orient').value;
  const margin = parseFloat(document.getElementById('prev-page-margin').value) || 10;

  const styles = {
    '--preview-whole-font-family': previewStyles.whole.family,
    '--preview-whole-font-size': `${previewStyles.whole.size}pt`,
    '--preview-title-font-family': previewStyles.title.family,
    '--preview-title-font-size': `${previewStyles.title.size}pt`,
    '--preview-meta-font-family': previewStyles.meta.family,
    '--preview-meta-font-size': `${previewStyles.meta.size}pt`,
    '--preview-tables-font-family': previewStyles.tables.family,
    '--preview-tables-font-size': `${previewStyles.tables.size}pt`,
    '--preview-seals-font-family': previewStyles.seals.family,
    '--preview-seals-font-size': `${previewStyles.seals.size}pt`
  };

  const paginatedEstimateHtmls = paginateContent(childrenArray, size, orient, margin, styles);

  // Collect other pages from DOM
  const otherPages = papers.filter(paper => {
    const isLandscape = paper.getAttribute('data-landscape') === 'true';
    const hasPhotos = paper.querySelector('.pdf-photo-grid') !== null;
    return isLandscape || hasPhotos;
  });

  const otherPagesData = otherPages.map(paper => ({
    html: paper.innerHTML,
    isLandscape: paper.getAttribute('data-landscape') === 'true',
    isSitePlan: paper.getAttribute('data-site-plan') === 'true'
  }));

  // Clear and rebuild canvas
  canvas.innerHTML = '';

  // Append paginated estimate pages
  paginatedEstimateHtmls.forEach(html => {
    const paper = document.createElement('div');
    paper.className = 'preview-paper';
    paper.setAttribute('contenteditable', 'true');
    paper.setAttribute('spellcheck', 'false');
    paper.innerHTML = html;
    canvas.appendChild(paper);
  });

  // Append other pages
  otherPagesData.forEach(page => {
    const paper = document.createElement('div');
    paper.className = 'preview-paper';
    paper.setAttribute('contenteditable', 'true');
    paper.setAttribute('spellcheck', 'false');
    if (page.isLandscape) {
      paper.setAttribute('data-landscape', 'true');
      paper.classList.add('landscape');
    }
    if (page.isSitePlan) {
      paper.setAttribute('data-site-plan', 'true');
      paper.classList.add('site-plan');
    }
    paper.innerHTML = page.html;
    canvas.appendChild(paper);
  });

  // Re-bind click handlers and icons
  canvas.querySelectorAll('.preview-page-break').forEach(pb => {
    pb.setAttribute('contenteditable', 'false');
    pb.addEventListener('click', () => {
      pb.remove();
      refreshPreviewFromDOM();
    });
  });

  if (window.lucide) {
    lucide.createIcons();
  }

  updatePreviewStyles();
}

function exportPreviewedDocument(isPrint = false, returnBlobUrl = false) {
  if (!currentPreviewEntry) return Promise.reject("No entry selected");
  if (!window.html2pdf) {
    alert('PDF export library is not loaded yet. Please check your internet connection.');
    return Promise.reject("Library not loaded");
  }

  const canvas = document.getElementById('print-preview-pages-canvas');
  const papers = canvas.querySelectorAll('.preview-paper');

  const size = document.getElementById('prev-page-size').value;
  const orient = document.getElementById('prev-page-orient').value;
  const margin = parseFloat(document.getElementById('prev-page-margin').value) || 10;

  let combinedHtml = '';
  papers.forEach((paper, idx) => {
    // Clone node to clean up any temporary elements
    const clone = paper.cloneNode(true);
    
    // Propagate custom CSS typography variables to exported pages
    const styles = [
      `--preview-whole-font-family: ${previewStyles.whole.family}`,
      `--preview-whole-font-size: ${previewStyles.whole.size}pt`,
      `--preview-title-font-family: ${previewStyles.title.family}`,
      `--preview-title-font-size: ${previewStyles.title.size}pt`,
      `--preview-meta-font-family: ${previewStyles.meta.family}`,
      `--preview-meta-font-size: ${previewStyles.meta.size}pt`,
      `--preview-tables-font-family: ${previewStyles.tables.family}`,
      `--preview-tables-font-size: ${previewStyles.tables.size}pt`,
      `--preview-seals-font-family: ${previewStyles.seals.family}`,
      `--preview-seals-font-size: ${previewStyles.seals.size}pt`
    ].join('; ');

    const isLandscape = paper.getAttribute('data-landscape') === 'true';
    const isSitePlan = paper.getAttribute('data-site-plan') === 'true';
    const pageMargin = isSitePlan ? SITE_PLAN_MARGIN_MM : margin;
    const pageStyle = `padding: ${pageMargin}mm; ${styles}; page-break-after: avoid !important; break-after: avoid !important;`;
    const landscapeClass = isLandscape ? ' pdf-landscape' : '';
    const sitePlanClass = isSitePlan ? ' pdf-site-plan-page' : '';
    
    combinedHtml += `<div class="pdf-page${landscapeClass}${sitePlanClass} size-${size}" style="${pageStyle}">${clone.innerHTML}</div>`;
  });

  const filename = (() => {
    const cleanName = (currentPreviewEntry.clientName || 'Owner').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    return `Estimate_${cleanName}_${currentPreviewEntry.id}.pdf`;
  })();

  const opt = {
    margin: [margin, margin, margin, margin],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: size, orientation: orient }
  };

  // Create temporary offscreen element in DOM to capture pages via html2canvas
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'fixed';
  tempContainer.style.left = '0';
  tempContainer.style.top = '0';
  tempContainer.style.zIndex = '-9999';
  tempContainer.style.opacity = '0';
  tempContainer.style.pointerEvents = 'none';
  tempContainer.innerHTML = combinedHtml;
  document.body.appendChild(tempContainer);

  const generateMode = returnBlobUrl ? 'bloburl' : isPrint;

  return generateMixedPdf(tempContainer, filename, 0.98, generateMode)
    .then((result) => {
      document.body.removeChild(tempContainer);
      markEntryPrinted(currentPreviewEntry.id);
      return result;
    })
    .catch(err => {
      console.error("Mixed orientation PDF generation failed, falling back:", err);
      document.body.removeChild(tempContainer);
      
      if (returnBlobUrl) {
        return html2pdf().from(combinedHtml).set(opt).toPdf().outputPdf('blob').then(blob => {
          markEntryPrinted(currentPreviewEntry.id);
          return URL.createObjectURL(blob);
        });
      }

      if (isPrint) {
        html2pdf().from(combinedHtml).set(opt).toPdf().outputPdf('blob').then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          window.open(blobUrl, '_blank');
        }).catch(fallbackErr => {
          console.error("Error generating print PDF in fallback:", fallbackErr);
        });
      } else {
        html2pdf().from(combinedHtml).set(opt).save();
      }
      markEntryPrinted(currentPreviewEntry.id);
    });
}

function insertPageBreakAtCursor() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);

  const canvas = document.getElementById('print-preview-pages-canvas');
  if (!canvas.contains(range.commonAncestorContainer)) {
    alert('Please click inside the document text where you want to insert the page break.');
    return;
  }

  const pageBreak = document.createElement('div');
  pageBreak.className = 'preview-page-break';
  pageBreak.setAttribute('contenteditable', 'false');
  pageBreak.addEventListener('click', () => {
    pageBreak.remove();
  });

  range.insertNode(pageBreak);
  range.collapse(false);
}

function exportPreviewedDocumentToWord() {
  if (!currentPreviewEntry) return;

  const canvas = document.getElementById('print-preview-pages-canvas');
  const papers = canvas.querySelectorAll('.preview-paper');

  let combinedHtml = '';
  papers.forEach((paper, idx) => {
    const clone = paper.cloneNode(true);
    
    // Resolve custom CSS variables into direct inline styles for Word compatibility
    clone.querySelectorAll('.pdf-title').forEach(el => {
      el.style.fontFamily = previewStyles.title.family;
      el.style.fontSize = `${previewStyles.title.size}pt`;
      el.querySelectorAll('*').forEach(c => {
        c.style.fontFamily = previewStyles.title.family;
        c.style.fontSize = `${previewStyles.title.size}pt`;
      });
    });
    
    clone.querySelectorAll('.pdf-meta').forEach(el => {
      el.style.fontFamily = previewStyles.meta.family;
      el.style.fontSize = `${previewStyles.meta.size}pt`;
      el.querySelectorAll('*').forEach(c => {
        c.style.fontFamily = previewStyles.meta.family;
        c.style.fontSize = `${previewStyles.meta.size}pt`;
      });
    });

    const tableSelectors = ['.pdf-items-list table', '.pdf-excluded-list table', '.pdf-service-items table'];
    tableSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => {
        el.style.fontFamily = previewStyles.tables.family;
        el.style.fontSize = `${previewStyles.tables.size}pt`;
        el.querySelectorAll('*').forEach(c => {
          c.style.fontFamily = previewStyles.tables.family;
          c.style.fontSize = `${previewStyles.tables.size}pt`;
        });
      });
    });

    clone.querySelectorAll('.pdf-seals-text').forEach(el => {
      el.style.fontFamily = previewStyles.seals.family;
      el.style.fontSize = `${previewStyles.seals.size}pt`;
      el.querySelectorAll('*').forEach(c => {
        c.style.fontFamily = previewStyles.seals.family;
        c.style.fontSize = `${previewStyles.seals.size}pt`;
      });
    });

    const pageHtml = clone.innerHTML;
    
    if (idx > 0) {
      combinedHtml += `<br style="page-break-before: always; clear: both; mso-break-type: section-break;">`;
    }
    combinedHtml += `<div class="word-page" style="font-family: ${previewStyles.whole.family}; font-size: ${previewStyles.whole.size}pt;">${pageHtml}</div>`;
  });

  const wordDoc = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Valuation Estimate</title>
<!--[if gte mso 9]>
<xml>
 <w:WordDocument>
  <w:View>Print</w:View>
  <w:Zoom>100</w:Zoom>
  <w:DoNotOptimizeForBrowser/>
 </w:WordDocument>
</xml>
<![endif]-->
<style>
  @page {
    size: A4;
    margin: 1in;
  }
  body {
    font-family: ${previewStyles.whole.family};
    font-size: ${previewStyles.whole.size}pt;
    color: #000000;
    line-height: 1.4;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 10px;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 6px;
    vertical-align: top;
    font-size: ${previewStyles.whole.size}pt;
  }
  img {
    max-width: 100%;
    height: auto;
  }
  .pdf-row {
    display: table;
    width: 100%;
    margin-bottom: 4px;
  }
  .pdf-row > div {
    display: table-cell;
    vertical-align: top;
  }
  .bold-right { font-weight: bold; text-align: right; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
</style>
</head>
<body>
  ${combinedHtml}
</body>
</html>
  `;

  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), wordDoc], { type: "application/msword;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  const cleanName = (currentPreviewEntry.clientName || 'Owner').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  const namePart = cleanName.substring(0, 33).replace(/_$/, '');
  const filename = `${namePart}_valuation_estimate.doc`;

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function initPrintPreviewEvents() {
  const prevPageSize = document.getElementById('prev-page-size');
  const prevPageOrient = document.getElementById('prev-page-orient');
  const prevPageMargin = document.getElementById('prev-page-margin');
  const prevFontFamily = document.getElementById('prev-font-family');
  const prevFontSize = document.getElementById('prev-font-size');
  const prevZoomSlider = document.getElementById('prev-zoom-slider');
  const prevStyleTarget = document.getElementById('prev-style-target');

  if (prevPageSize) {
    prevPageSize.addEventListener('change', () => {
      updatePreviewStyles();
    });
  }
  if (prevPageOrient) {
    prevPageOrient.addEventListener('change', () => {
      updatePreviewStyles();
    });
  }
  if (prevPageMargin) prevPageMargin.addEventListener('input', updatePreviewStyles);
  
  if (prevStyleTarget) {
    prevStyleTarget.addEventListener('change', () => {
      const target = prevStyleTarget.value;
      const styles = previewStyles[target] || previewStyles.whole;
      if (prevFontFamily) prevFontFamily.value = styles.family;
      if (prevFontSize) prevFontSize.value = styles.size;
    });
  }

  if (prevFontFamily) {
    prevFontFamily.addEventListener('change', () => {
      const target = prevStyleTarget ? prevStyleTarget.value : 'whole';
      if (previewStyles[target]) {
        previewStyles[target].family = prevFontFamily.value;
      }
      updatePreviewStyles();
    });
  }
  if (prevFontSize) {
    prevFontSize.addEventListener('change', () => {
      const target = prevStyleTarget ? prevStyleTarget.value : 'whole';
      if (previewStyles[target]) {
        previewStyles[target].size = prevFontSize.value;
      }
      updatePreviewStyles();
    });
  }

  if (prevZoomSlider) {
    prevZoomSlider.addEventListener('input', () => {
      updatePreviewStyles();
    });
  }

  const btnPageBreak = document.getElementById('prev-btn-pagebreak');
  if (btnPageBreak) btnPageBreak.addEventListener('click', insertPageBreakAtCursor);

  const prevShowJms = document.getElementById('prev-show-jms-sl');
  if (prevShowJms) {
    prevShowJms.addEventListener('change', (e) => {
      const settings = getPdfTemplateSettings();
      settings.showJmsSlNo = e.target.checked;
      localStorage.setItem(PDF_TEMPLATE_KEY, JSON.stringify(settings));
      if (auth.currentUser) {
        saveUserPdfTemplate(auth.currentUser.uid, settings).catch(err => {});
      }
      renderPreviewPages();
    });
  }

  const btnPdf = document.getElementById('prev-btn-pdf');
  if (btnPdf) btnPdf.addEventListener('click', () => exportPreviewedDocument(false));

  const btnExcel = document.getElementById('prev-btn-excel');
  if (btnExcel) {
    btnExcel.addEventListener('click', () => {
      if (currentPreviewEntry) {
        exportSingleEstimateToExcel(currentPreviewEntry.id);
      }
    });
  }

  const btnWord = document.getElementById('prev-btn-word');
  if (btnWord) btnWord.addEventListener('click', exportPreviewedDocumentToWord);

  const btnPrint = document.getElementById('prev-btn-print');
  if (btnPrint) btnPrint.addEventListener('click', () => exportPreviewedDocument(true));

  const btnClose = document.getElementById('prev-btn-close');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      switchView('editor');
    });
  }

  // Page Navigation
  const btnPagePrev = document.getElementById('prev-btn-page-prev');
  const btnPageNext = document.getElementById('prev-btn-page-next');
  const pageIndicator = document.getElementById('prev-page-indicator');
  let currentPageNum = 1;
  let navThrottleTimer = null;

  function updatePageIndicator() {
    const canvas = document.getElementById('print-preview-pages-canvas');
    if (!canvas) return;
    const papers = canvas.querySelectorAll('.preview-paper');
    const total = papers.length;
    if (pageIndicator) pageIndicator.textContent = currentPageNum + ' / ' + total;
    if (btnPagePrev) btnPagePrev.disabled = currentPageNum <= 1;
    if (btnPageNext) btnPageNext.disabled = currentPageNum >= total;
  }

  function scrollToPage(pageNum) {
    const canvas = document.getElementById('print-preview-pages-canvas');
    if (!canvas) return;
    const papers = canvas.querySelectorAll('.preview-paper');
    if (pageNum < 1 || pageNum > papers.length) return;
    currentPageNum = pageNum;
    const target = papers[pageNum - 1];
    const offset = target.offsetTop - canvas.offsetTop;
    canvas.scrollTop = Math.max(0, offset - 16);
    updatePageIndicator();
  }

  if (btnPagePrev) {
    btnPagePrev.addEventListener('click', () => scrollToPage(currentPageNum - 1));
  }
  if (btnPageNext) {
    btnPageNext.addEventListener('click', () => scrollToPage(currentPageNum + 1));
  }

  // Update page indicator on scroll (throttled)
  const navCanvas = document.getElementById('print-preview-pages-canvas');
  if (navCanvas) {
    navCanvas.addEventListener('scroll', () => {
      if (navThrottleTimer) return;
      navThrottleTimer = setTimeout(() => { navThrottleTimer = null; }, 100);
      const papers = navCanvas.querySelectorAll('.preview-paper');
      const scrollCenter = navCanvas.scrollTop + navCanvas.clientHeight / 2;
      let bestIdx = 0;
      for (let i = 0; i < papers.length; i++) {
        const paperMid = papers[i].offsetTop + papers[i].offsetHeight / 2;
        if (paperMid < scrollCenter) bestIdx = i;
      }
      currentPageNum = bestIdx + 1;
      if (pageIndicator) pageIndicator.textContent = currentPageNum + ' / ' + papers.length;
    });
  }

  window.updatePreviewPageIndicator = updatePageIndicator;

  // Pointer drag-and-drop vertical positioning for signatures and page breaks
  const canvas = document.getElementById('print-preview-pages-canvas');
  if (canvas) {
    let dragEl = null;
    let dragType = null; // 'signature' or 'page-break'
    let startY = 0;
    let startTop = 0;
    let siblings = [];
    let paperEl = null;

    canvas.addEventListener('pointerdown', (e) => {
      const sigRow = e.target.closest('.pdf-signature-row');
      const pb = e.target.closest('.preview-page-break');
      
      if (sigRow) {
        e.preventDefault();
        dragEl = sigRow;
        dragType = 'signature';
        
        const paper = dragEl.closest('.preview-paper');
        if (paper) {
          paper.style.position = 'relative';
        }

        const style = window.getComputedStyle(dragEl);
        if (style.position !== 'absolute') {
          const rect = dragEl.getBoundingClientRect();
          const parentRect = paper.getBoundingClientRect();
          const zoomFactor = parseFloat(paper.style.getPropertyValue('--preview-zoom')) || 1.0;

          const relativeTop = (rect.top - parentRect.top) / zoomFactor;

          dragEl.style.position = 'absolute';
          dragEl.style.left = 'var(--preview-margin, 15mm)';
          dragEl.style.width = 'calc(100% - 2 * var(--preview-margin, 15mm))';
          dragEl.style.top = `${relativeTop}px`;
          dragEl.style.margin = '0';
          dragEl.style.zIndex = '1000';
          dragEl.style.cursor = 'ns-resize';
        }

        startY = e.clientY;
        startTop = parseFloat(dragEl.style.top) || 0;
        dragEl.setPointerCapture(e.pointerId);
      } else if (pb) {
        e.preventDefault();
        dragEl = pb;
        dragType = 'page-break';
        
        paperEl = dragEl.closest('.preview-paper');
        siblings = Array.from(paperEl.children).filter(el => el !== dragEl && !el.classList.contains('preview-page-break'));
        
        dragEl.style.opacity = '0.5';
        dragEl.style.zIndex = '2000';
        dragEl.setPointerCapture(e.pointerId);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!dragEl) return;

      if (dragType === 'signature') {
        const paper = dragEl.closest('.preview-paper');
        const zoomFactor = paper ? (parseFloat(paper.style.getPropertyValue('--preview-zoom')) || 1.0) : 1.0;
        const dy = (e.clientY - startY) / zoomFactor;
        dragEl.style.top = `${startTop + dy}px`;
      } else if (dragType === 'page-break' && paperEl) {
        const rect = paperEl.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;

        let closestEl = null;
        let closestDist = Infinity;
        let insertAfter = false;

        siblings.forEach(child => {
          const childRect = child.getBoundingClientRect();
          const childCenter = (childRect.top + childRect.bottom) / 2 - rect.top;
          const dist = Math.abs(relativeY - childCenter);

          if (dist < closestDist) {
            closestDist = dist;
            closestEl = child;
            insertAfter = relativeY > childCenter;
          }
        });

        if (closestEl) {
          if (insertAfter) {
            if (closestEl.nextSibling !== dragEl) {
              paperEl.insertBefore(dragEl, closestEl.nextSibling);
            }
          } else {
            if (closestEl !== dragEl) {
              paperEl.insertBefore(dragEl, closestEl);
            }
          }
        }
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!dragEl) return;

      dragEl.releasePointerCapture(e.pointerId);

      if (dragType === 'page-break') {
        dragEl.style.opacity = '1.0';
        refreshPreviewFromDOM();
      }

      dragEl = null;
      dragType = null;
      siblings = [];
      paperEl = null;
    });
  }

  // Preview Tabs Event Handlers
  const btnTabInteractive = document.getElementById('btn-tab-interactive');
  const btnTabPdfPreview = document.getElementById('btn-tab-pdf-preview');
  const canvasContainer = document.getElementById('print-preview-pages-canvas');
  const iframeContainer = document.getElementById('pdf-iframe-container');

  if (btnTabInteractive && btnTabPdfPreview && canvasContainer && iframeContainer) {
    btnTabInteractive.addEventListener('click', () => {
      canvasContainer.style.removeProperty('position');
      canvasContainer.style.removeProperty('height');
      canvasContainer.style.removeProperty('overflow');
      canvasContainer.style.removeProperty('visibility');
      iframeContainer.style.display = 'none';

      btnTabInteractive.classList.add('active');
      btnTabInteractive.style.background = '#ffffff';
      btnTabInteractive.style.border = '1px solid #cbd5e1';
      btnTabInteractive.style.borderBottom = 'none';
      btnTabInteractive.style.color = 'var(--accent)';
      btnTabInteractive.style.fontWeight = '700';
      btnTabInteractive.style.zIndex = '2';

      btnTabPdfPreview.classList.remove('active');
      btnTabPdfPreview.style.background = 'transparent';
      btnTabPdfPreview.style.border = '1px solid transparent';
      btnTabPdfPreview.style.color = 'var(--text-secondary)';
      btnTabPdfPreview.style.fontWeight = '600';
      btnTabPdfPreview.style.zIndex = '1';
    });

    btnTabPdfPreview.addEventListener('click', () => {
      canvasContainer.style.position = 'absolute';
      canvasContainer.style.left = '-9999px';
      canvasContainer.style.top = '-9999px';
      canvasContainer.style.visibility = 'hidden';
      canvasContainer.style.height = '0';
      canvasContainer.style.overflow = 'hidden';
      iframeContainer.style.display = 'block';

      btnTabPdfPreview.classList.add('active');
      btnTabPdfPreview.style.background = '#ffffff';
      btnTabPdfPreview.style.border = '1px solid #cbd5e1';
      btnTabPdfPreview.style.borderBottom = 'none';
      btnTabPdfPreview.style.color = 'var(--accent)';
      btnTabPdfPreview.style.fontWeight = '700';
      btnTabPdfPreview.style.zIndex = '2';

      btnTabInteractive.classList.remove('active');
      btnTabInteractive.style.background = 'transparent';
      btnTabInteractive.style.border = '1px solid transparent';
      btnTabInteractive.style.color = 'var(--text-secondary)';
      btnTabInteractive.style.fontWeight = '600';
      btnTabInteractive.style.zIndex = '1';

      iframeContainer.innerHTML = `
        <div class="pdf-loading-overlay" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1e293b; color: #ffffff; font-family: sans-serif; gap: 1rem; z-index: 5;">
          <div class="spinner" style="width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.1); border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <span style="font-weight: 600; font-size: 0.95rem;">Compiling & Rendering PDF Preview...</span>
        </div>
        <style>
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      `;

      exportPreviewedDocument(false, true)
        .then(blobUrl => {
          iframeContainer.innerHTML = '';
          const iframe = document.createElement('iframe');
          iframe.src = `${blobUrl}#toolbar=1&navpanes=0`;
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          iframe.style.background = '#525659';
          iframeContainer.appendChild(iframe);
        })
        .catch(err => {
          iframeContainer.innerHTML = `
            <div style="padding: 2rem; color: #f87171; text-align: center; font-family: sans-serif;">
              <h3>⚠️ Failed to Render PDF</h3>
              <p>${err.message || err}</p>
            </div>
          `;
        });
    });
  }
}

// ── Particle Background Effect ──────────────────────────────────────────
function initParticles() {
  if (window.tsParticles) {
    tsParticles.load("tsparticles", {
      fpsLimit: 60,
      interactivity: {
        events: {
          onHover: { enable: true, mode: "grab" },
          resize: true
        },
        modes: { grab: { distance: 140, links: { opacity: 0.5 } } }
      },
      particles: {
        color: { value: "#3b82f6" },
        links: { color: "#3b82f6", distance: 150, enable: true, opacity: 0.2, width: 1 },
        move: { direction: "none", enable: true, outModes: { default: "bounce" }, random: false, speed: 1, straight: false },
        number: { density: { enable: true, area: 800 }, value: 60 },
        opacity: { value: 0.4 },
        shape: { type: "circle" },
        size: { value: { min: 1, max: 3 } }
      },
      detectRetina: true
    });
  }
}

// ── Estimator AI Chatbox Implementation ──────────────────────────────────
let aiChatHistory = [];

function setupAiChatbox() {
  const openChatBtn = document.getElementById('open-ai-chat-btn');
  const chatbox = document.getElementById('estimator-ai-chatbox');
  const chatHeader = document.getElementById('ai-chatbox-header');
  const minimizeBtn = document.getElementById('ai-chatbox-minimize-btn');
  const closeBtn = document.getElementById('ai-chatbox-close-btn');
  const sendBtn = document.getElementById('ai-chatbox-send-btn');
  const chatInput = document.getElementById('ai-chatbox-input');
  const chatMessages = document.getElementById('ai-chatbox-messages');
  const suggestionChips = document.querySelectorAll('.ai-suggestion-chip');

  if (!openChatBtn || !chatbox) return;

  // Toggle chat window when clicking Estimator AI button
  openChatBtn.addEventListener('click', () => {
    chatbox.classList.add('active');
    chatbox.classList.remove('minimized');
    if (window.lucide) lucide.createIcons();
    // Scroll messages to bottom
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
  });

  // Toggle minimize when clicking the header
  chatHeader.addEventListener('click', (e) => {
    // Prevent minimize if clicking control buttons
    if (e.target.closest('.ai-chat-control-btn')) return;
    chatbox.classList.toggle('minimized');
  });

  // Minimize button click
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chatbox.classList.toggle('minimized');
    });
  }

  // Close button click
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chatbox.classList.remove('active');
    });
  }

  // Suggestion chips
  suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const query = chip.getAttribute('data-query');
      if (query) {
        handleSendUserMessage(query);
      }
    });
  });

  // Send message on button click
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const text = chatInput.value.trim();
      if (text) {
        chatInput.value = '';
        handleSendUserMessage(text);
      }
    });
  }

  // Send message on Enter keypress
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text) {
          chatInput.value = '';
          handleSendUserMessage(text);
        }
      }
    });
  }

  async function handleSendUserMessage(text) {
    // 1. Append user bubble
    appendMessageBubble('user', text);

    // 2. Add to local conversation history
    aiChatHistory.push({ role: 'user', content: text });
    if (aiChatHistory.length > 20) {
      aiChatHistory.shift(); // Keep last 20 messages to manage context size
    }

    // 3. Show typing indicator
    const typingIndicator = appendTypingIndicator();

    try {
      // 4. Call OpenRouter API
      const responseText = await callOpenRouterCompletions(aiChatHistory);

      // 5. Remove typing indicator
      typingIndicator.remove();

      // 6. Append bot bubble
      appendMessageBubble('bot', responseText);

      // 7. Add bot response to history
      aiChatHistory.push({ role: 'assistant', content: responseText });
      if (aiChatHistory.length > 20) {
        aiChatHistory.shift();
      }
    } catch (error) {
      console.error('Estimator AI Error:', error);
      typingIndicator.remove();
      const errorMsg = error.message.includes('API key is missing')
        ? 'Estimator AI key is not configured. Please set VITE_OPENROUTER_API_KEY in your .env file and refresh the page.'
        : 'Sorry, I encountered an issue connecting to my brain. Please try again in a moment.';
      appendMessageBubble('bot', errorMsg);
    }
  }

  function appendMessageBubble(sender, text) {
    const bubble = document.createElement('div');
    bubble.className = `ai-msg-bubble ${sender}`;
    if (sender === 'bot') {
      bubble.innerHTML = formatAiMarkdown(text);
    } else {
      bubble.textContent = text;
    }
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'ai-msg-bubble bot';
    indicator.innerHTML = `
      <div class="ai-typing-dots">
        <div class="ai-typing-dot"></div>
        <div class="ai-typing-dot"></div>
        <div class="ai-typing-dot"></div>
      </div>
    `;
    chatMessages.appendChild(indicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return indicator;
  }
}

async function callOpenRouterCompletions(history) {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
  if (!apiKey) {
    throw new Error('API key is missing. Please ensure VITE_OPENROUTER_API_KEY is set in your .env file and restart/reload the application.');
  }

  const model = import.meta.env.VITE_OPENROUTER_MODEL || 'openrouter/free';
  const systemPrompt = "You are Estimator AI, a helpful AI assistant built into ValuRoad, a professional real estate and road valuation application. You assist users with calculating structural depreciation, using the CPWD DSR catalog, doing road acquisitions, estimating construction classes (RCC, Assam Type, Temporary sheds), and using the application. Keep your responses helpful, precise, and professional. Format outputs nicely using Markdown if needed.";

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://valuroad.app',
      'X-Title': 'ValuRoad App'
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content;
  }

  throw new Error('Invalid response format from OpenRouter');
}

function formatAiMarkdown(text) {
  // Simple markdown parsing helper
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```code```
  html = html.replace(/```([\s\S]+?)```/g, (match, p1) => {
    return `<pre><code>${p1.trim()}</code></pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');

  // Italics: *text*
  html = html.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');

  // Newlines to br
  html = html.replace(/\n/g, '<br>');

  return html;
}

// ── AI Bulk Survey Estimator Feature ──────────────────────────────────────────
let parsedBulkOwners = [];

function setupAiBulkEstimate() {
  const dropzone = document.getElementById('bulk-dropzone');
  const fileInput = document.getElementById('bulk-file-input');
  const generateBtn = document.getElementById('bulk-generate-estimates-btn');
  const addOwnerBtn = document.getElementById('bulk-add-owner-row-btn');

  if (dropzone && fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          handleBulkPdfFile(file);
        } else if (file.type.startsWith('image/')) {
          handleBulkImageFile(file);
        } else {
          alert('Please upload a PDF or an image file.');
        }
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--accent)';
      dropzone.style.backgroundColor = 'var(--accent-light)';
    });

    dropzone.style.transition = 'all 0.2s';
    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = 'var(--border-color)';
      dropzone.style.backgroundColor = '';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border-color)';
      dropzone.style.backgroundColor = '';
      const file = e.dataTransfer.files[0];
      if (file) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          handleBulkPdfFile(file);
        } else if (file.type.startsWith('image/')) {
          handleBulkImageFile(file);
        } else {
          alert('Please drop a PDF or an image file.');
        }
      }
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', generateBulkEstimates);
  }

  if (addOwnerBtn) {
    addOwnerBtn.addEventListener('click', () => {
      const newOwner = {
        id: 'OWNER_PARSED_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        jms_sl_no: '',
        owner_name: 'New Owner',
        village: '',
        mouza: '',
        structures: [
          {
            id: 'STRUCT_' + Date.now() + '_0',
            description: 'Structure 1',
            category: 'Temporary Building',
            length_ft: 10,
            breadth_ft: 10,
            area_sqft: 100,
            area_sqm: 9.29,
            rate: 205.00,
            deduction_pct: 0,
            total_cost: 20500
          }
        ]
      };
      parsedBulkOwners.push(newOwner);
      renderBulkPreview();
    });
  }
}

function refreshBulkProjectSelector() {
  const select = document.getElementById('bulk-project-select');
  if (!select) return;
  
  select.innerHTML = '';
  
  if (projects.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- No projects available. Create one first --';
    select.appendChild(opt);
    return;
  }

  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.workName || p.projectName || `Project ${p.id}`;
    if (activeProject && activeProject.id === p.id) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

async function handleBulkImageFile(file) {
  const container = document.getElementById('bulk-progress-container');
  const statusEl = document.getElementById('bulk-progress-status');
  const percentEl = document.getElementById('bulk-progress-percent');
  const barEl = document.getElementById('bulk-progress-bar');
  const previewPanel = document.getElementById('bulk-preview-panel');

  if (!container || !statusEl || !percentEl || !barEl) return;

  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
  if (!apiKey) {
    alert('Estimator AI key is not configured. Please set VITE_OPENROUTER_API_KEY in your .env file and reload.');
    return;
  }

  const selectedProjId = document.getElementById('bulk-project-select').value;
  if (!selectedProjId) {
    alert('Please select or create a project first before importing survey documents.');
    return;
  }

  container.style.display = 'block';
  statusEl.innerText = 'Reading image...';
  percentEl.innerText = '10%';
  barEl.style.width = '10%';
  previewPanel.style.display = 'none';

  try {
    console.log('[AI Bulk Estimate] Processing image file:', file.name);

    // Convert image file to base64 data URL
    const base64DataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    statusEl.innerText = 'AI Analysing image...';
    percentEl.innerText = '50%';
    barEl.style.width = '50%';

    console.log('[AI Bulk Estimate] Sending image to AI vision model...');
    const pageData = await callAiVisionForBulkPdfPage(base64DataUrl, apiKey);
    console.log('[AI Bulk Estimate] Image parsed: extracted', pageData.length, 'owners');

    parsedBulkOwners = pageData;

    statusEl.innerText = `✅ Extracted ${parsedBulkOwners.length} owners successfully!`;
    percentEl.innerText = '100%';
    barEl.style.width = '100%';

    setTimeout(() => {
      container.style.display = 'none';
      if (parsedBulkOwners.length > 0) {
        renderBulkPreview();
      } else {
        alert('The AI could not extract any owners or structures from this image. Please verify the image is clear and contains a survey schedule.');
      }
    }, 1500);

  } catch (err) {
    console.error('[AI Bulk Estimate] Image error:', err);
    statusEl.innerText = 'AI Extraction Error!';
    percentEl.innerText = '';
    barEl.style.width = '0%';
    alert('Failed to parse survey image with AI: ' + err.message);
  }
}

async function handleBulkPdfFile(file) {
  const container = document.getElementById('bulk-progress-container');
  const statusEl = document.getElementById('bulk-progress-status');
  const percentEl = document.getElementById('bulk-progress-percent');
  const barEl = document.getElementById('bulk-progress-bar');
  const previewPanel = document.getElementById('bulk-preview-panel');

  if (!container || !statusEl || !percentEl || !barEl) return;

  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
  if (!apiKey) {
    alert('Estimator AI key is not configured. Please set VITE_OPENROUTER_API_KEY in your .env file and reload.');
    return;
  }

  const selectedProjId = document.getElementById('bulk-project-select').value;
  if (!selectedProjId) {
    alert('Please select or create a project first before importing survey PDFs.');
    return;
  }

  if (!window.pdfjsLib) {
    alert('PDF.js library is not loaded yet. Please check your internet connection.');
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

  container.style.display = 'block';
  statusEl.innerText = 'Loading Survey PDF...';
  percentEl.innerText = '0%';
  barEl.style.width = '0%';
  previewPanel.style.display = 'none';

  try {
    console.log('[AI Bulk Estimate] Reading PDF file:', file.name);

    const fileReader = new FileReader();
    const loadPromise = new Promise((resolve, reject) => {
      fileReader.onload = function() { resolve(new Uint8Array(this.result)); };
      fileReader.onerror = function(e) { reject(e); };
    });
    fileReader.readAsArrayBuffer(file);
    const typedarray = await loadPromise;

    const pdf = await pdfjsLib.getDocument(typedarray).promise;
    console.log('[AI Bulk Estimate] PDF loaded. Pages:', pdf.numPages);

    const startPageInput = document.getElementById('bulk-pdf-start-page');
    const endPageInput = document.getElementById('bulk-pdf-end-page');

    let startPage = parseInt(startPageInput?.value) || 1;
    let endPage = parseInt(endPageInput?.value) || pdf.numPages;
    startPage = Math.max(1, Math.min(pdf.numPages, startPage));
    endPage = Math.max(startPage, Math.min(pdf.numPages, endPage));

    const totalPagesToParse = (endPage - startPage) + 1;
    console.log(`[AI Bulk Estimate] Rendering pages ${startPage}–${endPage} to canvas...`);

    parsedBulkOwners = [];

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      const pageIndex = (pageNum - startPage) + 1;
      const baseProgress = Math.round(((pageIndex - 1) / totalPagesToParse) * 100);

      statusEl.innerText = `Rendering PDF Page ${pageNum} of ${endPage}...`;
      percentEl.innerText = `${baseProgress}%`;
      barEl.style.width = `${baseProgress}%`;

      // Render page to canvas
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for legibility
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const base64DataUrl = canvas.toDataURL('image/png');

      statusEl.innerText = `AI Analysing Page ${pageNum} of ${endPage}...`;
      const aiProgress = baseProgress + Math.round((1 / totalPagesToParse) * 50);
      percentEl.innerText = `${Math.min(aiProgress, 95)}%`;
      barEl.style.width = `${Math.min(aiProgress, 95)}%`;

      console.log(`[AI Bulk Estimate] Sending page ${pageNum} to AI vision model...`);
      const pageData = await callAiVisionForBulkPdfPage(base64DataUrl, apiKey);
      console.log(`[AI Bulk Estimate] Page ${pageNum}: extracted ${pageData.length} owners`);
      parsedBulkOwners = parsedBulkOwners.concat(pageData);
    }

    statusEl.innerText = `✅ Extracted ${parsedBulkOwners.length} owners successfully!`;
    percentEl.innerText = '100%';
    barEl.style.width = '100%';

    setTimeout(() => {
      container.style.display = 'none';
      if (parsedBulkOwners.length > 0) {
        renderBulkPreview();
      } else {
        alert('The AI could not extract any owners or structures from this PDF page range. Please verify the document is clear and contains a survey schedule.');
      }
    }, 1500);

  } catch (err) {
    console.error('[AI Bulk Estimate] Error:', err);
    statusEl.innerText = 'AI Extraction Error!';
    percentEl.innerText = '';
    barEl.style.width = '0%';
    alert('Failed to parse survey PDF with AI: ' + err.message);
  }
}

async function callAiVisionForBulkPdfPage(base64DataUrl, apiKey) {
  const systemPrompt = `You are an expert Joint Measurement Survey (JMS) extractor.
You will receive an image of a survey schedule (table) containing affected structures and landowner information.
Extract ALL landowner records from the table and return them as a valid JSON object with this exact format:
{
  "owners": [
    {
      "jms_sl_no": "...",
      "owner_name": "...",
      "village": "...",
      "mouza": "...",
      "structures": [
        {
          "description": "...",
          "category": "Temporary Building",
          "length_ft": 0.0,
          "breadth_ft": 0.0,
          "area_sqft": 0.0,
          "area_sqm": 0.0
        }
      ]
    }
  ]
}

Table Column Structure:
- Sl. No. | Name | Village | Mouza | Description | Size (in Feets) L and B

Extraction and Splitting Rules:
1. "jms_sl_no" must contain the serial number of the row (e.g. from the 'Sl. No.' column, such as '1', '2', '2(a)', etc.). If not found or not visible, set it to an empty string.
2. "owner_name" must contain the full name of the occupant or owner. Joint owners listed together in a row (e.g., "1. Smti Mina Hazarika, 2. Sri Praffulla Hazarika") should be extracted and joined with a comma or ampersand.
3. "village" and "mouza" must be extracted from their respective columns (e.g. Village: "Haluwa Gaon", Mouza: "Kaziranga").
4. A single owner row can contain multiple lines of L (Length) and B (Breadth) dimensions. Each line representing L and B is a separate structure asset. You MUST create a separate object in the "structures" array for each dimension line.
4. How to pair structure descriptions with dimension lines:
   - If the Description column lists multiple structures separated by slashes or plus signs (e.g., "Kacha House/Cowshed" or "Kacha House + Cowshed") and there are multiple dimension lines (e.g. 15x20 and 10x12), pair them in order:
     - Structure 1: Description "Kacha House", Category "Temporary Building", L: 15, B: 20.
     - Structure 2: Description "Cowshed", Category "Temp Shed", L: 10, B: 12.
   - If there is only one description (e.g. "Kacha Shed") but multiple dimension lines (e.g., 5 lines), create 5 structures all of description "Kacha Shed" and category "Temp Shed" using their respective L and B dimensions.
   - If the Description cell is blank/empty, default the description to "Kacha House" and category to "Temporary Building" (since the page is a "List of Kacha House").
5. Category Mapping:
   - "Kacha House" -> category "Temporary Building"
   - "Ghumti" -> category "Temporary Building"
   - "Kacha Shed", "Cow Shed", "Cowshed", "Kacha Cowshed", "Granary", "Rice Store House", "Paddy Straw House" -> category "Temp Shed"
   - "Shop", "Kacha Shop", "Hotel" -> category "Commercial Building"
   - "RCC Structure" -> category "RCC Structure"
   - "Assam Type Building" -> category "Assam Type Building"
6. For each structure, extract "length_ft" (L) and "breadth_ft" (B) as raw numbers in feet.
7. Compute: "area_sqft" = length_ft * breadth_ft.
8. Compute: "area_sqm" = area_sqft * 0.092903. Round all areas to 2 decimals.
9. Return ONLY the raw JSON string starting with { and ending with }. Do not enclose in markdown code fences, backticks, or write explanations.`;

  const isGeminiKey = apiKey && apiKey.startsWith('AQ.');
  if (isGeminiKey) {
    let geminiModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
    const selectedModel = document.getElementById('bulk-ai-model-select')?.value || 'auto';
    if (selectedModel && selectedModel.includes('gemini')) {
      const cleanName = selectedModel.replace(':free', '').replace('google/', '');
      geminiModels = [cleanName, ...geminiModels.filter(m => m !== cleanName)];
    }

    let geminiError = null;
    for (const geminiModel of geminiModels) {
      try {
        console.log(`[AI Bulk Estimate] Attempting Gemini Direct call with model: ${geminiModel}`);
        const rawContent = await callGeminiApiDirect(geminiModel, base64DataUrl, apiKey, systemPrompt, 'Please extract all owner and structure records from this survey schedule image and return them as a JSON object.');
        
        console.log(`[AI Bulk Estimate] Raw response from Gemini Direct (${geminiModel}):`, rawContent.substring(0, 500));

        let cleaned = rawContent.trim();
        cleaned = cleaned.replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, '');

        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        const firstBracket = cleaned.indexOf('[');
        const lastBracket = cleaned.lastIndexOf(']');

        let jsonStr = '';
        if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
          jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
        } else if (firstBracket !== -1 && lastBracket !== -1) {
          jsonStr = cleaned.substring(firstBracket, lastBracket + 1);
        } else {
          jsonStr = cleaned;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (err) {
          console.warn(`[AI Bulk Estimate] Standard JSON.parse failed for ${geminiModel}, attempting loose repair...`, err.message);
          try {
            let repaired = jsonStr
              .replace(/,\s*([\]}])/g, '$1')
              .replace(/\\'/g, "'");
            parsed = JSON.parse(repaired);
          } catch (err2) {
            console.warn(`[AI Bulk Estimate] Repaired JSON parse failed for ${geminiModel}, attempting object evaluation...`, err2.message);
            const fn = new Function(`return (${jsonStr});`);
            parsed = fn();
          }
        }

        let ownersList = [];
        if (Array.isArray(parsed)) {
          ownersList = parsed;
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.owners)) {
            ownersList = parsed.owners;
          } else {
            const arrays = Object.values(parsed).filter(val => Array.isArray(val));
            if (arrays.length > 0) {
              ownersList = arrays[0];
            }
          }
        }

        const results = ownersList.map((owner, idx) => {
          const jmsSlNo = String(owner.jms_sl_no || owner.sl_no || owner.serial || owner.serial_no || '').trim();
          const ownerName = String(owner.owner_name || owner.owner || owner.name || owner.landowner || '').trim();
          const village = String(owner.village || owner.village_name || owner.location || '').trim();
          const mouza = String(owner.mouza || owner.mouza_name || '').trim();
          
          const rawStructs = owner.structures || owner.structure || owner.assets || owner.items || [];
          const structures = Array.isArray(rawStructs) ? rawStructs.map((s, sIdx) => {
            const desc = String(s.description || s.desc || s.name || s.type || '').trim();
            let cat = String(s.category || s.structure_category || s.type || 'Temporary Building').trim();
            if (cat === 'Temp Building' || cat.toLowerCase().includes('temporary')) {
              cat = 'Temporary Building';
            } else if (cat.toLowerCase().includes('shed')) {
              cat = 'Temp Shed';
            } else if (cat.toLowerCase().includes('rcc')) {
              cat = 'RCC Structure';
            } else if (cat.toLowerCase().includes('assam')) {
              cat = 'Assam Type Building';
            } else if (cat.toLowerCase().includes('commercial') || cat.toLowerCase().includes('shop') || cat.toLowerCase().includes('hotel')) {
              cat = 'Commercial Building';
            }

            const l = parseFloat(s.length_ft || s.length || s.l || s.size_l || 0);
            const b = parseFloat(s.breadth_ft || s.breadth || s.b || s.width || s.w || s.size_b || 0);
            const areaSqft = l * b;
            const areaSqm = areaSqft * 0.092903;

            let rate = 205.00;
            if (cat === 'RCC Structure') rate = 20685.00;
            else if (cat === 'Assam Type Building') rate = 15867.00;
            else if (cat === 'Commercial Building') rate = 20685.00;

            const qty = (cat === 'Temporary Building' || cat === 'Temp Shed') ? areaSqft : areaSqm;
            const totalCost = Math.round(qty * rate);

            return {
              id: `STRUCT_${Date.now()}_${idx}_${sIdx}`,
              description: desc || cat,
              category: cat,
              length_ft: l,
              breadth_ft: b,
              area_sqft: parseFloat(areaSqft.toFixed(2)),
              area_sqm: parseFloat(areaSqm.toFixed(2)),
              rate: rate,
              deduction_pct: 0,
              total_cost: totalCost
            };
          }) : [];

          return {
            id: `OWNER_PARSED_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`,
            jms_sl_no: jmsSlNo,
            owner_name: ownerName || 'Unknown Owner',
            village: village,
            mouza: mouza,
            structures: structures
          };
        }).filter(o => o.owner_name && o.owner_name !== 'Unknown Owner');

        if (results.length === 0) {
          throw new Error('AI returned no valid owner records');
        }

        console.log(`[AI Bulk Estimate] Successfully parsed ${results.length} owner records from Gemini Direct (${geminiModel})`);
        return results;
      } catch (err) {
        console.warn(`[AI Bulk Estimate] Gemini Direct model ${geminiModel} failed:`, err.message);
        geminiError = err;
      }
    }
    throw new Error(`Gemini Direct API call failed on all models. Last error: ${geminiError ? geminiError.message : 'Unknown error'}`);
  }

  const selectedModel = document.getElementById('bulk-ai-model-select')?.value || 'auto';
  let candidateModels = [
    'meta-llama/llama-3.2-11b-vision-instruct:free',
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'openrouter/free'
  ];
  if (selectedModel && selectedModel !== 'auto') {
    candidateModels = [selectedModel, ...candidateModels.filter(m => m !== selectedModel)];
  }

  let lastError = null;

  for (const model of candidateModels) {
    try {
      console.log(`[AI Bulk Estimate] Attempting extraction with model: ${model}`);
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://valuroad.app',
          'X-Title': 'ValuRoad Bulk PDF Parser'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Please extract all owner and structure records from this survey schedule image and return them as a JSON object.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: base64DataUrl,
                    detail: 'high'
                  }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 4096
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI Vision Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const rawContent = data?.choices?.[0]?.message?.content || '';
      console.log(`[AI Bulk Estimate] Raw Response from ${model}:`, rawContent.substring(0, 500));

      let cleaned = rawContent.trim();
      cleaned = cleaned.replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, '');

      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');

      let jsonStr = '';
      if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
      } else if (firstBracket !== -1 && lastBracket !== -1) {
        jsonStr = cleaned.substring(firstBracket, lastBracket + 1);
      } else {
        jsonStr = cleaned;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (err) {
        console.warn(`[AI Bulk Estimate] Standard JSON.parse failed for ${model}, attempting loose repair...`, err.message);
        try {
          let repaired = jsonStr
            .replace(/,\s*([\]}])/g, '$1')
            .replace(/\\'/g, "'");
          parsed = JSON.parse(repaired);
        } catch (err2) {
          console.warn(`[AI Bulk Estimate] Repaired JSON parse failed for ${model}, attempting object evaluation...`, err2.message);
          const fn = new Function(`return (${jsonStr});`);
          parsed = fn();
        }
      }

      let ownersList = [];
      if (Array.isArray(parsed)) {
        ownersList = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.owners)) {
          ownersList = parsed.owners;
        } else {
          const arrays = Object.values(parsed).filter(val => Array.isArray(val));
          if (arrays.length > 0) {
            ownersList = arrays[0];
          }
        }
      }

      const results = ownersList.map((owner, idx) => {
        const jmsSlNo = String(owner.jms_sl_no || owner.sl_no || owner.serial || owner.serial_no || '').trim();
        const ownerName = String(owner.owner_name || owner.owner || owner.name || owner.landowner || '').trim();
        const village = String(owner.village || owner.village_name || owner.location || '').trim();
        const mouza = String(owner.mouza || owner.mouza_name || '').trim();
        
        const rawStructs = owner.structures || owner.structure || owner.assets || owner.items || [];
        const structures = Array.isArray(rawStructs) ? rawStructs.map((s, sIdx) => {
          const desc = String(s.description || s.desc || s.name || s.type || '').trim();
          let cat = String(s.category || s.structure_category || s.type || 'Temporary Building').trim();
          if (cat === 'Temp Building' || cat.toLowerCase().includes('temporary')) {
            cat = 'Temporary Building';
          } else if (cat.toLowerCase().includes('shed')) {
            cat = 'Temp Shed';
          } else if (cat.toLowerCase().includes('rcc')) {
            cat = 'RCC Structure';
          } else if (cat.toLowerCase().includes('assam')) {
            cat = 'Assam Type Building';
          } else if (cat.toLowerCase().includes('commercial') || cat.toLowerCase().includes('shop') || cat.toLowerCase().includes('hotel')) {
            cat = 'Commercial Building';
          }

          const l = parseFloat(s.length_ft || s.length || s.l || s.size_l || 0);
          const b = parseFloat(s.breadth_ft || s.breadth || s.b || s.width || s.w || s.size_b || 0);
          const areaSqft = l * b;
          const areaSqm = areaSqft * 0.092903;

          let rate = 205.00;
          if (cat === 'RCC Structure') rate = 20685.00;
          else if (cat === 'Assam Type Building') rate = 15867.00;
          else if (cat === 'Commercial Building') rate = 20685.00;

          const qty = (cat === 'Temporary Building' || cat === 'Temp Shed') ? areaSqft : areaSqm;
          const totalCost = Math.round(qty * rate);

          return {
            id: `STRUCT_${Date.now()}_${idx}_${sIdx}`,
            description: desc || cat,
            category: cat,
            length_ft: l,
            breadth_ft: b,
            area_sqft: parseFloat(areaSqft.toFixed(2)),
            area_sqm: parseFloat(areaSqm.toFixed(2)),
            rate: rate,
            deduction_pct: 0,
            total_cost: totalCost
          };
        }) : [];

        return {
          id: `OWNER_PARSED_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`,
          jms_sl_no: jmsSlNo,
          owner_name: ownerName || 'Unknown Owner',
          village: village,
          mouza: mouza,
          structures: structures
        };
      }).filter(o => o.owner_name && o.owner_name !== 'Unknown Owner');

      if (results.length === 0) {
        throw new Error(`AI returned no valid owner records from ${model}`);
      }

      console.log(`[AI Bulk Estimate] Successfully parsed ${results.length} owner records from ${model}`);
      return results;

    } catch (err) {
      console.warn(`[AI Bulk Estimate] Model ${model} failed:`, err.message);
      lastError = err;
    }
  }

  throw new Error(`AI Vision Bulk PDF extraction failed on all candidate models. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
}

function renderBulkPreview() {
  const tbody = document.getElementById('bulk-preview-tbody');
  const countEl = document.getElementById('bulk-preview-count');
  const panel = document.getElementById('bulk-preview-panel');
  if (!tbody || !panel) return;

  tbody.innerHTML = '';
  countEl.innerText = `${parsedBulkOwners.length} owners detected — review details below before generating estimates:`;

  const selectedProjId = document.getElementById('bulk-project-select').value;
  const project = projects.find(p => p.id === selectedProjId);
  const existingEntries = (project && project.entries) ? project.entries : [];

  parsedBulkOwners.forEach((owner, idx) => {
    // 1. Duplicate detection
    const isDuplicate = existingEntries.some(e => {
      const matchName = (e.clientName || '').toLowerCase().trim() === owner.owner_name.toLowerCase().trim();
      const locationStr = (e.location || '').toLowerCase().trim();
      const matchVillage = owner.village ? locationStr.includes(owner.village.toLowerCase().trim()) : false;
      const matchMouza = owner.mouza ? locationStr.includes(owner.mouza.toLowerCase().trim()) : false;
      return matchName && (matchVillage || matchMouza);
    });

    if (owner.duplicateAction === undefined) {
      owner.duplicateAction = isDuplicate ? 'skip' : 'new';
    }

    // 2. Validate completeness
    const needsReview = !owner.owner_name || !owner.village || owner.structures.length === 0 || owner.structures.some(s => s.length_ft === 0 || s.breadth_ft === 0);
    let statusClass = 'background: #22c55e; color: #fff;';
    let statusText = 'Ready';
    if (needsReview) {
      statusClass = 'background: #f59e0b; color: #fff;';
      statusText = 'Needs Review';
    } else if (isDuplicate) {
      statusClass = 'background: #3b82f6; color: #fff;';
      statusText = 'Already Exists';
    }

    const tr = document.createElement('tr');
    tr.dataset.ownerId = owner.id;
    tr.innerHTML = `
      <td>
        <button type="button" class="expand-owner-btn" style="background: none; border: none; color: var(--text-primary); cursor: pointer; padding: 4px;">
          <i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i>
        </button>
      </td>
      <td>
        <input type="text" class="owner-jms-sl-input" value="${owner.jms_sl_no || ''}" style="width:100%; font-size:0.85rem; padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-primary);">
      </td>
      <td>
        <input type="text" class="owner-name-input" value="${owner.owner_name}" style="width:100%; font-size:0.85rem; padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-primary);">
      </td>
      <td>
        <input type="text" class="owner-village-input" value="${owner.village}" style="width:100%; font-size:0.85rem; padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-primary);">
      </td>
      <td>
        <input type="text" class="owner-mouza-input" value="${owner.mouza}" style="width:100%; font-size:0.85rem; padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-primary);">
      </td>
      <td style="font-weight:600; text-align:center;">
        <span class="struct-count-display">${owner.structures.length}</span>
      </td>
      <td>
        <div style="display: flex; flex-direction: column; gap: 4px; align-items: stretch;">
          <span class="status-badge" style="padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 600; text-align: center; ${statusClass}">${statusText}</span>
          <select class="duplicate-action-select" style="padding: 2px 4px; font-size: 0.72rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); cursor: pointer; ${isDuplicate ? '' : 'display: none;'}">
            <option value="skip" ${owner.duplicateAction === 'skip' ? 'selected' : ''}>Skip</option>
            <option value="overwrite" ${owner.duplicateAction === 'overwrite' ? 'selected' : ''}>Overwrite</option>
            <option value="duplicate" ${owner.duplicateAction === 'duplicate' ? 'selected' : ''}>Duplicate</option>
          </select>
        </div>
      </td>
      <td style="text-align:center;">
        <button type="button" class="btn-danger delete-owner-row-btn" style="padding: 0.25rem 0.5rem;" title="Remove Owner">🗑</button>
      </td>
    `;
    tbody.appendChild(tr);

    // Expanded structures row
    const expTr = document.createElement('tr');
    expTr.className = 'expanded-row';
    expTr.style.display = 'none';
    expTr.innerHTML = `
      <td colspan="8" style="padding: 0.75rem 1rem; background-color: var(--bg-primary);">
        <div class="structures-detail-container" style="padding: 1rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background: var(--bg-secondary);">
          <h4 style="font-size: 0.9rem; margin-bottom: 0.75rem; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
            <span>Structure Assets Details</span>
            <button type="button" class="btn-secondary add-structure-asset-btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;"><i data-lucide="plus" style="width:12px;height:12px;"></i> Add Structure</button>
          </h4>
          <div class="structures-list" style="display: flex; flex-direction: column; gap: 0.75rem;">
            <!-- Structure cards go here -->
          </div>
        </div>
      </td>
    `;
    tbody.appendChild(expTr);

    // Bind Main row edits
    tr.querySelector('.owner-jms-sl-input').addEventListener('input', (e) => {
      owner.jms_sl_no = e.target.value.trim();
    });
    tr.querySelector('.owner-name-input').addEventListener('input', (e) => {
      owner.owner_name = e.target.value.trim();
      revalidateRow(tr, owner, isDuplicate);
    });
    tr.querySelector('.owner-village-input').addEventListener('input', (e) => {
      owner.village = e.target.value.trim();
      revalidateRow(tr, owner, isDuplicate);
    });
    tr.querySelector('.owner-mouza-input').addEventListener('input', (e) => {
      owner.mouza = e.target.value.trim();
      revalidateRow(tr, owner, isDuplicate);
    });
    tr.querySelector('.duplicate-action-select').addEventListener('change', (e) => {
      owner.duplicateAction = e.target.value;
    });
    tr.querySelector('.delete-owner-row-btn').addEventListener('click', () => {
      if (confirm(`Remove owner "${owner.owner_name}" from the list?`)) {
        parsedBulkOwners.splice(idx, 1);
        renderBulkPreview();
      }
    });

    // Wire up expand/collapse toggle
    const expandBtn = tr.querySelector('.expand-owner-btn');
    expandBtn.addEventListener('click', () => {
      const isCollapsed = expTr.style.display === 'none';
      expTr.style.display = isCollapsed ? 'table-row' : 'none';
      expandBtn.querySelector('i').style.transform = isCollapsed ? 'rotate(90deg)' : 'rotate(0deg)';
    });

    // Populate structure cards
    const structuresContainer = expTr.querySelector('.structures-list');
    
    function renderStructureCards() {
      structuresContainer.innerHTML = '';
      tr.querySelector('.struct-count-display').innerText = owner.structures.length;

      if (owner.structures.length === 0) {
        structuresContainer.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:1rem; border:1px dashed var(--border-color); border-radius:0.5rem;">No structures defined. Add one using the button above.</p>`;
        revalidateRow(tr, owner, isDuplicate);
        return;
      }

      owner.structures.forEach((struct, sIdx) => {
        const card = document.createElement('div');
        card.className = 'structure-card';
        card.style = `display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; padding: 0.5rem 0.75rem; border: 1px solid var(--border-color); border-radius: 0.5rem; background-color: var(--bg-secondary); margin-bottom: 0.5rem;`;
        card.innerHTML = `
          <div style="flex-grow: 1; min-width: 150px;">
            <label style="font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 2px; color: var(--text-muted);">Structure Type / Description</label>
            <input type="text" class="struct-desc-input" value="${struct.description}" style="width: 100%; padding: 0.35rem 0.5rem; font-size: 0.8rem; border-radius: 0.35rem; border: 1px solid var(--border-color); background-color: var(--bg-primary); color: var(--text-primary);">
          </div>
          <div style="width: 140px;">
            <label style="font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 2px; color: var(--text-muted);">Category</label>
            <select class="struct-cat-select" style="width: 100%; padding: 0.35rem 0.5rem; font-size: 0.8rem; border-radius: 0.35rem; border: 1px solid var(--border-color); background-color: var(--bg-primary); color: var(--text-primary);">
              <option value="Temporary Building" ${struct.category === 'Temporary Building' ? 'selected' : ''}>Temp Building</option>
              <option value="Temp Shed" ${struct.category === 'Temp Shed' ? 'selected' : ''}>Temp Shed</option>
              <option value="Commercial Building" ${struct.category === 'Commercial Building' ? 'selected' : ''}>Commercial Building</option>
              <option value="RCC Structure" ${struct.category === 'RCC Structure' ? 'selected' : ''}>RCC Structure</option>
              <option value="Assam Type Building" ${struct.category === 'Assam Type Building' ? 'selected' : ''}>Assam Type Building</option>
            </select>
          </div>
          <div style="width: 70px;">
            <label style="font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 2px; color: var(--text-muted);">Length (ft)</label>
            <input type="number" class="struct-l-input" value="${struct.length_ft}" step="0.1" style="width: 100%; padding: 0.35rem 0.5rem; font-size: 0.8rem; border-radius: 0.35rem; border: 1px solid var(--border-color); background-color: var(--bg-primary); color: var(--text-primary); text-align: right;">
          </div>
          <div style="width: 70px;">
            <label style="font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 2px; color: var(--text-muted);">Breadth (ft)</label>
            <input type="number" class="struct-b-input" value="${struct.breadth_ft}" step="0.1" style="width: 100%; padding: 0.35rem 0.5rem; font-size: 0.8rem; border-radius: 0.35rem; border: 1px solid var(--border-color); background-color: var(--bg-primary); color: var(--text-primary); text-align: right;">
          </div>
          <div style="width: 100px; text-align: right;">
            <label style="font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 2px; color: var(--text-muted);">Area (sqft / sqm)</label>
            <span style="font-size: 0.78rem; font-weight: 500;" class="struct-area-display">${struct.area_sqft} sqf<br>${struct.area_sqm} sqm</span>
          </div>
          <div style="width: 90px;">
            <label style="font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 2px; color: var(--text-muted);">Rate (₹/unit)</label>
            <input type="number" class="struct-rate-input" value="${struct.rate}" style="width: 100%; padding: 0.35rem 0.5rem; font-size: 0.8rem; border-radius: 0.35rem; border: 1px solid var(--border-color); background-color: var(--bg-primary); color: var(--text-primary); text-align: right;">
          </div>
          <div style="width: 65px;">
            <label style="font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 2px; color: var(--text-muted);">Deduct %</label>
            <input type="number" class="struct-deduct-input" value="${struct.deduction_pct}" min="0" max="100" style="width: 100%; padding: 0.35rem 0.5rem; font-size: 0.8rem; border-radius: 0.35rem; border: 1px solid var(--border-color); background-color: var(--bg-primary); color: var(--text-primary); text-align: right;">
          </div>
          <div style="width: 100px; text-align: right;">
            <label style="font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 2px; color: var(--text-muted);">Total Cost</label>
            <span style="font-size: 0.82rem; font-weight: 700; color: var(--accent);" class="struct-cost-display">₹ ${formatIndianCurrency(struct.total_cost)}</span>
          </div>
          <div>
            <button type="button" class="btn-danger delete-structure-asset-btn" style="padding: 0.25rem 0.45rem; background-color: var(--text-muted);"><i data-lucide="minus" style="width: 12px; height: 12px;"></i></button>
          </div>
        `;
        structuresContainer.appendChild(card);

        // Bind structure card events
        const descInput = card.querySelector('.struct-desc-input');
        const catSelect = card.querySelector('.struct-cat-select');
        const lInput = card.querySelector('.struct-l-input');
        const bInput = card.querySelector('.struct-b-input');
        const rateInput = card.querySelector('.struct-rate-input');
        const deductInput = card.querySelector('.struct-deduct-input');

        const recalculateCard = () => {
          struct.description = descInput.value.trim();
          struct.length_ft = parseFloat(lInput.value) || 0;
          struct.breadth_ft = parseFloat(bInput.value) || 0;
          struct.deduction_pct = parseFloat(deductInput.value) || 0;
          struct.rate = parseFloat(rateInput.value) || 0;

          // Re-compute Area
          struct.area_sqft = parseFloat((struct.length_ft * struct.breadth_ft).toFixed(2));
          struct.area_sqm = parseFloat((struct.area_sqft * 0.092903).toFixed(2));

          card.querySelector('.struct-area-display').innerHTML = `${struct.area_sqft.toFixed(2)} sqf<br>${struct.area_sqm.toFixed(2)} sqm`;

          // Re-compute Cost
          const qty = (struct.category === 'Temporary Building' || struct.category === 'Temp Shed') ? struct.area_sqft : struct.area_sqm;
          const rawCost = qty * struct.rate;
          const deductAmount = rawCost * (struct.deduction_pct / 100);
          struct.total_cost = Math.round(rawCost - deductAmount);

          card.querySelector('.struct-cost-display').innerText = `₹ ${formatIndianCurrency(struct.total_cost)}`;

          revalidateRow(tr, owner, isDuplicate);
        };

        descInput.addEventListener('input', recalculateCard);
        lInput.addEventListener('input', recalculateCard);
        bInput.addEventListener('input', recalculateCard);
        rateInput.addEventListener('input', recalculateCard);
        deductInput.addEventListener('input', recalculateCard);

        catSelect.addEventListener('change', () => {
          struct.category = catSelect.value;
          // Assign default rate for selected category
          if (struct.category === 'RCC Structure') struct.rate = 20685.00;
          else if (struct.category === 'Assam Type Building') struct.rate = 15867.00;
          else if (struct.category === 'Temporary Building') struct.rate = 205.00;
          else if (struct.category === 'Temp Shed') struct.rate = 205.00;
          else if (struct.category === 'Commercial Building') struct.rate = 20685.00;

          rateInput.value = struct.rate;
          recalculateCard();
        });

        card.querySelector('.delete-structure-asset-btn').addEventListener('click', () => {
          owner.structures.splice(sIdx, 1);
          renderStructureCards();
        });
      });

      revalidateRow(tr, owner, isDuplicate);
      if (window.lucide) lucide.createIcons();
    }

    renderStructureCards();

    // Wire up Add structure button
    expTr.querySelector('.add-structure-asset-btn').addEventListener('click', () => {
      const nextIdx = owner.structures.length + 1;
      owner.structures.push({
        id: `STRUCT_${Date.now()}_${idx}_${nextIdx}`,
        description: `Structure ${nextIdx}`,
        category: 'Temporary Building',
        length_ft: 10,
        breadth_ft: 10,
        area_sqft: 100,
        area_sqm: 9.29,
        rate: 205.00,
        deduction_pct: 0,
        total_cost: 20500
      });
      renderStructureCards();
    });
  });

  if (window.lucide) lucide.createIcons();
  panel.style.display = 'block';
}

function revalidateRow(tr, owner, isDuplicate) {
  const needsReview = !owner.owner_name || !owner.village || owner.structures.length === 0 || owner.structures.some(s => s.length_ft === 0 || s.breadth_ft === 0);
  const badge = tr.querySelector('.status-badge');
  const actionSel = tr.querySelector('.duplicate-action-select');

  if (needsReview) {
    badge.innerText = 'Needs Review';
    badge.style.background = '#f59e0b';
    badge.style.color = '#fff';
  } else if (isDuplicate) {
    badge.innerText = 'Already Exists';
    badge.style.background = '#3b82f6';
    badge.style.color = '#fff';
  } else {
    badge.innerText = 'Ready';
    badge.style.background = '#22c55e';
    badge.style.color = '#fff';
  }
}

async function generateBulkEstimates() {
  const selectedProjId = document.getElementById('bulk-project-select').value;
  if (!selectedProjId) {
    alert('Please select a target project.');
    return;
  }

  const project = projects.find(p => p.id === selectedProjId);
  if (!project) {
    alert('Selected project does not exist.');
    return;
  }

  if (parsedBulkOwners.length === 0) {
    alert('No owners available to generate estimates.');
    return;
  }

  // Double check reviews
  const needsReviewCount = parsedBulkOwners.filter(owner => {
    return !owner.owner_name || !owner.village || owner.structures.length === 0 || owner.structures.some(s => s.length_ft === 0 || s.breadth_ft === 0);
  }).length;

  if (needsReviewCount > 0) {
    if (!confirm(`Warning: There are ${needsReviewCount} owner(s) that need review (missing names, villages, or structure dimensions). Do you want to proceed anyway? These records will be generated with partial details.`)) {
      return;
    }
  }

  const generateBtn = document.getElementById('bulk-generate-estimates-btn');
  const origText = generateBtn.innerHTML;
  generateBtn.disabled = true;
  generateBtn.innerHTML = '<i data-lucide="refresh-cw" class="spin"></i> Generating...';
  if (window.lucide) lucide.createIcons();

  try {
    let savedCount = 0;
    let skippedCount = 0;

    const bulkEnableDep = document.getElementById('bulk-enable-depreciation');
    const isDepreciated = bulkEnableDep ? bulkEnableDep.checked : true;

    const bulkEnableCP = document.getElementById('bulk-enable-contractor-profit');
    const deductCP = bulkEnableCP ? bulkEnableCP.checked : true;
    const tplSettings = getPdfTemplateSettings();
    const contractorPctValue = deductCP ? (tplSettings.contractorPct !== undefined ? tplSettings.contractorPct : 15) : 0;

    const bulkEnableJms = document.getElementById('bulk-enable-jms-sl');
    const isJmsEnabled = bulkEnableJms ? bulkEnableJms.checked : true;

    for (const owner of parsedBulkOwners) {
      if (owner.duplicateAction === 'skip') {
        skippedCount++;
        continue;
      }

      const needsReview = !owner.owner_name || !owner.village || owner.structures.length === 0 || owner.structures.some(s => s.length_ft === 0 || s.breadth_ft === 0);

      let entry = null;

      // Handle overwrite
      if (owner.duplicateAction === 'overwrite' && project.entries) {
        // Find existing match
        const match = project.entries.find(e => {
          const matchName = (e.clientName || '').toLowerCase().trim() === owner.owner_name.toLowerCase().trim();
          const locationStr = (e.location || '').toLowerCase().trim();
          const matchVillage = owner.village ? locationStr.includes(owner.village.toLowerCase().trim()) : false;
          const matchMouza = owner.mouza ? locationStr.includes(owner.mouza.toLowerCase().trim()) : false;
          return matchName && (matchVillage || matchMouza);
        });
        if (match) {
          entry = JSON.parse(JSON.stringify(match));
          entry.items = []; // reset structures for full re-creation
          entry.enableDepreciation = isDepreciated;
          entry.contractorPct = contractorPctValue;
          entry.status = needsReview ? 'needs-review' : 'draft';
        }
      }

      // Create new if not overwriting
      if (!entry) {
        entry = {
          id: 'OWNER_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          clientName: owner.owner_name,
          location: owner.village + (owner.mouza ? `, Mouza: ${owner.mouza}` : ''),
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
          enableDepreciation: isDepreciated,
          contractorPct: contractorPctValue,
          items: [],
          addElectrification: false,
          electrificationPct: 5,
          electrificationDeductPct: 0,
          electrificationCost: 0,
          addSanitary: false,
          sanitaryPct: 3,
          sanitaryDeductPct: 0,
          sanitaryCost: 0,
          sketcherData: [],
          status: needsReview ? 'needs-review' : 'draft',
          grandTotal: 0
        };
      }

      entry.jmsSlNo = (isJmsEnabled && owner.jms_sl_no) ? owner.jms_sl_no : '';

      // Populate structures as plinth-area items
      owner.structures.forEach((s, idx) => {
        const itemNo = (entry.items.length + 1).toString();
        
        let mappedCat = s.category;
        if (mappedCat === 'Temp Building') mappedCat = 'Temporary Building'; // standardize

        const plinthItem = {
          id: 'ITEM_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 5),
          itemNo: itemNo,
          title: mappedCat,
          description: 'Plinth area for building',
          type: 'plinth-area',
          quantity: (mappedCat === 'Temporary Building' || mappedCat === 'Temp Shed') ? s.area_sqft : s.area_sqm,
          unit: (mappedCat === 'Temporary Building' || mappedCat === 'Temp Shed') ? 'sqf' : 'sqm',
          rate: s.rate,
          totalCost: s.total_cost,
          includeInValuation: true,
          excludeFromDepreciation: false,
          customDepreciation: false,
          customDepreciationPct: 2.0,
          customDepreciationAge: 10,
          rooms: [
            {
              id: Date.now() + Math.random(),
              name: s.description || mappedCat,
              l: parseFloat((s.length_ft * 0.3048).toFixed(3)),
              w: parseFloat((s.breadth_ft * 0.3048).toFixed(3)),
              areaSqm: s.area_sqm
            }
          ],
          totalAreaSqm: s.area_sqm,
          totalAreaSqft: s.area_sqft,
          deductionPct: s.deduction_pct,
          deductionLabel: s.deduction_pct > 0 ? 'non conformity with CPWD norms' : '',
          deductionAmount: 0
        };

        // Re-compute to verify consistency
        const isSqf = plinthItem.unit === 'sqf';
        const qty = isSqf ? plinthItem.totalAreaSqft : plinthItem.totalAreaSqm;
        const rawCost = qty * plinthItem.rate;
        plinthItem.deductionAmount = Math.round(rawCost * (plinthItem.deductionPct / 100));
        plinthItem.totalCost = Math.round(rawCost - plinthItem.deductionAmount);

        entry.items.push(plinthItem);
      });

      // Auto-draw sketcher shapes
      const autoShapes = autoGenerateSketcherShapes(entry);
      entry.sketcherData = autoShapes;

      if (!sketcher) {
        sketcher = new SiteSketcher('sketcher-canvas');
        window.sketcher = sketcher;
      }
      if (sketcher) {
        sketcher.loadData(autoShapes);
        sketcher.fitToContent();
        entry.sketcherImage = sketcher.exportImage();
      }

      // Run Programmatic Valuation Calculations on Entry
      calculateBulkEntryTotals(entry);

      // Save Entry
      if (!project.entries) project.entries = [];
      const eIdx = project.entries.findIndex(e => e.id === entry.id);
      if (eIdx > -1) {
        project.entries[eIdx] = entry;
      } else {
        project.entries.push(entry);
      }

      project.entriesCount = project.entries.length;
      project.totalValuation = project.entries.reduce((acc, e) => acc + (e.grandTotal || 0), 0);

      // Cloud saves if online
      if (auth.currentUser) {
        await saveProjectEntry(project.id, entry);
      }
      
      savedCount++;
    }

    // Save project metadata
    if (auth.currentUser) {
      await saveUserProject(auth.currentUser.uid, project);
    }

    // Save local projects list
    const pIdx = projects.findIndex(p => p.id === project.id);
    if (pIdx > -1) {
      projects[pIdx] = project;
    }
    saveProjects();

    alert(`Estimates generation complete!\nSaved/Generated: ${savedCount}\nSkipped (Duplicates): ${skippedCount}`);

    // Clean up parsed list
    parsedBulkOwners = [];
    document.getElementById('bulk-preview-panel').style.display = 'none';

    // Switch view to projectDetails for selected project
    activeProject = project;
    switchView('projectDetails');

  } catch (err) {
    console.error('[AI Bulk Estimate] Generation failed:', err);
    alert('Failed to generate valuation estimates: ' + err.message);
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = origText;
    if (window.lucide) lucide.createIcons();
  }
}

function calculateBulkEntryTotals(entry) {
  if (!entry.items) entry.items = [];
  if (!entry.customServices) entry.customServices = [];

  const includedItems = entry.items.filter(i => i.includeInValuation);
  const mainDepreciatedItems = includedItems.filter(i => !i.excludeFromDepreciation && !i.customDepreciation);
  const customDepreciatedItems = includedItems.filter(i => !i.excludeFromDepreciation && i.customDepreciation);
  const excludedItems = includedItems.filter(i => i.excludeFromDepreciation);

  // 1. Calculate Main Depreciated totals
  const totalA = Math.round(mainDepreciatedItems.reduce((acc, curr) => acc + curr.totalCost, 0));
  entry.totalA = totalA;

  // Read contractor profit pct (standard is 15%)
  const contractorPct = entry.contractorPct !== undefined ? entry.contractorPct : 15;
  const contractorDeduction = Math.round(totalA * (contractorPct / 100));
  entry.contractorDeduction = contractorDeduction;

  const totalB = totalA - contractorDeduction;
  entry.totalB = totalB;

  const age = Math.max(0, entry.valuationYear - entry.constructionYear);
  entry.structureAge = age;
  
  const totalDepPct = entry.enableDepreciation ? (entry.depreciationPct * age) : 0;
  entry.totalDepreciationPct = totalDepPct;

  const depAmount = entry.enableDepreciation ? Math.round(totalB * (totalDepPct / 100)) : 0;
  entry.depreciationAmount = depAmount;

  const mainAfterDep = Math.max(0, totalB - depAmount);

  // 2. Calculate Custom Depreciated totals
  let totalCustomCostBeforeDep = 0;
  let totalCustomDepAmount = 0;
  
  customDepreciatedItems.forEach(item => {
    const rawCost = item.totalCost;
    const costAfterProfit = Math.round(rawCost * (1 - (contractorPct / 100))); 
    const itemDepPct = entry.enableDepreciation ? ((item.customDepreciationPct || 0) * (item.customDepreciationAge || 0)) : 0;
    const itemDepAmount = Math.round(costAfterProfit * (itemDepPct / 100));
    
    totalCustomCostBeforeDep += costAfterProfit;
    totalCustomDepAmount += itemDepAmount;
  });

  entry.totalAfterDepreciation = mainAfterDep + Math.max(0, totalCustomCostBeforeDep - totalCustomDepAmount);
  entry.depreciationAmount = depAmount + totalCustomDepAmount;

  const totalExcludedCost = Math.round(excludedItems.reduce((acc, curr) => acc + curr.totalCost, 0));
  entry.totalExcludedCost = totalExcludedCost;

  // Calculate building base for electrification/sanitary percentage
  const buildingTitles = ["RCC Structure", "Assam Type Building", "Temporary Building", "Temp Shed"];
  const buildingBase = Math.round(includedItems
    .filter(i => i.type === 'plinth-area' && buildingTitles.includes(i.title))
    .reduce((acc, curr) => acc + curr.totalCost, 0));
  entry.buildingBase = buildingBase;

  // Migrate legacy entries
  if (entry.electrificationPct === undefined) entry.electrificationPct = 5;
  if (entry.sanitaryPct === undefined) entry.sanitaryPct = 3;
  if (entry.electrificationDeductPct === undefined) entry.electrificationDeductPct = 0;
  if (entry.sanitaryDeductPct === undefined) entry.sanitaryDeductPct = 0;

  // Calculate electrification and sanitary costs as percentage of building base, with non-conformity deduction
  if (entry.addElectrification) {
    const elecGross = Math.round(buildingBase * (entry.electrificationPct / 100));
    const elecDeduct = Math.round(elecGross * (entry.electrificationDeductPct / 100));
    entry.electrificationCostGross = elecGross;
    entry.electrificationDeductAmt = elecDeduct;
    entry.electrificationCost = elecGross - elecDeduct;
  } else {
    entry.electrificationCostGross = 0;
    entry.electrificationDeductAmt = 0;
    entry.electrificationCost = 0;
  }
  if (entry.addSanitary) {
    const saniGross = Math.round(buildingBase * (entry.sanitaryPct / 100));
    const saniDeduct = Math.round(saniGross * (entry.sanitaryDeductPct / 100));
    entry.sanitaryCostGross = saniGross;
    entry.sanitaryDeductAmt = saniDeduct;
    entry.sanitaryCost = saniGross - saniDeduct;
  } else {
    entry.sanitaryCostGross = 0;
    entry.sanitaryDeductAmt = 0;
    entry.sanitaryCost = 0;
  }

  const customServicesSum = (entry.customServices || []).reduce((acc, curr) => acc + (curr.cost || 0), 0);
  let grandTotal = entry.totalAfterDepreciation + totalExcludedCost + customServicesSum;
  if (entry.addElectrification) grandTotal += entry.electrificationCost;
  if (entry.addSanitary) grandTotal += entry.sanitaryCost;
  entry.grandTotal = Math.round(grandTotal);
}

