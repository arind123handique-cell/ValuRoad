import { initializeApp } from "firebase/app";
import { initializeFirestore, collection, getDocs, collectionGroup } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
});

async function scan() {
  console.log("Scanning Firestore for projects...");
  
  // Scan all project collections (both root and legacy user-private)
  try {
    const projectsGroup = collectionGroup(db, 'projects');
    const snapshot = await getDocs(projectsGroup);
    console.log(`\n--- All 'projects' Collections (${snapshot.size} docs found) ---`);
    snapshot.forEach(doc => {
      const data = doc.data();
      const entriesCount = data.entries ? data.entries.length : 0;
      console.log(`Doc Path: ${doc.ref.path}`);
      console.log(`  Work Name: ${data.workName}`);
      console.log(`  Owner: ${data.ownerEmail}`);
      console.log(`  Entries count: ${entriesCount}`);
      if (data.entries) {
        console.log(`  Entries: ${data.entries.map(e => e.clientName).join(', ')}`);
      }
    });
  } catch (err) {
    console.error("Error scanning project collection group:", err);
  }
}

scan().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
