import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
    apiKey: "AIzaSyDYtaWg0QdpuG_aAcGe2KrPpc3fhxmoKp4",
    authDomain: "okulsporlari-6db6e.firebaseapp.com",
    databaseURL: "https://okulsporlari-6db6e-default-rtdb.firebaseio.com",
    projectId: "okulsporlari-6db6e",
    storageBucket: "okulsporlari-6db6e.appspot.com",
    messagingSenderId: "44512640585",
    appId: "1:44512640585:web:35e7f9039744567c13c998",
    measurementId: "G-CP31TFRNTJ"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
