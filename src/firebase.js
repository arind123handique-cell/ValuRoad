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
  getDocs,
  query,
  where
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
export async function fetchUserProjects(uid, email = "") {
  const projects = [];
  const projectIds = new Set();

  try {
    // 1. Fetch projects owned by the user in root collection
    const ownedQuery = query(collection(db, 'projects'), where('ownerId', '==', uid));
    const ownedSnapshot = await getDocs(ownedQuery);
    ownedSnapshot.forEach(doc => {
      projects.push({ id: doc.id, ...doc.data() });
      projectIds.add(doc.id);
    });

    // 2. Fetch projects shared with this user's email in root collection
    if (email) {
      const sharedQuery = query(collection(db, 'projects'), where('sharedWith', 'array-contains', email));
      const sharedSnapshot = await getDocs(sharedQuery);
      sharedSnapshot.forEach(doc => {
        if (!projectIds.has(doc.id)) {
          projects.push({ id: doc.id, ...doc.data() });
          projectIds.add(doc.id);
        }
      });
    }

    // 3. Fetch legacy user-isolated projects
    const legacyCol = collection(db, 'users', uid, 'projects');
    const legacySnapshot = await getDocs(legacyCol);
    legacySnapshot.forEach(doc => {
      if (!projectIds.has(doc.id)) {
        projects.push({ id: doc.id, ...doc.data() });
        projectIds.add(doc.id);
      }
    });
  } catch (err) {
    console.error("Error fetching projects:", err);
  }

  return projects;
}

export async function saveUserProject(uid, project) {
  if (!project.id) return;

  // Initialize sharing and ownership fields if not present
  if (!project.ownerId) {
    project.ownerId = uid;
  }
  if (!project.ownerEmail && auth.currentUser) {
    project.ownerEmail = auth.currentUser.email;
  }
  if (!project.sharedWith) {
    project.sharedWith = [];
  }

  // Save to the root 'projects' collection
  const projectDoc = doc(db, 'projects', String(project.id));
  await setDoc(projectDoc, project);

  // Clean up legacy document if it exists to complete migration
  try {
    const legacyDoc = doc(db, 'users', uid, 'projects', String(project.id));
    const legacySnap = await getDoc(legacyDoc);
    if (legacySnap.exists()) {
      await deleteDoc(legacyDoc);
      console.log(`Migrated legacy project ${project.id} to root collection.`);
    }
  } catch (err) {
    console.warn("Could not delete legacy project document:", err);
  }
}

export async function deleteUserProject(uid, projectId) {
  const rootDocRef = doc(db, 'projects', String(projectId));
  try {
    const rootSnap = await getDoc(rootDocRef);
    if (rootSnap.exists()) {
      const data = rootSnap.data();
      if (data.ownerId === uid) {
        // Owner deletes the document
        await deleteDoc(rootDocRef);
      } else if (data.sharedWith && auth.currentUser) {
        // Collaborator just removes themselves from shared list
        const updatedSharedWith = data.sharedWith.filter(email => email !== auth.currentUser.email);
        await setDoc(rootDocRef, { ...data, sharedWith: updatedSharedWith });
      }
    }
  } catch (err) {
    console.error("Error deleting root project:", err);
  }

  // Always attempt to delete legacy project for cleanup
  try {
    const legacyDoc = doc(db, 'users', uid, 'projects', String(projectId));
    await deleteDoc(legacyDoc);
  } catch (err) {
    // Ignore legacy delete failures
  }
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

export async function fetchProjectById(projectId) {
  try {
    const rootDocRef = doc(db, 'projects', String(projectId));
    const rootSnap = await getDoc(rootDocRef);
    if (rootSnap.exists()) {
      return { id: rootSnap.id, ...rootSnap.data() };
    }
  } catch (err) {
    console.error("Error fetching project by ID from Firestore:", err);
  }
  return null;
}
