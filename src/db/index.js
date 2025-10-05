import mongoose from "mongoose";

const connectDB = async () => {
    try {
        console.log('🔄 Attempting to connect to MongoDB...');
        console.log('📍 MongoDB URI:', process.env.MONGODB_URI?.replace(/\/\/.*:.*@/, '//***:***@'));
        
        const connectionInstance = await mongoose.connect(`${process.env.MONGODB_URI}`, {
            // Connection options for better stability
            serverSelectionTimeoutMS: 10000, // 10 seconds
            socketTimeoutMS: 45000, // 45 seconds
            maxPoolSize: 10,
            retryWrites: true,
            w: 'majority'
        });
        
        console.log(`✅ MongoDB connected successfully!`);
        console.log(`🏠 DB HOST: ${connectionInstance.connection.host}`);
        console.log(`📁 DB NAME: ${connectionInstance.connection.name}`);
        
        // Handle connection events
        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
        });
        
        mongoose.connection.on('disconnected', () => {
            console.log('⚠️ MongoDB disconnected');
        });
        
        mongoose.connection.on('reconnected', () => {
            console.log('🔄 MongoDB reconnected');
        });
        
    } catch (error) {
        console.error("❌ MONGODB connection FAILED");
        console.error("Error details:", error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('📝 Troubleshooting steps:');
            console.log('1. Check internet connection');
            console.log('2. Verify MongoDB Atlas cluster is running');
            console.log('3. Check IP whitelist in MongoDB Atlas');
            console.log('4. Verify connection string format');
        }
        
        process.exit(1);
    }
}

export default connectDB;