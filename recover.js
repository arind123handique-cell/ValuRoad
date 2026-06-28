import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, collectionGroup } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCy0Ag2-KyNxX0NymeReKLctiw71RYql1k",
  authDomain: "road-val-v9zgrb.firebaseapp.com",
  databaseURL: "https://road-val-v9zgrb-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "road-val-v9zgrb",
  storageBucket: "road-val-v9zgrb.firebasestorage.app",
  messagingSenderId: "41687836536",
  appId: "1:41687836536:web:e79a5be2d06499ea8e0a8d",
  measurementId: "G-4HXCDLC56M"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
