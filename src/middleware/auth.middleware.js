import { ApiError } from "../Utils/ApiError.js";
import { asyncHandler } from "../Utils/asyncHandler.js";
import jwt from "jsonwebtoken"
import { User } from "../models/user.model.js";

export const verifyJWT = asyncHandler(async(req, _, next) => {
    try {
        const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "")
        
        if (!token) {
            console.log("❌ No token provided");
            throw new ApiError(401, "Unauthorized request")
        }
    
        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
    
        const user = await User.findById(decodedToken?._id).select("-password -refreshToken")
    
        if (!user) {
            console.log("❌ User not found for token");
            throw new ApiError(401, "Invalid Access Token")
        }
    
        req.user = user;
        next()
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            console.log("❌ Token has expired");
            throw new ApiError(401, "Access token has expired. Please login again.")
        }
        if (error.name === 'JsonWebTokenError') {
            console.log("❌ Invalid token format");
            throw new ApiError(401, "Invalid access token")
        }
        console.log("❌ Auth error:", error.message);
        throw new ApiError(401, error?.message || "Invalid access token")
    }
    
})