import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Flat } from "../models/flat.model.js";
import mongoose from "mongoose";

const createFlat = asyncHandler(async (req, res) => {
  const { name, rent, address, settings } = req.body;
  const userId = req.user._id;

  if (!name || !name.trim()) {
    throw new ApiError(400, "Flat name is required");
  }

  if (!rent || rent <= 0) {
    throw new ApiError(400, "Flat rent is required and must be greater than 0");
  }

  const existingFlat = await Flat.findOne({
    admin: userId,
    status: "active",
  });

  if (existingFlat) {
    throw new ApiError(
      400,
      "You already have an active flat. You can only be admin of one flat at a time."
    );
  }

  const joinCode = await Flat.generateUniqueJoinCode();

  const flat = await Flat.create({
    name: name.trim(),
    rent: Number(rent),
    admin: userId,
    joinCode,
    address,
    settings: {
      currency: settings?.currency || "INR",
      timezone: settings?.timezone || "Asia/Kolkata",
      autoSplitExpenses:
        settings?.autoSplitExpenses !== undefined
          ? settings.autoSplitExpenses
          : true,
      requireApprovalForNewMembers:
        settings?.requireApprovalForNewMembers !== undefined
          ? settings.requireApprovalForNewMembers
          : false,
    },
    members: [
      {
        userId: userId,
        role: "admin",
        joinedAt: new Date(),
        status: "active",
        monthlyContribution: 0,
      },
    ],
  });

  const populatedFlat = await Flat.findById(flat._id)
    .populate("admin", "userName email")
    .populate("members.userId", "userName email");

  return res
    .status(201)
    .json(new ApiResponse(201, populatedFlat, "Flat created successfully"));
});

const joinFlat = asyncHandler(async (req, res) => {
  const { joinCode } = req.body;
  const userId = req.user._id;

  if (!joinCode || !joinCode.trim()) {
    throw new ApiError(400, "Join code is required");
  }

  const flat = await Flat.findByJoinCode(joinCode.trim());

  if (!flat) {
    throw new ApiError(
      404,
      "Invalid join code. Please check the code and try again."
    );
  }
  if (flat.isMember(userId)) {
    throw new ApiError(400, "You are already a member of this flat");
  }

  const adminFlat = await Flat.findOne({
    admin: userId,
    status: "active",
  });

  if (adminFlat) {
    throw new ApiError(
      400,
      "You cannot join another flat while being an admin of a flat"
    );
  }
  const memberFlat = await Flat.findOne({
    "members.userId": userId,
    "members.status": "active",
    status: "active",
  });

  if (memberFlat) {
    throw new ApiError(
      400,
      "You are already a member of another flat. Please leave that flat first."
    );
  }

  await flat.addMember(userId, "co_tenant", 0);

  const updatedFlat = await Flat.findById(flat._id)
    .populate("admin", "userName email")
    .populate("members.userId", "userName email");

  return res
    .status(200)
    .json(new ApiResponse(200, updatedFlat, "Successfully joined the flat"));
});

const getUserFlat = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  console.log("🔍 getUserFlat called for userId:", userId);

  const flat = await Flat.findOne({
    $or: [
      { admin: userId },
      { "members.userId": userId, "members.status": "active" },
    ],
    status: "active",
  })
    .populate("admin", "userName email")
    .populate("members.userId", "userName email");

  if (!flat) {
    console.log("❌ No active flat found for userId:", userId);
    return res
      .status(200)
      .json(new ApiResponse(200, null, "No active flat found"));
  }

  console.log("✅ Flat found:", flat._id, "for userId:", userId);
  console.log("   Admin:", flat.admin._id);
  console.log(
    "   Members:",
    flat.members.map((m) => ({
      id: m.userId._id,
      status: m.status,
      role: m.role,
    }))
  );

  const userMember = flat.getMember(userId);
  const flatData = {
    ...flat.toObject(),
    userRole: userMember?.role || (flat.isAdmin(userId) ? "admin" : null),
    userContribution: userMember?.monthlyContribution || 0,
  };

  console.log("   User role:", flatData.userRole);

  return res
    .status(200)
    .json(new ApiResponse(200, flatData, "Flat details fetched successfully"));
});

const getFlatByJoinCode = asyncHandler(async (req, res) => {
  const { joinCode } = req.params;

  if (!joinCode) {
    throw new ApiError(400, "Join code is required");
  }

  const flat = await Flat.findByJoinCode(joinCode).select(
    "name admin members.userId joinCode stats createdAt"
  );

  if (!flat) {
    throw new ApiError(404, "Invalid join code");
  }

  const flatInfo = {
    name: flat.name,
    adminName: flat.admin?.userName,
    memberCount: flat.stats.totalMembers,
    joinCode: flat.joinCode,
    createdAt: flat.createdAt,
  };

  return res
    .status(200)
    .json(
      new ApiResponse(200, flatInfo, "Flat information fetched successfully")
    );
});

const updateFlat = asyncHandler(async (req, res) => {
  const { flatId } = req.params;
  const { name, address, settings, monthlyBudget, rent } = req.body;
  const userId = req.user._id;

  console.log('📝 updateFlat called with:', { flatId, name, address, settings, monthlyBudget, rent });

  if (!mongoose.Types.ObjectId.isValid(flatId)) {
    throw new ApiError(400, "Invalid flat ID");
  }

  const flat = await Flat.findById(flatId);

  if (!flat) {
    throw new ApiError(404, "Flat not found");
  }

  if (!flat.isAdmin(userId)) {
    throw new ApiError(403, "Only flat admin can update flat details");
  }

  // Update fields if provided
  if (name) flat.name = name.trim();
  if (address) flat.address = { ...flat.address, ...address };
  if (settings) flat.settings = { ...flat.settings, ...settings };
  if (monthlyBudget !== undefined) flat.monthlyBudget = Number(monthlyBudget);
  if (rent !== undefined) flat.rent = Number(rent);

  await flat.save();

  const updatedFlat = await Flat.findById(flat._id)
    .populate("admin", "userName email")
    .populate("members.userId", "userName email");

  console.log('✅ Flat updated successfully:', updatedFlat.monthlyBudget);

  return res
    .status(200)
    .json(new ApiResponse(200, updatedFlat, "Flat updated successfully"));
});


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

  if (!flat.isMember(userId)) {
    throw new ApiError(400, "You are not a member of this flat");
  }

  if (flat.isAdmin(userId)) {
    throw new ApiError(
      400,
      "Admin cannot leave the flat. Please transfer admin rights first or delete the flat."
    );
  }

  await flat.removeMember(userId);

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Successfully left the flat"));
});

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

  if (!flat.isAdmin(userId)) {
    throw new ApiError(403, "Only flat admin can delete the flat");
  }

  flat.status = "archived";
  await flat.save();

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Flat deleted successfully"));
});

const getFlatMembers = asyncHandler(async (req, res) => {
  const { flatId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(flatId)) {
    throw new ApiError(400, "Invalid flat ID");
  }

  const flat = await Flat.findById(flatId)
    .populate("admin", "userName email")
    .populate("members.userId", "userName email");

  if (!flat) {
    throw new ApiError(404, "Flat not found");
  }

  console.log("📋 getFlatMembers Debug:");
  console.log("   Requested by userId:", userId.toString());
  console.log("   Flat admin:", flat.admin._id.toString());
  console.log(
    "   Flat members:",
    flat.members.map((m) => ({
      id: m.userId._id.toString(),
      status: m.status,
      role: m.role,
    }))
  );


  const isAdmin = flat.admin._id.toString() === userId.toString();
  const isMember = flat.members.some(
    (member) =>
      member.userId._id.toString() === userId.toString() &&
      member.status === "active"
  );

  console.log("   isAdmin:", isAdmin);
  console.log("   isMember:", isMember);

  if (!isAdmin && !isMember) {
    console.log("❌ Access denied - userId:", userId, "flatId:", flatId);
    throw new ApiError(403, "You don't have access to this flat");
  }

  const members = flat.getActiveMembers().map((member) => ({
    _id: member.userId._id,
    name: member.userId.userName,
    email: member.userId.email,
    role: member.role,
    monthlyContribution: member.monthlyContribution,
    joinedAt: member.joinedAt,
    status: member.status,
  }));

  console.log("✅ Members fetched successfully");

  return res
    .status(200)
    .json(new ApiResponse(200, members, "Flat members fetched successfully"));
});

// Generate invite link
const generateInviteLink = asyncHandler(async (req, res) => {
  const { flatId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(flatId)) {
    throw new ApiError(400, "Invalid flat ID");
  }

  const flat = await Flat.findById(flatId);

  if (!flat) {
    throw new ApiError(404, "Flat not found");
  }

  if (!flat.isAdmin(userId)) {
    throw new ApiError(403, "Only flat admin can generate invite link");
  }

  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const inviteLink = `${baseUrl}/join-flat?code=${flat.joinCode}`;

  return res.status(200).json(
    new ApiResponse(200, {
      joinCode: flat.joinCode,
      inviteLink,
      flatName: flat.name
    }, "Invite link generated successfully")
  );
});

// Remove member (admin only)
const removeMember = asyncHandler(async (req, res) => {
  const { flatId, memberId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(flatId) || !mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid flat ID or member ID");
  }

  const flat = await Flat.findById(flatId);

  if (!flat) {
    throw new ApiError(404, "Flat not found");
  }

  if (!flat.isAdmin(userId)) {
    throw new ApiError(403, "Only flat admin can remove members");
  }

  if (flat.admin.toString() === memberId) {
    throw new ApiError(400, "Cannot remove flat admin");
  }

  await flat.removeMember(memberId);

  const updatedFlat = await Flat.findById(flat._id)
    .populate("admin", "userName email")
    .populate("members.userId", "userName email");

  return res
    .status(200)
    .json(new ApiResponse(200, updatedFlat, "Member removed successfully"));
});

// Transfer admin rights
const transferAdmin = asyncHandler(async (req, res) => {
  const { flatId } = req.params;
  const { newAdminId } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(flatId) || !mongoose.Types.ObjectId.isValid(newAdminId)) {
    throw new ApiError(400, "Invalid flat ID or user ID");
  }

  const flat = await Flat.findById(flatId);

  if (!flat) {
    throw new ApiError(404, "Flat not found");
  }

  if (!flat.isAdmin(userId)) {
    throw new ApiError(403, "Only flat admin can transfer admin rights");
  }

  if (!flat.isMember(newAdminId) && flat.admin.toString() !== newAdminId) {
    throw new ApiError(400, "New admin must be a member of the flat");
  }

  // Update old admin to member
  const oldAdminMember = flat.getMember(userId);
  if (oldAdminMember) {
    oldAdminMember.role = 'co_tenant';
  } else {
    // Add old admin as member if not already
    flat.members.push({
      userId: userId,
      role: 'co_tenant',
      joinedAt: new Date(),
      status: 'active',
      monthlyContribution: 0
    });
  }

  // Update new admin
  const newAdminMember = flat.getMember(newAdminId);
  if (newAdminMember) {
    newAdminMember.role = 'admin';
  }

  flat.admin = newAdminId;
  await flat.save();

  const updatedFlat = await Flat.findById(flat._id)
    .populate("admin", "userName email")
    .populate("members.userId", "userName email");

  return res
    .status(200)
    .json(new ApiResponse(200, updatedFlat, "Admin rights transferred successfully"));
});

// Update member role
const updateMemberRole = asyncHandler(async (req, res) => {
  const { flatId, memberId } = req.params;
  const { role } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(flatId) || !mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid flat ID or member ID");
  }

  const flat = await Flat.findById(flatId);

  if (!flat) {
    throw new ApiError(404, "Flat not found");
  }

  if (!flat.isAdmin(userId)) {
    throw new ApiError(403, "Only flat admin can update member roles");
  }

  if (!['co_tenant', 'subtenant', 'guest'].includes(role)) {
    throw new ApiError(400, "Invalid role");
  }

  await flat.updateMemberRole(memberId, role);

  const updatedFlat = await Flat.findById(flat._id)
    .populate("admin", "userName email")
    .populate("members.userId", "userName email");

  return res
    .status(200)
    .json(new ApiResponse(200, updatedFlat, "Member role updated successfully"));
});

export {
  createFlat,
  joinFlat,
  getUserFlat,
  getFlatByJoinCode,
  updateFlat,
  leaveFlat,
  deleteFlat,
  getFlatMembers,
  generateInviteLink,
  removeMember,
  transferAdmin,
  updateMemberRole
};
