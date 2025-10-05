import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Flatmate } from "../models/flatmate.model.js";
import { User } from "../models/user.model.js";
import smsService from "../services/smsService.js";
import mongoose from "mongoose";

// Get all flatmates
const getAllFlatmates = asyncHandler(async (req, res) => {
    const { status } = req.query;
    
    const filter = {};
    if (status) filter.status = status;

    const flatmates = await Flatmate.find(filter)
        .populate('userId', 'userName email')
        .sort({ joinedAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, flatmates, "Flatmates fetched successfully")
    );
});

// Get active flatmates only
const getActiveFlatmates = asyncHandler(async (req, res) => {
    const flatmates = await Flatmate.find({ status: 'active' })
        .populate('userId', 'userName email')
        .sort({ joinedAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, flatmates, "Active flatmates fetched successfully")
    );
});

// Add a new flatmate with invitation
const addFlatmate = asyncHandler(async (req, res) => {
    const {
        name,
        email,
        role = 'co_tenant',
        monthlyContribution,
        contactNumber,
        emergencyContact,
        sendInvitation = true
    } = req.body;

    // Validation
    if (!name || !email || !monthlyContribution || !contactNumber) {
        throw new ApiError(400, "Name, email, contact number, and monthly contribution are required");
    }

    if (monthlyContribution < 0) {
        throw new ApiError(400, "Monthly contribution cannot be negative");
    }

    // Check if user exists
    let user = await User.findOne({ email: email.toLowerCase() });
    
    // If user doesn't exist, create a basic user record
    if (!user) {
        // Generate a random password for new users
        const tempPassword = Math.random().toString(36).slice(-8);
        
        user = await User.create({
            userName: name.toLowerCase().replace(/\s+/g, '_'),
            email: email.toLowerCase(),
            password: tempPassword // In real app, you'd want to send invitation email
        });
    }

    // Check if flatmate already exists
    const existingFlatmate = await Flatmate.findOne({ userId: user._id });
    if (existingFlatmate) {
        throw new ApiError(400, "This user is already a flatmate");
    }

    // Create flatmate
    const flatmate = await Flatmate.create({
        userId: user._id,
        name,
        email: email.toLowerCase(),
        role,
        monthlyContribution,
        contactNumber,
        emergencyContact
    });

    let invitationData = null;
    let smsResult = null;

    // Create invitation and send SMS if requested
    if (sendInvitation) {
        try {
            // Generate invitation token and link
            const invitationToken = smsService.generateInvitationToken();
            const invitationLink = smsService.createInvitationLink(invitationToken);

            // Create invitation record
            const invitation = await Invitation.create({
                token: invitationToken,
                invitedBy: req.user._id,
                inviteeName: name,
                inviteeEmail: email.toLowerCase(),
                inviteePhone: contactNumber,
                role,
                monthlyContribution,
                emergencyContact,
                invitationLink
            });

            invitationData = {
                token: invitation.token,
                link: invitation.invitationLink,
                expiresAt: invitation.expiresAt
            };

            // Send SMS invitation
            const inviterUser = await User.findById(req.user._id);
            smsResult = await smsService.sendInvitationSMS(
                contactNumber,
                name,
                inviterUser.userName,
                invitationLink
            );

            // Update invitation with SMS status
            invitation.smsSent = smsResult.success;
            if (smsResult.success) {
                invitation.smsStatus = {
                    messageSid: smsResult.messageSid,
                    sentAt: new Date()
                };
            } else {
                invitation.smsStatus = {
                    error: smsResult.error || smsResult.message,
                    sentAt: new Date()
                };
            }
            await invitation.save();

        } catch (invitationError) {
            console.error('Invitation creation failed:', invitationError);
            // Don't fail the entire request if invitation fails
            smsResult = {
                success: false,
                message: 'Failed to create invitation'
            };
        }
    }

    const populatedFlatmate = await Flatmate.findById(flatmate._id)
        .populate('userId', 'userName email');

    const response = {
        flatmate: populatedFlatmate,
        invitation: invitationData,
        sms: smsResult
    };

    return res.status(201).json(
        new ApiResponse(201, response, 
            smsResult && smsResult.success 
                ? "Flatmate added and invitation SMS sent successfully"
                : "Flatmate added successfully"
        )
    );
});

// Update flatmate information
const updateFlatmate = asyncHandler(async (req, res) => {
    const { flatmateId } = req.params;
    const updates = req.body;

    if (!flatmateId) {
        throw new ApiError(400, "Flatmate ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(flatmateId)) {
        throw new ApiError(400, "Invalid flatmate ID");
    }

    const flatmate = await Flatmate.findById(flatmateId);

    if (!flatmate) {
        throw new ApiError(404, "Flatmate not found");
    }

    // Prevent changing userId
    if (updates.userId) {
        delete updates.userId;
    }

    const updatedFlatmate = await Flatmate.findByIdAndUpdate(
        flatmateId,
        { $set: updates },
        { new: true, runValidators: true }
    ).populate('userId', 'userName email');

    return res.status(200).json(
        new ApiResponse(200, updatedFlatmate, "Flatmate updated successfully")
    );
});

// Remove flatmate (mark as inactive)
const removeFlatmate = asyncHandler(async (req, res) => {
    const { flatmateId } = req.params;
    const { permanent = false } = req.body;

    if (!flatmateId) {
        throw new ApiError(400, "Flatmate ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(flatmateId)) {
        throw new ApiError(400, "Invalid flatmate ID");
    }

    const flatmate = await Flatmate.findById(flatmateId);

    if (!flatmate) {
        throw new ApiError(404, "Flatmate not found");
    }

    if (permanent) {
        // Permanently delete the flatmate record
        await Flatmate.findByIdAndDelete(flatmateId);
        return res.status(200).json(
            new ApiResponse(200, {}, "Flatmate permanently removed")
        );
    } else {
        // Mark as inactive
        flatmate.status = 'inactive';
        flatmate.leftAt = new Date();
        await flatmate.save();

        return res.status(200).json(
            new ApiResponse(200, flatmate, "Flatmate marked as inactive")
        );
    }
});

// Reactivate flatmate
const reactivateFlatmate = asyncHandler(async (req, res) => {
    const { flatmateId } = req.params;

    if (!flatmateId) {
        throw new ApiError(400, "Flatmate ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(flatmateId)) {
        throw new ApiError(400, "Invalid flatmate ID");
    }

    const flatmate = await Flatmate.findById(flatmateId);

    if (!flatmate) {
        throw new ApiError(404, "Flatmate not found");
    }

    flatmate.status = 'active';
    flatmate.leftAt = null;
    await flatmate.save();

    const populatedFlatmate = await Flatmate.findById(flatmate._id)
        .populate('userId', 'userName email');

    return res.status(200).json(
        new ApiResponse(200, populatedFlatmate, "Flatmate reactivated successfully")
    );
});

// Get flatmate statistics
const getFlatmateStats = asyncHandler(async (req, res) => {
    const stats = await Flatmate.aggregate([
        {
            $group: {
                _id: null,
                totalFlatmates: { $sum: 1 },
                activeFlatmates: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "active"] }, 1, 0]
                    }
                },
                inactiveFlatmates: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "inactive"] }, 1, 0]
                    }
                },
                totalMonthlyContribution: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "active"] }, "$monthlyContribution", 0]
                    }
                },
                averageContribution: {
                    $avg: {
                        $cond: [{ $eq: ["$status", "active"] }, "$monthlyContribution", null]
                    }
                }
            }
        }
    ]);

    const result = stats[0] || {
        totalFlatmates: 0,
        activeFlatmates: 0,
        inactiveFlatmates: 0,
        totalMonthlyContribution: 0,
        averageContribution: 0
    };

    return res.status(200).json(
        new ApiResponse(200, result, "Flatmate statistics fetched successfully")
    );
});

// Get invitation details by token
const getInvitationByToken = asyncHandler(async (req, res) => {
    const { token } = req.params;

    if (!token) {
        throw new ApiError(400, "Invitation token is required");
    }

    const invitation = await Invitation.findOne({ token })
        .populate('invitedBy', 'userName email');

    if (!invitation) {
        throw new ApiError(404, "Invitation not found");
    }

    if (invitation.isExpired()) {
        invitation.status = 'expired';
        await invitation.save();
        throw new ApiError(410, "Invitation has expired");
    }

    if (invitation.status !== 'pending') {
        throw new ApiError(400, `Invitation is ${invitation.status}`);
    }

    return res.status(200).json(
        new ApiResponse(200, invitation, "Invitation details fetched successfully")
    );
});

// Accept invitation and create flatmate
const acceptInvitation = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { userDetails } = req.body; // Additional user details if needed

    if (!token) {
        throw new ApiError(400, "Invitation token is required");
    }

    const invitation = await Invitation.findOne({ token })
        .populate('invitedBy', 'userName email');

    if (!invitation) {
        throw new ApiError(404, "Invitation not found");
    }

    if (!invitation.canBeAccepted()) {
        throw new ApiError(400, "Invitation cannot be accepted");
    }

    // Check if user already exists
    let user = await User.findOne({ email: invitation.inviteeEmail });

    if (!user) {
        // Create user if doesn't exist
        const tempPassword = Math.random().toString(36).slice(-8);
        
        user = await User.create({
            userName: invitation.inviteeName.toLowerCase().replace(/\s+/g, '_'),
            email: invitation.inviteeEmail,
            password: tempPassword,
            ...userDetails
        });
    }

    // Check if flatmate already exists
    const existingFlatmate = await Flatmate.findOne({ userId: user._id });
    if (existingFlatmate) {
        throw new ApiError(400, "This user is already a flatmate");
    }

    // Create flatmate
    const flatmate = await Flatmate.create({
        userId: user._id,
        name: invitation.inviteeName,
        email: invitation.inviteeEmail,
        role: invitation.role,
        monthlyContribution: invitation.monthlyContribution,
        contactNumber: invitation.inviteePhone,
        emergencyContact: invitation.emergencyContact
    });

    // Accept invitation
    await invitation.accept({
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    const populatedFlatmate = await Flatmate.findById(flatmate._id)
        .populate('userId', 'userName email');

    return res.status(201).json(
        new ApiResponse(201, {
            flatmate: populatedFlatmate,
            invitation: invitation
        }, "Invitation accepted and flatmate added successfully")
    );
});

// Get user's invitations
const getUserInvitations = asyncHandler(async (req, res) => {
    const { status } = req.query;
    
    const filter = { invitedBy: req.user._id };
    if (status) filter.status = status;

    const invitations = await Invitation.find(filter)
        .sort({ createdAt: -1 })
        .populate('invitedBy', 'userName email');

    return res.status(200).json(
        new ApiResponse(200, invitations, "Invitations fetched successfully")
    );
});

// Cancel invitation
const cancelInvitation = asyncHandler(async (req, res) => {
    const { invitationId } = req.params;

    if (!invitationId) {
        throw new ApiError(400, "Invitation ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(invitationId)) {
        throw new ApiError(400, "Invalid invitation ID");
    }

    const invitation = await Invitation.findOne({
        _id: invitationId,
        invitedBy: req.user._id
    });

    if (!invitation) {
        throw new ApiError(404, "Invitation not found");
    }

    await invitation.cancel();

    return res.status(200).json(
        new ApiResponse(200, invitation, "Invitation cancelled successfully")
    );
});

// Resend invitation SMS
const resendInvitationSMS = asyncHandler(async (req, res) => {
    const { invitationId } = req.params;

    if (!invitationId) {
        throw new ApiError(400, "Invitation ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(invitationId)) {
        throw new ApiError(400, "Invalid invitation ID");
    }

    const invitation = await Invitation.findOne({
        _id: invitationId,
        invitedBy: req.user._id
    }).populate('invitedBy', 'userName email');

    if (!invitation) {
        throw new ApiError(404, "Invitation not found");
    }

    if (invitation.status !== 'pending') {
        throw new ApiError(400, "Can only resend SMS for pending invitations");
    }

    if (invitation.isExpired()) {
        throw new ApiError(410, "Cannot resend SMS for expired invitation");
    }

    // Send SMS invitation
    const smsResult = await smsService.sendInvitationSMS(
        invitation.inviteePhone,
        invitation.inviteeName,
        invitation.invitedBy.userName,
        invitation.invitationLink
    );

    // Update invitation with SMS status
    invitation.smsSent = smsResult.success;
    if (smsResult.success) {
        invitation.smsStatus = {
            messageSid: smsResult.messageSid,
            sentAt: new Date()
        };
    } else {
        invitation.smsStatus = {
            error: smsResult.error || smsResult.message,
            sentAt: new Date()
        };
    }
    await invitation.save();

    return res.status(200).json(
        new ApiResponse(200, {
            invitation,
            sms: smsResult
        }, smsResult.success ? "Invitation SMS sent successfully" : "Failed to send invitation SMS")
    );
});

export {
    getAllFlatmates,
    getActiveFlatmates,
    addFlatmate,
    updateFlatmate,
    removeFlatmate,
    reactivateFlatmate,
    getFlatmateStats,
    getInvitationByToken,
    acceptInvitation,
    getUserInvitations,
    cancelInvitation,
    resendInvitationSMS
};