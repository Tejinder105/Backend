// SMS Service has been disabled
// Original functionality moved to smsService.js.backup
// The SMS invitation feature has been removed from the application

import crypto from 'crypto';

class SMSService {
  constructor() {
    console.log('SMS Service disabled - invitations will be created without SMS sending');
  }

  // Generate a unique invitation token (keeping this utility function)
  generateInvitationToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Create invitation link (keeping this utility function)
  createInvitationLink(token) {
    const baseUrl = process.env.FRONTEND_URL || 'https://smartrent.app';
    return `${baseUrl}/join/${token}`;
  }

  // Disabled SMS functions - return failure responses
  async sendInvitationSMS() {
    return {
      success: false,
      message: 'SMS service disabled'
    };
  }

  async sendSMS() {
    return {
      success: false,
      message: 'SMS service disabled'
    };
  }

  async sendPaymentReminderSMS() {
    return {
      success: false,
      message: 'SMS service disabled'
    };
  }

  async sendFlatInvitationSMS() {
    return {
      success: false,
      message: 'SMS service disabled'
    };
  }

  async sendExpenseSplitSMS() {
    return {
      success: false,
      message: 'SMS service disabled'
    };
  }
}

export default new SMSService();