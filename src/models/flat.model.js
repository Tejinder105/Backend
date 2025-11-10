import mongoose, { Schema } from 'mongoose';

const flatSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zipCode: { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' }
  },
  
  // Monthly rent amount
  rent: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Currency
  currency: {
    type: String,
    default: 'INR',
    uppercase: true
  },
  
  // Monthly budget
  monthlyBudget: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Unique join code (never expires)
  joinCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  
  // Flat admin (creator)
  admin: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Flat members
  members: [{
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'co_tenant', 'subtenant', 'guest'],
      default: 'co_tenant'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'pending'],
      default: 'active'
    },
    monthlyContribution: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  
  // Flat statistics
  stats: {
    totalMembers: {
      type: Number,
      default: 0
    },
    totalExpenses: {
      type: Number,
      default: 0
    },
    totalPayments: {
      type: Number,
      default: 0
    }
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'archived'],
    default: 'active'
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

flatSchema.index({ admin: 1 });
flatSchema.index({ 'members.userId': 1 });
flatSchema.index({ status: 1 });


flatSchema.methods.generateJoinCode = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

flatSchema.methods.addMember = function(userId, role = 'co_tenant', monthlyContribution = 0) {
  const existingMember = this.members.find(member => 
    member.userId.toString() === userId.toString()
  );
  
  if (existingMember) {
    throw new Error('User is already a member of this flat');
  }
  
  // Add new member
  this.members.push({
    userId,
    role,
    monthlyContribution,
    joinedAt: new Date(),
    status: 'active'
  });
  
  // Update stats
  this.stats.totalMembers = this.members.filter(m => m.status === 'active').length;
  this.updatedAt = new Date();
  
  return this.save();
};

flatSchema.methods.removeMember = function(userId) {
  if (this.admin.toString() === userId.toString()) {
    throw new Error('Cannot remove flat admin');
  }
  
  // Remove member
  this.members = this.members.filter(member => 
    member.userId.toString() !== userId.toString()
  );
  
  this.stats.totalMembers = this.members.filter(m => m.status === 'active').length;
  this.updatedAt = new Date();
  
  return this.save();
};

flatSchema.methods.updateMemberRole = function(userId, newRole) {
  const member = this.members.find(member => 
    member.userId.toString() === userId.toString()
  );
  
  if (!member) {
    throw new Error('Member not found');
  }
  
  member.role = newRole;
  this.updatedAt = new Date();
  
  return this.save();
};

flatSchema.methods.isAdmin = function(userId) {
  return this.admin.toString() === userId.toString();
};

flatSchema.methods.isMember = function(userId) {
  return this.members.some(member => {
    const memberId = member.userId._id ? member.userId._id.toString() : member.userId.toString();
    return memberId === userId.toString() && member.status === 'active';
  });
};

flatSchema.methods.getMember = function(userId) {
  return this.members.find(member => {
    const memberId = member.userId._id ? member.userId._id.toString() : member.userId.toString();
    return memberId === userId.toString();
  });
};

flatSchema.methods.getActiveMembers = function() {
  return this.members.filter(member => member.status === 'active');
};


flatSchema.statics.generateUniqueJoinCode = async function() {
  let code;
  let attempts = 0;
  const maxAttempts = 10;
  
  do {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    attempts++;
  } while (await this.findOne({ joinCode: code }) && attempts < maxAttempts);
  
  if (attempts >= maxAttempts) {
    throw new Error('Could not generate unique join code');
  }
  
  return code;
};

flatSchema.statics.findByJoinCode = function(joinCode) {
  return this.findOne({ joinCode: joinCode.toUpperCase(), status: 'active' })
    .populate('admin', 'userName email')
    .populate('members.userId', 'userName email');
};

flatSchema.statics.findUserFlats = function(userId) {
  return this.find({
    $or: [
      { admin: userId },
      { 'members.userId': userId }
    ],
    status: 'active'
  })
  .populate('admin', 'userName email')
  .populate('members.userId', 'userName email')
  .sort({ createdAt: -1 });
};

flatSchema.pre('save', function(next) {
  if (this.isNew && !this.joinCode) {
    this.constructor.generateUniqueJoinCode()
      .then(code => {
        this.joinCode = code;
        next();
      })
      .catch(next);
  } else {
    this.updatedAt = new Date();
    next();
  }
});

flatSchema.pre('save', function(next) {
  if (this.isModified('members')) {
    this.stats.totalMembers = this.members.filter(m => m.status === 'active').length;
  }
  next();
});

export const Flat = mongoose.model('Flat', flatSchema);