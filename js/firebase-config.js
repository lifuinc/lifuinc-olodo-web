// Firebase v10 Modular SDK configuration for Olodo Lecturer & Admin Portal
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc,
  query, 
  where, 
  serverTimestamp,
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDvg1dvECrhDVjdR4aHlh8NoTuQzuBZFbo",
  authDomain: "brainsquard-studio-b458b.firebaseapp.com",
  projectId: "brainsquard-studio-b458b",
  storageBucket: "brainsquard-studio-b458b.appspot.com",
  messagingSenderId: "276143195820",
  appId: "1:276143195820:android:be4fac138ec724de508109"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
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
  deleteDoc,
  query,
  where,
  serverTimestamp,
  onSnapshot
};
