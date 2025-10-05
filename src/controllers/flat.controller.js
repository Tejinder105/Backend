import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Flat } from "../models/flat.model.js";
import { User } from "../models/user.model.js";
import { Flatmate } from "../models/flatmate.model.js";
import mongoose from "mongoose";
import crypto from "crypto";

// Create a new flat
const createFlat = asyncHandler(async (req, res) => {
    const { name, address, settings } = req.body;
    const userId = req.user._id;

    // Validation
    if (!name || !name.trim()) {
        throw new ApiError(400, "Flat name is required");
    }

    // Check if user already has an active flat as admin
    const existingFlat = await Flat.findOne({
        admin: userId,
        status: 'active'
    });

    if (existingFlat) {
        throw new ApiError(400, "You already have an active flat. You can only be admin of one flat at a time.");
    }

    // Generate unique join code
    const joinCode = await Flat.generateUniqueJoinCode();

    // Create flat
    const flat = await Flat.create({
        name: name.trim(),
        admin: userId,
        joinCode,
        address,
        settings: {
            ...settings,
            currency: settings?.currency || 'INR',
            timezone: settings?.timezone || 'Asia/Kolkata'
        },
        members: [{
            userId: userId,
            role: 'admin',
            joinedAt: new Date(),
            status: 'active',
            monthlyContribution: 0
        }]
    });

    // Populate the flat with user details
    const populatedFlat = await Flat.findById(flat._id)
        .populate('admin', 'userName email')
        .populate('members.userId', 'userName email');

    return res.status(201).json(
        new ApiResponse(201, populatedFlat, "Flat created successfully")
    );
});

// Join flat using join code
const joinFlat = asyncHandler(async (req, res) => {
    const { joinCode } = req.body;
    const userId = req.user._id;

    if (!joinCode || !joinCode.trim()) {
        throw new ApiError(400, "Join code is required");
    }

    // Find flat by join code
    const flat = await Flat.findByJoinCode(joinCode.trim());

    if (!flat) {
        throw new ApiError(404, "Invalid join code. Please check the code and try again.");
    }

    // Check if user is already a member
    if (flat.isMember(userId)) {
        throw new ApiError(400, "You are already a member of this flat");
    }

    // Check if user is admin of another flat
    const adminFlat = await Flat.findOne({
        admin: userId,
        status: 'active'
    });

    if (adminFlat) {
        throw new ApiError(400, "You cannot join another flat while being an admin of a flat");
    }

    // Check if user is already a member of another active flat
    const memberFlat = await Flat.findOne({
        'members.userId': userId,
        'members.status': 'active',
        status: 'active'
    });

    if (memberFlat) {
        throw new ApiError(400, "You are already a member of another flat. Please leave that flat first.");
    }

    // Add user to flat
    await flat.addMember(userId, 'co_tenant', 0);

    // Populate the updated flat
    const updatedFlat = await Flat.findById(flat._id)
        .populate('admin', 'userName email')
        .populate('members.userId', 'userName email');

    return res.status(200).json(
        new ApiResponse(200, updatedFlat, "Successfully joined the flat")
    );
});

// Get user's current flat
const getUserFlat = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Find user's active flat
    const flat = await Flat.findOne({
        $or: [
            { admin: userId },
            { 'members.userId': userId, 'members.status': 'active' }
        ],
        status: 'active'
    })
    .populate('admin', 'userName email')
    .populate('members.userId', 'userName email');

    if (!flat) {
        return res.status(200).json(
            new ApiResponse(200, null, "No active flat found")
        );
    }

    // Add user's role and contribution to response
    const userMember = flat.getMember(userId);
    const flatData = {
        ...flat.toObject(),
        userRole: userMember?.role || (flat.isAdmin(userId) ? 'admin' : null),
        userContribution: userMember?.monthlyContribution || 0
    };

    return res.status(200).json(
        new ApiResponse(200, flatData, "Flat details fetched successfully")
    );
});

// Get flat by join code (public endpoint for preview)
const getFlatByJoinCode = asyncHandler(async (req, res) => {
    const { joinCode } = req.params;

    if (!joinCode) {
        throw new ApiError(400, "Join code is required");
    }

    const flat = await Flat.findByJoinCode(joinCode)
        .select('name admin members.userId joinCode stats createdAt');

    if (!flat) {
        throw new ApiError(404, "Invalid join code");
    }

    // Return basic flat info (no sensitive data)
    const flatInfo = {
        name: flat.name,
        adminName: flat.admin?.userName,
        memberCount: flat.stats.totalMembers,
        joinCode: flat.joinCode,
        createdAt: flat.createdAt
    };

    return res.status(200).json(
        new ApiResponse(200, flatInfo, "Flat information fetched successfully")
    );
});

// Update flat details (admin only)
const updateFlat = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { name, address, settings } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(flatId)) {
        throw new ApiError(400, "Invalid flat ID");
    }

    const flat = await Flat.findById(flatId);

    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    // Check if user is admin
    if (!flat.isAdmin(userId)) {
        throw new ApiError(403, "Only flat admin can update flat details");
    }

    // Update flat details
    if (name) flat.name = name.trim();
    if (address) flat.address = { ...flat.address, ...address };
    if (settings) flat.settings = { ...flat.settings, ...settings };

    await flat.save();

    const updatedFlat = await Flat.findById(flat._id)
        .populate('admin', 'userName email')
        .populate('members.userId', 'userName email');

    return res.status(200).json(
        new ApiResponse(200, updatedFlat, "Flat updated successfully")
    );
});

// Invitation functionality removed - only join codes are supported

// Leave flat
const leaveFlat = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(flatId)) {
        throw new ApiError(400, "Invalid flat ID");
    }

    const flat = await Flat.findById(flatId);

    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    // Check if user is a member
    if (!flat.isMember(userId)) {
        throw new ApiError(400, "You are not a member of this flat");
    }

    // Admin cannot leave flat (must transfer admin first)
    if (flat.isAdmin(userId)) {
        throw new ApiError(400, "Admin cannot leave the flat. Please transfer admin rights first or delete the flat.");
    }

    // Remove user from flat
    await flat.removeMember(userId);

    return res.status(200).json(
        new ApiResponse(200, {}, "Successfully left the flat")
    );
});

// Delete flat (admin only)
const deleteFlat = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(flatId)) {
        throw new ApiError(400, "Invalid flat ID");
    }

    const flat = await Flat.findById(flatId);

    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    // Check if user is admin
    if (!flat.isAdmin(userId)) {
        throw new ApiError(403, "Only flat admin can delete the flat");
    }

    // Mark as archived instead of deleting
    flat.status = 'archived';
    await flat.save();

    return res.status(200).json(
        new ApiResponse(200, {}, "Flat deleted successfully")
    );
});

// Get flat members (for admin)
const getFlatMembers = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(flatId)) {
        throw new ApiError(400, "Invalid flat ID");
    }

    const flat = await Flat.findById(flatId)
        .populate('admin', 'userName email')
        .populate('members.userId', 'userName email');

    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    // Check if user is a member
    if (!flat.isMember(userId) && !flat.isAdmin(userId)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    const members = flat.getActiveMembers().map(member => ({
        _id: member.userId._id,
        name: member.userId.userName,
        email: member.userId.email,
        role: member.role,
        monthlyContribution: member.monthlyContribution,
        joinedAt: member.joinedAt,
        status: member.status
    }));

    return res.status(200).json(
        new ApiResponse(200, members, "Flat members fetched successfully")
    );
});

export {
    createFlat,
    joinFlat,
    getUserFlat,
    getFlatByJoinCode,
    updateFlat,
    leaveFlat,
    deleteFlat,
    getFlatMembers
};