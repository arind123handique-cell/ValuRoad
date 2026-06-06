import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  collection, 
  getDocs 
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCy0Ag2-KyNxX0NymeReKLctiw71RYql1k",
  authDomain: "road-val-v9zgrb.firebaseapp.com",
  projectId: "road-val-v9zgrb",
  storageBucket: "road-val-v9zgrb.firebasestorage.app",
  messagingSenderId: "41687836536",
  appId: "1:41687836536:web:e79a5be2d06499ea8e0a8d",
  measurementId: "G-4HXCDLC56M"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Authentication Helpers
export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function registerUser(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function logoutUser() {
  return signOut(auth);
}

export { onAuthStateChanged };

// Firestore Database Sync Helpers
export async function fetchUserProjects(uid) {
  const projectsCol = collection(db, 'users', uid, 'projects');
  const snapshot = await getDocs(projectsCol);
  const projects = [];
  snapshot.forEach(doc => {
    projects.push({ id: doc.id, ...doc.data() });
  });
  return projects;
}

export async function saveUserProject(uid, project) {
  if (!project.id) return;
  const projectDoc = doc(db, 'users', uid, 'projects', String(project.id));
  await setDoc(projectDoc, project);
}

export async function deleteUserProject(uid, projectId) {
  const projectDoc = doc(db, 'users', uid, 'projects', String(projectId));
  await deleteDoc(projectDoc);
}

export async function fetchUserCustomDsr(uid) {
  const dsrDoc = doc(db, 'users', uid, 'settings', 'dsr_catalog');
  const snapshot = await getDoc(dsrDoc);
  if (snapshot.exists()) {
    return snapshot.data().items || [];
  }
  return [];
}

export async function saveUserCustomDsr(uid, items) {
  const dsrDoc = doc(db, 'users', uid, 'settings', 'dsr_catalog');
  await setDoc(dsrDoc, { items });
}

export async function fetchUserPdfTemplate(uid) {
  const tplDoc = doc(db, 'users', uid, 'settings', 'pdf_template');
  const snapshot = await getDoc(tplDoc);
  if (snapshot.exists()) {
    return snapshot.data();
  }
  return null;
}

export async function saveUserPdfTemplate(uid, settings) {
  const tplDoc = doc(db, 'users', uid, 'settings', 'pdf_template');
  await setDoc(tplDoc, settings);
}
