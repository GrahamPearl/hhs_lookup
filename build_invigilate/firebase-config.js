/**
 * FIREBASE CONFIGURATION
 * 
 * To enable Firebase cloud storage:
 * 1. Create a Firebase project at https://console.firebase.google.com
 * 2. Get your config values from Project Settings
 * 3. Replace the placeholder values below
 * 4. Include this file in index.html AFTER Firebase SDKs are loaded
 * 
 * Example in index.html:
 * <script src="firebase-config.js"></script>
 */

// REPLACE WITH YOUR FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

/**
 * Initialize Firebase when document is ready
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Only initialize if config is not placeholder
    if (firebaseConfig.projectId !== 'your-project-id') {
        console.log('Initializing Firebase...');
        const result = await app.initializeFirebase(firebaseConfig);
        
        if (result) {
            console.log('Firebase ready for online/offline storage');
            document.getElementById('connection-status').innerHTML = '<span>✓ Firebase Connected</span>';
        }
    } else {
        console.log('Firebase config not set - using localStorage only');
    }
});
