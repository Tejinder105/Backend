// MongoDB Connection Test
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const testConnection = async () => {
  try {
    console.log('Testing MongoDB connection...');
    console.log('MongoDB URI:', process.env.MONGODB_URI);
    
    const connectionInstance = await mongoose.connect(process.env.MONGODB_URI, {
      // Additional connection options
      serverSelectionTimeoutMS: 10000, // 10 seconds
      socketTimeoutMS: 45000, // 45 seconds
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority'
    });
    
    console.log('✅ MongoDB connected successfully!');
    console.log('DB HOST:', connectionInstance.connection.host);
    console.log('DB NAME:', connectionInstance.connection.name);
    
    // Test a simple query
    const admin = mongoose.connection.db.admin();
    const result = await admin.ping();
    console.log('✅ Ping successful:', result);
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('📝 Possible solutions:');
      console.log('1. Check if your internet connection is working');
      console.log('2. Verify MongoDB Atlas cluster is running');
      console.log('3. Check if your IP address is whitelisted in MongoDB Atlas');
      console.log('4. Verify the connection string is correct');
    }
    
    process.exit(1);
  }
};

testConnection();