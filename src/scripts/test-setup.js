import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create public/temp directory if it doesn't exist
const tempDir = path.join(__dirname, '..', 'public', 'temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log('✅ Created public/temp directory for file uploads');
} else {
  console.log('✅ public/temp directory already exists');
}

// Test backend health
const testBackend = async () => {
  try {
    const response = await fetch('http://localhost:8000/health');
    const data = await response.json();
    
    if (data.status === 'ok') {
      console.log('✅ Backend health check passed');
      console.log('   Server is running and accepting requests');
    } else {
      console.log('❌ Backend returned unexpected response:', data);
    }
  } catch (error) {
    console.log('❌ Backend health check failed:', error.message);
    console.log('   Make sure backend is running: npm start');
  }
};

// Run tests
console.log('🔍 Running backend setup checks...\n');
await testBackend();
