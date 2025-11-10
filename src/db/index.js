import mongoose from "mongoose";

const connectDB = async () => {
    try {
        console.log('MongoDB URI:', process.env.MONGODB_URI);
        
        const connectionInstance = await mongoose.connect(`${process.env.MONGODB_URI}`, {
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000, 
            maxPoolSize: 10,
            retryWrites: true,
            w: 'majority'
        });
        
        
        mongoose.connection.on('error', (err) => {
            console.error(' MongoDB connection error:', err);
        });
        
        mongoose.connection.on('disconnected', () => {
            console.log(' MongoDB disconnected');
        });
        
        mongoose.connection.on('reconnected', () => {
            console.log('MongoDB reconnected');
        });
        
    } catch (error) {
        console.error("MONGODB connection FAILED");
        console.error("Error details:", error.message);
        
        process.exit(1);
    }
}

export default connectDB;